import type { Activity, StatusLog, Unit } from '@/types/domain';
import { applicableActivities, EMPTY_APPLICABILITY_INDEX } from '@/utils/applicability';
import type { ApplicabilityIndex } from '@/utils/applicability';

/**
 * progressAnalytics — pure schedule-variance and rollup math shared by
 * Map Lag Mode, the Unit Journey timeline, Floor Pulse, and the Type Scorecard.
 *
 * All date-only fields (planned_start_date, planned_end_date, logged_date) are
 * 'YYYY-MM-DD' strings; they are parsed at UTC noon so day arithmetic is
 * timezone-stable. `today` is always passed in explicitly so the functions
 * stay deterministic and testable.
 *
 * Activity applicability (N/A): callers must pass each unit's APPLICABLE
 * track-activities. `computeUnitVariance` takes the already-filtered list;
 * `summarizeGroup` filters internally via the optional `applicabilityIndex`.
 * N/A activities are excluded from bottleneck detection and every denominator.
 */

const DAY_MS = 86_400_000;

/** Parse a 'YYYY-MM-DD' date-only string at UTC noon. Returns null for falsy/invalid input. */
export function parseDay(d: string | null | undefined): Date | null {
  if (!d) return null;
  const t = Date.parse(`${d.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(t) ? null : new Date(t);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function dayDiff(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

export function orderedTrackActivities(activities: Activity[], track: string): Activity[] {
  return activities
    .filter(a => a.track === track)
    .sort((a, b) => (a.sequence_order || 0) - (b.sequence_order || 0));
}

// ---------------------------------------------------------------------------
// Per-unit schedule variance
// ---------------------------------------------------------------------------

export type VarianceKind =
  | 'complete'    // every activity in the track is completed
  | 'behind'      // bottleneck's planned finish has passed
  | 'ahead'       // bottleneck's planned start is still in the future
  | 'onpace'      // inside the bottleneck's planned window
  | 'noplan'      // bottleneck has no planned dates — fall back to idle time
  | 'notstarted'; // no work logged and no plan to measure against

export interface VarianceInfo {
  kind: VarianceKind;
  /** behind: days late (>0). ahead: days until due (>0). 0 otherwise. */
  days: number;
  /** noplan only: days since the unit's last logged activity (null if unknown). */
  idleDays: number | null;
  /** Bottleneck activity name (null when complete). */
  bottleneck: string | null;
  /** Temporal state of the bottleneck slot ('none' when no log exists). */
  state: string;
}

/** Most recent write timestamp across a unit's current-state logs. */
export function lastActivityAt(unitLogs: StatusLog[]): Date | null {
  let latest: number | null = null;
  for (const log of unitLogs) {
    const stamp = log.client_timestamp || log.created_at || null;
    const t = stamp ? Date.parse(stamp) : NaN;
    if (!Number.isNaN(t) && (latest === null || t > latest)) latest = t;
  }
  return latest === null ? null : new Date(latest);
}

/**
 * Schedule variance of a unit's bottleneck activity (the earliest incomplete
 * activity in sequence order). `unitLogs` must already be filtered to one
 * unit + one track; `trackActivities` must be sequence-ordered for that track.
 *
 * Planned dates are read from the bottleneck activity's `status_logs` row.
 * If no row exists yet for that activity, it is treated as unplanned —
 * activity-template dates do NOT flow through here (dates live per slot).
 */
export function computeUnitVariance(
  unitLogs: StatusLog[],
  trackActivities: Activity[],
  today: Date
): VarianceInfo {
  if (trackActivities.length === 0) {
    return { kind: 'notstarted', days: 0, idleDays: null, bottleneck: null, state: 'none' };
  }

  let bottleneck: Activity | null = null;
  let bottleneckLog: StatusLog | undefined;
  for (const a of trackActivities) {
    const log = unitLogs.find(s => s.activityName === a.name);
    if (!log || log.temporal_state !== 'completed') {
      bottleneck = a;
      bottleneckLog = log;
      break;
    }
  }

  if (!bottleneck) {
    return { kind: 'complete', days: 0, idleDays: null, bottleneck: null, state: 'completed' };
  }

  const state = bottleneckLog?.temporal_state || 'none';
  const plannedStart = parseDay(bottleneckLog?.planned_start_date);
  const plannedEnd = parseDay(bottleneckLog?.planned_end_date);

  if (plannedEnd && today > plannedEnd) {
    return { kind: 'behind', days: dayDiff(plannedEnd, today), idleDays: null, bottleneck: bottleneck.name, state };
  }
  if (plannedStart && today < plannedStart) {
    return { kind: 'ahead', days: dayDiff(today, plannedStart), idleDays: null, bottleneck: bottleneck.name, state };
  }
  if (plannedStart || plannedEnd) {
    return { kind: 'onpace', days: 0, idleDays: null, bottleneck: bottleneck.name, state };
  }

  const started = unitLogs.some(s => s.temporal_state !== 'none');
  if (!started) {
    return { kind: 'notstarted', days: 0, idleDays: null, bottleneck: bottleneck.name, state };
  }
  const last = lastActivityAt(unitLogs);
  return {
    kind: 'noplan',
    days: 0,
    idleDays: last ? Math.max(0, dayDiff(last, today)) : null,
    bottleneck: bottleneck.name,
    state,
  };
}

// ---------------------------------------------------------------------------
// Per-activity schedule story (actual start · planned/actual durations · variances)
//
// The per-ACTIVITY breakdown behind a unit's bottleneck verdict: when did work
// actually start, how long did it plan vs run, and the three signed variances.
// Pure + `Date.now()`-free — the caller supplies `today` (as `actualEnd`) for the
// ongoing case. Consumed by the Unit History modal; the flat list stays a summary.
// ---------------------------------------------------------------------------

/** Minimal shape of a `status_audit_log` row needed to locate the first "ongoing" event. */
export interface AuditEventLike {
  temporal_state?: string | null;
  /** Capture-time stamp (when the field marked it ongoing); preferred for "actual start". */
  client_timestamp?: string | null;
  /** Server-side audit write time; the fallback stamp + the ordering key. */
  changed_at?: string | null;
  created_at?: string | null;
  /** Completion date on a `completed` event; the jumped-straight-to-complete fallback. */
  logged_date?: string | null;
}

/**
 * ISO timestamp of when an activity ACTUALLY started: the earliest `ongoing`
 * audit event's `client_timestamp` (capture time), falling back to its
 * `changed_at`. Rows may arrive in any order — they are ordered by
 * `changed_at`/`created_at` so the earliest ongoing wins. Returns null when the
 * activity never went ongoing (it was never started, or it jumped straight to
 * complete — the caller supplies that completion-day fallback).
 *
 * This is the SINGLE definition of "actual start", lifted from the Unit History
 * Journey tab so the timeline and any future consumer never re-derive it.
 */
export function firstOngoingIso(rows: AuditEventLike[]): string | null {
  const firstOngoing = rows
    .filter(r => r.temporal_state === 'ongoing')
    .sort((a, b) =>
      Date.parse(a.changed_at || a.created_at || '') - Date.parse(b.changed_at || b.created_at || ''))[0];
  if (!firstOngoing) return null;
  return firstOngoing.client_timestamp || firstOngoing.changed_at || null;
}

/**
 * The fully-resolved ISO "actual start" for one activity — {@link firstOngoingIso}
 * with the two fallbacks the Unit Journey has always applied: (1) an activity that
 * jumped straight to `completed` (no `ongoing` event) starts on its completion day;
 * (2) a stray late `ongoing` event that post-dates completion is clamped back to the
 * completion day. `events` are one activity's audit rows (any order); `state` +
 * `loggedDate` come from the current `status_logs` row. Returns null when the
 * activity never started and never completed. Pure — feeds {@link activitySchedule}.
 */
export function resolveActualStartIso(
  events: AuditEventLike[],
  opts: { state?: string | null; loggedDate?: string | null },
): string | null {
  const { state, loggedDate } = opts;
  const completed = events
    .filter(e => e.temporal_state === 'completed')
    .sort((a, b) => Date.parse(a.changed_at || a.created_at || '') - Date.parse(b.changed_at || b.created_at || ''));
  const lastCompletion = completed[completed.length - 1];
  const completionIso = state === 'completed'
    ? (loggedDate || lastCompletion?.logged_date || lastCompletion?.changed_at || null)
    : null;

  let iso = firstOngoingIso(events);
  if (!iso && completionIso) iso = completionIso; // jumped straight to complete
  if (iso && completionIso && iso.slice(0, 10) > completionIso.slice(0, 10)) iso = completionIso; // clamp
  return iso;
}

export interface ActivityScheduleInput {
  /** Planned window start ('YYYY-MM-DD'). */
  plannedStart?: string | null;
  /** Planned window finish ('YYYY-MM-DD'). */
  plannedEnd?: string | null;
  /** Actual start — {@link firstOngoingIso}, or the completion day when it jumped straight to complete. */
  actualStart?: string | null;
  /** Actual finish — the completion date when completed, or `today` while ongoing (caller's choice), else null. */
  actualEnd?: string | null;
}

export interface ActivityScheduleMetrics {
  /** Planned window length in whole days (a same-day window is 0). Null when a planned date is missing. */
  plannedDuration: number | null;
  /** Actual elapsed days start→end (counts to `today` while ongoing). Null when either actual date is missing. */
  actualDuration: number | null;
  /** Signed days late to start (+ = started after plan). Null when plannedStart or actualStart is missing. */
  varianceStart: number | null;
  /** Signed days late to finish (+ = finished after plan). Null when plannedEnd or actualEnd is missing. */
  varianceCompleted: number | null;
  /** Signed days over plan (+ = ran longer than planned). Null when either duration is null. */
  varianceDuration: number | null;
}

/**
 * The per-activity schedule story as signed whole-day numbers — "planned 10d,
 * ran 16d, started 4d late". Every field NULL-propagates: a missing input yields
 * `null`, never `0`, so a blank never reads as an on-time "0d" (a genuine 0 — a
 * same-day window, or actual == plan — is real and kept). Late = positive.
 * Pure; pass ISO 'YYYY-MM-DD' strings (the ongoing case passes `today` as
 * `actualEnd`). Reuses {@link parseDay}/{@link dayDiff}.
 */
export function activitySchedule({
  plannedStart, plannedEnd, actualStart, actualEnd,
}: ActivityScheduleInput): ActivityScheduleMetrics {
  const pStart = parseDay(plannedStart);
  const pEnd = parseDay(plannedEnd);
  const aStart = parseDay(actualStart);
  const aEnd = parseDay(actualEnd);

  const plannedDuration = pStart && pEnd ? dayDiff(pStart, pEnd) : null;
  const actualDuration = aStart && aEnd ? dayDiff(aStart, aEnd) : null;
  const varianceStart = pStart && aStart ? dayDiff(pStart, aStart) : null;
  const varianceCompleted = pEnd && aEnd ? dayDiff(pEnd, aEnd) : null;
  const varianceDuration =
    plannedDuration !== null && actualDuration !== null ? actualDuration - plannedDuration : null;

  return { plannedDuration, actualDuration, varianceStart, varianceCompleted, varianceDuration };
}

// ---------------------------------------------------------------------------
// Variance → color / label (single source of truth for the lag encoding)
// ---------------------------------------------------------------------------

export const VARIANCE_COLORS = {
  complete: '#10b981',   // emerald-500
  ahead: '#3b82f6',      // blue-500
  onpace: '#94a3b8',     // slate-400
  behind1: '#fbbf24',    // amber-400  · 1–3 days
  behind4: '#f59e0b',    // amber-500  · 4–7 days
  behind8: '#ea580c',    // orange-600 · 8–14 days
  behind15: '#dc2626',   // red-600    · 15+ days
  noplan: '#475569',     // slate-600
  notstarted: '#cbd5e1', // slate-300
} as const;

export function varianceFill(info: VarianceInfo): string {
  switch (info.kind) {
    case 'complete': return VARIANCE_COLORS.complete;
    case 'ahead': return VARIANCE_COLORS.ahead;
    case 'onpace': return VARIANCE_COLORS.onpace;
    case 'noplan': return VARIANCE_COLORS.noplan;
    case 'notstarted': return VARIANCE_COLORS.notstarted;
    case 'behind':
      if (info.days <= 3) return VARIANCE_COLORS.behind1;
      if (info.days <= 7) return VARIANCE_COLORS.behind4;
      if (info.days <= 14) return VARIANCE_COLORS.behind8;
      return VARIANCE_COLORS.behind15;
  }
}

/**
 * Color for a signed COMPLETION variance (days late to finish, + = late) — the
 * cheap per-activity number shown on the expanded list rows (Schedule Variance
 * Columns Phase 2). Reuses the existing lag encoding, never a new palette:
 * late (>0) rides {@link varianceFill}'s `behind` severity ramp; early (<0)
 * reads emerald (finished ahead); exactly on time (0) reads muted slate. `null`
 * (no completion / no planned finish) is never rendered, so it degrades to the
 * neutral on-pace slate rather than throwing.
 */
export function varianceCompletedColor(days: number | null): string {
  if (days === null || days === 0) return VARIANCE_COLORS.onpace;
  if (days < 0) return VARIANCE_COLORS.complete;
  return varianceFill({ kind: 'behind', days, idleDays: null, bottleneck: null, state: 'completed' });
}

export function varianceLabel(info: VarianceInfo): string {
  switch (info.kind) {
    case 'complete': return 'Complete';
    case 'ahead': return `Due in ${info.days}d — ahead of plan`;
    case 'onpace': return 'On pace';
    case 'behind': return `${info.days}d behind plan`;
    case 'noplan':
      return info.idleDays !== null ? `No plan dates · idle ${info.idleDays}d` : 'No plan dates';
    case 'notstarted': return 'Not started';
  }
}

/** Fixed legend entries for the map's Schedule Lag mode. */
export const VARIANCE_LEGEND: { label: string; color: string }[] = [
  { label: 'Ahead of plan', color: VARIANCE_COLORS.ahead },
  { label: 'On pace', color: VARIANCE_COLORS.onpace },
  { label: '1–3 days behind', color: VARIANCE_COLORS.behind1 },
  { label: '4–7 days behind', color: VARIANCE_COLORS.behind4 },
  { label: '8–14 days behind', color: VARIANCE_COLORS.behind8 },
  { label: '15+ days behind', color: VARIANCE_COLORS.behind15 },
  { label: 'No plan dates', color: VARIANCE_COLORS.noplan },
  { label: 'Complete', color: VARIANCE_COLORS.complete },
  { label: 'Not started', color: VARIANCE_COLORS.notstarted },
];

// ---------------------------------------------------------------------------
// Group rollups (per sheet, per unit type) for Floor Pulse / Type Scorecard
// ---------------------------------------------------------------------------

/** Minimal shape of a completed audit-log row used for pace math. */
export interface CompletionEvent {
  unit_id: string | null;
  logged_date: string | null;
  track?: string | null;
}

export interface GroupRollup {
  unitCount: number;
  totalSlots: number;
  completedSlots: number;
  ongoingSlots: number;
  completionPct: number;
  /**
   * % of ALL slots whose planned finish has passed — same denominator as
   * `completionPct`, so the two are directly comparable on one axis (the plan
   * tick sits on the completion bar). Null when no slot has planned dates.
   */
  plannedByTodayPct: number | null;
  /** Fraction of slots (0–1) that carry a planned finish date. Drives whether the plan tick is trustworthy enough to show. */
  plannedCoverage: number;
  /** Mean signed bottleneck variance in days (positive = behind). Null when no unit has a scheduled bottleneck. */
  avgBehindDays: number | null;
  stalledUnitIds: string[];
  /** Completions per ISO week (Mon start), oldest → newest, last `weeks` entries incl. current partial week. */
  weekly: { weekStart: string; count: number }[];
  /** Completions in the trailing 7 rolling days — a current-rate measure, comparable to `trailingAvg`. */
  paceThisWeek: number;
  /** Mean of the 4 weeks before the current one. Null when suppressed. */
  trailingAvg: number | null;
  /** Projected completion date at median weekly pace, or null. */
  forecastDate: string | null;
  forecastSuppressed: 'small-sample' | 'no-pace' | 'complete' | null;
}

// Exported so dashboard tooltips/captions quote the REAL thresholds instead of
// restating them from memory (UI Polish P3). Values are unchanged.
export const STALL_THRESHOLD_DAYS = 14;
export const SMALL_SAMPLE_SLOTS = 12;
export const FORECAST_WINDOW_WEEKS = 6;
/** Below this fraction of dated slots, the plan tick is too sparse to be trustworthy and is hidden. */
export const PLAN_TICK_MIN_COVERAGE = 0.5;

/** ISO 'YYYY-MM-DD' of the Monday of `d`'s week (UTC, Mon-start). Exported so the
 *  Phase-6 rate + forecast-trend utils bucket by the SAME week boundary. */
export function mondayOf(d: Date): string {
  const day = d.getUTCDay(); // 0 = Sun
  const offset = day === 0 ? 6 : day - 1;
  const monday = new Date(d.getTime() - offset * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

/**
 * The median-pace finish projection — factored out of {@link summarizeGroup} so the
 * Phase-6 forecast-TREND util can replay it as-of past vantage dates without forking
 * the math (AGENTS.md §3). Same suppression honesty: 'complete' when nothing remains,
 * 'small-sample' below {@link SMALL_SAMPLE_SLOTS} total slots, 'no-pace' when the
 * median of the last {@link FORECAST_WINDOW_WEEKS} full weeks is zero.
 *
 * @param fullWeekCounts contiguous weekly completion counts (INCLUDING zero weeks),
 *   oldest→newest, EXCLUDING the current partial week. The median is taken over the
 *   trailing {@link FORECAST_WINDOW_WEEKS} of them.
 */
export function projectForecastDate(params: {
  remaining: number;
  totalSlots: number;
  fullWeekCounts: number[];
  today: Date;
}): { forecastDate: string | null; forecastSuppressed: GroupRollup['forecastSuppressed'] } {
  const { remaining, totalSlots, fullWeekCounts, today } = params;
  if (remaining <= 0 && totalSlots > 0) return { forecastDate: null, forecastSuppressed: 'complete' };
  if (totalSlots < SMALL_SAMPLE_SLOTS) return { forecastDate: null, forecastSuppressed: 'small-sample' };

  const windowSize = Math.min(FORECAST_WINDOW_WEEKS, fullWeekCounts.length);
  const window = fullWeekCounts.slice(-windowSize).slice().sort((a, b) => a - b);
  const median = window.length === 0 ? 0
    : window.length % 2 === 1
      ? window[(window.length - 1) / 2]
      : (window[window.length / 2 - 1] + window[window.length / 2]) / 2;
  if (median <= 0) return { forecastDate: null, forecastSuppressed: 'no-pace' };

  const weeksLeft = remaining / median;
  const forecastDate = new Date(today.getTime() + Math.ceil(weeksLeft * 7) * DAY_MS)
    .toISOString().slice(0, 10);
  return { forecastDate, forecastSuppressed: null };
}

export interface GroupRollupInput {
  /** Units in the group — `unit_type` is needed to resolve applicability. */
  units: Pick<Unit, 'id' | 'unit_type'>[];
  /** Current-state logs for (at least) those units, single project. */
  statuses: StatusLog[];
  activities: Activity[];
  track: string;
  /** Completed audit events for (at least) those units. */
  history: CompletionEvent[];
  today: Date;
  /** How many weekly buckets to return (default 8). */
  weeks?: number;
  /** N/A activities are dropped from every denominator + bottleneck. Defaults to all-applicable. */
  applicabilityIndex?: ApplicabilityIndex;
}

export function summarizeGroup({
  units, statuses, activities, track, history, today, weeks = 8,
  applicabilityIndex = EMPTY_APPLICABILITY_INDEX,
}: GroupRollupInput): GroupRollup {
  const trackActivities = orderedTrackActivities(activities, track);
  const idSet = new Set(units.map(u => u.id));
  const trackStatuses = statuses.filter(s => s.track === track && s.unit_id && idSet.has(s.unit_id));

  const logsByUnit = new Map<string, StatusLog[]>();
  for (const s of trackStatuses) {
    const arr = logsByUnit.get(s.unit_id as string);
    if (arr) arr.push(s);
    else logsByUnit.set(s.unit_id as string, [s]);
  }

  // One pass per unit over its APPLICABLE activities — N/A slots never enter
  // the denominator, the completion/ongoing counts, or the bottleneck.
  let totalSlots = 0;
  let completedSlots = 0;
  let ongoingSlots = 0;
  let plannedDatedSlots = 0;
  let plannedDueSlots = 0;
  const stalledUnitIds: string[] = [];
  let varianceSum = 0;
  let varianceCount = 0;

  for (const unit of units) {
    const appActs = applicableActivities(trackActivities, unit, applicabilityIndex);
    const unitLogs = logsByUnit.get(unit.id) || [];

    totalSlots += appActs.length;
    for (const a of appActs) {
      const log = unitLogs.find(s => s.activityName === a.name);
      if (log?.temporal_state === 'completed') completedSlots++;
      else if (log?.temporal_state === 'ongoing') ongoingSlots++;
      const end = log ? parseDay(log.planned_end_date) : null;
      if (end) {
        plannedDatedSlots++;
        if (end <= today) plannedDueSlots++;
      }
    }

    const info = computeUnitVariance(unitLogs, appActs, today);
    if (info.kind === 'behind') { varianceSum += info.days; varianceCount++; }
    else if (info.kind === 'ahead') { varianceSum -= info.days; varianceCount++; }
    else if (info.kind === 'onpace') { varianceCount++; }

    if (info.kind !== 'complete' && info.kind !== 'notstarted') {
      const started = unitLogs.some(s => s.temporal_state === 'ongoing' || s.temporal_state === 'completed');
      const last = lastActivityAt(unitLogs);
      if (started && last && dayDiff(last, today) >= STALL_THRESHOLD_DAYS) {
        stalledUnitIds.push(unit.id);
      }
    }
  }

  // --- Pace from the audit trail ---
  const groupHistory = history.filter(h => h.unit_id && idSet.has(h.unit_id) && h.logged_date);
  const byWeek = new Map<string, number>();
  let paceThisWeek = 0;
  for (const h of groupHistory) {
    const d = parseDay(h.logged_date);
    if (!d || d > today) continue; // ignore future-dated entries
    const wk = mondayOf(d);
    byWeek.set(wk, (byWeek.get(wk) || 0) + 1);
    if (dayDiff(d, today) < 7) paceThisWeek++;
  }

  const currentWeek = mondayOf(today);
  const weekly: { weekStart: string; count: number }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const wkStart = new Date(Date.parse(`${currentWeek}T12:00:00Z`) - i * 7 * DAY_MS)
      .toISOString().slice(0, 10);
    weekly.push({ weekStart: wkStart, count: byWeek.get(wkStart) || 0 });
  }

  const fullWeeks = weekly.slice(0, -1); // exclude current partial week
  const trailing4 = fullWeeks.slice(-4);
  const trailingAvg = trailing4.length > 0
    ? trailing4.reduce((sum, w) => sum + w.count, 0) / trailing4.length
    : null;

  // --- Forecast at median weekly pace (shared with the Phase-6 forecast-trend util) ---
  const remaining = totalSlots - completedSlots;
  const { forecastDate, forecastSuppressed } = projectForecastDate({
    remaining, totalSlots, fullWeekCounts: fullWeeks.map(w => w.count), today,
  });

  return {
    unitCount: units.length,
    totalSlots,
    completedSlots,
    ongoingSlots,
    completionPct: totalSlots > 0 ? (completedSlots / totalSlots) * 100 : 0,
    plannedByTodayPct: plannedDatedSlots > 0 ? (plannedDueSlots / totalSlots) * 100 : null,
    plannedCoverage: totalSlots > 0 ? plannedDatedSlots / totalSlots : 0,
    avgBehindDays: varianceCount > 0 ? varianceSum / varianceCount : null,
    stalledUnitIds,
    weekly,
    paceThisWeek,
    trailingAvg: totalSlots < SMALL_SAMPLE_SLOTS ? null : trailingAvg,
    forecastDate,
    forecastSuppressed,
  };
}

// ---------------------------------------------------------------------------
// Dashboard presentation helpers (planned-vs-projected · hero clamp · swarm)
//
// Presentation-only derivations layered AROUND the pace math above — they never
// change a forecast, only compare / clamp / label existing values. All take dates
// as ISO 'YYYY-MM-DD' strings and are `Date.now()`-free so they stay testable
// (Data Storytelling P1/P2).
// ---------------------------------------------------------------------------

/**
 * The scope's planned finish: the latest `planned_end_date` among its slots on
 * one track. Null when no slot carries a planned end date — that null drives both
 * the planned-vs-projected delta AND its "no planned dates" nudge state. ISO
 * 'YYYY-MM-DD' strings sort lexicographically, so a plain string max is correct.
 */
export function scopePlannedFinish(
  statuses: Pick<StatusLog, 'track' | 'planned_end_date'>[],
  track: string,
): string | null {
  let max: string | null = null;
  for (const s of statuses) {
    if (s.track !== track || !s.planned_end_date) continue;
    if (max === null || s.planned_end_date > max) max = s.planned_end_date;
  }
  return max;
}

/**
 * Whole-day delta between a planned finish and a projected finish — positive when
 * the projection lands LATER than the plan (the scope is trending late), negative
 * when it beats the plan. Null when either date is missing. Pure; pass ISO strings.
 */
export function planVsProjected(planned: string | null, projected: string | null): number | null {
  const p = parseDay(planned);
  const q = parseDay(projected);
  return p && q ? dayDiff(p, q) : null;
}

/**
 * Clamp an aggregate forecast so it can never fall EARLIER than the latest of its
 * own per-level forecasts — an all-levels median pace can otherwise project a
 * finish that contradicts the project's slowest level. Only ever pushes the date
 * LATER (never earlier), and never fabricates a date when the aggregate honestly
 * suppressed its own (a null hero stays null — forecast honesty, AGENTS.md §3).
 * `clampedToLevel` reports when a level pinned it so the UI can explain the basis.
 */
export function clampProjectForecast(
  heroForecast: string | null,
  levelForecasts: (string | null)[],
): { date: string | null; clampedToLevel: boolean } {
  let latest: string | null = null;
  for (const f of levelForecasts) {
    if (f && (latest === null || f > latest)) latest = f;
  }
  if (heroForecast === null || latest === null || latest <= heroForecast) {
    return { date: heroForecast, clampedToLevel: false };
  }
  return { date: latest, clampedToLevel: true };
}

/**
 * True when a stalled-location count is a "swarm" — at/above `threshold` (default
 * 60%) of the tracked locations. Past this, per-level stalled chips collapse into
 * ONE "data may be stale" banner (P2). An empty/zero scope guards to false.
 */
export function isStalledSwarm(stalledCount: number, trackedCount: number, threshold = 0.6): boolean {
  if (trackedCount <= 0) return false;
  return stalledCount / trackedCount >= threshold;
}

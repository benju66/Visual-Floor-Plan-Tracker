import type { Milestone, StatusLog } from '@/types/domain';

/**
 * progressAnalytics — pure schedule-variance and rollup math shared by
 * Map Lag Mode, the Unit Journey timeline, Floor Pulse, and the Type Scorecard.
 *
 * All date-only fields (planned_start_date, planned_end_date, logged_date) are
 * 'YYYY-MM-DD' strings; they are parsed at UTC noon so day arithmetic is
 * timezone-stable. `today` is always passed in explicitly so the functions
 * stay deterministic and testable.
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

export function orderedTrackMilestones(milestones: Milestone[], track: string): Milestone[] {
  return milestones
    .filter(m => m.track === track)
    .sort((a, b) => (a.sequence_order || 0) - (b.sequence_order || 0));
}

// ---------------------------------------------------------------------------
// Per-unit schedule variance
// ---------------------------------------------------------------------------

export type VarianceKind =
  | 'complete'    // every milestone in the track is completed
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
  /** Bottleneck milestone name (null when complete). */
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
 * Schedule variance of a unit's bottleneck milestone (the earliest incomplete
 * milestone in sequence order). `unitLogs` must already be filtered to one
 * unit + one track; `trackMilestones` must be sequence-ordered for that track.
 *
 * Planned dates are read from the bottleneck milestone's `status_logs` row.
 * If no row exists yet for that milestone, it is treated as unplanned —
 * milestone-template dates do NOT flow through here (dates live per slot).
 */
export function computeUnitVariance(
  unitLogs: StatusLog[],
  trackMilestones: Milestone[],
  today: Date
): VarianceInfo {
  if (trackMilestones.length === 0) {
    return { kind: 'notstarted', days: 0, idleDays: null, bottleneck: null, state: 'none' };
  }

  let bottleneck: Milestone | null = null;
  let bottleneckLog: StatusLog | undefined;
  for (const m of trackMilestones) {
    const log = unitLogs.find(s => s.milestone === m.name);
    if (!log || log.temporal_state !== 'completed') {
      bottleneck = m;
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

const STALL_THRESHOLD_DAYS = 14;
const SMALL_SAMPLE_SLOTS = 12;
const FORECAST_WINDOW_WEEKS = 6;
/** Below this fraction of dated slots, the plan tick is too sparse to be trustworthy and is hidden. */
export const PLAN_TICK_MIN_COVERAGE = 0.5;

function mondayOf(d: Date): string {
  const day = d.getUTCDay(); // 0 = Sun
  const offset = day === 0 ? 6 : day - 1;
  const monday = new Date(d.getTime() - offset * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

export interface GroupRollupInput {
  /** Unit ids in the group. */
  unitIds: string[];
  /** Current-state logs for (at least) those units, single project. */
  statuses: StatusLog[];
  milestones: Milestone[];
  track: string;
  /** Completed audit events for (at least) those units. */
  history: CompletionEvent[];
  today: Date;
  /** How many weekly buckets to return (default 8). */
  weeks?: number;
}

export function summarizeGroup({
  unitIds, statuses, milestones, track, history, today, weeks = 8,
}: GroupRollupInput): GroupRollup {
  const trackMilestones = orderedTrackMilestones(milestones, track);
  const idSet = new Set(unitIds);
  const trackStatuses = statuses.filter(s => s.track === track && s.unit_id && idSet.has(s.unit_id));

  const logsByUnit = new Map<string, StatusLog[]>();
  for (const s of trackStatuses) {
    const arr = logsByUnit.get(s.unit_id as string);
    if (arr) arr.push(s);
    else logsByUnit.set(s.unit_id as string, [s]);
  }

  const totalSlots = unitIds.length * trackMilestones.length;
  let completedSlots = 0;
  let ongoingSlots = 0;
  let plannedDatedSlots = 0;
  let plannedDueSlots = 0;
  for (const s of trackStatuses) {
    if (s.temporal_state === 'completed') completedSlots++;
    else if (s.temporal_state === 'ongoing') ongoingSlots++;
    const end = parseDay(s.planned_end_date);
    if (end) {
      plannedDatedSlots++;
      if (end <= today) plannedDueSlots++;
    }
  }

  const stalledUnitIds: string[] = [];
  let varianceSum = 0;
  let varianceCount = 0;
  for (const id of unitIds) {
    const unitLogs = logsByUnit.get(id) || [];
    const info = computeUnitVariance(unitLogs, trackMilestones, today);
    if (info.kind === 'behind') { varianceSum += info.days; varianceCount++; }
    else if (info.kind === 'ahead') { varianceSum -= info.days; varianceCount++; }
    else if (info.kind === 'onpace') { varianceCount++; }

    if (info.kind !== 'complete' && info.kind !== 'notstarted') {
      const started = unitLogs.some(s => s.temporal_state === 'ongoing' || s.temporal_state === 'completed');
      const last = lastActivityAt(unitLogs);
      if (started && last && dayDiff(last, today) >= STALL_THRESHOLD_DAYS) {
        stalledUnitIds.push(id);
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

  // --- Forecast at median weekly pace ---
  const remaining = totalSlots - completedSlots;
  let forecastDate: string | null = null;
  let forecastSuppressed: GroupRollup['forecastSuppressed'] = null;
  if (remaining <= 0 && totalSlots > 0) {
    forecastSuppressed = 'complete';
  } else if (totalSlots < SMALL_SAMPLE_SLOTS) {
    forecastSuppressed = 'small-sample';
  } else {
    const windowSize = Math.min(FORECAST_WINDOW_WEEKS, fullWeeks.length);
    const window = fullWeeks.slice(-windowSize).map(w => w.count).sort((a, b) => a - b);
    const median = window.length === 0 ? 0
      : window.length % 2 === 1
        ? window[(window.length - 1) / 2]
        : (window[window.length / 2 - 1] + window[window.length / 2]) / 2;
    if (median <= 0) {
      forecastSuppressed = 'no-pace';
    } else {
      const weeksLeft = remaining / median;
      forecastDate = new Date(today.getTime() + Math.ceil(weeksLeft * 7) * DAY_MS)
        .toISOString().slice(0, 10);
    }
  }

  return {
    unitCount: unitIds.length,
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

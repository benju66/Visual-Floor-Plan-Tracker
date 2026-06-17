import type { Milestone, MilestoneSchedules, StatusLog, StatusLogInsert, Unit } from '@/types/domain';
import { dayDiff, orderedTrackMilestones, parseDay } from '@/utils/progressAnalytics';
import {
  applicableMilestones,
  isMilestoneApplicable,
  EMPTY_APPLICABILITY_INDEX,
  type ApplicabilityIndex,
} from '@/utils/applicability';

/**
 * ganttMath — framework-free, deterministic geometry + row-model + cascade math
 * for the Phase 3 Schedule (Gantt) view.
 *
 * This module owns the load-bearing date arithmetic so it can be unit-tested in
 * isolation. It does NOT compute schedule variance / lag colors — that stays in
 * `progressAnalytics` (the single source of truth); this file only positions
 * bars and flags whether an individual slot is past its own planned end.
 *
 * All date-only values are 'YYYY-MM-DD' strings, parsed at UTC noon (via
 * `parseDay`) so day arithmetic is timezone-stable. `today` is always passed in
 * so every function stays deterministic and testable — never call Date.now() here.
 */

const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type GanttZoom = 'day' | 'week' | 'month';

/** Pixels-per-day for each zoom level. The timeline derives all widths from these. */
export const ZOOM_PX_PER_DAY: Record<GanttZoom, number> = {
  day: 28,
  week: 12,
  month: 4,
};

/** Add `n` whole days to a UTC-noon date, staying at UTC noon. */
export function addDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * DAY_MS);
}

/** A UTC-noon date back to its 'YYYY-MM-DD' string (inverse of parseDay). */
export function toDayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Date <-> pixel mapping (day-resolution; bars always land on day boundaries)
// ---------------------------------------------------------------------------

/** Horizontal pixel offset of `date` from the left edge (`windowStart`). */
export function dateToX(date: Date, windowStart: Date, pxPerDay: number): number {
  return dayDiff(windowStart, date) * pxPerDay;
}

/** Nearest day to a pixel offset, as a UTC-noon date. */
export function xToDate(x: number, windowStart: Date, pxPerDay: number): Date {
  return addDays(windowStart, Math.round(x / pxPerDay));
}

/** Snap a raw pixel offset to the nearest whole-day gridline. */
export function snapToDay(x: number, pxPerDay: number): number {
  return Math.round(x / pxPerDay) * pxPerDay;
}

export interface BarRect {
  x: number;
  width: number;
}

/**
 * Pixel rect for a bar spanning `start`..`end` (inclusive of the end day, so a
 * same-day bar is one day wide). Accepts either date missing — a one-sided slot
 * renders as a single-day marker. Returns null only when both are absent.
 * If end precedes start, the span is taken min..max (validation lives elsewhere).
 */
export function barRect(
  start: string | null | undefined,
  end: string | null | undefined,
  windowStart: Date,
  pxPerDay: number
): BarRect | null {
  const s = parseDay(start);
  const e = parseDay(end);
  if (!s && !e) return null;
  const a = s ?? (e as Date);
  const b = e ?? (s as Date);
  const lo = a <= b ? a : b;
  const hi = a <= b ? b : a;
  return {
    x: dateToX(lo, windowStart, pxPerDay),
    width: (dayDiff(lo, hi) + 1) * pxPerDay,
  };
}

// ---------------------------------------------------------------------------
// Visible date window
// ---------------------------------------------------------------------------

export interface DateWindow {
  start: Date;
  end: Date;
}

/**
 * Compute the visible date window from a set of date strings plus `today`,
 * padded on both sides and widened to at least `minSpanDays` so a sparse or
 * empty schedule still renders a usable axis.
 */
export function windowBounds(
  dates: (string | null | undefined)[],
  today: Date,
  { padDays = 7, minSpanDays = 28 }: { padDays?: number; minSpanDays?: number } = {}
): DateWindow {
  let lo: Date | null = null;
  let hi: Date | null = null;
  for (const d of [...dates, toDayString(today)]) {
    const p = parseDay(d);
    if (!p) continue;
    if (!lo || p < lo) lo = p;
    if (!hi || p > hi) hi = p;
  }
  // Fallback: no parseable dates at all (today always parses, so this is defensive).
  const baseLo = lo ?? today;
  const baseHi = hi ?? today;

  let start = addDays(baseLo, -padDays);
  let end = addDays(baseHi, padDays);
  const span = dayDiff(start, end);
  if (span < minSpanDays) {
    end = addDays(start, minSpanDays);
  }
  return { start, end };
}

// ---------------------------------------------------------------------------
// Axis ticks
// ---------------------------------------------------------------------------

export interface GanttTick {
  date: Date;
  label: string;
  /** Heavier gridline (month boundary for day zoom, month start otherwise). */
  major: boolean;
}

/**
 * Axis ticks across the window at the zoom's natural granularity:
 *  - day:   one per day (label = day-of-month; major on Mondays)
 *  - week:  one per Monday (label = 'Mon d'; major on the first Monday of a month)
 *  - month: one per month start (label = 'Mon', or 'Mon yyyy' in January; always major)
 */
export function axisTicks(windowStart: Date, windowEnd: Date, zoom: GanttZoom): GanttTick[] {
  const ticks: GanttTick[] = [];
  if (windowEnd.getTime() < windowStart.getTime()) return ticks;

  for (let t = windowStart.getTime(); t <= windowEnd.getTime(); t += DAY_MS) {
    const d = new Date(t);
    const dom = d.getUTCDate();
    const dow = d.getUTCDay();
    const mon = d.getUTCMonth();
    if (zoom === 'day') {
      ticks.push({ date: d, label: String(dom), major: dow === 1 });
    } else if (zoom === 'week') {
      if (dow === 1) ticks.push({ date: d, label: `${MONTHS[mon]} ${dom}`, major: dom <= 7 });
    } else {
      if (dom === 1) {
        ticks.push({ date: d, label: mon === 0 ? `${MONTHS[0]} ${d.getUTCFullYear()}` : MONTHS[mon], major: true });
      }
    }
  }
  return ticks;
}

// ---------------------------------------------------------------------------
// Row model (one row per location; milestone bars inline)
// ---------------------------------------------------------------------------

export interface GanttBarModel {
  milestone: string;
  track: string;
  /** Bar color — the slot's status_color if logged, else the milestone color. */
  color: string;
  temporalState: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  loggedDate: string | null;
  /** This specific slot is past its own planned end and not yet completed. */
  overdue: boolean;
  sequenceOrder: number;
}

export interface GanttRowModel {
  unitId: string;
  unitNumber: string;
  unitType: string | null;
  sheetId: string | null;
  bars: GanttBarModel[];
}

type UnitLike = Pick<Unit, 'id' | 'unit_number' | 'unit_type' | 'sheet_id'>;
type StatusLike = Pick<
  StatusLog,
  | 'unit_id'
  | 'track'
  | 'milestone'
  | 'temporal_state'
  | 'planned_start_date'
  | 'planned_end_date'
  | 'logged_date'
  | 'status_color'
>;

export interface BuildScheduleRowsParams {
  units: UnitLike[];
  /** Raw current-state logs (one row per unit×track×milestone). */
  statuses: StatusLike[];
  milestones: Milestone[];
  track: string;
  today: Date;
  /** N/A (inapplicable) slots are excluded from bars. Defaults to all-applicable. */
  applicabilityIndex?: ApplicabilityIndex;
}

/**
 * One row per unit (input order preserved). Each row carries a bar for every
 * APPLICABLE milestone that has at least one date (planned start/end or logged) —
 * milestones with no dates contribute no bar. N/A slots never produce a bar.
 */
export function buildScheduleRows({
  units,
  statuses,
  milestones,
  track,
  today,
  applicabilityIndex = EMPTY_APPLICABILITY_INDEX,
}: BuildScheduleRowsParams): GanttRowModel[] {
  const trackMilestones = orderedTrackMilestones(milestones, track);
  const seqByName = new Map<string, number>();
  trackMilestones.forEach((m, i) => seqByName.set(m.name, m.sequence_order ?? i));

  // Index logs by unit+milestone for this track.
  const logByKey = new Map<string, StatusLike>();
  for (const s of statuses) {
    if (s.track !== track || !s.unit_id) continue;
    logByKey.set(`${s.unit_id}_${s.milestone}`, s);
  }

  const colorByName = new Map<string, string>();
  for (const m of trackMilestones) colorByName.set(m.name, m.color);

  return units.map((unit) => {
    const appMs = applicableMilestones(trackMilestones, unit, applicabilityIndex);
    const bars: GanttBarModel[] = [];
    for (const m of appMs) {
      const log = logByKey.get(`${unit.id}_${m.name}`);
      if (!log) continue;
      const hasDates = !!(log.planned_start_date || log.planned_end_date || log.logged_date);
      if (!hasDates) continue;
      const state = log.temporal_state || 'none';
      const end = parseDay(log.planned_end_date);
      const overdue = !!end && today > end && state !== 'completed';
      bars.push({
        milestone: m.name,
        track,
        color: log.status_color || colorByName.get(m.name) || m.color,
        temporalState: state,
        plannedStart: log.planned_start_date ?? null,
        plannedEnd: log.planned_end_date ?? null,
        loggedDate: log.logged_date ?? null,
        overdue,
        sequenceOrder: seqByName.get(m.name) ?? 0,
      });
    }
    return {
      unitId: unit.id,
      unitNumber: unit.unit_number,
      unitType: unit.unit_type,
      sheetId: unit.sheet_id,
      bars,
    };
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Ensure end is not before start. If end precedes start, end is pulled up to start. */
export function clampEndAfterStart(
  start: string | null,
  end: string | null
): { start: string | null; end: string | null } {
  const s = parseDay(start);
  const e = parseDay(end);
  if (s && e && e < s) return { start, end: start };
  return { start, end };
}

export interface DependencyIssue {
  milestone: string;
  /** The earlier milestone whose planned end this bar starts before. */
  predecessor: string;
}

/**
 * Dependency check across a single row's bars: a later milestone (by sequence
 * order) should not start before the latest planned end of any earlier
 * milestone. Returns one issue per violating bar (seeds 3b drag guards;
 * informational in 3a). Bars without both endpoints are skipped.
 */
export function checkDependencies(bars: GanttBarModel[]): DependencyIssue[] {
  const ordered = [...bars].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  const issues: DependencyIssue[] = [];
  let maxEnd: Date | null = null;
  let maxEndMilestone: string | null = null;
  for (const bar of ordered) {
    const start = parseDay(bar.plannedStart);
    if (start && maxEnd && start < maxEnd && maxEndMilestone) {
      issues.push({ milestone: bar.milestone, predecessor: maxEndMilestone });
    }
    const end = parseDay(bar.plannedEnd);
    if (end && (!maxEnd || end > maxEnd)) {
      maxEnd = end;
      maxEndMilestone = bar.milestone;
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Level -> location cascade
// ---------------------------------------------------------------------------

export interface CascadeParams {
  /** sheets.milestone_schedules — per-milestone-name level default dates. */
  levelSchedule: MilestoneSchedules;
  units: Pick<Unit, 'id' | 'unit_type'>[];
  milestones: Milestone[];
  track: string;
  /** Existing current-state logs (any track; filtered internally). */
  existing: StatusLike[];
  /** When false (default), units that already have their own planned dates are skipped. */
  overrideExisting?: boolean;
  applicabilityIndex?: ApplicabilityIndex;
}

/**
 * Compute the status_logs upserts to flow a level's milestone dates down to its
 * locations. Non-destructive by default: a unit that already has a planned date
 * for a milestone keeps it (unless `overrideExisting`). N/A slots are skipped.
 * Existing temporal_state / logged_date / status_color are preserved so a
 * cascade never resets a unit's progress — it only sets the planned window.
 */
export function cascadeLevelToLocations({
  levelSchedule,
  units,
  milestones,
  track,
  existing,
  overrideExisting = false,
  applicabilityIndex = EMPTY_APPLICABILITY_INDEX,
}: CascadeParams): StatusLogInsert[] {
  const trackMilestones = orderedTrackMilestones(milestones, track);
  const existingByKey = new Map<string, StatusLike>();
  for (const s of existing) {
    if (s.track !== track || !s.unit_id) continue;
    existingByKey.set(`${s.unit_id}_${s.milestone}`, s);
  }

  const out: StatusLogInsert[] = [];
  for (const m of trackMilestones) {
    const entry = levelSchedule[m.name];
    if (!entry) continue;
    const start = entry.start_date ?? null;
    const end = entry.end_date ?? null;
    if (!start && !end) continue;

    for (const unit of units) {
      if (!isMilestoneApplicable(m, unit, applicabilityIndex)) continue;
      const prior = existingByKey.get(`${unit.id}_${m.name}`);
      const hasOwnDates = !!(prior?.planned_start_date || prior?.planned_end_date);
      if (hasOwnDates && !overrideExisting) continue;

      out.push({
        unit_id: unit.id,
        track,
        milestone: m.name,
        status_color: prior?.status_color || m.color,
        temporal_state: prior?.temporal_state || 'planned',
        planned_start_date: start ?? prior?.planned_start_date ?? null,
        planned_end_date: end ?? prior?.planned_end_date ?? null,
        logged_date: prior?.logged_date ?? null,
      });
    }
  }
  return out;
}

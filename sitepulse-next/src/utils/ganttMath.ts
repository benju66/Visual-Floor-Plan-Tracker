import type { Activity, ActivitySchedules, StatusLog, StatusLogInsert, Unit } from '@/types/domain';
import { dayDiff, orderedTrackActivities, parseDay } from '@/utils/progressAnalytics';
import {
  applicableActivities,
  isActivityApplicable,
  EMPTY_APPLICABILITY_INDEX,
  type ApplicabilityIndex,
} from '@/utils/applicability';
// Deliberate (safe) import cycle: scheduleReconcile imports addDays/toDayString
// from this module. Both sides are hoisted `export function` declarations used
// only at call time, so module evaluation order cannot bite. The crew-flow
// subdivision engine lives THERE (the importer built it first); the cascade
// delegates to it rather than forking (Unified Schedule Engine Phase 1).
import { subdivideTaskWindow, type DistributionMode, type TargetUnit } from '@/utils/scheduleReconcile';

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
// Row model (one row per location; activity bars inline)
// ---------------------------------------------------------------------------

export interface GanttBarModel {
  /** Stable activity id — the slot key used when writing edited dates back. */
  activity_id: string;
  activityName: string;
  track: string;
  /** Bar color — the slot's status_color if logged, else the activity color. */
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
  | 'activityName'
  | 'temporal_state'
  | 'planned_start_date'
  | 'planned_end_date'
  | 'logged_date'
  | 'status_color'
>;

export interface BuildScheduleRowsParams {
  units: UnitLike[];
  /** Raw current-state logs (one row per unit×track×activity). */
  statuses: StatusLike[];
  activities: Activity[];
  track: string;
  today: Date;
  /** N/A (inapplicable) slots are excluded from bars. Defaults to all-applicable. */
  applicabilityIndex?: ApplicabilityIndex;
}

/**
 * One row per unit (input order preserved). Each row carries a bar for every
 * APPLICABLE activity that has at least one date (planned start/end or logged) —
 * activities with no dates contribute no bar. N/A slots never produce a bar.
 */
export function buildScheduleRows({
  units,
  statuses,
  activities,
  track,
  today,
  applicabilityIndex = EMPTY_APPLICABILITY_INDEX,
}: BuildScheduleRowsParams): GanttRowModel[] {
  const trackActivities = orderedTrackActivities(activities, track);
  const seqByName = new Map<string, number>();
  trackActivities.forEach((a, i) => seqByName.set(a.name, a.sequence_order ?? i));

  // Index logs by unit+activity for this track.
  const logByKey = new Map<string, StatusLike>();
  for (const s of statuses) {
    if (s.track !== track || !s.unit_id) continue;
    logByKey.set(`${s.unit_id}_${s.activityName}`, s);
  }

  const colorByName = new Map<string, string>();
  for (const a of trackActivities) colorByName.set(a.name, a.color);

  return units.map((unit) => {
    const appActs = applicableActivities(trackActivities, unit, applicabilityIndex);
    const bars: GanttBarModel[] = [];
    for (const a of appActs) {
      const log = logByKey.get(`${unit.id}_${a.name}`);
      if (!log) continue;
      const hasDates = !!(log.planned_start_date || log.planned_end_date || log.logged_date);
      if (!hasDates) continue;
      const state = log.temporal_state || 'none';
      const end = parseDay(log.planned_end_date);
      const overdue = !!end && today > end && state !== 'completed';
      bars.push({
        activity_id: a.id,
        activityName: a.name,
        track,
        color: log.status_color || colorByName.get(a.name) || a.color,
        temporalState: state,
        plannedStart: log.planned_start_date ?? null,
        plannedEnd: log.planned_end_date ?? null,
        loggedDate: log.logged_date ?? null,
        overdue,
        sequenceOrder: seqByName.get(a.name) ?? 0,
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

/**
 * Inclusive day count of a planned window ('YYYY-MM-DD' strings) — the DERIVED
 * duration the Unified Schedule Engine shows next to date inputs. Duration is
 * never stored or typed anywhere: end − start IS the duration (owner decision,
 * 2026-07-06). Null when either date is missing or unparseable. A reversed
 * window is normalized (min..max) so the shown duration always matches what the
 * cascade/subdivision would actually write.
 */
export function deriveDuration(
  start: string | null | undefined,
  end: string | null | undefined
): number | null {
  const s = parseDay(start);
  const e = parseDay(end);
  if (!s || !e) return null;
  return Math.abs(dayDiff(s, e)) + 1;
}

export interface DependencyIssue {
  activityName: string;
  /** The earlier activity whose planned end this bar starts before. */
  predecessor: string;
}

/**
 * Dependency check across a single row's bars: a later activity (by sequence
 * order) should not start before the latest planned end of any earlier
 * activity. Returns one issue per violating bar (seeds 3b drag guards;
 * informational in 3a). Bars without both endpoints are skipped.
 */
export function checkDependencies(bars: GanttBarModel[]): DependencyIssue[] {
  const ordered = [...bars].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  const issues: DependencyIssue[] = [];
  let maxEnd: Date | null = null;
  let maxEndActivity: string | null = null;
  for (const bar of ordered) {
    const start = parseDay(bar.plannedStart);
    if (start && maxEnd && start < maxEnd && maxEndActivity) {
      issues.push({ activityName: bar.activityName, predecessor: maxEndActivity });
    }
    const end = parseDay(bar.plannedEnd);
    if (end && (!maxEnd || end > maxEnd)) {
      maxEnd = end;
      maxEndActivity = bar.activityName;
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Level -> location cascade
// ---------------------------------------------------------------------------

export interface CascadeParams {
  /** sheets.activity_schedules — per-activity-name level default dates. */
  levelSchedule: ActivitySchedules;
  /**
   * The level's locations. The crew-flow fields (walk_sequence / unit_number /
   * computed_area) drive 'subdivide' ordering + weighting; 'envelope' only
   * reads id + unit_type.
   */
  units: TargetUnit[];
  activities: Activity[];
  track: string;
  /** Existing current-state logs (any track; filtered internally). */
  existing: StatusLike[];
  /** When false (default), units that already have their own planned dates are skipped. */
  overrideExisting?: boolean;
  applicabilityIndex?: ApplicabilityIndex;
  /**
   * How a level window lands on the locations (Unified Schedule Engine
   * Phase 1): 'envelope' (default — today's behavior, every location gets the
   * full window) or 'subdivide' (the window staggers across the locations in
   * crew-flow order via `subdivideTaskWindow` — the same engine the MS Project
   * importer uses; area-weighted only when every unit has a positive
   * computed_area, else even).
   */
  flowMode?: DistributionMode;
}

/**
 * Compute the status_logs upserts to flow a level's activity dates down to its
 * locations. Non-destructive by default: a unit that already has a planned date
 * for an activity keeps it (unless `overrideExisting`). N/A slots are skipped.
 * Existing temporal_state / logged_date / status_color are preserved so a
 * cascade never resets a unit's progress — it only sets the planned window.
 *
 * 'subdivide' mirrors the importer's `buildImportWrites` exactly: a one-sided
 * window coalesces to a same-day window, and the window is subdivided across
 * ALL applicable locations — a hand-dated location still consumes its slice of
 * the crew's walk — with the non-destructive skip applied at write time.
 */
export function cascadeLevelToLocations({
  levelSchedule,
  units,
  activities,
  track,
  existing,
  overrideExisting = false,
  applicabilityIndex = EMPTY_APPLICABILITY_INDEX,
  flowMode = 'envelope',
}: CascadeParams): StatusLogInsert[] {
  const trackActivities = orderedTrackActivities(activities, track);
  const existingByKey = new Map<string, StatusLike>();
  for (const s of existing) {
    if (s.track !== track || !s.unit_id) continue;
    existingByKey.set(`${s.unit_id}_${s.activityName}`, s);
  }

  const out: StatusLogInsert[] = [];
  for (const a of trackActivities) {
    const entry = levelSchedule[a.name];
    if (!entry) continue;
    const start = entry.start_date ?? null;
    const end = entry.end_date ?? null;
    if (!start && !end) continue;

    if (flowMode === 'subdivide') {
      const applicable = units.filter((u) => isActivityApplicable(a, u, applicabilityIndex));
      const { windows } = subdivideTaskWindow(
        (start ?? end) as string,
        (end ?? start) as string,
        applicable,
        'subdivide'
      );
      for (const w of windows) {
        const prior = existingByKey.get(`${w.unitId}_${a.name}`);
        const hasOwnDates = !!(prior?.planned_start_date || prior?.planned_end_date);
        if (hasOwnDates && !overrideExisting) continue;
        out.push({
          unit_id: w.unitId,
          track,
          activity_id: a.id,
          status_color: prior?.status_color || a.color,
          temporal_state: prior?.temporal_state || 'planned',
          planned_start_date: w.start,
          planned_end_date: w.end,
          logged_date: prior?.logged_date ?? null,
        });
      }
      continue;
    }

    for (const unit of units) {
      if (!isActivityApplicable(a, unit, applicabilityIndex)) continue;
      const prior = existingByKey.get(`${unit.id}_${a.name}`);
      const hasOwnDates = !!(prior?.planned_start_date || prior?.planned_end_date);
      if (hasOwnDates && !overrideExisting) continue;

      out.push({
        unit_id: unit.id,
        track,
        activity_id: a.id,
        status_color: prior?.status_color || a.color,
        temporal_state: prior?.temporal_state || 'planned',
        planned_start_date: start ?? prior?.planned_start_date ?? null,
        planned_end_date: end ?? prior?.planned_end_date ?? null,
        logged_date: prior?.logged_date ?? null,
      });
    }
  }
  return out;
}

/**
 * scheduleBaseline — pure snapshot + diff math for schedule baselines
 * (Unified Schedule Engine — Phase 4).
 *
 * Framework-free and deterministic — no DB, no React, no `Date.now()`; callers
 * pass everything in. A baseline captures the PLAN only (level windows +
 * per-location planned dates); progress fields (`temporal_state` /
 * `logged_date` / `status_color`) are deliberately never snapshotted, so no
 * consumer can ever "restore" progress from a baseline.
 */
import type {
  ActivitySchedules,
  BaselineLocationWindow,
  ScheduleBaseline,
  ScheduleBaselineSnapshot,
  Sheet,
  StatusLog,
} from '@/types/domain';
import { isScheduleBaselineSnapshot } from '@/types/domain';
import { dayDiff, parseDay } from '@/utils/progressAnalytics';

/** The one baseline the app treats as "current", with its snapshot narrowed. */
export interface CurrentBaseline {
  row: ScheduleBaseline;
  snapshot: ScheduleBaselineSnapshot;
}

/**
 * Resolve the single "current baseline" from a project's baselines (v1 rule:
 * the NEWEST captured baseline — no picker). Order-robust (sorts by `created_at`
 * rather than trusting caller order) and honest about corruption: if the newest
 * baseline's JSONB fails the {@link isScheduleBaselineSnapshot} guard it degrades
 * to `null` ("no baseline"), never a crash and never a silent fallback to an
 * older one. This is the shared read every baseline surface uses so the
 * "which baseline?" rule lives in exactly one place.
 */
export function resolveCurrentBaseline(baselines: ScheduleBaseline[]): CurrentBaseline | null {
  let newest: ScheduleBaseline | null = null;
  for (const b of baselines) {
    if (!newest || (b.created_at ?? '') > (newest.created_at ?? '')) newest = b;
  }
  if (!newest) return null;
  return isScheduleBaselineSnapshot(newest.snapshot) ? { row: newest, snapshot: newest.snapshot } : null;
}

type SheetLike = Pick<Sheet, 'id' | 'activity_schedules'>;
type StatusLike = Pick<
  StatusLog,
  'unit_id' | 'activity_id' | 'track' | 'planned_start_date' | 'planned_end_date'
>;

/**
 * Capture a whole-project snapshot of both schedule layers.
 * Layer 1: every sheet's `activity_schedules` (level×activity windows).
 * Layer 2: every dated slot's planned window (undated slots contribute nothing).
 * `track` filters the location layer when given ('all' captures every track —
 * the level layer is name-keyed and inherently track-agnostic, so it is always
 * captured whole).
 */
export function buildBaselineSnapshot({
  sheets,
  statuses,
  track = 'all',
}: {
  sheets: SheetLike[];
  statuses: StatusLike[];
  track?: string;
}): ScheduleBaselineSnapshot {
  const levels: Record<string, Record<string, { start_date?: string | null; end_date?: string | null }>> = {};
  for (const s of sheets) {
    const schedule = (s.activity_schedules as ActivitySchedules | null) ?? null;
    if (schedule && Object.keys(schedule).length > 0) levels[s.id] = schedule;
  }

  const locations: BaselineLocationWindow[] = [];
  for (const log of statuses) {
    if (!log.unit_id || !log.activity_id) continue;
    if (track !== 'all' && log.track !== track) continue;
    if (!log.planned_start_date && !log.planned_end_date) continue;
    locations.push({
      unit_id: log.unit_id,
      activity_id: log.activity_id,
      planned_start_date: log.planned_start_date ?? null,
      planned_end_date: log.planned_end_date ?? null,
    });
  }

  return { version: 1, track, levels, locations };
}

/** How a proposed window compares to the baseline's level window. */
export interface BaselineDelta {
  kind: 'new' | 'moved' | 'unchanged';
  /** The baseline's window (null when the baseline has none → kind 'new'). */
  baseline: { start_date: string | null; end_date: string | null } | null;
  /** Whole days the proposed start/end sit later than the baseline (negative = earlier). */
  startShiftDays: number | null;
  endShiftDays: number | null;
}

/**
 * Compare one proposed level window (e.g. an imported task landing on a sheet ×
 * activity) against the baseline's level window for that same slot. Returns
 * 'new' when the baseline has no window there, 'unchanged' when both endpoints
 * match, else 'moved' with the endpoint shifts in days.
 */
export function baselineDelta(
  snapshot: ScheduleBaselineSnapshot,
  sheetId: string,
  activityName: string,
  proposedStart: string | null,
  proposedEnd: string | null
): BaselineDelta {
  const entry = snapshot.levels[sheetId]?.[activityName];
  const base = entry && (entry.start_date || entry.end_date)
    ? { start_date: entry.start_date ?? null, end_date: entry.end_date ?? null }
    : null;
  if (!base) return { kind: 'new', baseline: null, startShiftDays: null, endShiftDays: null };

  const shift = (from: string | null, to: string | null): number | null => {
    const f = parseDay(from);
    const t = parseDay(to);
    return f && t ? dayDiff(f, t) : null;
  };
  const startShiftDays = shift(base.start_date, proposedStart);
  const endShiftDays = shift(base.end_date, proposedEnd);
  const unchanged =
    (base.start_date ?? null) === (proposedStart ?? null) &&
    (base.end_date ?? null) === (proposedEnd ?? null);
  return { kind: unchanged ? 'unchanged' : 'moved', baseline: base, startShiftDays, endShiftDays };
}

/**
 * The frozen LEVEL window one activity carried in the baseline, for a single
 * sheet × activity slot (Band vs Promise P4 — the read behind the List's
 * read-only "Baseline start / Baseline end" columns). Uses the SAME snapshot
 * path {@link baselineDelta} reads (`snapshot.levels[sheetId][activityName]`,
 * Layer 1) so the JSONB shape lives in one place. Returns `null` when the
 * baseline never froze a window there — a missing slot AND a present-but-dateless
 * entry both read as `null`, which the caller surfaces as "new". Pure.
 */
export function baselineSlotWindow(
  snapshot: ScheduleBaselineSnapshot,
  sheetId: string,
  activityName: string
): { start: string | null; end: string | null } | null {
  const entry = snapshot.levels[sheetId]?.[activityName];
  if (!entry || (!entry.start_date && !entry.end_date)) return null;
  return { start: entry.start_date ?? null, end: entry.end_date ?? null };
}

/**
 * Whole-day PLAN drift since the baseline: how much later (or earlier) the
 * current plan's finish sits versus the finish the baseline plan implied (Band
 * vs Promise P4 — the List's top-line "plan drifted ~N days since baseline"
 * read). The baseline's implied finish is the latest level-window end it froze
 * (`snapshot.levels`, Layer 1); the caller pairs it with a Layer-1 current
 * planned finish (the latest end across the sheets' live `activity_schedules`)
 * so both sides read the SAME basis. Positive = the plan slipped LATER since the
 * baseline; negative = it pulled in. This is plan-vs-plan drift — distinct from
 * execution variance (actual vs plan), which the List's variance columns already
 * carry. Returns `{ days: null }` (render nothing) when the baseline froze no
 * level window or the current finish is missing — never a fabricated number.
 * Pure; ISO 'YYYY-MM-DD' in, no `Date.now()`.
 */
export function projectDriftSinceBaseline(
  snapshot: ScheduleBaselineSnapshot,
  currentPlannedFinish: string | null
): { days: number | null } {
  let baselineFinish: string | null = null;
  for (const activities of Object.values(snapshot.levels)) {
    for (const win of Object.values(activities)) {
      const end = win?.end_date ?? null;
      if (end && (baselineFinish === null || end > baselineFinish)) baselineFinish = end;
    }
  }
  const from = parseDay(baselineFinish);
  const to = parseDay(currentPlannedFinish);
  return { days: from && to ? dayDiff(from, to) : null };
}

/**
 * Fold confirmed import rows into per-sheet level-window patches (the Phase 4
 * "import as anchor-loading": the importer feeds Layer 1 so import and manual
 * entry drive the SAME engine). One-sided task dates coalesce to a same-day
 * window (the importer precedent); when two rows hit the same sheet × activity
 * the later one wins (deterministic, mirrors buildImportWrites).
 */
export function mergeLevelWindows(
  entries: Array<{ sheetId: string; activityName: string; start: string | null; finish: string | null }>
): Record<string, ActivitySchedules> {
  const out: Record<string, ActivitySchedules> = {};
  for (const e of entries) {
    const start = e.start ?? e.finish;
    const finish = e.finish ?? e.start;
    if (!start || !finish) continue; // dateless — nothing to anchor
    const sheet = (out[e.sheetId] ??= {});
    sheet[e.activityName] = { start_date: start, end_date: finish };
  }
  return out;
}

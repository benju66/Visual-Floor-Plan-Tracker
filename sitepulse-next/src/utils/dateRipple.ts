/**
 * dateRipple — pure forward date-propagation over the light Finish-to-Start
 * dependency graph (Scheduling Analytics Slice B, Phase 4).
 *
 * When a predecessor activity's finish SLIPS, the activities that depend on it
 * should be pushed later so the plan stays self-consistent. This module computes
 * those downstream planned-date deltas within a SINGLE location's slots (planned
 * dates live per unit × activity on `status_logs`; the edge graph is shared by
 * every location).
 *
 * Framework-free and deterministic — no DB, no React, no `Date.now()` (the caller
 * passes the slipped finish in). COARSE by design: this is a forward propagation,
 * NOT a critical-path / float engine.
 *
 * Semantics (Finish-to-Start + lag, calendar days):
 *  - A successor starts the day AFTER its predecessor finishes, plus the edge's
 *    `lag_days` — `requiredStart = predFinish + 1 + lag` (negative lag = a lead,
 *    so the successor may overlap).
 *  - PUSH-ONLY: a slip only ever moves successors LATER. A predecessor finishing
 *    early never auto-compresses the plan (that would silently rewrite dates the
 *    team may have set on purpose).
 *  - Only successors that ALREADY have a planned start are shifted (their
 *    duration is preserved); undated downstream slots are left untouched.
 *  - Cycle-safe: a recursion-stack guard breaks loops in malformed edge data so
 *    the walk always terminates (mirrors `activityDependencies.wouldCreateCycle`).
 *  - Per-link opt-in: only edges with `ripple_dates === true` propagate. A link
 *    left as sequencing/make-ready only (the default) shows blocked/ready but
 *    never moves dates. Make-ready (`activityReadiness`) still uses ALL edges.
 */
import type { Activity, ActivityDependency, ActivitySchedules, StatusLog, StatusLogInsert } from '@/types/domain';
import { parseDay, dayDiff, orderedTrackActivities } from '@/utils/progressAnalytics';
import { addDays, toDayString } from '@/utils/ganttMath';

/** A slot's current planned window (either endpoint may be absent). */
export interface PlannedWindow {
  start: string | null;
  end: string | null;
}

/** A recomputed downstream planned window for one activity (this location). */
export interface RippleDelta {
  activityId: string;
  start: string;
  end: string;
  /** Whole days the window moved later (always > 0). */
  shiftedDays: number;
}

/**
 * Forward-propagate a predecessor slip to its downstream activities within one
 * location's slots.
 *
 * @param edges        the project's FS edges (`activity_dependencies`).
 * @param plannedDates activityId → current planned window for THIS location.
 * @param slippedId    the activity whose finish moved.
 * @param newFinish    its new planned finish ('YYYY-MM-DD').
 * @returns one delta per downstream activity that had to move later.
 */
export function rippleForward(
  edges: ActivityDependency[],
  plannedDates: Map<string, PlannedWindow>,
  slippedId: string,
  newFinish: string,
): RippleDelta[] {
  const startFinish = parseDay(newFinish);
  if (!startFinish) return [];

  const successorsOf = new Map<string, ActivityDependency[]>();
  for (const e of edges) {
    // Only links explicitly opted into date propagation ripple; sequencing-only
    // links (the default) are skipped here (they still drive make-ready).
    if (!e.ripple_dates) continue;
    const arr = successorsOf.get(e.predecessor_activity_id);
    if (arr) arr.push(e);
    else successorsOf.set(e.predecessor_activity_id, [e]);
  }

  const deltas = new Map<string, RippleDelta>();

  const walk = (predId: string, predFinish: Date, path: Set<string>): void => {
    const outs = successorsOf.get(predId);
    if (!outs) return;
    for (const e of outs) {
      const succId = e.successor_activity_id;
      if (path.has(succId)) continue; // cycle guard (malformed data)
      const win = plannedDates.get(succId);
      const curStart = win ? parseDay(win.start) : null;
      if (!win || !curStart) continue; // only shift already-dated successors
      const lag = e.lag_days ?? 0;
      const requiredStart = addDays(predFinish, 1 + lag);
      if (requiredStart <= curStart) continue; // push-only: no shift needed
      const curEnd = parseDay(win.end);
      const duration = curEnd && curEnd >= curStart ? dayDiff(curStart, curEnd) : 0;
      const newStart = requiredStart;
      const newEnd = addDays(newStart, duration);
      const existing = deltas.get(succId);
      const existingStart = existing ? parseDay(existing.start) : null;
      // Keep the LATEST shift when multiple paths reach the same successor.
      if (existingStart && existingStart >= newStart) continue;
      deltas.set(succId, {
        activityId: succId,
        start: toDayString(newStart),
        end: toDayString(newEnd),
        shiftedDays: dayDiff(curStart, newStart),
      });
      path.add(succId);
      walk(succId, newEnd, path);
      path.delete(succId);
    }
  };

  walk(slippedId, startFinish, new Set([slippedId]));
  return [...deltas.values()];
}

/** One successor level window pushed by a predecessor's window change. */
export interface LevelChainShift {
  /** Activity NAME (level schedules are name-keyed). */
  name: string;
  start: string;
  end: string;
  shiftedDays: number;
}

/**
 * Chain FS dependencies across the LEVEL layer (Unified Schedule Engine
 * Phase 3): when an activity's level window changed (draft vs saved), push the
 * opted-in (`ripple_dates`) successors' LEVEL windows via `rippleForward` — the
 * level plan is treated as one "location" whose planned-window map is the
 * schedule itself. Inherits rippleForward's semantics wholesale: FS + lag,
 * push-only (never pulls earlier), duration preserved, only already-dated
 * successors move, transitive, cycle-safe.
 *
 * Returns a NEW schedule (draft + chained successor windows; inputs untouched)
 * plus the list of chained shifts for the UI's count-confirm.
 */
export function chainLevelSchedule({
  saved,
  draft,
  activities,
  track,
  edges,
}: {
  saved: ActivitySchedules;
  draft: ActivitySchedules;
  activities: Activity[];
  track: string;
  edges: ActivityDependency[];
}): { schedule: ActivitySchedules; chained: LevelChainShift[] } {
  const trackActivities = orderedTrackActivities(activities, track);
  const nameById = new Map<string, string>();
  for (const a of trackActivities) nameById.set(a.id, a.name);

  const result: ActivitySchedules = { ...draft };
  const windowsById = (): Map<string, PlannedWindow> => {
    const m = new Map<string, PlannedWindow>();
    for (const a of trackActivities) {
      const e = result[a.name];
      if (e && (e.start_date || e.end_date)) m.set(a.id, { start: e.start_date ?? null, end: e.end_date ?? null });
    }
    return m;
  };

  // An activity "changed" when its draft window differs from the saved plan and
  // it has an end date to ripple from. Processed in sequence order so upstream
  // pushes land before downstream ones are evaluated.
  const chained = new Map<string, LevelChainShift>();
  for (const a of trackActivities) {
    const d = result[a.name];
    const s = saved[a.name];
    if (!d?.end_date) continue;
    const changedStart = (s?.start_date ?? null) !== (d.start_date ?? null);
    const changedEnd = (s?.end_date ?? null) !== (d.end_date ?? null);
    if (!changedStart && !changedEnd) continue;

    const deltas = rippleForward(edges, windowsById(), a.id, d.end_date);
    for (const delta of deltas) {
      const name = nameById.get(delta.activityId);
      if (!name) continue;
      result[name] = { start_date: delta.start, end_date: delta.end };
      chained.set(name, { name, start: delta.start, end: delta.end, shiftedDays: delta.shiftedDays });
    }
  }

  return { schedule: result, chained: [...chained.values()] };
}

type PriorSlot = Pick<
  StatusLog,
  'unit_id' | 'activity_id' | 'status_color' | 'temporal_state' | 'logged_date'
>;

export interface BuildRippleWritesParams {
  unitId: string;
  track: string;
  deltas: RippleDelta[];
  /** This location's current-state slot rows, to preserve color / state / logged_date. */
  existing: PriorSlot[];
  /** Activity color by id — fallback when a slot has no prior row. */
  colorByActivityId?: Map<string, string>;
}

/**
 * Turn ripple deltas into `status_logs` upserts for the bulk planned-date write
 * path (`useBulkInsertStatusLogs`, online-first). Mirrors
 * `ganttMath.cascadeLevelToLocations`'s posture: only the planned window changes;
 * a slot's existing temporal_state / logged_date / status_color are preserved so
 * a ripple never resets progress.
 */
export function buildRippleWrites({
  unitId,
  track,
  deltas,
  existing,
  colorByActivityId,
}: BuildRippleWritesParams): StatusLogInsert[] {
  const priorByActivity = new Map<string, PriorSlot>();
  for (const s of existing) {
    if (s.unit_id === unitId && s.activity_id) priorByActivity.set(s.activity_id, s);
  }

  return deltas.map((d) => {
    const prior = priorByActivity.get(d.activityId);
    return {
      unit_id: unitId,
      track,
      activity_id: d.activityId,
      status_color: prior?.status_color || colorByActivityId?.get(d.activityId) || '#3b82f6',
      temporal_state: prior?.temporal_state || 'planned',
      planned_start_date: d.start,
      planned_end_date: d.end,
      logged_date: prior?.logged_date ?? null,
    };
  });
}

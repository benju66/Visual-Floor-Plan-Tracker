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
 */
import type { ActivityDependency, StatusLog, StatusLogInsert } from '@/types/domain';
import { parseDay, dayDiff } from '@/utils/progressAnalytics';
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

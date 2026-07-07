// Pure lag / make-ready recolor wiring for the floor-plan canvas
// (FloorplanCanvas Decomposition — Phase 9). Extracted verbatim from the
// `displayStatuses` memo body in FloorplanCanvas.tsx; the component keeps its
// `useMemo` wrapper (it owns the React deps + the mode dispatch and passes its
// component-lifetime `today` in) and each mode branch just calls these.
// Framework-free and deterministic — no React, no `Date.now()` — so the
// recolor wiring is unit-testable in isolation.
//
// AGENTS.md §3 hard rules:
// - This is ORCHESTRATION over the existing math — `progressAnalytics`
//   (variance), `activityReadiness` (make-ready), `applicability` (N/A slots)
//   are imported and called, never re-derived.
// - Recolor happens ONLY on new display copies: both functions return new
//   status objects with `status_color` swapped and never mutate their inputs.
//   The copies exist solely for the canvas renderers — never recolor
//   `mapDisplayStatuses` in the parent (it feeds write paths) and never write
//   these colors to `status_logs.status_color`.

import type { Activity, ActivityDependency, StatusLog, Unit } from '@/types/domain';
import { computeUnitVariance, varianceFill, orderedTrackActivities } from '@/utils/progressAnalytics';
import { unitMakeReady, makeReadyFill, slotKey } from '@/utils/activityReadiness';
import { applicableActivities, isActivityApplicable } from '@/utils/applicability';
import type { ApplicabilityIndex } from '@/utils/applicability';

/**
 * Make-Ready Mode (Scheduling Analytics Phase 4): recolor by dependency
 * readiness instead of activity color. Returns copies of `activeStatuses`
 * with `status_color` set to the make-ready fill of each unit's bottleneck.
 * A status whose unit isn't in `units` passes through unchanged (same object).
 */
export function recolorForMakeReady(
  activeStatuses: StatusLog[],
  rawStatuses: StatusLog[],
  units: Unit[],
  allActivities: Activity[],
  trackingMode: string,
  dependencies: ActivityDependency[],
  applicabilityIndex: ApplicabilityIndex | undefined,
): StatusLog[] {
  const unitById = new Map(units.map(u => [u.id, u]));

  // Completed slots + applicable slots for the active track (N/A slots respected —
  // AGENTS.md §3). Both are plain slot-key sets keyed `${unitId}_${activityId}`.
  const orderedActs = orderedTrackActivities(allActivities, trackingMode);
  const completed = new Set<string>();
  for (const log of rawStatuses) {
    if (log.track === trackingMode && log.unit_id && log.activity_id && log.temporal_state === 'completed') {
      completed.add(slotKey(log.unit_id, log.activity_id));
    }
  }
  const hasIndex = !!applicabilityIndex;
  const applicable = new Set<string>();
  if (hasIndex) {
    for (const u of units) for (const a of orderedActs) {
      if (isActivityApplicable(a, u, applicabilityIndex)) applicable.add(slotKey(u.id, a.id));
    }
  }
  return activeStatuses.map(s => {
    const unit = unitById.get(s.unit_id as string);
    if (!unit) return s;
    const appActs = hasIndex ? applicableActivities(orderedActs, unit, applicabilityIndex) : orderedActs;
    const info = unitMakeReady(unit.id, appActs, dependencies, completed, hasIndex ? applicable : undefined);
    return { ...s, status_color: makeReadyFill(info) };
  });
}

/**
 * Lag Mode: schedule-variance recolor. Returns copies of `activeStatuses`
 * with `status_color` set to each unit's bottleneck-variance fill.
 *
 * `activities` is the track-filtered list (`allActivities` filtered to
 * `trackingMode`), exactly as the component derives it; `today` is passed in
 * by the caller (the component's lifetime-stable `new Date()`).
 */
export function recolorForLag(
  activeStatuses: StatusLog[],
  rawStatuses: StatusLog[],
  units: Unit[],
  activities: Activity[],
  trackingMode: string,
  applicabilityIndex: ApplicabilityIndex | undefined,
  today: Date,
): StatusLog[] {
  const unitById = new Map(units.map(u => [u.id, u]));

  const logsByUnit = new Map<string, StatusLog[]>();
  for (const log of rawStatuses) {
    if (log.track !== trackingMode || !log.unit_id) continue;
    const arr = logsByUnit.get(log.unit_id);
    if (arr) arr.push(log);
    else logsByUnit.set(log.unit_id, [log]);
  }
  return activeStatuses.map(s => {
    // Variance skips activities that are N/A for this unit, matching the bottleneck.
    const unit = unitById.get(s.unit_id as string);
    const unitActivities = unit && applicabilityIndex
      ? applicableActivities(activities, unit, applicabilityIndex)
      : activities;
    const info = computeUnitVariance(logsByUnit.get(s.unit_id as string) || [], unitActivities, today);
    return { ...s, status_color: varianceFill(info) };
  });
}

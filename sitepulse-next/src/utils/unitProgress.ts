import type { Activity, StatusLog, TemporalState, Unit } from '@/types/domain';
import { isActivityApplicable, type ApplicabilityIndex } from './applicability';

/**
 * Pure progress roll-ups for the map side panel.
 *
 * These derive the same shape of data the map already computes for markers, but
 * scoped for the panel's needs: a per-unit summary (status dot + done/total) and
 * a sheet-level roll-up (headline % + unit buckets). Kept dependency-free and
 * unit-tested because they hold the panel's load-bearing math.
 *
 * Applicability (N/A) is respected everywhere: an activity that does not apply to
 * a unit is excluded from that unit's denominator — identical to the map and the
 * field list (see src/utils/applicability.ts).
 */

/** A unit's current "stage" for the panel: a temporal state, or 'done' when every
 *  applicable activity is completed. 'none' covers units with no applicable work. */
export type UnitStage = TemporalState | 'done';

export interface UnitSummary {
  unitId: string;
  /** applicable activities in the active track */
  totalCount: number;
  /** completed applicable activities */
  doneCount: number;
  /** first non-completed applicable activity (the bottleneck), or null when done/none */
  currentActivityName: string | null;
  /** stage shown as the row's status dot */
  stage: UnitStage;
}

export interface SheetProgress {
  totalUnits: number;
  /** completed applicable slots ÷ total applicable slots, 0–100 (rounded) */
  percentComplete: number;
  /** units bucketed by their current stage */
  buckets: { done: number; ongoing: number; planned: number; none: number };
  /** raw slot tallies behind percentComplete */
  slots: { completed: number; total: number };
}

const stateOf = (log: StatusLog | undefined): TemporalState =>
  (log?.temporal_state as TemporalState) || 'none';

/**
 * Summarize one unit against the active track's activities.
 * `trackActivities` must already be filtered to the active track and ordered by
 * sequence. `statuses` may be the full sheet array — it is filtered here.
 */
export function summarizeUnit(
  unit: Pick<Unit, 'id' | 'unit_type'>,
  statuses: StatusLog[],
  trackActivities: Array<Pick<Activity, 'id' | 'name'>>,
  index: ApplicabilityIndex,
  track: string,
): UnitSummary {
  let totalCount = 0;
  let doneCount = 0;
  let currentActivityName: string | null = null;

  for (const a of trackActivities) {
    if (!isActivityApplicable(a, unit, index)) continue;
    totalCount++;
    const log = statuses.find(
      s => s.unit_id === unit.id && s.track === track && s.activityName === a.name,
    );
    const state = stateOf(log);
    if (state === 'completed') {
      doneCount++;
    } else if (currentActivityName === null) {
      currentActivityName = a.name;
    }
  }

  let stage: UnitStage;
  if (totalCount === 0) {
    stage = 'none';
  } else if (doneCount === totalCount) {
    stage = 'done';
  } else {
    // stage of the bottleneck activity
    const log = statuses.find(
      s => s.unit_id === unit.id && s.track === track && s.activityName === currentActivityName,
    );
    stage = stateOf(log);
  }

  return { unitId: unit.id, totalCount, doneCount, currentActivityName, stage };
}

/** Sheet-wide roll-up built from per-unit summaries. */
export function summarizeSheetProgress(
  units: Array<Pick<Unit, 'id' | 'unit_type'>>,
  statuses: StatusLog[],
  trackActivities: Array<Pick<Activity, 'id' | 'name'>>,
  index: ApplicabilityIndex,
  track: string,
): SheetProgress {
  const buckets = { done: 0, ongoing: 0, planned: 0, none: 0 };
  let completed = 0;
  let total = 0;

  for (const u of units) {
    const s = summarizeUnit(u, statuses, trackActivities, index, track);
    completed += s.doneCount;
    total += s.totalCount;
    if (s.stage === 'done') buckets.done++;
    else if (s.stage === 'ongoing') buckets.ongoing++;
    else if (s.stage === 'planned') buckets.planned++;
    else buckets.none++;
  }

  const percentComplete = total === 0 ? 0 : Math.round((completed / total) * 100);
  return { totalUnits: units.length, percentComplete, buckets, slots: { completed, total } };
}

/**
 * Count, per activity, how many units currently sit at that activity (its
 * bottleneck). Drives the "Drywall 18" counts on the overview filter chips.
 */
export function countUnitsByCurrentActivity(
  units: Array<Pick<Unit, 'id' | 'unit_type'>>,
  statuses: StatusLog[],
  trackActivities: Array<Pick<Activity, 'id' | 'name'>>,
  index: ApplicabilityIndex,
  track: string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const u of units) {
    const { currentActivityName } = summarizeUnit(u, statuses, trackActivities, index, track);
    if (currentActivityName) counts[currentActivityName] = (counts[currentActivityName] || 0) + 1;
  }
  return counts;
}

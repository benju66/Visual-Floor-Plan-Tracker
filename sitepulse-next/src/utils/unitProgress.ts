import type { Milestone, StatusLog, TemporalState, Unit } from '@/types/domain';
import { isMilestoneApplicable, type ApplicabilityIndex } from './applicability';

/**
 * Pure progress roll-ups for the map side panel.
 *
 * These derive the same shape of data the map already computes for markers, but
 * scoped for the panel's needs: a per-unit summary (status dot + done/total) and
 * a sheet-level roll-up (headline % + unit buckets). Kept dependency-free and
 * unit-tested because they hold the panel's load-bearing math.
 *
 * Applicability (N/A) is respected everywhere: a milestone that does not apply to
 * a unit is excluded from that unit's denominator — identical to the map and the
 * field list (see src/utils/applicability.ts).
 */

/** A unit's current "stage" for the panel: a temporal state, or 'done' when every
 *  applicable milestone is completed. 'none' covers units with no applicable work. */
export type UnitStage = TemporalState | 'done';

export interface UnitSummary {
  unitId: string;
  /** applicable milestones in the active track */
  totalCount: number;
  /** completed applicable milestones */
  doneCount: number;
  /** first non-completed applicable milestone (the bottleneck), or null when done/none */
  currentMilestone: string | null;
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
 * Summarize one unit against the active track's milestones.
 * `trackMilestones` must already be filtered to the active track and ordered by
 * sequence. `statuses` may be the full sheet array — it is filtered here.
 */
export function summarizeUnit(
  unit: Pick<Unit, 'id' | 'unit_type'>,
  statuses: StatusLog[],
  trackMilestones: Array<Pick<Milestone, 'id' | 'name'>>,
  index: ApplicabilityIndex,
  track: string,
): UnitSummary {
  let totalCount = 0;
  let doneCount = 0;
  let currentMilestone: string | null = null;

  for (const m of trackMilestones) {
    if (!isMilestoneApplicable(m, unit, index)) continue;
    totalCount++;
    const log = statuses.find(
      s => s.unit_id === unit.id && s.track === track && s.milestone === m.name,
    );
    const state = stateOf(log);
    if (state === 'completed') {
      doneCount++;
    } else if (currentMilestone === null) {
      currentMilestone = m.name;
    }
  }

  let stage: UnitStage;
  if (totalCount === 0) {
    stage = 'none';
  } else if (doneCount === totalCount) {
    stage = 'done';
  } else {
    // stage of the bottleneck milestone
    const log = statuses.find(
      s => s.unit_id === unit.id && s.track === track && s.milestone === currentMilestone,
    );
    stage = stateOf(log);
  }

  return { unitId: unit.id, totalCount, doneCount, currentMilestone, stage };
}

/** Sheet-wide roll-up built from per-unit summaries. */
export function summarizeSheetProgress(
  units: Array<Pick<Unit, 'id' | 'unit_type'>>,
  statuses: StatusLog[],
  trackMilestones: Array<Pick<Milestone, 'id' | 'name'>>,
  index: ApplicabilityIndex,
  track: string,
): SheetProgress {
  const buckets = { done: 0, ongoing: 0, planned: 0, none: 0 };
  let completed = 0;
  let total = 0;

  for (const u of units) {
    const s = summarizeUnit(u, statuses, trackMilestones, index, track);
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
 * Count, per milestone, how many units currently sit at that milestone (its
 * bottleneck). Drives the "Drywall 18" counts on the overview filter chips.
 */
export function countUnitsByCurrentMilestone(
  units: Array<Pick<Unit, 'id' | 'unit_type'>>,
  statuses: StatusLog[],
  trackMilestones: Array<Pick<Milestone, 'id' | 'name'>>,
  index: ApplicabilityIndex,
  track: string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const u of units) {
    const { currentMilestone } = summarizeUnit(u, statuses, trackMilestones, index, track);
    if (currentMilestone) counts[currentMilestone] = (counts[currentMilestone] || 0) + 1;
  }
  return counts;
}

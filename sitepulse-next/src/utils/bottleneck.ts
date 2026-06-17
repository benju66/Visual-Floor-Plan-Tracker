import type { Unit, StatusLog, Milestone, StatusLogAugmented } from '@/types/domain';
import { isMilestoneApplicable, EMPTY_APPLICABILITY_INDEX, type ApplicabilityIndex } from '@/utils/applicability';

/**
 * Derive each unit's **current (bottleneck) status** for one track — the first
 * applicable milestone in sequence that isn't completed — plus any out-of-sequence
 * work logged after it.
 *
 * This is the single source of truth extracted verbatim from `page.jsx`'s
 * `mapDisplayStatuses`, so the Map, the level-scoped List, and the all-levels List
 * all compute "current work" identically. N/A (inapplicable) milestones never
 * participate in the sequence or become a bottleneck.
 */
export interface DeriveBottleneckParams {
  units: Unit[];
  /** Raw current-state logs (one row per unit×track×milestone). */
  statuses: StatusLog[];
  /** All project milestones (the function filters to `trackingMode` itself). */
  milestones: Milestone[];
  trackingMode: string;
  applicabilityIndex?: ApplicabilityIndex;
}

export function deriveBottleneckStatuses({
  units,
  statuses,
  milestones,
  trackingMode,
  applicabilityIndex = EMPTY_APPLICABILITY_INDEX,
}: DeriveBottleneckParams): StatusLogAugmented[] {
  const currentTrackMilestones = milestones
    .filter((m) => m.track === trackingMode)
    .sort((a, b) => (a.sequence_order || 0) - (b.sequence_order || 0));

  if (currentTrackMilestones.length === 0) return [];

  const out: StatusLogAugmented[] = [];

  for (const unit of units) {
    const unitStatuses = statuses.filter((s) => s.unit_id === unit.id && s.track === trackingMode);
    if (unitStatuses.length === 0) continue;

    // Only milestones applicable to THIS unit participate in the bottleneck sequence.
    const unitMilestones = currentTrackMilestones.filter((m) => isMilestoneApplicable(m, unit, applicabilityIndex));
    if (unitMilestones.length === 0) continue;

    let primaryMasterIdx = unitMilestones.length - 1; // default to end (all completed)

    // First applicable milestone in the sequence that is NOT completed = the bottleneck.
    for (let i = 0; i < unitMilestones.length; i++) {
      const log = unitStatuses.find((s) => s.milestone === unitMilestones[i].name);
      if (!log || log.temporal_state !== 'completed') {
        primaryMasterIdx = i;
        break;
      }
    }

    const primaryMilestone = unitMilestones[primaryMasterIdx];
    if (!primaryMilestone) continue;

    const existingLog = unitStatuses.find((s) => s.milestone === primaryMilestone.name);
    // When the bottleneck milestone has no log yet, synthesize a 'planned' placeholder.
    // (Mirrors page.jsx's original mapDisplayStatuses, where this branch always yielded 'planned'.)
    const primaryStatus: StatusLog =
      existingLog ??
      ({
        unit_id: unit.id,
        milestone: primaryMilestone.name,
        status_color: primaryMilestone.color,
        temporal_state: 'planned',
        track: trackingMode,
      } as unknown as StatusLog);

    // Out-of-sequence: completed/ongoing work on milestones AFTER the bottleneck.
    const outOfSequence = unitStatuses.filter((s) => {
      if (s.temporal_state !== 'completed' && s.temporal_state !== 'ongoing') return false;
      const sIdx = unitMilestones.findIndex((m) => m.name === s.milestone);
      return sIdx > primaryMasterIdx;
    });

    out.push({ ...primaryStatus, outOfSequence });
  }

  return out;
}

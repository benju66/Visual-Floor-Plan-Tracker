import type { Unit, StatusLog, Activity, StatusLogAugmented } from '@/types/domain';
import { isActivityApplicable, EMPTY_APPLICABILITY_INDEX, type ApplicabilityIndex } from '@/utils/applicability';

/**
 * Derive each unit's **current (bottleneck) status** for one track — the first
 * applicable activity in sequence that isn't completed — plus any out-of-sequence
 * work logged after it.
 *
 * This is the single source of truth extracted verbatim from `page.jsx`'s
 * `mapDisplayStatuses`, so the Map, the level-scoped List, and the all-levels List
 * all compute "current work" identically. N/A (inapplicable) activities never
 * participate in the sequence or become a bottleneck.
 */
export interface DeriveBottleneckParams {
  units: Unit[];
  /** Raw current-state logs (one row per unit×track×activity). */
  statuses: StatusLog[];
  /** All project activities (the function filters to `trackingMode` itself). */
  activities: Activity[];
  trackingMode: string;
  applicabilityIndex?: ApplicabilityIndex;
}

export function deriveBottleneckStatuses({
  units,
  statuses,
  activities,
  trackingMode,
  applicabilityIndex = EMPTY_APPLICABILITY_INDEX,
}: DeriveBottleneckParams): StatusLogAugmented[] {
  const currentTrackActivities = activities
    .filter((a) => a.track === trackingMode)
    .sort((a, b) => (a.sequence_order || 0) - (b.sequence_order || 0));

  if (currentTrackActivities.length === 0) return [];

  const out: StatusLogAugmented[] = [];

  for (const unit of units) {
    const unitStatuses = statuses.filter((s) => s.unit_id === unit.id && s.track === trackingMode);
    if (unitStatuses.length === 0) continue;

    // Only activities applicable to THIS unit participate in the bottleneck sequence.
    const unitActivities = currentTrackActivities.filter((a) => isActivityApplicable(a, unit, applicabilityIndex));
    if (unitActivities.length === 0) continue;

    let primaryMasterIdx = unitActivities.length - 1; // default to end (all completed)

    // First applicable activity in the sequence that is NOT completed = the bottleneck.
    for (let i = 0; i < unitActivities.length; i++) {
      const log = unitStatuses.find((s) => s.activityName === unitActivities[i].name);
      if (!log || log.temporal_state !== 'completed') {
        primaryMasterIdx = i;
        break;
      }
    }

    const primaryActivity = unitActivities[primaryMasterIdx];
    if (!primaryActivity) continue;

    const existingLog = unitStatuses.find((s) => s.activityName === primaryActivity.name);
    // When the bottleneck activity has no log yet, synthesize a 'planned' placeholder.
    // (Mirrors page.jsx's original mapDisplayStatuses, where this branch always yielded 'planned'.)
    const primaryStatus: StatusLog =
      existingLog ??
      ({
        unit_id: unit.id,
        activityName: primaryActivity.name,
        status_color: primaryActivity.color,
        temporal_state: 'planned',
        track: trackingMode,
      } as unknown as StatusLog);

    // Out-of-sequence: completed/ongoing work on activities AFTER the bottleneck.
    const outOfSequence = unitStatuses.filter((s) => {
      if (s.temporal_state !== 'completed' && s.temporal_state !== 'ongoing') return false;
      const sIdx = unitActivities.findIndex((a) => a.name === s.activityName);
      return sIdx > primaryMasterIdx;
    });

    out.push({ ...primaryStatus, outOfSequence });
  }

  return out;
}

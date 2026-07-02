import type { Activity, ActivityOverride, StatusLog, Unit } from '@/types/domain';
import { getAppliesTo } from '@/types/domain';

/**
 * Activity applicability resolver — the single source of truth for
 * "does activity A apply to unit U".
 *
 * Two data sources, resolved in priority order:
 *   1. Per-unit override rows (activity_applicability_overrides) — always win.
 *   2. Unit-type rules (activities.applies_to_unit_types) — null/empty = all types.
 *
 * A slot that is not applicable is excluded from every progress denominator,
 * the auto-advance sequence, and the map bottleneck computation. It is NOT a
 * temporal_state — status_logs never stores applicability.
 */

type ActivityRuleInput = Pick<Activity, 'id' | 'applies_to_unit_types'>;
type OverrideInput = Pick<ActivityOverride, 'activity_id' | 'unit_id' | 'is_applicable'>;
type UnitInput = Pick<Unit, 'id' | 'unit_type'>;

export interface ApplicabilityIndex {
  /** activity id → allowed unit types (null = applies to all) */
  rules: Record<string, string[] | null>;
  /** `${activity_id}_${unit_id}` → is_applicable */
  overrides: Record<string, boolean>;
}

/** Everything applicable — use when rules/overrides haven't loaded yet. */
export const EMPTY_APPLICABILITY_INDEX: ApplicabilityIndex = { rules: {}, overrides: {} };

// Plain Records (not Map/Set) so the index stays JSON-serializable if it ever
// flows near the IDB-persisted query cache.
export function buildApplicabilityIndex(
  activities: ActivityRuleInput[],
  overrides: OverrideInput[]
): ApplicabilityIndex {
  const rules: Record<string, string[] | null> = {};
  for (const a of activities) {
    rules[a.id] = getAppliesTo(a);
  }
  const overrideMap: Record<string, boolean> = {};
  for (const o of overrides) {
    overrideMap[`${o.activity_id}_${o.unit_id}`] = o.is_applicable;
  }
  return { rules, overrides: overrideMap };
}

export function isActivityApplicable(
  activity: Pick<Activity, 'id'>,
  unit: UnitInput,
  index: ApplicabilityIndex
): boolean {
  const override = index.overrides[`${activity.id}_${unit.id}`];
  if (override !== undefined) return override;
  const rule = index.rules[activity.id];
  if (!rule) return true;
  // Fail-open for untyped units: legacy units without a unit_type stay in
  // scope so adding a rule never silently shrinks existing totals.
  if (!unit.unit_type) return true;
  return rule.includes(unit.unit_type);
}

export function applicableActivities<A extends Pick<Activity, 'id'>>(
  activities: A[],
  unit: UnitInput,
  index: ApplicabilityIndex
): A[] {
  return activities.filter(a => isActivityApplicable(a, unit, index));
}

export function partitionUnitsByApplicability<U extends UnitInput>(
  activity: Pick<Activity, 'id'>,
  units: U[],
  index: ApplicabilityIndex
): { applicable: U[]; notApplicable: U[] } {
  const applicable: U[] = [];
  const notApplicable: U[] = [];
  for (const u of units) {
    (isActivityApplicable(activity, u, index) ? applicable : notApplicable).push(u);
  }
  return { applicable, notApplicable };
}

/** Total applicable (unit × activity) slots — the progress denominator. */
export function applicableSlotCount(
  units: UnitInput[],
  activities: Array<Pick<Activity, 'id'>>,
  index: ApplicabilityIndex
): number {
  let count = 0;
  for (const u of units) {
    for (const a of activities) {
      if (isActivityApplicable(a, u, index)) count++;
    }
  }
  return count;
}

/**
 * Index of the next activity applicable to this unit strictly after
 * `fromIndex`, or -1 if none. Auto-advance uses this to walk PAST
 * inapplicable activities instead of landing on them.
 */
export function nextApplicableIndex(
  trackActivities: Array<Pick<Activity, 'id'>>,
  unit: UnitInput,
  fromIndex: number,
  index: ApplicabilityIndex
): number {
  for (let i = fromIndex + 1; i < trackActivities.length; i++) {
    if (isActivityApplicable(trackActivities[i], unit, index)) return i;
  }
  return -1;
}

/**
 * Defensive auto-advance gap check: true if any APPLICABLE activity before
 * `uptoIndex` is missing or not completed. Inapplicable activities are not gaps.
 */
export function hasSequenceGaps(
  trackActivities: Array<Pick<Activity, 'id' | 'name'>>,
  unit: UnitInput,
  uptoIndex: number,
  index: ApplicabilityIndex,
  getLog: (activityName: string) => Pick<StatusLog, 'temporal_state'> | undefined | null
): boolean {
  for (let i = 0; i < uptoIndex; i++) {
    const a = trackActivities[i];
    if (!isActivityApplicable(a, unit, index)) continue;
    const log = getLog(a.name);
    if (!log || log.temporal_state !== 'completed') return true;
  }
  return false;
}

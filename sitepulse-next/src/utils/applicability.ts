import type { Milestone, MilestoneOverride, StatusLog, Unit } from '@/types/domain';
import { getAppliesTo } from '@/types/domain';

/**
 * Milestone applicability resolver — the single source of truth for
 * "does milestone M apply to unit U".
 *
 * Two data sources, resolved in priority order:
 *   1. Per-unit override rows (milestone_applicability_overrides) — always win.
 *   2. Unit-type rules (project_milestones.applies_to_unit_types) — null/empty = all types.
 *
 * A slot that is not applicable is excluded from every progress denominator,
 * the auto-advance sequence, and the map bottleneck computation. It is NOT a
 * temporal_state — status_logs never stores applicability.
 */

type MilestoneRuleInput = Pick<Milestone, 'id' | 'applies_to_unit_types'>;
type OverrideInput = Pick<MilestoneOverride, 'activity_id' | 'unit_id' | 'is_applicable'>;
type UnitInput = Pick<Unit, 'id' | 'unit_type'>;

export interface ApplicabilityIndex {
  /** milestone id → allowed unit types (null = applies to all) */
  rules: Record<string, string[] | null>;
  /** `${milestone_id}_${unit_id}` → is_applicable */
  overrides: Record<string, boolean>;
}

/** Everything applicable — use when rules/overrides haven't loaded yet. */
export const EMPTY_APPLICABILITY_INDEX: ApplicabilityIndex = { rules: {}, overrides: {} };

// Plain Records (not Map/Set) so the index stays JSON-serializable if it ever
// flows near the IDB-persisted query cache.
export function buildApplicabilityIndex(
  milestones: MilestoneRuleInput[],
  overrides: OverrideInput[]
): ApplicabilityIndex {
  const rules: Record<string, string[] | null> = {};
  for (const m of milestones) {
    rules[m.id] = getAppliesTo(m);
  }
  const overrideMap: Record<string, boolean> = {};
  for (const o of overrides) {
    overrideMap[`${o.activity_id}_${o.unit_id}`] = o.is_applicable;
  }
  return { rules, overrides: overrideMap };
}

export function isMilestoneApplicable(
  milestone: Pick<Milestone, 'id'>,
  unit: UnitInput,
  index: ApplicabilityIndex
): boolean {
  const override = index.overrides[`${milestone.id}_${unit.id}`];
  if (override !== undefined) return override;
  const rule = index.rules[milestone.id];
  if (!rule) return true;
  // Fail-open for untyped units: legacy units without a unit_type stay in
  // scope so adding a rule never silently shrinks existing totals.
  if (!unit.unit_type) return true;
  return rule.includes(unit.unit_type);
}

export function applicableMilestones<M extends Pick<Milestone, 'id'>>(
  milestones: M[],
  unit: UnitInput,
  index: ApplicabilityIndex
): M[] {
  return milestones.filter(m => isMilestoneApplicable(m, unit, index));
}

export function partitionUnitsByApplicability<U extends UnitInput>(
  milestone: Pick<Milestone, 'id'>,
  units: U[],
  index: ApplicabilityIndex
): { applicable: U[]; notApplicable: U[] } {
  const applicable: U[] = [];
  const notApplicable: U[] = [];
  for (const u of units) {
    (isMilestoneApplicable(milestone, u, index) ? applicable : notApplicable).push(u);
  }
  return { applicable, notApplicable };
}

/** Total applicable (unit × milestone) slots — the progress denominator. */
export function applicableSlotCount(
  units: UnitInput[],
  milestones: Array<Pick<Milestone, 'id'>>,
  index: ApplicabilityIndex
): number {
  let count = 0;
  for (const u of units) {
    for (const m of milestones) {
      if (isMilestoneApplicable(m, u, index)) count++;
    }
  }
  return count;
}

/**
 * Index of the next milestone applicable to this unit strictly after
 * `fromIndex`, or -1 if none. Auto-advance uses this to walk PAST
 * inapplicable milestones instead of landing on them.
 */
export function nextApplicableIndex(
  trackMilestones: Array<Pick<Milestone, 'id'>>,
  unit: UnitInput,
  fromIndex: number,
  index: ApplicabilityIndex
): number {
  for (let i = fromIndex + 1; i < trackMilestones.length; i++) {
    if (isMilestoneApplicable(trackMilestones[i], unit, index)) return i;
  }
  return -1;
}

/**
 * Defensive auto-advance gap check: true if any APPLICABLE milestone before
 * `uptoIndex` is missing or not completed. Inapplicable milestones are not gaps.
 */
export function hasSequenceGaps(
  trackMilestones: Array<Pick<Milestone, 'id' | 'name'>>,
  unit: UnitInput,
  uptoIndex: number,
  index: ApplicabilityIndex,
  getLog: (milestoneName: string) => Pick<StatusLog, 'temporal_state'> | undefined | null
): boolean {
  for (let i = 0; i < uptoIndex; i++) {
    const m = trackMilestones[i];
    if (!isMilestoneApplicable(m, unit, index)) continue;
    const log = getLog(m.name);
    if (!log || log.temporal_state !== 'completed') return true;
  }
  return false;
}

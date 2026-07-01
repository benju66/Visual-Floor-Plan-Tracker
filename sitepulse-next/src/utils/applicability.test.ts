import { describe, it, expect } from 'vitest';
import {
  buildApplicabilityIndex,
  isMilestoneApplicable,
  applicableMilestones,
  partitionUnitsByApplicability,
  applicableSlotCount,
  nextApplicableIndex,
  hasSequenceGaps,
  EMPTY_APPLICABILITY_INDEX,
} from './applicability';
import type { StatusLog } from '@/types/domain';

const ms = (id: string, appliesTo: string[] | null = null, name = id) =>
  ({ id, name, applies_to_unit_types: appliesTo } as never as {
    id: string;
    name: string;
    applies_to_unit_types: string[] | null;
  });

const un = (id: string, unitType: string | null = 'Apartment Unit') =>
  ({ id, unit_type: unitType });

const ov = (activityId: string, unitId: string, isApplicable: boolean) =>
  ({ activity_id: activityId, unit_id: unitId, is_applicable: isApplicable });

describe('buildApplicabilityIndex', () => {
  it('maps rules and overrides into plain records', () => {
    const index = buildApplicabilityIndex(
      [ms('m1', ['Apartment Unit']), ms('m2')],
      [ov('m1', 'u1', false)]
    );
    expect(index.rules).toEqual({ m1: ['Apartment Unit'], m2: null });
    expect(index.overrides).toEqual({ m1_u1: false });
  });

  it('treats an empty rule array as "applies to all" (null)', () => {
    const index = buildApplicabilityIndex([ms('m1', [])], []);
    expect(index.rules.m1).toBeNull();
  });

  it('drops non-string entries from malformed JSONB rules', () => {
    const malformed = { id: 'm1', name: 'm1', applies_to_unit_types: [1, 'Common Area', null] } as never;
    const index = buildApplicabilityIndex([malformed], []);
    expect(index.rules.m1).toEqual(['Common Area']);
  });
});

describe('isMilestoneApplicable', () => {
  const index = buildApplicabilityIndex(
    [ms('m1', ['Apartment Unit']), ms('m2')],
    [ov('m1', 'uIncluded', true), ov('m2', 'uExcluded', false)]
  );

  it('applies to all units when no rule exists', () => {
    expect(isMilestoneApplicable(ms('m2'), un('u1', 'Common Area'), index)).toBe(true);
  });

  it('respects a unit-type rule', () => {
    expect(isMilestoneApplicable(ms('m1'), un('u1', 'Apartment Unit'), index)).toBe(true);
    expect(isMilestoneApplicable(ms('m1'), un('u2', 'Common Area'), index)).toBe(false);
  });

  it('override wins in both directions', () => {
    // rule excludes Common Area, but override re-includes this unit
    expect(isMilestoneApplicable(ms('m1'), un('uIncluded', 'Common Area'), index)).toBe(true);
    // no rule restriction, but override excludes this unit
    expect(isMilestoneApplicable(ms('m2'), un('uExcluded', 'Apartment Unit'), index)).toBe(false);
  });

  it('fails open for units with no unit_type', () => {
    expect(isMilestoneApplicable(ms('m1'), un('u3', null), index)).toBe(true);
  });

  it('treats unknown milestones and the empty index as applicable', () => {
    expect(isMilestoneApplicable(ms('mUnknown'), un('u1'), index)).toBe(true);
    expect(isMilestoneApplicable(ms('m1'), un('u1', 'Common Area'), EMPTY_APPLICABILITY_INDEX)).toBe(true);
  });
});

describe('applicableMilestones / partitionUnitsByApplicability / applicableSlotCount', () => {
  const milestones = [ms('m1', ['Apartment Unit']), ms('m2'), ms('m3', ['Common Area'])];
  const units = [un('u1', 'Apartment Unit'), un('u2', 'Common Area'), un('u3', null)];
  const index = buildApplicabilityIndex(milestones, [ov('m2', 'u2', false)]);

  it('filters milestones per unit', () => {
    expect(applicableMilestones(milestones, un('u1', 'Apartment Unit'), index).map(m => m.id)).toEqual(['m1', 'm2']);
    expect(applicableMilestones(milestones, un('u2', 'Common Area'), index).map(m => m.id)).toEqual(['m3']);
  });

  it('partitions units per milestone', () => {
    const { applicable, notApplicable } = partitionUnitsByApplicability(ms('m1'), units, index);
    expect(applicable.map(u => u.id)).toEqual(['u1', 'u3']); // u3 fail-open
    expect(notApplicable.map(u => u.id)).toEqual(['u2']);
  });

  it('counts applicable slots for the progress denominator', () => {
    // u1: m1+m2 = 2; u2: m3 = 1 (m2 overridden off); u3: all 3 (fail-open)
    expect(applicableSlotCount(units, milestones, index)).toBe(6);
    expect(applicableSlotCount(units, milestones, EMPTY_APPLICABILITY_INDEX)).toBe(9);
  });
});

describe('nextApplicableIndex', () => {
  const track = [ms('m1'), ms('m2', ['Common Area']), ms('m3'), ms('m4', ['Common Area'])];
  const index = buildApplicabilityIndex(track, []);
  const apt = un('u1', 'Apartment Unit');

  it('walks past inapplicable milestones', () => {
    expect(nextApplicableIndex(track, apt, 0, index)).toBe(2);
  });

  it('returns -1 when nothing applicable remains', () => {
    expect(nextApplicableIndex(track, apt, 2, index)).toBe(-1);
    expect(nextApplicableIndex(track, apt, track.length - 1, index)).toBe(-1);
  });

  it('returns the immediate next when everything applies', () => {
    expect(nextApplicableIndex(track, un('u2', 'Common Area'), 0, index)).toBe(1);
  });
});

describe('hasSequenceGaps', () => {
  const track = [ms('m1'), ms('m2', ['Common Area']), ms('m3')];
  const index = buildApplicabilityIndex(track, []);
  const apt = un('u1', 'Apartment Unit');
  const logsOf = (states: Record<string, string>) =>
    (name: string): Pick<StatusLog, 'temporal_state'> | undefined =>
      states[name] !== undefined ? ({ temporal_state: states[name] } as never) : undefined;

  it('an inapplicable milestone is not a gap', () => {
    // m2 doesn't apply to apartments; only m1 must be completed before index 2
    expect(hasSequenceGaps(track, apt, 2, index, logsOf({ m1: 'completed' }))).toBe(false);
  });

  it('a missing or non-completed applicable milestone is a gap', () => {
    expect(hasSequenceGaps(track, apt, 2, index, logsOf({}))).toBe(true);
    expect(hasSequenceGaps(track, apt, 2, index, logsOf({ m1: 'ongoing' }))).toBe(true);
  });

  it('applies the gap rule to units the milestone does apply to', () => {
    const common = un('u2', 'Common Area');
    expect(hasSequenceGaps(track, common, 2, index, logsOf({ m1: 'completed' }))).toBe(true);
    expect(hasSequenceGaps(track, common, 2, index, logsOf({ m1: 'completed', m2: 'completed' }))).toBe(false);
  });

  it('never reports gaps at the start of the sequence', () => {
    expect(hasSequenceGaps(track, apt, 0, index, logsOf({}))).toBe(false);
  });
});

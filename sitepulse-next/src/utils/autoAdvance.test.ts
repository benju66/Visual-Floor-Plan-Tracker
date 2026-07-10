import { describe, it, expect } from 'vitest';
import { planAutoAdvance, type TrackActivity } from './autoAdvance';
import { buildApplicabilityIndex, EMPTY_APPLICABILITY_INDEX } from './applicability';
import type { Activity, TemporalState, Unit } from '@/types/domain';

// ─────────────────────────────────────────────────────────────────────────────
// Pure decision tests for planAutoAdvance (Status Sequencing & Data-Integrity Fix,
// Phase 1). The load-bearing invariant: auto-advance NEVER downgrades a slot that
// already has progress — it only tees up a Not-Started ('none') next slot. No mocks,
// no clock: the unit's per-slot state is passed in via `stateOf`.
// ─────────────────────────────────────────────────────────────────────────────

const act = (id: string, name: string): TrackActivity => ({
  id,
  name,
  color: `#${id}`,
  track: 'Production',
});

// An applicability-typed Activity for the N/A cases (buildApplicabilityIndex reads
// `id` + `applies_to_unit_types`).
const typedAct = (id: string, name: string, appliesTo: string[] | null): Activity =>
  ({ id, name, color: `#${id}`, track: 'Production', applies_to_unit_types: appliesTo } as unknown as Activity);

const untypedUnit = { id: 'u1', unit_type: null } as unknown as Unit;

// Build a stateOf from an index→state map; every unlisted index is 'none'.
const statesBy = (m: Record<number, TemporalState>) => (i: number): TemporalState => m[i] ?? 'none';

describe('planAutoAdvance', () => {
  it('advances to the next slot when it has not been started', () => {
    const acts = [act('a', 'A'), act('b', 'B')];
    const target = planAutoAdvance({
      orderedTrackActivities: acts,
      unit: untypedUnit,
      completedIndex: 0,
      applicabilityIndex: EMPTY_APPLICABILITY_INDEX,
      stateOf: statesBy({}),
    });
    expect(target).toEqual({ activityId: 'b', activityName: 'B', color: '#b', track: 'Production' });
  });

  it('returns null when the next slot is already completed (never downgrade)', () => {
    const acts = [act('a', 'A'), act('b', 'B')];
    const target = planAutoAdvance({
      orderedTrackActivities: acts,
      unit: untypedUnit,
      completedIndex: 0,
      applicabilityIndex: EMPTY_APPLICABILITY_INDEX,
      stateOf: statesBy({ 1: 'completed' }),
    });
    expect(target).toBeNull();
  });

  // The exact reported repro: completing the FIRST activity when the SECOND is already
  // completed. completedIndex === 0 skips the gap check, so only the never-downgrade
  // rule stands between the user and a wiped completion.
  it('returns null when completing the first activity and the second is already completed (the repro)', () => {
    const acts = [act('a', 'A'), act('b', 'B')];
    const target = planAutoAdvance({
      orderedTrackActivities: acts,
      unit: untypedUnit,
      completedIndex: 0,
      applicabilityIndex: EMPTY_APPLICABILITY_INDEX,
      stateOf: statesBy({ 1: 'completed' }),
    });
    expect(target).toBeNull();
  });

  it('returns null when the next slot is ongoing (never downgrade)', () => {
    const acts = [act('a', 'A'), act('b', 'B')];
    const target = planAutoAdvance({
      orderedTrackActivities: acts,
      unit: untypedUnit,
      completedIndex: 0,
      applicabilityIndex: EMPTY_APPLICABILITY_INDEX,
      stateOf: statesBy({ 1: 'ongoing' }),
    });
    expect(target).toBeNull();
  });

  it('returns null when the next slot is already planned (idempotent — no re-write)', () => {
    const acts = [act('a', 'A'), act('b', 'B')];
    const target = planAutoAdvance({
      orderedTrackActivities: acts,
      unit: untypedUnit,
      completedIndex: 0,
      applicabilityIndex: EMPTY_APPLICABILITY_INDEX,
      stateOf: statesBy({ 1: 'planned' }),
    });
    expect(target).toBeNull();
  });

  it('returns null when an applicable PRIOR activity is not completed (sequence gap)', () => {
    const acts = [act('a', 'A'), act('b', 'B'), act('c', 'C')];
    // Completing B (index 1), but A (index 0) is still Not Started → a real gap.
    const target = planAutoAdvance({
      orderedTrackActivities: acts,
      unit: untypedUnit,
      completedIndex: 1,
      applicabilityIndex: EMPTY_APPLICABILITY_INDEX,
      stateOf: statesBy({ 0: 'none', 2: 'none' }),
    });
    expect(target).toBeNull();
  });

  it('advances when all applicable priors are completed (no gap)', () => {
    const acts = [act('a', 'A'), act('b', 'B'), act('c', 'C')];
    const target = planAutoAdvance({
      orderedTrackActivities: acts,
      unit: untypedUnit,
      completedIndex: 1,
      applicabilityIndex: EMPTY_APPLICABILITY_INDEX,
      stateOf: statesBy({ 0: 'completed', 2: 'none' }),
    });
    expect(target?.activityId).toBe('c');
  });

  it('returns null when there is no next activity (completed the last one)', () => {
    const acts = [act('a', 'A')];
    const target = planAutoAdvance({
      orderedTrackActivities: acts,
      unit: untypedUnit,
      completedIndex: 0,
      applicabilityIndex: EMPTY_APPLICABILITY_INDEX,
      stateOf: statesBy({}),
    });
    expect(target).toBeNull();
  });

  it('returns null when the completed activity is not in the track (completedIndex < 0)', () => {
    const acts = [act('a', 'A'), act('b', 'B')];
    const target = planAutoAdvance({
      orderedTrackActivities: acts,
      unit: untypedUnit,
      completedIndex: -1,
      applicabilityIndex: EMPTY_APPLICABILITY_INDEX,
      stateOf: statesBy({}),
    });
    expect(target).toBeNull();
  });

  it('walks PAST an inapplicable next slot to the following applicable one', () => {
    // B is N/A for this typed unit → auto-advance should land on C.
    const acts = [typedAct('a', 'A', null), typedAct('b', 'B', ['other-type']), typedAct('c', 'C', null)];
    const typedUnit = { id: 'u1', unit_type: 'my-type' } as unknown as Unit;
    const index = buildApplicabilityIndex(acts, []);
    const target = planAutoAdvance({
      orderedTrackActivities: acts,
      unit: typedUnit,
      completedIndex: 0,
      applicabilityIndex: index,
      stateOf: statesBy({}),
    });
    expect(target?.activityId).toBe('c');
  });

  it('returns null when the next APPLICABLE slot (past an N/A one) is already completed', () => {
    const acts = [typedAct('a', 'A', null), typedAct('b', 'B', ['other-type']), typedAct('c', 'C', null)];
    const typedUnit = { id: 'u1', unit_type: 'my-type' } as unknown as Unit;
    const index = buildApplicabilityIndex(acts, []);
    const target = planAutoAdvance({
      orderedTrackActivities: acts,
      unit: typedUnit,
      completedIndex: 0,
      applicabilityIndex: index,
      // Index 2 (C, the next APPLICABLE slot) is already completed → never downgrade.
      stateOf: statesBy({ 2: 'completed' }),
    });
    expect(target).toBeNull();
  });
});

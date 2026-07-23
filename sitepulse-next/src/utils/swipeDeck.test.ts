import { describe, it, expect } from 'vitest';
import type { PendingChange } from '@/types/domain';
import {
  collectTimelinePayloads,
  orderDeck,
  buildHistoryEntry,
  restorePendingPayload,
  restoreTimelinePayloads,
  skipToBack,
  unskipLast,
  resolveCurrentState,
  nextSwipeState,
  swipeRightLabel,
  chooseStatusState,
  resolveSwipeGesture,
  SWIPE_OFFSET_THRESHOLD,
  SWIPE_VELOCITY_THRESHOLD,
} from './swipeDeck';

// Minimal PendingChange fixtures — only the fields the deck logic reads.
// (Stub-cast per the repo's test convention; the full shape is exercised by
// useFieldData/pendingChangesStore tests.)
function pc(over: Record<string, unknown> = {}): PendingChange {
  return { state: 'planned', extraProps: {}, log: null, capturedAt: '2026-07-22T00:00:00Z', ...over } as unknown as PendingChange;
}
const card = (id: string) => ({ unit: { id }, log: null });

describe('orderDeck', () => {
  const visible = [card('a'), card('b'), card('c'), card('d')];

  it('keeps visible order with nothing swiped or skipped', () => {
    expect(orderDeck(visible, [], []).map(c => c.unit.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('removes swiped cards entirely', () => {
    expect(orderDeck(visible, [{ unitId: 'b' }], []).map(c => c.unit.id)).toEqual(['a', 'c', 'd']);
  });

  it('moves skipped cards behind the main queue, preserving skip order', () => {
    expect(orderDeck(visible, [], ['c', 'a']).map(c => c.unit.id)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('drops skipped ids that are no longer visible (e.g. filtered out or swiped)', () => {
    expect(orderDeck(visible, [{ unitId: 'c' }], ['c', 'a']).map(c => c.unit.id)).toEqual(['b', 'd', 'a']);
  });
});

describe('skipToBack / unskipLast', () => {
  it('appends to the back', () => {
    expect(skipToBack(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('re-skipping an already-skipped card moves it to the very end', () => {
    expect(skipToBack(['a', 'b'], 'a')).toEqual(['b', 'a']);
  });

  it('unskipLast pops the most recent skip and is safe on empty', () => {
    expect(unskipLast(['a', 'b'])).toEqual(['a']);
    expect(unskipLast([])).toEqual([]);
  });
});

describe('collectTimelinePayloads / buildHistoryEntry', () => {
  const framing = pc({ extraProps: { activityObj: { name: 'Framing' } } });
  const paint = pc({ extraProps: { activityObj: { name: 'Painting' } } });
  const timeline = { 'u1_Framing': framing, 'u1_Painting': paint, 'u2_Framing': pc() };

  it('collects only the given unit\'s payloads (key prefix `${unitId}_`)', () => {
    expect(collectTimelinePayloads(timeline, 'u1')).toEqual([framing, paint]);
    expect(collectTimelinePayloads(timeline, 'u3')).toEqual([]);
  });

  it('buildHistoryEntry snapshots the unit\'s pending payload + timeline payloads', () => {
    const pending = { u1: pc({ state: 'ongoing' }) };
    expect(buildHistoryEntry('u1', pending, timeline, true)).toEqual({
      unitId: 'u1',
      previousPendingPayload: pending.u1,
      previousTimelinePayloads: [framing, paint],
      wasSkippedToBack: true,
    });
    expect(buildHistoryEntry('u9', pending, timeline, false).previousPendingPayload).toBeUndefined();
  });
});

describe('restorePendingPayload', () => {
  it('restores a snapshot payload at the unit key', () => {
    const snap = pc({ state: 'ongoing' });
    const next = restorePendingPayload({ u2: pc() }, 'u1', snap);
    expect(next.u1).toBe(snap);
    expect(Object.keys(next).sort()).toEqual(['u1', 'u2']);
  });

  it('an empty snapshot clears the unit key (undo of a fresh stage removes it)', () => {
    const next = restorePendingPayload({ u1: pc(), u2: pc() }, 'u1', undefined);
    expect(Object.keys(next)).toEqual(['u2']);
  });

  it('never mutates the input map', () => {
    const map = { u1: pc() };
    restorePendingPayload(map, 'u1', undefined);
    expect(Object.keys(map)).toEqual(['u1']);
  });
});

describe('restoreTimelinePayloads', () => {
  it('wipes all of the unit\'s keys, then re-adds snapshots keyed by activity name', () => {
    const stale = pc({ extraProps: { activityObj: { name: 'Stale' } } });
    const snapA = pc({ extraProps: { activityObj: { name: 'Framing' } } });
    const map = { 'u1_Stale': stale, 'u2_Framing': pc() };
    const next = restoreTimelinePayloads(map, 'u1', [snapA]);
    expect(Object.keys(next).sort()).toEqual(['u1_Framing', 'u2_Framing']);
    expect(next['u1_Framing']).toBe(snapA);
  });

  it('restoring an empty snapshot list just clears the unit (undo of a fresh timeline stage)', () => {
    const next = restoreTimelinePayloads({ 'u1_Framing': pc(), 'u2_X': pc() }, 'u1', []);
    expect(Object.keys(next)).toEqual(['u2_X']);
  });

  it('falls back to the log\'s synthesized activityName when no activity was picked', () => {
    const snap = pc({ extraProps: {}, log: { activityName: 'Drywall' } });
    const next = restoreTimelinePayloads({}, 'u1', [snap]);
    expect(Object.keys(next)).toEqual(['u1_Drywall']);
  });

  it('never mutates the input map', () => {
    const map = { 'u1_Framing': pc() };
    restoreTimelinePayloads(map, 'u1', []);
    expect(Object.keys(map)).toEqual(['u1_Framing']);
  });
});

describe('resolveCurrentState', () => {
  it('staged single change wins over everything', () => {
    expect(resolveCurrentState(pc({ state: 'ongoing' }), pc({ state: 'planned' }), 'completed')).toBe('ongoing');
  });

  it('then a staged timeline change, then the fetched log state', () => {
    expect(resolveCurrentState(undefined, pc({ state: 'planned' }), 'completed')).toBe('planned');
    expect(resolveCurrentState(undefined, undefined, 'completed')).toBe('completed');
  });

  it("defaults to 'none' when nothing is staged or fetched", () => {
    expect(resolveCurrentState(undefined, undefined, null)).toBe('none');
    expect(resolveCurrentState(undefined, undefined, undefined)).toBe('none');
  });
});

describe('nextSwipeState (the swipe-right progression)', () => {
  it('none→planned, planned→ongoing, ongoing→completed', () => {
    expect(nextSwipeState('none')).toBe('planned');
    expect(nextSwipeState('planned')).toBe('ongoing');
    expect(nextSwipeState('ongoing')).toBe('completed');
  });

  it("any other input yields 'planned' (the inline default; callers guard 'completed' themselves)", () => {
    expect(nextSwipeState('completed')).toBe('planned');
    expect(nextSwipeState('')).toBe('planned');
  });
});

describe('swipeRightLabel', () => {
  it("shows the would-be action when nothing is staged", () => {
    expect(swipeRightLabel(false, 'none')).toBe('PLN');
    expect(swipeRightLabel(false, 'planned')).toBe('ONG');
    expect(swipeRightLabel(false, 'ongoing')).toBe('✓');
    expect(swipeRightLabel(false, 'completed')).toBe('→');
  });

  it("always '✓' once a pending change is staged (the swipe won't restage)", () => {
    for (const s of ['none', 'planned', 'ongoing', 'completed']) {
      expect(swipeRightLabel(true, s)).toBe('✓');
    }
  });
});

describe('chooseStatusState', () => {
  it("an untouched card stages the picked activity as completed", () => {
    expect(chooseStatusState('none')).toBe('completed');
  });

  it('any other state is kept as-is', () => {
    expect(chooseStatusState('planned')).toBe('planned');
    expect(chooseStatusState('ongoing')).toBe('ongoing');
    expect(chooseStatusState('completed')).toBe('completed');
  });
});

describe('resolveSwipeGesture (Swipe Deck Excellence P2 — flick-to-commit)', () => {
  it('commits by drag distance alone, direction from offset sign', () => {
    expect(resolveSwipeGesture(120, 0)).toBe('right');
    expect(resolveSwipeGesture(-120, 0)).toBe('left');
  });

  it('commits a fast flick below the offset threshold, direction from velocity sign', () => {
    expect(resolveSwipeGesture(40, 600)).toBe('right');
    expect(resolveSwipeGesture(-40, -600)).toBe('left');
  });

  it('does not commit when a flick fights the drag direction (sign disagreement)', () => {
    // Flick left while the card sits right of centre must NOT commit right.
    expect(resolveSwipeGesture(40, -600)).toBeNull();
    expect(resolveSwipeGesture(-40, 600)).toBeNull();
  });

  it('commits a dead-centre flick in the velocity direction (no drag to disagree)', () => {
    expect(resolveSwipeGesture(0, 600)).toBe('right');
    expect(resolveSwipeGesture(0, -600)).toBe('left');
  });

  it('does not commit when both offset and velocity are sub-threshold', () => {
    expect(resolveSwipeGesture(40, 200)).toBeNull();
    expect(resolveSwipeGesture(-40, -200)).toBeNull();
    expect(resolveSwipeGesture(0, 0)).toBeNull();
  });

  it('offset wins outright — a disagreeing late flick cannot flip a long drag', () => {
    expect(resolveSwipeGesture(150, -600)).toBe('right');
    expect(resolveSwipeGesture(-150, 600)).toBe('left');
  });

  it('is inclusive at both thresholds (boundary values commit)', () => {
    expect(resolveSwipeGesture(SWIPE_OFFSET_THRESHOLD, 0)).toBe('right');
    expect(resolveSwipeGesture(-SWIPE_OFFSET_THRESHOLD, 0)).toBe('left');
    expect(resolveSwipeGesture(10, SWIPE_VELOCITY_THRESHOLD)).toBe('right');
    expect(resolveSwipeGesture(-10, -SWIPE_VELOCITY_THRESHOLD)).toBe('left');
    // Just under either threshold with the other quiet → no commit.
    expect(resolveSwipeGesture(SWIPE_OFFSET_THRESHOLD - 1, SWIPE_VELOCITY_THRESHOLD - 1)).toBeNull();
  });

  it('is a superset of the old `offset.x > 100` rule (everything that committed still commits)', () => {
    for (const off of [101, 150, 300, 5000]) {
      expect(resolveSwipeGesture(off, 0)).toBe('right');
      expect(resolveSwipeGesture(-off, 0)).toBe('left');
    }
  });

  it('honours caller-supplied thresholds', () => {
    expect(resolveSwipeGesture(60, 0, { offset: 50 })).toBe('right');
    expect(resolveSwipeGesture(60, 0, { offset: 200 })).toBeNull();
    expect(resolveSwipeGesture(10, 300, { velocity: 250 })).toBe('right');
    expect(resolveSwipeGesture(10, 300, { velocity: 400 })).toBeNull();
  });
});

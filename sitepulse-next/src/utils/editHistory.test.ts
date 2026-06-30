import { describe, it, expect } from 'vitest';
import {
  EDIT_HISTORY_CAP,
  emptyEditHistory,
  seedEditHistory,
  pushSnapshot,
  undo,
  redo,
  canUndo,
  canRedo,
} from './editHistory';
import type { PercentPoint } from '@/types/domain';

// A distinct one-point snapshot per step — the pctX doubles as a step id so tests can
// assert exactly which state the cursor landed on after undo/redo.
const snap = (id: number): PercentPoint[] => [{ pctX: id, pctY: id }];
const idOf = (s: PercentPoint[] | null): number | null => (s ? s[0].pctX : null);

describe('editHistory — empty / seed', () => {
  it('an empty history can neither undo nor redo', () => {
    const h = emptyEditHistory();
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it('a seeded history sits on the original with nothing to undo/redo yet', () => {
    const h = seedEditHistory(snap(0));
    expect(h.cursor).toBe(0);
    expect(h.snapshots).toHaveLength(1);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it('seed deep-copies so later mutation of the source array cannot corrupt it', () => {
    const source = snap(7);
    const h = seedEditHistory(source);
    source[0].pctX = 999;
    expect(h.snapshots[0][0].pctX).toBe(7);
  });
});

describe('editHistory — push grows + advances the cursor', () => {
  it('each push appends a state and moves the cursor onto it', () => {
    let h = seedEditHistory(snap(0));
    h = pushSnapshot(h, snap(1));
    expect(h.snapshots).toHaveLength(2);
    expect(h.cursor).toBe(1);
    h = pushSnapshot(h, snap(2));
    expect(h.snapshots).toHaveLength(3);
    expect(h.cursor).toBe(2);
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);
  });

  it('pushing deep-copies the snapshot (later mutation does not leak in)', () => {
    let h = seedEditHistory(snap(0));
    const pushed = snap(1);
    h = pushSnapshot(h, pushed);
    pushed[0].pctY = 999;
    expect(h.snapshots[1][0].pctY).toBe(1);
  });
});

describe('editHistory — undo / redo round-trip', () => {
  it('undo then redo returns to the same state', () => {
    let h = seedEditHistory(snap(0));
    h = pushSnapshot(h, snap(1));

    const back = undo(h);
    expect(idOf(back.current)).toBe(0); // restored the original trace
    h = back.history;
    expect(h.cursor).toBe(0);

    const forward = redo(h);
    expect(idOf(forward.current)).toBe(1); // re-applied the edit
    h = forward.history;
    expect(h.cursor).toBe(1);
  });

  it('steps back through every state in order', () => {
    let h = seedEditHistory(snap(0));
    h = pushSnapshot(h, snap(1));
    h = pushSnapshot(h, snap(2));

    let r = undo(h);
    expect(idOf(r.current)).toBe(1);
    r = undo(r.history);
    expect(idOf(r.current)).toBe(0);
  });

  it('the undo/redo result deep-copies so applying it cannot corrupt the stack', () => {
    let h = seedEditHistory(snap(0));
    h = pushSnapshot(h, snap(1));
    const r = undo(h);
    if (r.current) r.current[0].pctX = 999;
    // The stored original is untouched, so a later undo still returns it intact.
    expect(r.history.snapshots[0][0].pctX).toBe(0);
  });
});

describe('editHistory — a new push after an undo clears the redo branch', () => {
  it('forking discards everything after the cursor', () => {
    let h = seedEditHistory(snap(0));
    h = pushSnapshot(h, snap(1));
    h = pushSnapshot(h, snap(2));

    // Undo back to state 1, then make a fresh edit (state 3).
    h = undo(h).history; // cursor → 1
    expect(canRedo(h)).toBe(true);
    h = pushSnapshot(h, snap(3));

    expect(canRedo(h)).toBe(false); // old state-2 redo branch is gone
    expect(h.snapshots.map(s => s[0].pctX)).toEqual([0, 1, 3]);
    expect(h.cursor).toBe(2);
  });
});

describe('editHistory — cap drops the oldest', () => {
  it('never exceeds EDIT_HISTORY_CAP and trims from the front', () => {
    let h = seedEditHistory(snap(0));
    const total = EDIT_HISTORY_CAP + 5;
    for (let i = 1; i <= total; i++) h = pushSnapshot(h, snap(i));

    expect(h.snapshots).toHaveLength(EDIT_HISTORY_CAP);
    expect(h.cursor).toBe(EDIT_HISTORY_CAP - 1);
    // The newest survives at the cursor; the oldest (0..overflow-1) were dropped.
    expect(idOf([h.snapshots[h.cursor][0]])).toBe(total);
    expect(h.snapshots[0][0].pctX).toBe(total - EDIT_HISTORY_CAP + 1);
  });
});

describe('editHistory — boundary no-ops are safe', () => {
  it('undo at the original is a no-op with null current', () => {
    const h = seedEditHistory(snap(0));
    const r = undo(h);
    expect(r.current).toBeNull();
    expect(r.history).toBe(h); // unchanged history returned
  });

  it('redo at the newest state is a no-op with null current', () => {
    let h = seedEditHistory(snap(0));
    h = pushSnapshot(h, snap(1));
    const r = redo(h);
    expect(r.current).toBeNull();
    expect(r.history).toBe(h);
  });

  it('undo/redo on an empty history are safe no-ops', () => {
    const h = emptyEditHistory();
    expect(undo(h).current).toBeNull();
    expect(redo(h).current).toBeNull();
  });

  it('canUndo / canRedo track the boundaries', () => {
    let h = seedEditHistory(snap(0));
    expect(canUndo(h)).toBe(false);
    h = pushSnapshot(h, snap(1));
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);
    h = undo(h).history;
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(true);
  });
});

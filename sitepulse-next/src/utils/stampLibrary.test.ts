import { describe, it, expect } from 'vitest';
import type { PercentPoint } from '@/types/domain';
import {
  shapeSignature,
  pushRecent,
  saveStamp,
  removeStamp,
  renameStamp,
  RECENTS_CAP,
  type StampDef,
} from './stampLibrary';

const square = (offset = 0): PercentPoint[] => [
  { pctX: -0.1 + offset, pctY: -0.1 },
  { pctX: 0.1 + offset, pctY: -0.1 },
  { pctX: 0.1 + offset, pctY: 0.1 },
  { pctX: -0.1 + offset, pctY: 0.1 },
];

const makeStamp = (id: string, points: PercentPoint[], name = id): StampDef => ({
  id,
  name,
  points,
  createdAt: '2026-07-04T00:00:00.000Z',
});

describe('shapeSignature', () => {
  it('is identical for the same shape and differs for a different one', () => {
    expect(shapeSignature(square())).toBe(shapeSignature(square()));
    expect(shapeSignature(square())).not.toBe(shapeSignature(square(0.5)));
  });

  it('ignores sub-1/1000 floating-point noise', () => {
    const noisy = square().map((p) => ({ pctX: p.pctX + 0.0001, pctY: p.pctY + 0.0001 }));
    expect(shapeSignature(noisy)).toBe(shapeSignature(square()));
  });
});

describe('pushRecent', () => {
  it('prepends newest-first', () => {
    let recents: StampDef[] = [];
    recents = pushRecent(recents, makeStamp('a', square(0.1)));
    recents = pushRecent(recents, makeStamp('b', square(0.2)));
    expect(recents.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('de-dupes the same shape and moves it to the front (no duplicate)', () => {
    let recents: StampDef[] = [];
    recents = pushRecent(recents, makeStamp('a', square()));
    recents = pushRecent(recents, makeStamp('b', square(0.3)));
    // Re-stamp shape "a" (same geometry, new id) → collapses onto one entry, front.
    recents = pushRecent(recents, makeStamp('a2', square()));
    expect(recents).toHaveLength(2);
    expect(recents[0].id).toBe('a2');
    expect(recents.map((r) => r.id)).not.toContain('a');
  });

  it('caps the list at the given cap, dropping the oldest', () => {
    let recents: StampDef[] = [];
    for (let i = 0; i < RECENTS_CAP + 5; i += 1) {
      recents = pushRecent(recents, makeStamp(`s${i}`, square(i)));
    }
    expect(recents).toHaveLength(RECENTS_CAP);
    // Newest is at the front; the 5 oldest fell off.
    expect(recents[0].id).toBe(`s${RECENTS_CAP + 4}`);
    expect(recents.map((r) => r.id)).not.toContain('s0');
  });

  it('honors a custom cap', () => {
    let recents: StampDef[] = [];
    recents = pushRecent(recents, makeStamp('a', square(0.1)), 1);
    recents = pushRecent(recents, makeStamp('b', square(0.2)), 1);
    expect(recents.map((r) => r.id)).toEqual(['b']);
  });
});

describe('saveStamp / removeStamp / renameStamp', () => {
  it('saves newest-first and round-trips through remove', () => {
    let saved: StampDef[] = [];
    saved = saveStamp(saved, makeStamp('a', square()));
    saved = saveStamp(saved, makeStamp('b', square(0.3)));
    expect(saved.map((s) => s.id)).toEqual(['b', 'a']);
    saved = removeStamp(saved, 'b');
    expect(saved.map((s) => s.id)).toEqual(['a']);
    saved = removeStamp(saved, 'a');
    expect(saved).toEqual([]);
  });

  it('replaces an existing save with the same id (de-dup by id) and moves it to front', () => {
    let saved: StampDef[] = [];
    saved = saveStamp(saved, makeStamp('a', square(), 'Kitchen'));
    saved = saveStamp(saved, makeStamp('b', square(0.3), 'Bath'));
    saved = saveStamp(saved, makeStamp('a', square(), 'Kitchenette'));
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ id: 'a', name: 'Kitchenette' });
  });

  it('renames only the matching id and no-ops on an absent id', () => {
    let saved: StampDef[] = [saveStamp([], makeStamp('a', square(), 'Old'))[0]];
    saved = renameStamp(saved, 'a', 'New');
    expect(saved[0].name).toBe('New');
    const unchanged = renameStamp(saved, 'zzz', 'Nope');
    expect(unchanged).toEqual(saved);
  });
});

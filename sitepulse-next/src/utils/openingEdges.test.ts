import { describe, it, expect } from 'vitest';
import {
  getOpeningType,
  setOpeningEdge,
  removeOpeningEdge,
  toggleOpeningEdge,
  normalizeOpeningEdges,
  reindexOnVertexInsert,
  reindexOnVertexDelete,
  openingSegment,
  resolveOpenings,
} from '@/utils/openingEdges';
import { isOpeningEdgeArray, type OpeningEdge, type PercentPoint } from '@/types/domain';

const oe = (edgeIndex: number, type: OpeningEdge['type'] = 'door'): OpeningEdge => ({ edgeIndex, type });
// A unit square traced clockwise: 4 vertices → 4 edges (0:top, 1:right, 2:bottom, 3:closing/left).
const SQUARE: PercentPoint[] = [
  { pctX: 0, pctY: 0 },
  { pctX: 1, pctY: 0 },
  { pctX: 1, pctY: 1 },
  { pctX: 0, pctY: 1 },
];

describe('getOpeningType / setOpeningEdge / removeOpeningEdge', () => {
  it('reads the type tagged on an edge (or null)', () => {
    const edges = [oe(1, 'cased_opening')];
    expect(getOpeningType(edges, 1)).toBe('cased_opening');
    expect(getOpeningType(edges, 0)).toBeNull();
  });

  it('tags an edge and keeps the result sorted by edgeIndex', () => {
    const out = setOpeningEdge(setOpeningEdge([], 2, 'door'), 0, 'overhead');
    expect(out).toEqual([oe(0, 'overhead'), oe(2, 'door')]);
  });

  it('re-tagging the same edge replaces (one tag per edge)', () => {
    const out = setOpeningEdge([oe(1, 'door')], 1, 'pass_through');
    expect(out).toEqual([oe(1, 'pass_through')]);
    expect(out).toHaveLength(1);
  });

  it('removeOpeningEdge clears only the targeted edge and never mutates input', () => {
    const input = [oe(0), oe(1, 'overhead')];
    const out = removeOpeningEdge(input, 0);
    expect(out).toEqual([oe(1, 'overhead')]);
    expect(input).toHaveLength(2); // original untouched
  });
});

describe('toggleOpeningEdge', () => {
  it('sets an untagged edge to the active type', () => {
    expect(toggleOpeningEdge([], 1, 'door')).toEqual([oe(1, 'door')]);
  });

  it('clears the edge when it already carries the same type', () => {
    expect(toggleOpeningEdge([oe(1, 'door')], 1, 'door')).toEqual([]);
  });

  it('replaces a different type rather than clearing', () => {
    expect(toggleOpeningEdge([oe(1, 'door')], 1, 'overhead')).toEqual([oe(1, 'overhead')]);
  });
});

describe('normalizeOpeningEdges', () => {
  it('keeps the closing edge (n-1) and drops out-of-range / negative / non-integer', () => {
    const out = normalizeOpeningEdges([oe(3), oe(4), oe(-1), { edgeIndex: 1.5, type: 'door' }], 4);
    expect(out).toEqual([oe(3)]); // edge 3 is the valid closing edge of a 4-gon
  });

  it('drops unknown types and de-dupes an edge (last write wins)', () => {
    const out = normalizeOpeningEdges(
      [oe(0, 'door'), { edgeIndex: 0, type: 'window' as unknown as OpeningEdge['type'] }, oe(0, 'overhead')],
      4,
    );
    expect(out).toEqual([oe(0, 'overhead')]);
  });
});

describe('reindexOnVertexInsert', () => {
  it('shifts tags at/after the insertion up, leaves earlier ones, splits onto the first half', () => {
    // Insert at vertex 2: edge 1 (started at vertex 1) is split → tag stays on edge 1;
    // edge 2 → 3; edge 0 unchanged.
    const out = reindexOnVertexInsert([oe(0, 'door'), oe(1, 'overhead'), oe(2, 'cased_opening')], 2);
    expect(out).toEqual([oe(0, 'door'), oe(1, 'overhead'), oe(3, 'cased_opening')]);
  });

  it('is a no-op when every tag is before the insertion', () => {
    expect(reindexOnVertexInsert([oe(0), oe(1)], 3)).toEqual([oe(0), oe(1)]);
  });
});

describe('reindexOnVertexDelete', () => {
  it('drops the edge starting at the deleted vertex and shifts later edges down', () => {
    // Delete vertex 1: edge 1 (started at vertex 1) is dropped; edge 2 → 1; edge 0 kept.
    const { edges, removed } = reindexOnVertexDelete([oe(0, 'door'), oe(1, 'overhead'), oe(2, 'cased_opening')], 1);
    expect(edges).toEqual([oe(0, 'door'), oe(1, 'cased_opening')]);
    expect(removed).toEqual([oe(1, 'overhead')]);
  });

  it('keeps the edge that ENDED at the deleted vertex (edge deletedIndex-1)', () => {
    const { edges, removed } = reindexOnVertexDelete([oe(0, 'door')], 1);
    expect(edges).toEqual([oe(0, 'door')]); // edge 0 ends at vertex 1 → kept
    expect(removed).toEqual([]);
  });
});

describe('openingSegment / resolveOpenings', () => {
  it('returns the two endpoints, honoring the wrap-around closing edge', () => {
    expect(openingSegment(SQUARE, 0)).toEqual({ p1: SQUARE[0], p2: SQUARE[1] });
    expect(openingSegment(SQUARE, 3)).toEqual({ p1: SQUARE[3], p2: SQUARE[0] }); // closing edge
  });

  it('returns null for an index that cannot address an edge', () => {
    expect(openingSegment(SQUARE, 4)).toBeNull();
    expect(openingSegment(SQUARE, -1)).toBeNull();
  });

  it('resolveOpenings drops stale tags whose edge no longer exists', () => {
    const out = resolveOpenings(SQUARE, [oe(1, 'door'), oe(9, 'overhead')]);
    expect(out).toEqual([{ edgeIndex: 1, type: 'door', p1: SQUARE[1], p2: SQUARE[2] }]);
  });
});

describe('isOpeningEdgeArray (query-boundary guard)', () => {
  it('accepts a well-formed array and an empty array', () => {
    expect(isOpeningEdgeArray([])).toBe(true);
    expect(isOpeningEdgeArray([oe(0, 'door'), oe(2, 'pass_through')])).toBe(true);
  });

  it('rejects junk without throwing (null elements, bad type, negative/non-integer index)', () => {
    expect(isOpeningEdgeArray(null)).toBe(false);
    expect(isOpeningEdgeArray([null])).toBe(false);
    expect(isOpeningEdgeArray([{ edgeIndex: 0, type: 'window' }])).toBe(false);
    expect(isOpeningEdgeArray([{ edgeIndex: -1, type: 'door' }])).toBe(false);
    expect(isOpeningEdgeArray([{ edgeIndex: 1.5, type: 'door' }])).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import {
  GRID_COLLINEAR_TOL,
  isVectorOnGrid,
  isVectorOnAnyGrid,
  tagVectorsWithGrid,
} from './gridAwareSnap';
import type { Gridline, PercentPoint } from '@/types/domain';
import type { RBushItem } from '@/services/api';

const pt = (pctX: number, pctY: number): PercentPoint => ({ pctX, pctY });

// A horizontal confirmed grid line at y=0.5 spanning x ∈ [0.2, 0.8].
const hGrid: Gridline = { label: 'A', axis: 'h', p1: pt(0.2, 0.5), p2: pt(0.8, 0.5) };
// A vertical confirmed grid line at x=0.5 spanning y ∈ [0.2, 0.8].
const vGrid: Gridline = { label: '1', axis: 'v', p1: pt(0.5, 0.2), p2: pt(0.5, 0.8) };

describe('isVectorOnGrid — collinear + overlapping classifier (aspect 1)', () => {
  const aspect = 1;

  it('tags a wall lying exactly on and overlapping the grid line', () => {
    expect(isVectorOnGrid(pt(0.3, 0.5), pt(0.6, 0.5), hGrid, aspect)).toBe(true);
  });

  it('tags a partial overlap (wall extends past the grid end)', () => {
    expect(isVectorOnGrid(pt(0.7, 0.5), pt(1.0, 0.5), hGrid, aspect)).toBe(true);
  });

  it('rejects a parallel wall that is too far off the grid line', () => {
    // 0.01 perpendicular > tol (0.004).
    expect(isVectorOnGrid(pt(0.3, 0.51), pt(0.6, 0.51), hGrid, aspect)).toBe(false);
  });

  it('rejects a collinear wall whose span does not overlap the grid', () => {
    // On the same infinite line (y=0.5) but past the grid's right end (x>0.8).
    expect(isVectorOnGrid(pt(0.85, 0.5), pt(0.95, 0.5), hGrid, aspect)).toBe(false);
  });

  it('rejects a perpendicular wall that merely crosses the grid', () => {
    expect(isVectorOnGrid(pt(0.5, 0.3), pt(0.5, 0.7), hGrid, aspect)).toBe(false);
  });

  it('is tight at the tolerance boundary', () => {
    // Just inside tol → tagged; just outside → not.
    expect(isVectorOnGrid(pt(0.3, 0.5 + 0.003), pt(0.6, 0.5 + 0.003), hGrid, aspect)).toBe(true);
    expect(isVectorOnGrid(pt(0.3, 0.5 + 0.005), pt(0.6, 0.5 + 0.005), hGrid, aspect)).toBe(false);
  });

  it('classifies vertical grids symmetrically', () => {
    expect(isVectorOnGrid(pt(0.5, 0.3), pt(0.5, 0.7), vGrid, aspect)).toBe(true);
    expect(isVectorOnGrid(pt(0.51, 0.3), pt(0.51, 0.7), vGrid, aspect)).toBe(false);
  });

  it('returns false for a degenerate (zero-length) grid line', () => {
    const dot: Gridline = { label: 'x', axis: 'h', p1: pt(0.5, 0.5), p2: pt(0.5, 0.5) };
    expect(isVectorOnGrid(pt(0.3, 0.5), pt(0.6, 0.5), dot, aspect)).toBe(false);
  });
});

describe('isVectorOnGrid — aspect correction', () => {
  it('honors the aspect ratio when measuring perpendicular distance', () => {
    // A horizontal wall 0.006 below a horizontal grid. With aspect 2 the corrected
    // gap halves to 0.003 (≤ tol → tagged); at aspect 1 the raw 0.006 exceeds tol.
    const a = pt(0.3, 0.506);
    const b = pt(0.6, 0.506);
    expect(isVectorOnGrid(a, b, hGrid, 2)).toBe(true);
    expect(isVectorOnGrid(a, b, hGrid, 1)).toBe(false);
  });

  it('treats a non-positive aspect as 1 (no crash, no correction)', () => {
    expect(isVectorOnGrid(pt(0.3, 0.5), pt(0.6, 0.5), hGrid, 0)).toBe(true);
  });
});

describe('isVectorOnAnyGrid', () => {
  it('is true when the vector matches at least one grid', () => {
    expect(isVectorOnAnyGrid(pt(0.5, 0.3), pt(0.5, 0.7), [hGrid, vGrid], 1)).toBe(true);
  });

  it('is false when it matches none', () => {
    expect(isVectorOnAnyGrid(pt(0.3, 0.51), pt(0.6, 0.51), [hGrid, vGrid], 1)).toBe(false);
  });

  it('is false for an empty grid list', () => {
    expect(isVectorOnAnyGrid(pt(0.3, 0.5), pt(0.6, 0.5), [], 1)).toBe(false);
  });
});

describe('tagVectorsWithGrid', () => {
  const item = (start: PercentPoint, end: PercentPoint): RBushItem => ({
    minX: Math.min(start.pctX, end.pctX),
    minY: Math.min(start.pctY, end.pctY),
    maxX: Math.max(start.pctX, end.pctX),
    maxY: Math.max(start.pctY, end.pctY),
    lineData: { start, end },
  });

  it('passes vectors through untagged when there are no confirmed grids', () => {
    const vectors = [item(pt(0.3, 0.5), pt(0.6, 0.5))];
    expect(tagVectorsWithGrid(vectors, null, 1)).toBe(vectors); // same reference, no clone
    expect(tagVectorsWithGrid(vectors, [], 1)[0].isGrid).toBeUndefined();
  });

  it('tags grid-collinear vectors true and others false', () => {
    const onGrid = item(pt(0.3, 0.5), pt(0.6, 0.5));
    const wall = item(pt(0.3, 0.6), pt(0.6, 0.6));
    const tagged = tagVectorsWithGrid([onGrid, wall], [hGrid], 1);
    expect(tagged[0].isGrid).toBe(true);
    expect(tagged[1].isGrid).toBe(false);
  });

  it('does not mutate the input items', () => {
    const onGrid = item(pt(0.3, 0.5), pt(0.6, 0.5));
    tagVectorsWithGrid([onGrid], [hGrid], 1);
    expect(onGrid.isGrid).toBeUndefined();
  });
});

describe('GRID_COLLINEAR_TOL', () => {
  it('is a small positive fraction of the sheet', () => {
    expect(GRID_COLLINEAR_TOL).toBeGreaterThan(0);
    expect(GRID_COLLINEAR_TOL).toBeLessThan(0.02);
  });
});

import { describe, it, expect } from 'vitest';
import {
  sqr,
  dist2,
  distToSegment,
  distToSegmentSquared,
  getCentroid,
  getSnappedCoordinate,
  mixAlpha,
  nearestCentroidWithin,
  type CentroidTarget,
} from './geometry';
import type { PercentPoint } from '@/types/domain';

describe('nearestCentroidWithin — walk-route drop targeting', () => {
  const layout = { offsetX: 0, offsetY: 0, drawW: 1000, drawH: 1000 };
  // Square units centered at (100, 100) and (500, 500) logical px.
  const square = (cx: number, cy: number): PercentPoint[] => [
    { pctX: cx - 0.05, pctY: cy - 0.05 },
    { pctX: cx + 0.05, pctY: cy - 0.05 },
    { pctX: cx + 0.05, pctY: cy + 0.05 },
    { pctX: cx - 0.05, pctY: cy + 0.05 },
  ];
  const units: CentroidTarget[] = [
    { id: 'a', polygon_coordinates: square(0.1, 0.1) },
    { id: 'b', polygon_coordinates: square(0.5, 0.5) },
    { id: 'unmapped', polygon_coordinates: null },
  ];

  it('returns the unit whose centroid is within the radius', () => {
    expect(nearestCentroidWithin(units, 110, 95, 40, layout)).toBe('a');
  });

  it('returns the closest unit when several are in range', () => {
    // (320,320) → distance ~311 to a's centroid (100,100), ~255 to b's (500,500).
    expect(nearestCentroidWithin(units, 320, 320, 1000, layout)).toBe('b');
    // (280,280) → ~255 to a, ~311 to b.
    expect(nearestCentroidWithin(units, 280, 280, 1000, layout)).toBe('a');
  });

  it('returns null when nothing is within the radius', () => {
    expect(nearestCentroidWithin(units, 800, 100, 40, layout)).toBeNull();
  });

  it('skips units without polygon coordinates', () => {
    expect(nearestCentroidWithin([{ id: 'x', polygon_coordinates: [] }], 0, 0, 1e9, layout)).toBeNull();
  });
});

describe('mixAlpha — single source of truth for CSS color → rgba()', () => {
  it('expands 3-digit hex to rgba', () => {
    expect(mixAlpha('#f00', 0.5)).toBe('rgba(255,0,0,0.5)');
  });

  it('converts 6-digit hex to rgba', () => {
    expect(mixAlpha('#00ff00', 1)).toBe('rgba(0,255,0,1)');
  });

  it('upgrades rgb(...) to rgba with the alpha appended', () => {
    expect(mixAlpha('rgb(10, 20, 30)', 0.25)).toBe('rgba(10, 20, 30, 0.25)');
  });

  it('rewrites the alpha of an existing rgba(...)', () => {
    expect(mixAlpha('rgba(10, 20, 30, 0.9)', 0.1)).toBe('rgba(10, 20, 30, 0.1)');
  });

  it('returns empty string for empty input', () => {
    expect(mixAlpha('', 0.5)).toBe('');
  });

  it('passes through unrecognized color formats unchanged', () => {
    expect(mixAlpha('hotpink', 0.5)).toBe('hotpink');
  });
});

describe('getCentroid', () => {
  it('returns the origin for an empty list', () => {
    expect(getCentroid([])).toEqual({ pctX: 0, pctY: 0 });
  });

  it('averages the points', () => {
    const pts: PercentPoint[] = [
      { pctX: 0, pctY: 0 },
      { pctX: 10, pctY: 0 },
      { pctX: 10, pctY: 10 },
      { pctX: 0, pctY: 10 },
    ];
    expect(getCentroid(pts)).toEqual({ pctX: 5, pctY: 5 });
  });
});

describe('distance helpers', () => {
  it('sqr squares its input', () => {
    expect(sqr(4)).toBe(16);
  });

  it('dist2 is the squared euclidean distance', () => {
    expect(dist2({ pctX: 0, pctY: 0 }, { pctX: 3, pctY: 4 })).toBe(25);
  });

  it('distToSegment projects onto the segment and clamps to endpoints', () => {
    const v: PercentPoint = { pctX: 0, pctY: 0 };
    const w: PercentPoint = { pctX: 10, pctY: 0 };
    // Point above the middle of the segment: perpendicular distance is 5.
    expect(distToSegment({ pctX: 5, pctY: 5 }, v, w)).toBeCloseTo(5);
    // Point beyond the end clamps to w (distance 5, not the line projection).
    expect(distToSegment({ pctX: 15, pctY: 0 }, v, w)).toBeCloseTo(5);
  });

  it('distToSegmentSquared collapses to point distance for a zero-length segment', () => {
    const p: PercentPoint = { pctX: 3, pctY: 4 };
    const v: PercentPoint = { pctX: 0, pctY: 0 };
    expect(distToSegmentSquared(p, v, v)).toBe(25);
  });
});

// getSnappedCoordinate only needs an object with a `.search()` method, so we
// stub RBush instead of pulling in the real spatial index. `as never` keeps the
// stub assignable to the RBush<RBushItem> parameter without importing rbush.
function fakeTree(items: { lineData: { start: PercentPoint; end: PercentPoint } }[]) {
  return { search: () => items } as never;
}

describe('getSnappedCoordinate', () => {
  const aspect = 1;
  const drawW = 1000;
  const stageScale = 1;

  it('returns the cursor untouched when there is no vector tree', () => {
    const result = getSnappedCoordinate(0.5, 0.5, null, aspect, drawW, stageScale);
    expect(result).toEqual({ pctX: 0.5, pctY: 0.5, snapped: false });
  });

  it('does not snap when no lines are nearby', () => {
    const result = getSnappedCoordinate(0.5, 0.5, fakeTree([]), aspect, drawW, stageScale);
    expect(result.snapped).toBe(false);
  });

  it('applies corner gravity: snaps to a vertex within the snap radius', () => {
    // strength 15 / (1000 * 1) => snapRadiusX = 0.015. Vertex 0.001 away.
    const tree = fakeTree([
      { lineData: { start: { pctX: 0.501, pctY: 0.5 }, end: { pctX: 0.8, pctY: 0.5 } } },
    ]);
    const result = getSnappedCoordinate(0.5, 0.5, tree, aspect, drawW, stageScale);
    expect(result.snapped).toBe(true);
    expect(result.pctX).toBeCloseTo(0.501);
    expect(result.pctY).toBeCloseTo(0.5);
  });

  it('projects onto a segment edge when no vertex is within the radius', () => {
    // snapRadiusX = 0.015. Both endpoints are 0.2 away (no corner gravity),
    // but the perpendicular foot at (0.5, 0.5) is 0.005 away — snaps to the edge.
    const tree = fakeTree([
      { lineData: { start: { pctX: 0.3, pctY: 0.5 }, end: { pctX: 0.7, pctY: 0.5 } } },
    ]);
    const result = getSnappedCoordinate(0.5, 0.505, tree, aspect, drawW, stageScale);
    expect(result.snapped).toBe(true);
    expect(result.pctX).toBeCloseTo(0.5);
    expect(result.pctY).toBeCloseTo(0.5);
  });

  it('does not snap when the nearest edge is outside the radius', () => {
    const tree = fakeTree([
      { lineData: { start: { pctX: 0.3, pctY: 0.5 }, end: { pctX: 0.7, pctY: 0.5 } } },
    ]);
    // 0.1 away vertically, well beyond snapRadiusX (0.015).
    const result = getSnappedCoordinate(0.5, 0.6, tree, aspect, drawW, stageScale);
    expect(result.snapped).toBe(false);
    expect(result.pctX).toBeCloseTo(0.5);
    expect(result.pctY).toBeCloseTo(0.6);
  });
});

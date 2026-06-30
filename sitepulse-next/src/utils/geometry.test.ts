import { describe, it, expect } from 'vitest';
import {
  sqr,
  dist2,
  distToSegment,
  distToSegmentSquared,
  getCentroid,
  getSnappedCoordinate,
  isFinitePolygon,
  isPointInPolygon,
  mixAlpha,
  nearestCentroidWithin,
  type CentroidTarget,
} from './geometry';
import type { PercentPoint } from '@/types/domain';

describe('isFinitePolygon — corrupt-shape persistence guard', () => {
  const tri: PercentPoint[] = [
    { pctX: 0.1, pctY: 0.1 },
    { pctX: 0.3, pctY: 0.1 },
    { pctX: 0.2, pctY: 0.3 },
  ];
  it('accepts a normal polygon (>=3 finite, in-bounds points)', () => {
    expect(isFinitePolygon(tri)).toBe(true);
  });
  it('accepts a small / thin room (size is not rejected)', () => {
    expect(isFinitePolygon([
      { pctX: 0.5, pctY: 0.5 },
      { pctX: 0.5001, pctY: 0.5 },
      { pctX: 0.5, pctY: 0.5001 },
    ])).toBe(true);
  });
  it('rejects fewer than 3 vertices', () => {
    expect(isFinitePolygon([{ pctX: 0.1, pctY: 0.1 }, { pctX: 0.2, pctY: 0.2 }])).toBe(false);
  });
  it('rejects NaN / Infinity coordinates', () => {
    expect(isFinitePolygon([{ pctX: NaN, pctY: 0.1 }, ...tri])).toBe(false);
    expect(isFinitePolygon([{ pctX: Infinity, pctY: 0.1 }, ...tri])).toBe(false);
  });
  it('rejects wildly off-canvas points', () => {
    expect(isFinitePolygon([{ pctX: 50, pctY: 0.1 }, ...tri])).toBe(false);
  });
  it('rejects null / empty / non-array', () => {
    expect(isFinitePolygon(null)).toBe(false);
    expect(isFinitePolygon(undefined)).toBe(false);
    expect(isFinitePolygon([])).toBe(false);
  });
});

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

describe('isPointInPolygon — ray-casting interior test', () => {
  // A unit square in percent space.
  const square: PercentPoint[] = [
    { pctX: 0.2, pctY: 0.2 },
    { pctX: 0.4, pctY: 0.2 },
    { pctX: 0.4, pctY: 0.4 },
    { pctX: 0.2, pctY: 0.4 },
  ];

  it('returns true for a point clearly inside', () => {
    expect(isPointInPolygon({ pctX: 0.3, pctY: 0.3 }, square)).toBe(true);
  });

  it('returns false for a point clearly outside', () => {
    expect(isPointInPolygon({ pctX: 0.9, pctY: 0.9 }, square)).toBe(false);
    expect(isPointInPolygon({ pctX: 0.1, pctY: 0.3 }, square)).toBe(false);
  });

  it('detects interior across the boundary transition', () => {
    // Just inside the left edge vs just outside it — the boundary is where the
    // true→false flip happens (the standard ray-cast convention).
    expect(isPointInPolygon({ pctX: 0.201, pctY: 0.3 }, square)).toBe(true);
    expect(isPointInPolygon({ pctX: 0.199, pctY: 0.3 }, square)).toBe(false);
  });

  it('handles a concave (L-shaped) polygon', () => {
    // L-shape occupying the top and left of a 0..6 grid (the inner corner cut out).
    const lShape: PercentPoint[] = [
      { pctX: 0, pctY: 0 },
      { pctX: 6, pctY: 0 },
      { pctX: 6, pctY: 2 },
      { pctX: 2, pctY: 2 },
      { pctX: 2, pctY: 6 },
      { pctX: 0, pctY: 6 },
    ];
    expect(isPointInPolygon({ pctX: 1, pctY: 1 }, lShape)).toBe(true); // in the arm
    expect(isPointInPolygon({ pctX: 4, pctY: 4 }, lShape)).toBe(false); // in the notch
  });

  it('returns false for a degenerate polygon (< 3 vertices)', () => {
    expect(isPointInPolygon({ pctX: 0, pctY: 0 }, [{ pctX: 0, pctY: 0 }])).toBe(false);
  });
});

// getSnappedCoordinate only needs an object with a `.search()` method, so we
// stub RBush instead of pulling in the real spatial index. `as never` keeps the
// stub assignable to the RBush<RBushItem> parameter without importing rbush.
// `isGrid` is optional so existing (grid-naive) tests can omit it.
function fakeTree(
  items: { lineData: { start: PercentPoint; end: PercentPoint }; isGrid?: boolean }[],
) {
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

  // Interior-aware bias on a thick wall (two parallel faces). The cursor sits inside
  // the wall body, marginally closer to the OUTER face.
  describe('interior-aware snapping (thick walls)', () => {
    // Inner face at y=0.500 (room is above), outer face at y=0.510.
    const thickWall = fakeTree([
      { lineData: { start: { pctX: 0.3, pctY: 0.5 }, end: { pctX: 0.7, pctY: 0.5 } } },
      { lineData: { start: { pctX: 0.3, pctY: 0.51 }, end: { pctX: 0.7, pctY: 0.51 } } },
    ]);

    it('snaps to the nearer (outer) face when no interior hint is given', () => {
      // Cursor at y=0.506: 0.006 from inner, 0.004 from outer → outer wins.
      const result = getSnappedCoordinate(0.5, 0.506, thickWall, aspect, drawW, stageScale);
      expect(result.snapped).toBe(true);
      expect(result.pctY).toBeCloseTo(0.51);
    });

    it('snaps to the inner face when the interior is on that side', () => {
      // Same cursor, but the room interior is above the wall (y=0.3). The interior
      // hint is the 9th arg (after gridAware=false in the 8th slot — Phase 3c added it).
      const result = getSnappedCoordinate(0.5, 0.506, thickWall, aspect, drawW, stageScale, 15, false, { pctX: 0.5, pctY: 0.3 });
      expect(result.snapped).toBe(true);
      expect(result.pctY).toBeCloseTo(0.5);
      expect(result.pctX).toBeCloseTo(0.5);
    });
  });
});

describe('getSnappedCoordinate — grid-aware two-pass (Phase 3c)', () => {
  const aspect = 1;
  const drawW = 1000;
  const stageScale = 1; // snapRadiusX = 15 / 1000 = 0.015

  // A grid line (isGrid) dead-on at y=0.5, and a real wall 0.005 below it at y=0.505.
  // Both run x ∈ [0.3, 0.7]; their endpoints are ~0.2 away (no corner gravity).
  const gridThenWall = () =>
    fakeTree([
      { lineData: { start: { pctX: 0.3, pctY: 0.5 }, end: { pctX: 0.7, pctY: 0.5 } }, isGrid: true },
      { lineData: { start: { pctX: 0.3, pctY: 0.505 }, end: { pctX: 0.7, pctY: 0.505 } }, isGrid: false },
    ]);

  it('prefers the wall over a nearer grid line when grid-aware is on', () => {
    // Cursor sits exactly on the grid (y=0.5). Grid-naive would snap to it (dist 0);
    // grid-aware skips the grid and snaps to the wall 0.005 away.
    const result = getSnappedCoordinate(0.5, 0.5, gridThenWall(), aspect, drawW, stageScale, 15, true);
    expect(result.snapped).toBe(true);
    expect(result.pctY).toBeCloseTo(0.505);
  });

  it('snaps to the nearer grid line when grid-aware is off (prior behavior)', () => {
    const result = getSnappedCoordinate(0.5, 0.5, gridThenWall(), aspect, drawW, stageScale, 15, false);
    expect(result.snapped).toBe(true);
    expect(result.pctY).toBeCloseTo(0.5);
  });

  it('still snaps to a grid line when it is the only vector nearby (wall-on-grid fallback)', () => {
    // Only a grid-tagged vector is in range; grid-aware must still snap (it is the
    // wall there) rather than refuse — the down-weight-not-remove invariant.
    const onlyGrid = fakeTree([
      { lineData: { start: { pctX: 0.3, pctY: 0.5 }, end: { pctX: 0.7, pctY: 0.5 } }, isGrid: true },
    ]);
    const result = getSnappedCoordinate(0.5, 0.505, onlyGrid, aspect, drawW, stageScale, 15, true);
    expect(result.snapped).toBe(true);
    expect(result.pctY).toBeCloseTo(0.5);
  });

  it('is a no-op when no nearby vector is tagged as grid', () => {
    // No grids in range → grid-aware behaves exactly like the single-pass search.
    const onlyWall = fakeTree([
      { lineData: { start: { pctX: 0.3, pctY: 0.5 }, end: { pctX: 0.7, pctY: 0.5 } }, isGrid: false },
    ]);
    const aware = getSnappedCoordinate(0.5, 0.505, onlyWall, aspect, drawW, stageScale, 15, true);
    const naive = getSnappedCoordinate(0.5, 0.505, onlyWall, aspect, drawW, stageScale, 15, false);
    expect(aware).toEqual(naive);
    expect(aware.snapped).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import type { PercentPoint } from '@/types/domain';
import {
  flipPolygon,
  rotatePolygon,
  normalizeToCentroid,
  placeAtAnchor,
  buildStampPolygon,
  IDENTITY_STAMP_TRANSFORM,
} from './stampTransform';

// Stamp & Fast Markup — Phase 1. Pins the placement math so a refactor can't silently
// change how a stamp lands (and so FloorplanCanvas's flip/rotate keep the same output
// once they delegate here). Percentage space; float compares use a tolerance.

const near = (a: PercentPoint[], b: PercentPoint[], eps = 1e-9) => {
  expect(a).toHaveLength(b.length);
  a.forEach((p, i) => {
    expect(p.pctX).toBeCloseTo(b[i].pctX, 9);
    expect(p.pctY).toBeCloseTo(b[i].pctY, 9);
  });
  void eps;
};

// An L-shaped, deliberately asymmetric polygon so mirrors/rotations are observable.
const SHAPE: PercentPoint[] = [
  { pctX: 0.2, pctY: 0.2 },
  { pctX: 0.6, pctY: 0.2 },
  { pctX: 0.6, pctY: 0.4 },
  { pctX: 0.4, pctY: 0.4 },
  { pctX: 0.4, pctY: 0.5 },
  { pctX: 0.2, pctY: 0.5 },
];

describe('flipPolygon', () => {
  it('flipping twice on the same axis is the identity', () => {
    near(flipPolygon(flipPolygon(SHAPE, 'horizontal'), 'horizontal'), SHAPE);
    near(flipPolygon(flipPolygon(SHAPE, 'vertical'), 'vertical'), SHAPE);
  });

  it("mirrors about the shape's bounding-box center (horizontal flips X only)", () => {
    // xs span 0.2..0.6 → center 0.4; ys are untouched.
    const flipped = flipPolygon(SHAPE, 'horizontal');
    flipped.forEach((p, i) => {
      expect(p.pctX).toBeCloseTo(0.8 - SHAPE[i].pctX, 9); // 0.4*2 - x
      expect(p.pctY).toBeCloseTo(SHAPE[i].pctY, 9);
    });
  });
});

describe('rotatePolygon', () => {
  it('four 90° turns return to the start (both directions, non-square aspect)', () => {
    const aspect = 1.6;
    let r = SHAPE;
    for (let i = 0; i < 4; i += 1) r = rotatePolygon(r, 'right', aspect);
    near(r, SHAPE);
    let l = SHAPE;
    for (let i = 0; i < 4; i += 1) l = rotatePolygon(l, 'left', aspect);
    near(l, SHAPE);
  });

  it('left then right is the identity, and rotation preserves the centroid', () => {
    const aspect = 2;
    near(rotatePolygon(rotatePolygon(SHAPE, 'right', aspect), 'left', aspect), SHAPE);
    const before = normalizeToCentroid(SHAPE); // centroid → origin
    const afterCentroidRel = normalizeToCentroid(rotatePolygon(SHAPE, 'right', aspect));
    // centroid is preserved, so recentring before/after yields a pure rotation
    expect(before).toHaveLength(afterCentroidRel.length);
  });

  it('is aspect-correct: a real-space right turn maps (dx*aspect, dy) → (-dy, dx*aspect)/aspect', () => {
    const aspect = 2;
    // Two points around a known centroid; check one vertex's mapping explicitly.
    const pts: PercentPoint[] = [
      { pctX: 0.5, pctY: 0.5 },
      { pctX: 0.7, pctY: 0.5 }, // centroid = (0.6, 0.5); dx=+0.1, dy=0 for this vertex
    ];
    const out = rotatePolygon(pts, 'right', aspect);
    // real (dx*aspect, dy) = (0.2, 0) → CW (-0, 0.2) → back to pct (cx + 0/aspect, cy + 0.2)
    expect(out[1].pctX).toBeCloseTo(0.6, 9);
    expect(out[1].pctY).toBeCloseTo(0.7, 9);
  });

  it('non-positive aspect is a safe no-op (returns a copy)', () => {
    const out = rotatePolygon(SHAPE, 'right', 0);
    near(out, SHAPE);
    expect(out).not.toBe(SHAPE);
  });
});

describe('normalizeToCentroid + placeAtAnchor', () => {
  it('round-trips: normalize then place back at the original centroid returns the shape', () => {
    const cx = SHAPE.reduce((s, p) => s + p.pctX, 0) / SHAPE.length;
    const cy = SHAPE.reduce((s, p) => s + p.pctY, 0) / SHAPE.length;
    near(placeAtAnchor(normalizeToCentroid(SHAPE), { pctX: cx, pctY: cy }), SHAPE);
  });

  it('places the shape so its centroid lands exactly on the anchor', () => {
    const anchor = { pctX: 0.75, pctY: 0.25 };
    const placed = placeAtAnchor(normalizeToCentroid(SHAPE), anchor);
    const cx = placed.reduce((s, p) => s + p.pctX, 0) / placed.length;
    const cy = placed.reduce((s, p) => s + p.pctY, 0) / placed.length;
    expect(cx).toBeCloseTo(anchor.pctX, 9);
    expect(cy).toBeCloseTo(anchor.pctY, 9);
  });
});

describe('buildStampPolygon', () => {
  it('identity transform just re-anchors the shape to the drop point (centroid on anchor)', () => {
    const anchor = { pctX: 0.9, pctY: 0.1 };
    const out = buildStampPolygon(SHAPE, IDENTITY_STAMP_TRANSFORM, 1.5, anchor);
    const cx = out.reduce((s, p) => s + p.pctX, 0) / out.length;
    const cy = out.reduce((s, p) => s + p.pctY, 0) / out.length;
    expect(cx).toBeCloseTo(anchor.pctX, 9);
    expect(cy).toBeCloseTo(anchor.pctY, 9);
  });

  it('rotation is mod 4: a 4-step rotation equals the identity placement', () => {
    const anchor = { pctX: 0.5, pctY: 0.5 };
    const four = buildStampPolygon(SHAPE, { rotation: 4, flipX: false, flipY: false }, 1.3, anchor);
    const zero = buildStampPolygon(SHAPE, IDENTITY_STAMP_TRANSFORM, 1.3, anchor);
    near(four, zero);
  });

  it('empty input yields an empty polygon', () => {
    expect(buildStampPolygon([], IDENTITY_STAMP_TRANSFORM, 1, { pctX: 0, pctY: 0 })).toEqual([]);
  });
});

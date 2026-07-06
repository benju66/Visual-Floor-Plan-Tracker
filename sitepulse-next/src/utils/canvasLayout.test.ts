// Pins the pure layout + culling math extracted from FloorplanCanvas (Phase 1
// of the decomposition). The 1000×800 stage over a 1000×1000 image fixture is
// the SAME mapping the FloorplanCanvas golden master assumes (offsetX=100,
// drawW=drawH=800) — the two suites corroborate each other.
import { describe, it, expect } from 'vitest';
import { computeLayout, computeVisibleBox, cullVisibleUnits } from './canvasLayout';
import type { CanvasLayout, VisibleBox } from './canvasLayout';
import type { PercentPoint } from '@/types/domain';

// The golden-master fixture: 1000×800 stage, 1000×1000 image → contain scale
// 0.8 → drawW=drawH=800, offsetX=(1000-800)/2=100, offsetY=(800-800)/2=0.
const GOLDEN_LAYOUT: CanvasLayout = {
  offsetX: 100, offsetY: 0, drawW: 800, drawH: 800, stageW: 1000, stageH: 800,
};

describe('computeLayout', () => {
  it('fits + centers the golden-master case (1000×800 stage, 1000×1000 image)', () => {
    expect(computeLayout(1000, 800, 1000, 1000)).toEqual(GOLDEN_LAYOUT);
  });

  it('letterboxes vertically for a wide image (offsetY, not offsetX)', () => {
    // 2000×1000 image in a 1000×1000 stage → scale 0.5, centered vertically.
    expect(computeLayout(1000, 1000, 2000, 1000)).toEqual({
      offsetX: 0, offsetY: 250, drawW: 1000, drawH: 500, stageW: 1000, stageH: 1000,
    });
  });

  it('returns the all-zero layout while the stage is unmeasured', () => {
    const zero = { offsetX: 0, offsetY: 0, drawW: 0, drawH: 0, stageW: 0, stageH: 0 };
    expect(computeLayout(0, 800, 1000, 1000)).toEqual(zero);
    expect(computeLayout(1000, 0, 1000, 1000)).toEqual(zero);
  });

  it('fills the stage with zero offsets while image dims are unknown', () => {
    const fill = { offsetX: 0, offsetY: 0, drawW: 1000, drawH: 800, stageW: 1000, stageH: 800 };
    expect(computeLayout(1000, 800, 0, 1000)).toEqual(fill);
    expect(computeLayout(1000, 800, 1000, 0)).toEqual(fill);
  });
});

describe('computeVisibleBox', () => {
  const dims = { width: 1000, height: 800 };

  it('maps the unpanned scale-1 viewport to percent space with ±0.05 padding', () => {
    // minX = (0-100)/800 = -0.125; maxX = (1000-100)/800 = 1.125;
    // minY = 0/800 = 0;            maxY = 800/800 = 1 — then ±0.05 padding.
    const box = computeVisibleBox(GOLDEN_LAYOUT, { x: 0, y: 0 }, 1, dims);
    expect(box).toEqual({
      minPctX: -0.125 - 0.05,
      maxPctX: 1.125 + 0.05,
      minPctY: 0 - 0.05,
      maxPctY: 1 + 0.05,
    });
  });

  it('accounts for pan + zoom (stage position and scale)', () => {
    // scale 2, panned to x=-200: minX = ((200/2)-100)/800 = 0 → -0.05 padded;
    // maxX = (((1000+200)/2)-100)/800 = 0.625 → 0.675 padded.
    const box = computeVisibleBox(GOLDEN_LAYOUT, { x: -200, y: 0 }, 2, dims);
    expect(box?.minPctX).toBeCloseTo(-0.05, 10);
    expect(box?.maxPctX).toBeCloseTo(0.675, 10);
    expect(box?.minPctY).toBeCloseTo(-0.05, 10);
    // maxY = ((800/2)-0)/800 = 0.5 → 0.55 padded.
    expect(box?.maxPctY).toBeCloseTo(0.55, 10);
  });

  it('returns null while the layout or container box is degenerate', () => {
    const zeroLayout = computeLayout(0, 0, 0, 0);
    expect(computeVisibleBox(zeroLayout, { x: 0, y: 0 }, 1, dims)).toBeNull();
    expect(computeVisibleBox(GOLDEN_LAYOUT, { x: 0, y: 0 }, 1, { width: 0, height: 800 })).toBeNull();
    expect(computeVisibleBox(GOLDEN_LAYOUT, { x: 0, y: 0 }, 1, { width: 1000, height: 0 })).toBeNull();
  });
});

describe('cullVisibleUnits', () => {
  type TestUnit = { id: string; polygon_coordinates: PercentPoint[] | null };
  const square = (x: number, y: number): PercentPoint[] => [
    { pctX: x, pctY: y },
    { pctX: x + 0.1, pctY: y },
    { pctX: x + 0.1, pctY: y + 0.1 },
    { pctX: x, pctY: y + 0.1 },
  ];
  const box: VisibleBox = { minPctX: 0, maxPctX: 0.5, minPctY: 0, maxPctY: 0.5 };
  const inside: TestUnit = { id: 'inside', polygon_coordinates: square(0.2, 0.2) };
  const outside: TestUnit = { id: 'outside', polygon_coordinates: square(0.8, 0.8) };
  const straddling: TestUnit = { id: 'straddling', polygon_coordinates: square(0.45, 0.45) };
  const unmappedNull: TestUnit = { id: 'null', polygon_coordinates: null };
  const unmappedEmpty: TestUnit = { id: 'empty', polygon_coordinates: [] };
  const all = [inside, outside, straddling, unmappedNull, unmappedEmpty];

  it('passes every unit through when there is no box or no layout yet', () => {
    expect(cullVisibleUnits(all, null, 800, 'pan')).toBe(all);
    expect(cullVisibleUnits(all, box, 0, 'pan')).toBe(all);
  });

  it('keeps a unit when ANY vertex is inside the box, drops fully-outside ones', () => {
    expect(cullVisibleUnits(all, box, 800, 'pan').map(u => u.id)).toEqual([
      'inside',
      'straddling',
    ]);
  });

  it('excludes unmapped units except in draw mode (any slot is a click target)', () => {
    expect(cullVisibleUnits(all, box, 800, 'draw').map(u => u.id)).toEqual([
      'inside',
      'straddling',
      'null',
      'empty',
    ]);
  });

  it('treats the padded box edges as inclusive', () => {
    const onEdge: TestUnit = { id: 'edge', polygon_coordinates: [{ pctX: 0.5, pctY: 0.5 }] };
    expect(cullVisibleUnits([onEdge], box, 800, 'select')).toEqual([onEdge]);
  });
});

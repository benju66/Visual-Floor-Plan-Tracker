import { describe, it, expect } from 'vitest';
import {
  lensCoverage,
  rectContains,
  expandPatchRect,
  regionToBitmapSrc,
  positionToRect,
} from './loupeMath';
import type { ViewportRect } from './pdfRenderMath';

describe('lensCoverage', () => {
  it('covers a smaller page region as magnification grows', () => {
    const proj = { drawW: 1000, drawH: 1000, scale: 1 };
    const at3 = lensCoverage(0.5, 0.5, 200, 3, proj);
    const at6 = lensCoverage(0.5, 0.5, 200, 6, proj);
    const span3 = at3.maxPctX - at3.minPctX;
    const span6 = at6.maxPctX - at6.minPctX;
    // Double the magnification → half the covered span.
    expect(span6).toBeCloseTo(span3 / 2, 6);
  });

  it('is centered on the cursor', () => {
    const proj = { drawW: 800, drawH: 600, scale: 2 };
    const c = lensCoverage(0.4, 0.7, 200, 3, proj);
    expect((c.minPctX + c.maxPctX) / 2).toBeCloseTo(0.4, 6);
    expect((c.minPctY + c.maxPctY) / 2).toBeCloseTo(0.7, 6);
  });

  it('covers less of the page as the stage zooms in', () => {
    const span = (scale: number) => {
      const c = lensCoverage(0.5, 0.5, 200, 3, { drawW: 1000, drawH: 1000, scale });
      return c.maxPctX - c.minPctX;
    };
    expect(span(4)).toBeCloseTo(span(1) / 4, 6);
  });
});

describe('rectContains', () => {
  const outer: ViewportRect = { minPctX: 0.2, minPctY: 0.2, maxPctX: 0.8, maxPctY: 0.8 };

  it('accepts an inner rect fully inside', () => {
    const inner: ViewportRect = { minPctX: 0.4, minPctY: 0.4, maxPctX: 0.6, maxPctY: 0.6 };
    expect(rectContains(outer, inner)).toBe(true);
  });

  it('rejects an inner rect crossing the edge', () => {
    const inner: ViewportRect = { minPctX: 0.1, minPctY: 0.4, maxPctX: 0.6, maxPctY: 0.6 };
    expect(rectContains(outer, inner)).toBe(false);
  });

  it('shrink tightens the test — a rect near the edge fails with margin', () => {
    // width 0.6, shrink 0.2 → 0.06 margin per edge → safe zone [0.26, 0.74].
    const nearEdge: ViewportRect = { minPctX: 0.22, minPctY: 0.4, maxPctX: 0.5, maxPctY: 0.6 };
    expect(rectContains(outer, nearEdge, 0)).toBe(true);
    expect(rectContains(outer, nearEdge, 0.2)).toBe(false);
  });
});

describe('expandPatchRect', () => {
  it('grows the rect about its center by the factor', () => {
    const cov: ViewportRect = { minPctX: 0.45, minPctY: 0.45, maxPctX: 0.55, maxPctY: 0.55 };
    const out = expandPatchRect(cov, 2);
    expect(out.minPctX).toBeCloseTo(0.4, 6);
    expect(out.maxPctX).toBeCloseTo(0.6, 6);
    // Center is preserved.
    expect((out.minPctX + out.maxPctX) / 2).toBeCloseTo(0.5, 6);
  });

  it('clamps to the [0,1] page bounds at the edge', () => {
    const cov: ViewportRect = { minPctX: 0.02, minPctY: 0.02, maxPctX: 0.08, maxPctY: 0.08 };
    const out = expandPatchRect(cov, 4);
    expect(out.minPctX).toBe(0);
    expect(out.minPctY).toBe(0);
    expect(out.maxPctX).toBeLessThanOrEqual(1);
  });
});

describe('positionToRect', () => {
  it('converts an x/y/width/height box to a min/max rect', () => {
    const r = positionToRect({ x: 0.2, y: 0.3, width: 0.5, height: 0.4 });
    expect(r).toEqual({ minPctX: 0.2, minPctY: 0.3, maxPctX: 0.7, maxPctY: 0.7 });
  });

  it('round-trips with regionToBitmapSrc for a full-patch region', () => {
    const pos = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 };
    const rect = positionToRect(pos);
    const src = regionToBitmapSrc(rect, pos, 600, 600);
    expect(src.sx).toBeCloseTo(0, 6);
    expect(src.sy).toBeCloseTo(0, 6);
    expect(src.sw).toBeCloseTo(600, 6);
    expect(src.sh).toBeCloseTo(600, 6);
  });
});

describe('regionToBitmapSrc', () => {
  it('maps a sub-region to bitmap pixels', () => {
    const patchPos = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 };
    // A region covering the right half of the patch in X, full height.
    const region: ViewportRect = { minPctX: 0.5, minPctY: 0.2, maxPctX: 0.8, maxPctY: 0.8 };
    const src = regionToBitmapSrc(region, patchPos, 600, 600);
    expect(src.sx).toBeCloseTo(300, 4); // (0.5-0.2)/0.6 * 600
    expect(src.sy).toBeCloseTo(0, 4);
    expect(src.sw).toBeCloseTo(300, 4); // 0.3/0.6 * 600
    expect(src.sh).toBeCloseTo(600, 4);
  });
});

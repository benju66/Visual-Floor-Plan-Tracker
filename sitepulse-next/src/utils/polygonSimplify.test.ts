import { describe, it, expect } from 'vitest';
import { simplifyPolygon } from './polygonSimplify';
import type { PercentPoint } from '@/types/domain';

describe('simplifyPolygon', () => {
  it('collapses a dense staircase of a square into ~4 corners', () => {
    // Walk the perimeter of a 0.2..0.8 square in small steps (a flood-fill style
    // staircase along axis-aligned edges).
    const pts: PercentPoint[] = [];
    const step = 0.02;
    for (let x = 0.2; x < 0.8; x += step) pts.push({ pctX: x, pctY: 0.2 });
    for (let y = 0.2; y < 0.8; y += step) pts.push({ pctX: 0.8, pctY: y });
    for (let x = 0.8; x > 0.2; x -= step) pts.push({ pctX: x, pctY: 0.8 });
    for (let y = 0.8; y > 0.2; y -= step) pts.push({ pctX: 0.2, pctY: y });

    const out = simplifyPolygon(pts, 0.01);
    // A clean rectangle is 4 corners; allow a little slack for ring-split seams.
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(out.length).toBeLessThanOrEqual(6);
  });

  it('reduces a near-straight jagged diagonal to a couple of points', () => {
    const pts: PercentPoint[] = [];
    for (let i = 0; i <= 20; i++) {
      pts.push({ pctX: i / 20, pctY: i / 20 + (i % 2 === 0 ? 0.001 : -0.001) });
    }
    const out = simplifyPolygon(pts, 0.01);
    expect(out.length).toBeLessThan(pts.length);
  });

  it('leaves a small polygon unchanged', () => {
    const tri: PercentPoint[] = [
      { pctX: 0.1, pctY: 0.1 },
      { pctX: 0.3, pctY: 0.1 },
      { pctX: 0.2, pctY: 0.3 },
    ];
    expect(simplifyPolygon(tri)).toHaveLength(3);
  });
});

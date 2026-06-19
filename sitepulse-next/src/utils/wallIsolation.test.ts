import { describe, it, expect } from 'vitest';
import { isolateWalls, type WallSegment } from './wallIsolation';

const seg = (x0: number, y0: number, x1: number, y1: number): WallSegment => ({
  start: { pctX: x0, pctY: y0 },
  end: { pctX: x1, pctY: y1 },
});

describe('isolateWalls', () => {
  it('keeps long segments and drops short ones', () => {
    const longWall = seg(0.1, 0.1, 0.9, 0.1); // 0.8 wide
    const dimTick = seg(0.5, 0.5, 0.505, 0.5); // 0.005 — noise
    const out = isolateWalls([longWall, dimTick], { aspect: 1 });
    expect(out).toContain(longWall);
    expect(out).not.toContain(dimTick);
  });

  it('respects a custom minLength', () => {
    const mid = seg(0.1, 0.1, 0.13, 0.1); // 0.03 wide
    expect(isolateWalls([mid], { aspect: 1, minLength: 0.05 })).toHaveLength(0);
    expect(isolateWalls([mid], { aspect: 1, minLength: 0.02 })).toHaveLength(1);
  });

  it('aspect-corrects vertical lengths on a non-square sheet', () => {
    // A short-looking vertical delta becomes physically longer when the sheet is
    // much wider than tall (aspect > 1 compresses y in width-units terms).
    const vertical = seg(0.5, 0.1, 0.5, 0.16); // 0.06 in pctY
    // aspect 3 → physical length in width-units = 0.06/3 = 0.02
    expect(isolateWalls([vertical], { aspect: 3, minLength: 0.03 })).toHaveLength(0);
    expect(isolateWalls([vertical], { aspect: 3, minLength: 0.015 })).toHaveLength(1);
  });

  it('returns empty for empty input', () => {
    expect(isolateWalls([], { aspect: 1 })).toEqual([]);
  });
});

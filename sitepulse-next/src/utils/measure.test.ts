import { describe, it, expect } from 'vitest';
import {
  lengthFt,
  roundToFraction,
  formatFeetInchesFraction,
  verificationError,
  FRACTION_LABELS,
} from './measure';
import type { PercentPoint } from '@/types/domain';

// A 100×100 base-image basis with unitsPerPx = 1 makes pixel distance == feet, so
// a point {pctX: x/100, pctY: y/100} sits at pixel (x, y) and lengths read cleanly.
const W = 100;
const H = 100;
const p = (x: number, y: number): PercentPoint => ({ pctX: x / 100, pctY: y / 100 });

describe('lengthFt', () => {
  it('measures a single 2-point segment (3-4-5 → 50ft)', () => {
    expect(lengthFt([p(0, 0), p(30, 40)], W, H, 1)).toBeCloseTo(50, 6);
  });

  it('sums a multi-segment polyline', () => {
    // (0,0)→(30,40) = 50, →(60,80) = another 50 → 100ft total.
    expect(lengthFt([p(0, 0), p(30, 40), p(60, 80)], W, H, 1)).toBeCloseTo(100, 6);
  });

  it('scales by unitsPerPx', () => {
    expect(lengthFt([p(0, 0), p(30, 40)], W, H, 0.5)).toBeCloseTo(25, 6);
  });

  it('uses the base-image basis (anisotropic dims are respected)', () => {
    // A purely-horizontal 0.1 span across a 200px-wide image = 20px.
    expect(lengthFt([p(0, 50), { pctX: 0.1, pctY: 0.5 }], 200, 100, 1)).toBeCloseTo(20, 6);
  });

  it('returns null for fewer than 2 points', () => {
    expect(lengthFt([], W, H, 1)).toBeNull();
    expect(lengthFt([p(0, 0)], W, H, 1)).toBeNull();
  });

  it('returns null when the sheet is un-scaled or dims are missing', () => {
    expect(lengthFt([p(0, 0), p(30, 40)], W, H, null)).toBeNull();
    expect(lengthFt([p(0, 0), p(30, 40)], W, H, 0)).toBeNull();
    expect(lengthFt([p(0, 0), p(30, 40)], 0, H, 1)).toBeNull();
    expect(lengthFt([p(0, 0), p(30, 40)], W, 0, 1)).toBeNull();
  });
});

describe('roundToFraction', () => {
  it('snaps to the nearest 1/4 inch', () => {
    // 6.1" → 6.0"; 6.2" → 6.25"
    expect(roundToFraction(6.1 / 12, 4)).toBeCloseTo(6.0 / 12, 9);
    expect(roundToFraction(6.2 / 12, 4)).toBeCloseTo(6.25 / 12, 9);
  });

  it('snaps to the nearest 1/8 inch', () => {
    expect(roundToFraction(6.05 / 12, 8)).toBeCloseTo(6.0 / 12, 9);
    expect(roundToFraction(6.1 / 12, 8)).toBeCloseTo(6.125 / 12, 9);
  });

  it('snaps to the nearest 1/16 inch', () => {
    expect(roundToFraction(6.02 / 12, 16)).toBeCloseTo(6.0 / 12, 9);
    expect(roundToFraction(6.04 / 12, 16)).toBeCloseTo(6.0625 / 12, 9);
  });

  it('snaps negative values symmetrically', () => {
    expect(roundToFraction(-6.2 / 12, 4)).toBeCloseTo(-6.25 / 12, 9);
  });

  it('passes non-finite input through', () => {
    expect(Number.isNaN(roundToFraction(NaN, 4))).toBe(true);
  });
});

describe('formatFeetInchesFraction', () => {
  it('formats whole feet and inches with no fraction', () => {
    expect(formatFeetInchesFraction(0, 4)).toBe(`0'-0"`);
    expect(formatFeetInchesFraction(1, 4)).toBe(`1'-0"`);
    expect(formatFeetInchesFraction(12.5, 4)).toBe(`12'-6"`);
  });

  it('formats a quarter-inch fraction', () => {
    // 12ft 6.25in
    expect(formatFeetInchesFraction(12 + 6.25 / 12, 4)).toBe(`12'-6 1⁄4"`);
  });

  it('formats eighth and sixteenth fractions', () => {
    expect(formatFeetInchesFraction(3 / 12 + 1 / 8 / 12, 8)).toBe(`0'-3 1⁄8"`);
    expect(formatFeetInchesFraction(3 / 12 + 1 / 16 / 12, 16)).toBe(`0'-3 1⁄16"`);
  });

  it('reduces the fraction to lowest terms', () => {
    // 6 + 8/16 inch → 6 1/2, not 6 8/16
    expect(formatFeetInchesFraction(6.5 / 12, 16)).toBe(`0'-6 1⁄2"`);
    // 6 + 2/8 inch → 6 1/4
    expect(formatFeetInchesFraction((6 + 2 / 8) / 12, 8)).toBe(`0'-6 1⁄4"`);
  });

  it('rolls a full inch of fraction up to the next inch', () => {
    // 6.97" at 1/16 rounds to 7 whole inches (16/16 → +1 inch, no fraction).
    expect(formatFeetInchesFraction(6.97 / 12, 16)).toBe(`0'-7"`);
  });

  it('rolls 12 inches up to the next foot', () => {
    // 11.99ft at 1/4 rounds to 12'-0"
    expect(formatFeetInchesFraction(11.99, 4)).toBe(`12'-0"`);
    // 11.97" (just under a foot) at 1/16 rounds up to 1'-0"
    expect(formatFeetInchesFraction(11.97 / 12, 16)).toBe(`1'-0"`);
  });

  it('formats negative lengths', () => {
    expect(formatFeetInchesFraction(-12.5, 4)).toBe(`-12'-6"`);
  });

  it('returns empty string for non-finite input', () => {
    expect(formatFeetInchesFraction(NaN, 4)).toBe('');
    expect(formatFeetInchesFraction(Infinity, 8)).toBe('');
  });
});

describe('verificationError', () => {
  it('returns a signed percent error', () => {
    expect(verificationError(10.2, 10)).toBeCloseTo(2, 9);
    expect(verificationError(9.8, 10)).toBeCloseTo(-2, 9);
    expect(verificationError(10, 10)).toBe(0);
  });

  it('returns null when the actual length is non-positive or inputs are non-finite', () => {
    expect(verificationError(10, 0)).toBeNull();
    expect(verificationError(10, -5)).toBeNull();
    expect(verificationError(NaN, 10)).toBeNull();
    expect(verificationError(10, NaN)).toBeNull();
  });
});

describe('FRACTION_LABELS', () => {
  it('has a label for each supported denominator', () => {
    expect(FRACTION_LABELS[4]).toBe('1⁄4"');
    expect(FRACTION_LABELS[8]).toBe('1⁄8"');
    expect(FRACTION_LABELS[16]).toBe('1⁄16"');
  });
});

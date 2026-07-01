import { describe, it, expect } from 'vitest';
import {
  ARCH_SCALE_PRESETS,
  ESTIMATED_RENDER_DPI,
  pixelDistance,
  unitsPerPxFromCalibration,
  presetUnitsPerPx,
  computeAreaFromUnitsPerPx,
  parseFeetInches,
  formatFeetInches,
  formatArea,
  describeScale,
} from './scale';
import type { PercentPoint } from '@/types/domain';

describe('pixelDistance', () => {
  it('measures horizontal distance in image pixels', () => {
    expect(pixelDistance({ pctX: 0, pctY: 0.5 }, { pctX: 1, pctY: 0.5 }, 200, 100)).toBe(200);
  });

  it('is isotropic (converts pct → px before measuring)', () => {
    // 0.5 across a 200px width = 100px; 0.5 down a 100px height = 50px → hypotenuse.
    expect(
      pixelDistance({ pctX: 0, pctY: 0 }, { pctX: 0.5, pctY: 0.5 }, 200, 100),
    ).toBeCloseTo(Math.sqrt(100 * 100 + 50 * 50), 6);
  });

  it('is zero for the same point', () => {
    expect(pixelDistance({ pctX: 0.3, pctY: 0.7 }, { pctX: 0.3, pctY: 0.7 }, 500, 500)).toBe(0);
  });
});

describe('unitsPerPxFromCalibration', () => {
  it('returns feet-per-pixel for a known line', () => {
    // 200px line declared as 20 ft → 0.1 ft/px.
    expect(
      unitsPerPxFromCalibration({ pctX: 0, pctY: 0.5 }, { pctX: 1, pctY: 0.5 }, 200, 100, 20),
    ).toBeCloseTo(0.1, 9);
  });

  it('returns null for a zero-length line', () => {
    expect(
      unitsPerPxFromCalibration({ pctX: 0.3, pctY: 0.3 }, { pctX: 0.3, pctY: 0.3 }, 200, 100, 20),
    ).toBeNull();
  });

  it('returns null for non-positive length', () => {
    const a = { pctX: 0, pctY: 0 };
    const b = { pctX: 1, pctY: 0 };
    expect(unitsPerPxFromCalibration(a, b, 200, 100, 0)).toBeNull();
    expect(unitsPerPxFromCalibration(a, b, 200, 100, -5)).toBeNull();
  });

  it('returns null when image dimensions are missing', () => {
    const a = { pctX: 0, pctY: 0 };
    const b = { pctX: 1, pctY: 0 };
    expect(unitsPerPxFromCalibration(a, b, 0, 100, 20)).toBeNull();
    expect(unitsPerPxFromCalibration(a, b, 200, 0, 20)).toBeNull();
  });
});

describe('presetUnitsPerPx', () => {
  it('derives ft/px from an architectural ratio at the assumed DPI', () => {
    // 1/4" = 1' → 4 ft per paper inch; at 288 px/inch → 4/288 ft/px.
    expect(presetUnitsPerPx(4)).toBeCloseTo(4 / 288, 12);
  });

  it('uses ESTIMATED_RENDER_DPI by default', () => {
    expect(presetUnitsPerPx(10)).toBeCloseTo(10 / ESTIMATED_RENDER_DPI, 12);
  });

  it('honors an explicit DPI override', () => {
    expect(presetUnitsPerPx(4, 150)).toBeCloseTo(4 / 150, 12);
  });

  it('returns null for invalid input', () => {
    expect(presetUnitsPerPx(0)).toBeNull();
    expect(presetUnitsPerPx(-4)).toBeNull();
    expect(presetUnitsPerPx(4, 0)).toBeNull();
  });
});

describe('ARCH_SCALE_PRESETS', () => {
  it('encodes real feet per paper inch correctly', () => {
    const byLabel = Object.fromEntries(ARCH_SCALE_PRESETS.map((p) => [p.label, p.realFeetPerPaperInch]));
    expect(byLabel[`1/4" = 1'`]).toBe(4);
    expect(byLabel[`1/8" = 1'`]).toBe(8);
    expect(byLabel[`1/2" = 1'`]).toBe(2);
    expect(byLabel[`1" = 10'`]).toBe(10);
    expect(byLabel[`3/8" = 1'`]).toBeCloseTo(8 / 3, 9);
  });
});

describe('computeAreaFromUnitsPerPx', () => {
  // A unit square in percent space over a 100×100 image is 100×100 = 10,000 px².
  const square: PercentPoint[] = [
    { pctX: 0, pctY: 0 },
    { pctX: 1, pctY: 0 },
    { pctX: 1, pctY: 1 },
    { pctX: 0, pctY: 1 },
  ];

  it('is pixel area at unitsPerPx = 1', () => {
    expect(computeAreaFromUnitsPerPx(square, 100, 100, 1)).toBe(10000);
  });

  it('SQUARES the linear factor (the bug fix)', () => {
    // The legacy math multiplied area by the linear factor (→ 20,000). Correct
    // is area × factor² (→ 40,000). This guards against regressing to linear.
    expect(computeAreaFromUnitsPerPx(square, 100, 100, 2)).toBe(40000);
    expect(computeAreaFromUnitsPerPx(square, 100, 100, 0.5)).toBe(2500);
  });

  it('is orientation-independent', () => {
    const cw = [...square].reverse();
    expect(computeAreaFromUnitsPerPx(cw, 100, 100, 2)).toBe(40000);
  });

  it('returns null for fewer than 3 points', () => {
    expect(computeAreaFromUnitsPerPx(square.slice(0, 2), 100, 100, 1)).toBeNull();
  });

  it('returns null for missing scale or dimensions', () => {
    expect(computeAreaFromUnitsPerPx(square, 100, 100, null)).toBeNull();
    expect(computeAreaFromUnitsPerPx(square, 100, 100, 0)).toBeNull();
    expect(computeAreaFromUnitsPerPx(square, 0, 100, 1)).toBeNull();
    expect(computeAreaFromUnitsPerPx(square, 100, 0, 1)).toBeNull();
  });

  it('the new area differs from the retired × scale_ratio math and is dimensionally correct (Phase 3)', () => {
    // Reproduce a real create-path scenario at a 1/4" = 1' preset, 288-DPI render:
    //   legacy scale_ratio  = realFeetPerPaperInch × 12  (real IN per paper IN, per ScaleControl)
    //   canonical units_per_px = presetUnitsPerPx(realFeetPerPaperInch)  (ft per px)
    const realFeetPerPaperInch = 4; // 1/4" = 1'
    const legacyScaleRatio = realFeetPerPaperInch * 12; // = 48
    const unitsPerPx = presetUnitsPerPx(realFeetPerPaperInch)!; // = 4 / 288 ft/px

    // Pixel area of the unit square over a 100×100 base image = 10,000 px².
    const pixelArea = 10000;

    // OLD (dimensionally wrong): pixelArea × linear ratio.
    const oldArea = pixelArea * legacyScaleRatio; // 480,000 — nonsense "sq ft"
    // NEW (correct): pixelArea × units_per_px².
    const newArea = computeAreaFromUnitsPerPx(square, 100, 100, unitsPerPx)!;

    // They must NOT agree — the whole point of the fix.
    expect(newArea).not.toBeCloseTo(oldArea, 6);

    // And the new value is the true real-world area: a 100 px side at 288 px per
    // paper inch is 100/288 paper-in → × 4 ft/paper-in ≈ 1.389 ft; squared ≈ 1.929 sq ft.
    const sideFt = (100 / ESTIMATED_RENDER_DPI) * realFeetPerPaperInch;
    expect(newArea).toBeCloseTo(sideFt * sideFt, 6);
    expect(newArea).toBeCloseTo(1.929, 3);
  });
});

describe('parseFeetInches', () => {
  it('treats a bare number as feet', () => {
    expect(parseFeetInches('12')).toBe(12);
    expect(parseFeetInches('12.5')).toBe(12.5);
  });

  it('parses feet marks', () => {
    expect(parseFeetInches(`12'`)).toBe(12);
    expect(parseFeetInches('12 ft')).toBe(12);
  });

  it('parses inches-only', () => {
    expect(parseFeetInches('150"')).toBe(12.5);
    expect(parseFeetInches('6 in')).toBe(0.5);
  });

  it('parses combined feet and inches in several notations', () => {
    expect(parseFeetInches(`12'6"`)).toBe(12.5);
    expect(parseFeetInches(`12' 6"`)).toBe(12.5);
    expect(parseFeetInches(`12'-6"`)).toBe(12.5);
    expect(parseFeetInches('12ft 6in')).toBe(12.5);
  });

  it('returns null for unparseable input', () => {
    expect(parseFeetInches('')).toBeNull();
    expect(parseFeetInches('   ')).toBeNull();
    expect(parseFeetInches('abc')).toBeNull();
    expect(parseFeetInches('12 6')).toBeNull();
  });
});

describe('formatFeetInches', () => {
  it('formats whole and fractional feet', () => {
    expect(formatFeetInches(12)).toBe(`12'-0"`);
    expect(formatFeetInches(12.5)).toBe(`12'-6"`);
    expect(formatFeetInches(0.5)).toBe(`0'-6"`);
  });

  it('rolls 12 rounded inches up to the next foot', () => {
    expect(formatFeetInches(11.999)).toBe(`12'-0"`);
  });

  it('returns empty for non-finite input', () => {
    expect(formatFeetInches(NaN)).toBe('');
  });

  it('round-trips with parseFeetInches at inch resolution', () => {
    expect(parseFeetInches(formatFeetInches(12.5))).toBe(12.5);
  });
});

describe('formatArea', () => {
  it('rounds and thousands-separates', () => {
    expect(formatArea(1234.5)).toBe('1,235 sq ft');
    expect(formatArea(42)).toBe('42 sq ft');
  });

  it('returns empty for non-finite input', () => {
    expect(formatArea(NaN)).toBe('');
  });
});

describe('describeScale', () => {
  it('reads "Not set" when nothing is scaled', () => {
    expect(describeScale({ unitsPerPx: null, preset: null, source: null })).toBe('Not set');
    expect(describeScale({ unitsPerPx: undefined, preset: undefined, source: undefined })).toBe('Not set');
    expect(describeScale({ unitsPerPx: 0, preset: '', source: null })).toBe('Not set');
  });

  it('labels a preset as approximate', () => {
    expect(describeScale({ unitsPerPx: 0.0139, preset: `1/4" = 1'`, source: 'preset' })).toBe(
      `Scale: 1/4" = 1' (approx)`,
    );
  });

  it('labels a calibrated scale with 4-decimal ft/px', () => {
    expect(describeScale({ unitsPerPx: 0.025, preset: null, source: 'calibration' })).toBe(
      'Calibrated: 1 px = 0.0250 ft',
    );
  });

  it('calibration provenance wins over a stale preset label', () => {
    expect(describeScale({ unitsPerPx: 0.025, preset: `1/4" = 1'`, source: 'calibration' })).toBe(
      'Calibrated: 1 px = 0.0250 ft',
    );
  });

  it('treats a bare units_per_px with no provenance as calibrated', () => {
    expect(describeScale({ unitsPerPx: 0.05, preset: null, source: null })).toBe(
      'Calibrated: 1 px = 0.0500 ft',
    );
  });

  it('ignores a non-positive units_per_px on the calibration path', () => {
    // source says calibration but the number is unusable → fall through to Not set.
    expect(describeScale({ unitsPerPx: 0, preset: null, source: 'calibration' })).toBe('Not set');
  });
});

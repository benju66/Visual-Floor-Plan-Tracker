import type { PercentPoint } from '@/types/domain';
import { pixelDistance } from '@/utils/scale';

/**
 * Measuring-tool math (framework-free, deterministic, no I/O, Date.now()-free).
 *
 * The standalone measure tool (Scale, Measure & Production Rates — Phase 4) drops
 * 2..N snapped points on a calibrated drawing and reads the running length back in
 * fractional feet-inches. Everything here is pure and unit-tested; the load-bearing
 * correctness is the fraction rounding + inch/foot roll-up.
 *
 * CRITICAL — pixel basis: length uses the SAME basis as the area/calibration math,
 * the base image's natural pixel size (`sheets.base_image_url`). Mixing that with
 * the on-canvas pdf.js render size is the ~4× area bug Phase 3 fixed — do not
 * reintroduce it here. See {@link pixelDistance} / `imageDimensions.ts`.
 */

/** Architectural fraction precision: nearest 1/4", 1/8", or 1/16" of an inch. */
export type FractionDenominator = 4 | 8 | 16;

/** Human labels for the fraction selector (⁄ is U+2044 FRACTION SLASH). */
export const FRACTION_LABELS: Record<FractionDenominator, string> = {
  4: '1⁄4"',
  8: '1⁄8"',
  16: '1⁄16"',
};

/**
 * Total real-world length (feet) of a 2..N-point polyline: the sum of each
 * segment's `pixelDistance × unitsPerPx`, measured against the base-image pixel
 * basis (`imageWidth`/`imageHeight`). Returns `null` when there is nothing
 * meaningful to measure — fewer than 2 points, missing image dims, or an un-scaled
 * sheet — so a caller can prompt "set a scale first" instead of showing a wrong
 * number.
 */
export function lengthFt(
  points: readonly PercentPoint[],
  imageWidth: number,
  imageHeight: number,
  unitsPerPx: number | null | undefined,
): number | null {
  if (points.length < 2 || !imageWidth || !imageHeight || !(typeof unitsPerPx === 'number') || !(unitsPerPx > 0)) {
    return null;
  }
  let px = 0;
  for (let i = 1; i < points.length; i++) {
    px += pixelDistance(points[i - 1], points[i], imageWidth, imageHeight);
  }
  return px * unitsPerPx;
}

/**
 * Snap decimal feet to the nearest architectural fraction of an inch (1/`denom`",
 * `denom ∈ {4,8,16}`) and return decimal feet. Negative inputs snap symmetrically
 * (`Math.round` rounds half away from zero on the sign we restore). Non-finite
 * input passes through unchanged.
 */
export function roundToFraction(ft: number, denom: FractionDenominator): number {
  if (!Number.isFinite(ft)) return ft;
  const sign = ft < 0 ? -1 : 1;
  const inches = Math.abs(ft) * 12;
  const snappedInches = Math.round(inches * denom) / denom;
  return (sign * snappedInches) / 12;
}

/**
 * Format decimal feet as `12'-6 1⁄4"` — feet, whole inches, and a reduced fraction
 * of an inch snapped to 1/`denom`". Handles inch/foot roll-up: a value that rounds
 * to `…-11 16⁄16"` becomes the next inch/foot, and `…-12"` becomes the next foot,
 * because we first round the whole length to an integer number of 1/`denom`-inch
 * units and then carry into inches and feet. Non-finite input returns `''`.
 */
export function formatFeetInchesFraction(ft: number, denom: FractionDenominator): string {
  if (!Number.isFinite(ft)) return '';
  const sign = ft < 0 ? '-' : '';
  const unitsPerFoot = 12 * denom;
  // Total count of 1/denom-inch units, rounded — this is where roll-up happens.
  const totalUnits = Math.round(Math.abs(ft) * unitsPerFoot);
  const feet = Math.floor(totalUnits / unitsPerFoot);
  const remUnits = totalUnits - feet * unitsPerFoot; // 0 .. unitsPerFoot-1
  const inches = Math.floor(remUnits / denom); // 0 .. 11
  let num = remUnits - inches * denom; // 0 .. denom-1
  let den = denom;
  if (num > 0) {
    const g = gcd(num, den);
    num /= g;
    den /= g;
  }
  const inchStr = num > 0 ? `${inches} ${num}⁄${den}` : `${inches}`;
  return `${sign}${feet}'-${inchStr}"`;
}

/** Greatest common divisor (both args ≥ 0), for reducing inch fractions. */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Signed percent error of a measured length against a known actual length:
 * `(measured − actual) / actual × 100`. Positive = measured is long. Returns
 * `null` when `actual ≤ 0` (or either input is non-finite) so a caller can suppress
 * a meaningless verdict. Phase 5 ("Verify scale") consumes this.
 */
export function verificationError(measuredFt: number, actualFt: number): number | null {
  if (!Number.isFinite(measuredFt) || !Number.isFinite(actualFt) || !(actualFt > 0)) return null;
  return ((measuredFt - actualFt) / actualFt) * 100;
}

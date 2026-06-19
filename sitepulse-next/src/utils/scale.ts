import type { PercentPoint } from '@/types/domain';

/**
 * Drawing scale & calibration math (framework-free, deterministic, no I/O).
 *
 * The canonical scale value we store is `units_per_px`: real-world **feet per
 * base-image pixel**. It is defined against the base image's natural pixel size
 * (`sheets.base_image_url`) — the same basis the area math uses. From it:
 *   - area   = pixelArea  × units_per_px²   (sq ft)
 *   - length = pixelDist  × units_per_px    (ft)
 *
 * Two ways to obtain `units_per_px`:
 *   - Calibration (TRUSTED): user draws a line on a known dimension and types its
 *     real length → units_per_px = knownLengthFt / pixelDistance. Needs no DPI.
 *   - Preset (ESTIMATE): an architectural ratio (¼"=1', …) + an assumed render
 *     DPI. Approximate by nature — see {@link ESTIMATED_RENDER_DPI}.
 *
 * NOTE on the bug this replaces: the legacy area math did `pixelArea ×
 * scale_ratio`, applying a LINEAR factor to an AREA (dimensionally wrong). The
 * correct relationship squares the linear factor — captured in
 * {@link computeAreaFromUnitsPerPx}.
 */

/**
 * Backend PDF→PNG render DPI. The converter (sitepulse-backend/main.py) rasterizes
 * pages with `fitz.Matrix(4.0, 4.0)`; PyMuPDF's base is 72 DPI, so the converted
 * base image is 72 × 4 = 288 px per PDF "paper" inch.
 *
 * Used ONLY by the preset (estimate) path to guess a scale from an architectural
 * ratio: it assumes the drawing is a PDF rendered at this DPI. That assumption is
 * why presets are APPROXIMATE — and why they are meaningless on raw image uploads
 * (which have no paper size). Calibration needs no DPI and is exact.
 */
export const ESTIMATED_RENDER_DPI = 288;

export interface ArchScalePreset {
  /** Display label, e.g. `1/4" = 1'`. Stored verbatim in `sheets.scale_preset`. */
  label: string;
  /** Real-world feet represented by one inch on the paper drawing. */
  realFeetPerPaperInch: number;
}

/**
 * Architectural scale presets — mirrors the legacy SettingsMenu dropdown labels.
 * The factor is real feet per paper inch: `1/4" = 1'` means ¼ inch on paper = 1
 * foot, so 1 inch on paper = 4 feet.
 */
export const ARCH_SCALE_PRESETS: readonly ArchScalePreset[] = [
  { label: `1/8" = 1'`, realFeetPerPaperInch: 8 },
  { label: `1/4" = 1'`, realFeetPerPaperInch: 4 },
  { label: `3/8" = 1'`, realFeetPerPaperInch: 8 / 3 },
  { label: `1/2" = 1'`, realFeetPerPaperInch: 2 },
  { label: `1" = 10'`, realFeetPerPaperInch: 10 },
  { label: `1" = 20'`, realFeetPerPaperInch: 20 },
];

/**
 * Straight-line pixel distance between two percent-space points, in base-image
 * pixels. Converting pct → pixels with the real width/height restores isotropy
 * (percent space alone is anisotropic — see geometry.ts notes).
 */
export function pixelDistance(
  p1: PercentPoint,
  p2: PercentPoint,
  imageWidth: number,
  imageHeight: number,
): number {
  const dx = (p2.pctX - p1.pctX) * imageWidth;
  const dy = (p2.pctY - p1.pctY) * imageHeight;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Linear scale (feet per base-image pixel) from a calibration line of known real
 * length. Returns `null` for degenerate input (missing dims, non-positive length,
 * or zero-length line) so callers can leave the drawing un-scaled.
 */
export function unitsPerPxFromCalibration(
  p1: PercentPoint,
  p2: PercentPoint,
  imageWidth: number,
  imageHeight: number,
  knownLengthFt: number,
): number | null {
  if (!imageWidth || !imageHeight || !(knownLengthFt > 0)) return null;
  const px = pixelDistance(p1, p2, imageWidth, imageHeight);
  if (!(px > 0)) return null;
  return knownLengthFt / px;
}

/**
 * Linear scale (feet per base-image pixel) ESTIMATED from an architectural preset.
 * `assumedDpi` px per paper inch and `realFeetPerPaperInch` ft per paper inch give
 * ft per px directly. Approximate — see {@link ESTIMATED_RENDER_DPI}. Returns
 * `null` for invalid input.
 */
export function presetUnitsPerPx(
  realFeetPerPaperInch: number,
  assumedDpi: number = ESTIMATED_RENDER_DPI,
): number | null {
  if (!(realFeetPerPaperInch > 0) || !(assumedDpi > 0)) return null;
  return realFeetPerPaperInch / assumedDpi;
}

/**
 * Real-world area (sq ft) of a polygon ring given a linear `units_per_px`. This is
 * the CORRECT replacement for the legacy `pixelArea × scale_ratio` math: the
 * linear factor is squared because area is two-dimensional.
 *
 * Returns `null` when there is nothing meaningful to compute — fewer than 3
 * points, missing image dimensions, or no scale — so a label on an un-scaled
 * drawing still saves (area-less), matching the existing flow.
 */
export function computeAreaFromUnitsPerPx(
  points: readonly PercentPoint[],
  imageWidth: number,
  imageHeight: number,
  unitsPerPx: number | null | undefined,
): number | null {
  if (points.length < 3 || !imageWidth || !imageHeight || !unitsPerPx) return null;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const xA = points[i].pctX * imageWidth;
    const yA = points[i].pctY * imageHeight;
    const xB = points[j].pctX * imageWidth;
    const yB = points[j].pctY * imageHeight;
    area += xA * yB - xB * yA;
  }
  const pixelArea = Math.abs(area) / 2;
  return pixelArea * unitsPerPx * unitsPerPx;
}

/**
 * Parse a feet/inches length string to decimal feet. Accepts a bare number
 * (treated as feet), and feet/inch marks or words:
 *   `12.5`, `12`, `12'`, `12'6"`, `12' 6"`, `12'-6"`, `150"`, `6"`, `12ft 6in`.
 * Returns `null` when nothing is parseable.
 */
export function parseFeetInches(input: string): number | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (!s) return null;

  // A feet portion is a number marked with ' / ft / feet; an inch portion is a
  // number marked with " / in / inch(es). The trailing (?![a-z]) stops `ft`/`in`
  // from matching the start of an unrelated word. Numbers are unsigned — lengths
  // are never negative, and this keeps the `-` separator in `12'-6"` from being
  // read as a negative sign on the inches.
  const feetMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:'|ft|feet)(?![a-z])/);
  const inchMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)(?![a-z])/);

  if (feetMatch || inchMatch) {
    const feet = feetMatch ? parseFloat(feetMatch[1]) : 0;
    const inches = inchMatch ? parseFloat(inchMatch[1]) : 0;
    const total = feet + inches / 12;
    return Number.isFinite(total) ? total : null;
  }

  // No unit marks → a bare number is feet.
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : null;
  }

  return null;
}

/** Format decimal feet as `12'-6"` (inches rounded; 12" rolls up to the next foot). */
export function formatFeetInches(ft: number): string {
  if (!Number.isFinite(ft)) return '';
  const sign = ft < 0 ? '-' : '';
  const abs = Math.abs(ft);
  let feet = Math.floor(abs);
  let inches = Math.round((abs - feet) * 12);
  if (inches === 12) {
    feet += 1;
    inches = 0;
  }
  return `${sign}${feet}'-${inches}"`;
}

/** Format square feet as a rounded, thousands-separated `1,234 sq ft`. */
export function formatArea(sqft: number): string {
  if (!Number.isFinite(sqft)) return '';
  return `${Math.round(sqft).toLocaleString('en-US')} sq ft`;
}

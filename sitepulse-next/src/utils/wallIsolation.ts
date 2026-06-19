/**
 * Wall isolation — pure, framework-free, deterministic.
 *
 * Reduces the raw extracted vector "soup" (everything PyMuPDF found on the
 * sheet: walls, but also dimension strings, leader/extension lines, hatching,
 * furniture detailing, grid lines) down to the segments that are plausibly
 * WALLS, before region detection runs over them.
 *
 * v1 is a deterministic LENGTH filter (aspect-corrected): architectural walls
 * are long continuous strokes; dimension ticks, leader arrows, hatching, and
 * furniture detailing are short. It is intentionally conservative — it keeps
 * anything plausibly a wall and lets the flood-fill + the human's edit absorb
 * whatever slips through.
 *
 * Designed so a future CAD-layer filter (once architects export layered PDFs)
 * or a connectivity / double-line-pairing heuristic can replace or augment the
 * body WITHOUT changing the signature. No I/O, no Date.now(), no `any`.
 */
import type { PercentPoint } from '@/types/domain';
import { sqr } from '@/utils/geometry';

/** A single extracted line segment, in percent space (0–1 of the page rect). */
export interface WallSegment {
  start: PercentPoint;
  end: PercentPoint;
}

export interface IsolateWallsOptions {
  /**
   * drawW / drawH. Percent space is anisotropic (x and y are normalized by
   * different page dimensions), so a y-delta must be divided by `aspect` to be
   * measured in the same units as an x-delta — otherwise a diagonal wall on a
   * non-square sheet is mis-measured.
   */
  aspect: number;
  /**
   * Minimum physical segment length to keep, expressed in percent-of-width
   * units. Shorter strokes are treated as dimension/hatching/detail noise.
   * Default 0.012 (~1.2% of the sheet width). The main Phase-F3 tuning knob.
   */
  minLength?: number;
}

/**
 * Keep only "wall-like" segments. Pure: same input → same output.
 */
export function isolateWalls(
  segments: readonly WallSegment[],
  opts: IsolateWallsOptions,
): WallSegment[] {
  const aspect = opts.aspect > 0 ? opts.aspect : 1;
  const minLen = opts.minLength ?? 0.012;
  const minLenSq = sqr(minLen);

  return segments.filter((s) => {
    const dx = s.end.pctX - s.start.pctX;
    const dy = (s.end.pctY - s.start.pctY) / aspect;
    return dx * dx + dy * dy >= minLenSq;
  });
}

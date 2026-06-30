import type { PercentPoint } from '@/types/domain';
import { isFinitePolygon } from './geometry';

/**
 * Pure polygon-validity helpers used to WARN (never block) on a self-overlapping
 * ("bow-tie") trace before it corrupts the room's square-footage. Framework-free,
 * deterministic, no I/O, no `Date.now()`, JSON-serializable in/out — safe to call
 * on every render and to unit-test in isolation (Drawing Tool Excellence — Phase 2).
 *
 * `isFinitePolygon` (geometry.ts) stays the single source of truth for NaN /
 * off-canvas rejection; this module only adds the self-intersection layer and a
 * composed `polygonIsSimpleAndFinite`.
 */

/**
 * 2D cross product of (a − o) × (b − o). Sign encodes the turn direction o→a→b:
 * > 0 left turn, < 0 right turn, 0 collinear.
 */
const orient = (o: PercentPoint, a: PercentPoint, b: PercentPoint): number =>
  (a.pctX - o.pctX) * (b.pctY - o.pctY) - (a.pctY - o.pctY) * (b.pctX - o.pctX);

/**
 * True only if segments AB and CD cross **properly** — i.e. each segment strictly
 * straddles the other's supporting line (all four orientations non-zero with
 * opposite signs). Deliberately ignores collinear overlaps and endpoint touches:
 * for a non-blocking bow-tie warning, a clean interior crossing is what signals a
 * wrong area, and excluding the degenerate cases avoids false positives on thin or
 * collinear shapes. NaN coordinates make every comparison false → returns false.
 */
const segmentsProperlyIntersect = (
  a: PercentPoint,
  b: PercentPoint,
  c: PercentPoint,
  d: PercentPoint,
): boolean => {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
};

/**
 * True if any two **non-adjacent** edges of the CLOSED polygon cross. The closing
 * edge (last → first) is treated as a real edge; adjacent edges (which legitimately
 * share a vertex) are skipped so a normal corner is never mistaken for a crossing.
 * O(n²) over the small vertex counts here. A triangle (or fewer) can never
 * self-intersect — it has no non-adjacent edge pair — so it short-circuits false.
 */
export const isSelfIntersecting = (points: PercentPoint[]): boolean => {
  if (!Array.isArray(points) || points.length < 4) return false;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Skip adjacent edges: consecutive (j === i+1) share points[i+1]; the
      // first edge (i === 0) and the closing edge (j === n-1) share points[0].
      if (j === i + 1) continue;
      if (i === 0 && j === n - 1) continue;
      const c = points[j];
      const d = points[(j + 1) % n];
      if (segmentsProperlyIntersect(a, b, c, d)) return true;
    }
  }
  return false;
};

/**
 * Composes the two validity layers: a polygon is "simple and finite" when it
 * passes `isFinitePolygon` (≥3 finite, on-canvas vertices) AND is not
 * self-intersecting. Used only to drive the warning cue — NEVER to block a save
 * (owner decision: self-intersection is surfaced, not trapped).
 */
export const polygonIsSimpleAndFinite = (
  points: PercentPoint[] | null | undefined,
): boolean => isFinitePolygon(points) && !isSelfIntersecting(points as PercentPoint[]);

/**
 * Polygon simplification — pure, framework-free, deterministic.
 *
 * Flood-fill boundary tracing (see `regionDetect.ts`) produces a dense staircase
 * of hundreds of tiny cell-edge steps. This collapses it into a clean, editable
 * polygon: an axis-aligned run becomes one edge, a diagonal wall becomes one
 * segment. Ramer–Douglas–Peucker, ring-aware (the loop is split at its two most
 * distant vertices so the closure isn't treated as a hard endpoint), followed by
 * a near-collinear vertex drop. No I/O, no Date.now(), no `any`.
 */
import type { PercentPoint } from '@/types/domain';

/** Perpendicular distance from `p` to the line through `a`,`b` (percent units). */
function perpDist(p: PercentPoint, a: PercentPoint, b: PercentPoint): number {
  const dx = b.pctX - a.pctX;
  const dy = b.pctY - a.pctY;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.pctX - a.pctX, p.pctY - a.pctY);
  return Math.abs((dx * (a.pctY - p.pctY) - (a.pctX - p.pctX) * dy) / len);
}

/** Ramer–Douglas–Peucker on an open polyline. */
function rdp(pts: PercentPoint[], tol: number): PercentPoint[] {
  if (pts.length < 3) return pts.slice();
  let maxD = 0;
  let idx = 0;
  const first = pts[0];
  const last = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], first, last);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= tol) return [first, last];
  const left = rdp(pts.slice(0, idx + 1), tol);
  const right = rdp(pts.slice(idx), tol);
  return left.slice(0, -1).concat(right);
}

/** Drop vertices that lie (within `tol`) on the line between their neighbors. */
function dropCollinear(pts: PercentPoint[], tol: number): PercentPoint[] {
  const n = pts.length;
  if (n < 4) return pts;
  const out: PercentPoint[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    if (perpDist(cur, prev, next) > tol) out.push(cur);
  }
  return out.length >= 3 ? out : pts;
}

/**
 * Simplify a closed polygon ring (percent space). `tol` is in percent units
 * (~0.004 ≈ a clean default for a 600-cell raster). Returns at least a triangle.
 */
export function simplifyPolygon(points: PercentPoint[], tol = 0.004): PercentPoint[] {
  if (points.length < 4) return points.slice();

  // Anchor the ring split at the vertex farthest from points[0].
  let far = 0;
  let farD = -1;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i].pctX - points[0].pctX, points[i].pctY - points[0].pctY);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }

  const firstHalf = points.slice(0, far + 1);
  const secondHalf = points.slice(far).concat([points[0]]);
  const a = rdp(firstHalf, tol);
  const b = rdp(secondHalf, tol);
  const merged = a.slice(0, -1).concat(b.slice(0, -1));
  return dropCollinear(merged, tol * 0.5);
}

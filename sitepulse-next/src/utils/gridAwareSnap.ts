/**
 * Grid-aware snapping (AI Tracing Assist — Phase 3c) — pure, framework-free.
 *
 * The problem: on grid-heavy drawing sets (e.g. Project A) the structural grid is
 * drawn with heavy lines, so the magnetic snapping engine happily grabs a grid line
 * when you meant to trace the wall a few pixels away. Phase 3b already captured each
 * sheet's gridlines (the human pointed them out), so we KNOW exactly which lines are
 * grids — no lineweight signature needed.
 *
 * This module classifies each snapping vector as "on a confirmed grid line" — i.e.
 * collinear with AND overlapping one of the confirmed {@link Gridline}s. The
 * canvas tags the RBush items with that flag at tree-build time, and
 * `getSnappedCoordinate` (called grid-aware) then DE-PRIORITIZES the tagged vectors:
 * it prefers a real-wall vector when one is within range, and only falls back to a
 * grid vector when nothing else is there — so a wall that runs ALONG a grid line
 * still snaps (we down-weight, never remove).
 *
 * Everything here is deterministic and side-effect-free (no DB, no `Date.now()`, no
 * network) so the heuristics are unit-tested in isolation (AGENTS.md §9). Geometry
 * lives in the SAME percent space (0..1) as `polygon_coordinates`/`sheet_vectors`/
 * `sheet_gridlines`. Distances are aspect-corrected the same way as
 * `getSnappedCoordinate` (the Y axis is divided by `aspect = drawW / drawH`) so a
 * tolerance expressed in pctX units means the same physical gap for horizontal and
 * vertical grids alike.
 */
import type { Gridline, PercentPoint } from '@/types/domain';
import type { RBushItem } from '@/services/api';

/**
 * How close (aspect-corrected, in pctX units) a vector must sit to a confirmed grid
 * line — perpendicular distance of BOTH endpoints — to count as "on" that grid.
 * 0.004 ≈ 0.4% of the sheet width: tight enough that a real wall a short distance
 * off the grid is NOT tagged, generous enough to catch the grid's own extracted
 * vector (the grid line the capture-line tool already snapped the annotation onto).
 * Roughly a quarter of the default snap radius (≈0.015 at 1× zoom).
 */
export const GRID_COLLINEAR_TOL = 0.004;

/** Aspect-correct a percent point's Y so distances read in pctX units. */
function corrY(p: PercentPoint, aspect: number): number {
  return p.pctY / aspect;
}

/**
 * Is a vector segment (`start`→`end`) collinear with AND overlapping a single
 * confirmed grid line? Pure; aspect-corrected.
 *
 * Collinear: both vector endpoints lie within `tol` perpendicular distance of the
 * grid line's infinite line (which also implies near-parallel — a straight segment
 * with both ends hugging a line runs along it). Overlapping: the vector's projection
 * onto the grid direction intersects the grid segment's own span (± `tol` slack), so
 * a far-away wall that merely shares the grid's infinite line is NOT tagged. A
 * perpendicular wall that crosses the grid fails the collinearity test.
 */
export function isVectorOnGrid(
  start: PercentPoint,
  end: PercentPoint,
  grid: Gridline,
  aspect: number,
  tol: number = GRID_COLLINEAR_TOL,
): boolean {
  const a = aspect > 0 ? aspect : 1;

  const g1x = grid.p1.pctX;
  const g1y = corrY(grid.p1, a);
  const gdx = grid.p2.pctX - g1x;
  const gdy = corrY(grid.p2, a) - g1y;
  const gLen = Math.hypot(gdx, gdy);
  if (gLen === 0) return false;

  const ux = gdx / gLen;
  const uy = gdy / gLen;

  // Perpendicular distance of (px,py) to the grid's infinite line (2D cross magnitude).
  const perp = (px: number, py: number) => Math.abs((px - g1x) * uy - (py - g1y) * ux);
  // Signed position of (px,py) along the grid direction, origin at p1 (grid spans [0, gLen]).
  const along = (px: number, py: number) => (px - g1x) * ux + (py - g1y) * uy;

  const sx = start.pctX, sy = corrY(start, a);
  const ex = end.pctX, ey = corrY(end, a);

  // Collinear: both endpoints hug the grid line.
  if (perp(sx, sy) > tol || perp(ex, ey) > tol) return false;

  // Overlap: the vector's along-axis span must intersect the grid's span.
  const ts = along(sx, sy);
  const te = along(ex, ey);
  const vMin = Math.min(ts, te);
  const vMax = Math.max(ts, te);
  return vMax >= -tol && vMin <= gLen + tol;
}

/** True when a vector is on ANY confirmed grid line (short-circuits). */
export function isVectorOnAnyGrid(
  start: PercentPoint,
  end: PercentPoint,
  grids: readonly Gridline[],
  aspect: number,
  tol: number = GRID_COLLINEAR_TOL,
): boolean {
  for (const g of grids) {
    if (isVectorOnGrid(start, end, g, aspect, tol)) return true;
  }
  return false;
}

/**
 * Tag RBush-ready snapping items with `isGrid`, ready to `tree.load()`. Returns the
 * vectors UNTAGGED (passthrough) when there are no confirmed grids — keeping the
 * live-map / no-grid path byte-identical to before. Pure (no mutation of inputs):
 * each item is shallow-cloned with the flag added. O(vectors × grids), called once
 * in the canvas's deferred tree-build effect, never per frame.
 */
export function tagVectorsWithGrid(
  vectors: readonly RBushItem[],
  grids: readonly Gridline[] | null | undefined,
  aspect: number,
  tol: number = GRID_COLLINEAR_TOL,
): RBushItem[] {
  if (!grids || grids.length === 0) return vectors as RBushItem[];
  return vectors.map((v) => ({
    ...v,
    isGrid: isVectorOnAnyGrid(v.lineData.start, v.lineData.end, grids, aspect, tol),
  }));
}

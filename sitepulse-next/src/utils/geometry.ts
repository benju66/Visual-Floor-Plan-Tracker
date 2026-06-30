import type RBush from 'rbush';
import type { PercentPoint } from '@/types/domain';
import type { RBushItem } from '@/services/api';

export const sqr = (x: number) => x * x;

export const dist2 = (v: PercentPoint, w: PercentPoint) => sqr(v.pctX - w.pctX) + sqr(v.pctY - w.pctY);

export const distToSegmentSquared = (p: PercentPoint, v: PercentPoint, w: PercentPoint) => {
  const l2 = dist2(v, w);
  if (l2 === 0) return dist2(p, v);
  let t = ((p.pctX - v.pctX) * (w.pctX - v.pctX) + (p.pctY - v.pctY) * (w.pctY - v.pctY)) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist2(p, { pctX: v.pctX + t * (w.pctX - v.pctX), pctY: v.pctY + t * (w.pctY - v.pctY) });
};

export const distToSegment = (p: PercentPoint, v: PercentPoint, w: PercentPoint) => Math.sqrt(distToSegmentSquared(p, v, w));

export const getCentroid = (points: PercentPoint[]) => {
  if (!points || points.length === 0) return { pctX: 0, pctY: 0 };
  let sumX = 0, sumY = 0;
  points.forEach(p => { sumX += p.pctX; sumY += p.pctY; });
  return { 
    pctX: sumX / points.length, 
    pctY: sumY / points.length 
  };
};

/**
 * Even-odd ray-casting point-in-polygon test (Jordan curve / "crossing number").
 * `polygon` is an open or closed ring of {@link PercentPoint}s; the edge wrap is
 * handled internally, so the caller need not repeat the first vertex. Pure and
 * aspect-naive — it compares raw pct coordinates, which is correct because a word's
 * position and the polygon vertices live in the SAME percent space.
 *
 * Boundary behaviour is the standard ray-cast convention (left/bottom edges count
 * as inside, right/top as outside) — deterministic but not symmetric; do not rely
 * on it for points lying exactly on an edge. Used by the room-name auto-fill to
 * pick the sheet-text words that fall inside a freshly-traced room.
 */
export const isPointInPolygon = (point: PercentPoint, polygon: PercentPoint[]): boolean => {
  if (!polygon || polygon.length < 3) return false;
  const { pctX: x, pctY: y } = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].pctX, yi = polygon[i].pctY;
    const xj = polygon[j].pctX, yj = polygon[j].pctY;
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
};

export interface SnapResult {
  pctX: number;
  pctY: number;
  snapped: boolean;
}

/**
 * Find the best snap (corner gravity, else perpendicular edge projection) among a
 * given set of vectors, within `snapRadiusX`. Aspect-corrected (Y divided by
 * `aspect`). Pure — the shared inner core of {@link getSnappedCoordinate}, factored
 * out so the grid-aware two-pass search can run it once over walls and once over the
 * full set without duplicating the math.
 *
 * `interiorPoint` (optional) biases selection toward the wall face on the
 * room-interior side: candidates whose offset from the cursor points AWAY from the
 * interior are penalized, so on a thick wall the snap lands on the inside face the
 * tracer is meant to follow even when the outer face is marginally closer. The bias
 * affects SELECTION only (`*Eff` distances); the radius threshold and corner-zone
 * test use the true cursor distance (`*Raw`), and the returned coordinate is never
 * moved off the chosen line.
 */
const snapAmongLines = (
  lines: readonly RBushItem[],
  cursorPctX: number,
  cursorPctY: number,
  aspect: number,
  snapRadiusX: number,
  interiorPoint: PercentPoint | null = null,
): SnapResult => {
  // Interior-aware bias setup. `dir` is the aspect-corrected direction from the
  // cursor toward the room interior. A candidate offset pointing away from the
  // interior (dot < 0) sits deeper into / through the wall, so push it back by
  // INTERIOR_PENALTY (≥ the largest in-range distance) — that guarantees any
  // interior-side face within range beats a far-side one, without ever moving the
  // snapped coordinate itself off the chosen line.
  const hasInterior = interiorPoint !== null;
  const dirX = hasInterior ? interiorPoint.pctX - cursorPctX : 0;
  const dirY = hasInterior ? (interiorPoint.pctY - cursorPctY) / aspect : 0;
  const INTERIOR_PENALTY = snapRadiusX;
  const farSidePenalty = (offX: number, offY: number) =>
    hasInterior && offX * dirX + offY * dirY < 0 ? INTERIOR_PENALTY : 0;

  // Edge projections and vertices are each tracked twice: `*Eff` (interior-biased)
  // drives selection; `*Raw` (true cursor distance) drives the radius threshold.
  let bestEdgeRaw = Infinity;
  let bestEdgeEff = Infinity;
  let bestPoint = { pctX: cursorPctX, pctY: cursorPctY };

  let bestVertexRaw = Infinity;
  let bestVertexEff = Infinity;
  let bestVertex: PercentPoint | null = null;

  for (const { lineData } of lines) {
    const { start, end } = lineData;

    // Vertices (corners) — priority snapping, interior-biased.
    const sOffX = start.pctX - cursorPctX;
    const sOffY = (start.pctY - cursorPctY) / aspect;
    const dStart = Math.sqrt(sOffX * sOffX + sOffY * sOffY);
    const dStartEff = dStart + farSidePenalty(sOffX, sOffY);
    if (dStartEff < bestVertexEff) {
      bestVertexEff = dStartEff;
      bestVertexRaw = dStart;
      bestVertex = start;
    }

    const eOffX = end.pctX - cursorPctX;
    const eOffY = (end.pctY - cursorPctY) / aspect;
    const dEnd = Math.sqrt(eOffX * eOffX + eOffY * eOffY);
    const dEndEff = dEnd + farSidePenalty(eOffX, eOffY);
    if (dEndEff < bestVertexEff) {
      bestVertexEff = dEndEff;
      bestVertexRaw = dEnd;
      bestVertex = end;
    }

    // Account for aspect ratio distortion in standard pct space calculations
    const l2 = sqr(start.pctX - end.pctX) + sqr((start.pctY - end.pctY) / aspect);
    if (l2 === 0) continue;

    let t = ((cursorPctX - start.pctX) * (end.pctX - start.pctX) +
            ((cursorPctY - start.pctY) / aspect) * ((end.pctY - start.pctY) / aspect)) / l2;
    t = Math.max(0, Math.min(1, t));

    const projX = start.pctX + t * (end.pctX - start.pctX);
    const projY = start.pctY + t * (end.pctY - start.pctY);

    const pOffX = projX - cursorPctX;
    const pOffY = (projY - cursorPctY) / aspect;
    const dist = Math.sqrt(pOffX * pOffX + pOffY * pOffY);
    const distEff = dist + farSidePenalty(pOffX, pOffY);

    if (distEff < bestEdgeEff) {
      bestEdgeEff = distEff;
      bestEdgeRaw = dist;
      bestPoint = { pctX: projX, pctY: projY };
    }
  }

  // Corner gravity: if a vertex is within the snap radius, strictly prefer it over a
  // straight edge projection. (Interior bias still steers WHICH vertex via `*Eff`;
  // the radius test uses the true cursor distance `*Raw`.)
  if (bestVertexRaw < snapRadiusX && bestVertex !== null) {
    return { pctX: bestVertex.pctX, pctY: bestVertex.pctY, snapped: true };
  }

  // Since bestEdgeRaw uses aspect-corrected distance, it is in the scale of pctX.
  if (bestEdgeRaw < snapRadiusX) {
    return { ...bestPoint, snapped: true };
  }

  return { pctX: cursorPctX, pctY: cursorPctY, snapped: false };
};

export const getSnappedCoordinate = (
  cursorPctX: number,
  cursorPctY: number,
  rBushTree: RBush<RBushItem> | null,
  aspect: number,
  drawW: number,
  stageScale: number,
  strength: number = 15,
  /**
   * Grid-aware snapping (AI Tracing Assist — Phase 3c). When true, vectors tagged
   * `isGrid` (collinear with a confirmed grid line) are DE-PRIORITIZED: snap to a
   * real-wall vector first, and only fall back to the full set — so a grid line is
   * preferred only when no wall is within range. A wall coincident with a grid still
   * snaps (it survives the walls-first pass, or the fallback). Default false →
   * byte-identical to the prior single-pass behavior (the live map never tags grids).
   */
  gridAware: boolean = false,
  /**
   * Optional interior reference (e.g. the centroid of the points placed so far while
   * tracing a room). When supplied, the snap prefers the wall face on the INTERIOR
   * side of the cursor — so on a thick wall it lands on the inside face the tracer is
   * meant to follow, even when the outer face is a touch closer. Threaded into BOTH
   * the walls-first and fallback passes. Default null → no bias (existing callers
   * unaffected).
   */
  interiorPoint: PercentPoint | null = null,
): SnapResult => {
  if (!rBushTree) return { pctX: cursorPctX, pctY: cursorPctY, snapped: false };

  // Dynamic snap radius based on physical canvas width, zoom level, and user strength setting
  const snapRadiusX = strength / (drawW * stageScale);
  const snapRadiusY = strength / ((drawW / aspect) * stageScale);

  const nearbyLines = rBushTree.search({
    minX: cursorPctX - snapRadiusX,
    minY: cursorPctY - snapRadiusY,
    maxX: cursorPctX + snapRadiusX,
    maxY: cursorPctY + snapRadiusY
  });

  if (nearbyLines.length === 0) return { pctX: cursorPctX, pctY: cursorPctY, snapped: false };

  if (gridAware) {
    // Walls-first: when some (but not all) nearby vectors are grid lines, try to snap
    // to a non-grid wall before considering the grids. Only if no wall is within range
    // do we fall through to the full set (so wall-on-grid coincident lines still snap).
    const walls = nearbyLines.filter((l) => !l.isGrid);
    if (walls.length > 0 && walls.length < nearbyLines.length) {
      const wallSnap = snapAmongLines(walls, cursorPctX, cursorPctY, aspect, snapRadiusX, interiorPoint);
      if (wallSnap.snapped) return wallSnap;
    }
  }

  return snapAmongLines(nearbyLines, cursorPctX, cursorPctY, aspect, snapRadiusX, interiorPoint);
};

/** Minimal layout shape for pct → logical-pixel conversion. */
interface CentroidLayout {
  offsetX: number;
  offsetY: number;
  drawW: number;
  drawH: number;
}

/** Minimal unit shape for centroid hit-testing (subset of domain `Unit`). */
export interface CentroidTarget {
  id: string;
  polygon_coordinates?: PercentPoint[] | null;
}

/**
 * Find the unit whose polygon centroid is closest to (x, y) — logical stage
 * pixels — within `radius`. Single pass, squared-distance compare (no sqrt).
 * Returns null when nothing is in range. Used for walk-route drop targeting.
 */
export const nearestCentroidWithin = (
  units: CentroidTarget[],
  x: number,
  y: number,
  radius: number,
  layout: CentroidLayout,
): string | null => {
  const radiusSq = radius * radius;
  let closestId: string | null = null;
  let minDistSq = Infinity;

  for (const u of units) {
    if (!u.polygon_coordinates || u.polygon_coordinates.length === 0) continue;
    const centroid = getCentroid(u.polygon_coordinates);
    const dx = layout.offsetX + centroid.pctX * layout.drawW - x;
    const dy = layout.offsetY + centroid.pctY * layout.drawH - y;
    const dSq = dx * dx + dy * dy;
    if (dSq < radiusSq && dSq < minDistSq) {
      minDistSq = dSq;
      closestId = u.id;
    }
  }

  return closestId;
};

/**
 * Sanity guard for a polygon about to be PERSISTED. It must have at least 3
 * vertices and every coordinate must be a finite number within a generous
 * percent-space bound (rooms live in 0–1; we allow slight overflow). Catches
 * NaN/Infinity or wildly off-canvas points produced by a bad drag/transform so a
 * corrupt shape can never be written to the row. Deliberately permissive on size
 * (a small or thin room is valid) — it rejects the impossible, not the unusual.
 */
export const isFinitePolygon = (points: PercentPoint[] | null | undefined): boolean => {
  if (!Array.isArray(points) || points.length < 3) return false;
  return points.every(
    (p) =>
      p != null &&
      Number.isFinite(p.pctX) &&
      Number.isFinite(p.pctY) &&
      p.pctX > -1 && p.pctX < 2 &&
      p.pctY > -1 && p.pctY < 2,
  );
};

/**
 * Converts any CSS color string to rgba() with the given alpha.
 * Handles: hex (#RGB or #RRGGBB), rgb(...), rgba(...).
 * Used by StampPreview and MappedUnit fill calculations.
 */
export const mixAlpha = (colorStr: string, alpha: number): string => {
  if (!colorStr) return '';
  if (colorStr.startsWith('rgba')) {
    return colorStr.replace(/[\d.]+\)$/g, `${alpha})`);
  }
  if (colorStr.startsWith('rgb')) {
    return colorStr.replace('rgb', 'rgba').replace(')', `, ${alpha})`);
  }
  if (colorStr.startsWith('#')) {
    let c = colorStr.substring(1).split('');
    if (c.length === 3) c = [c[0], c[0], c[1], c[1], c[2], c[2]];
    const cNum = parseInt(c.join(''), 16);
    return `rgba(${(cNum >> 16) & 255},${(cNum >> 8) & 255},${cNum & 255},${alpha})`;
  }
  return colorStr;
};

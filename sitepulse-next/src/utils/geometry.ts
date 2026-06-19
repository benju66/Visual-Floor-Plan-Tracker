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
 * Ray-casting point-in-polygon test in percent space. `polygon` is an ordered
 * ring (the wrap from last → first vertex is handled). Inside/outside is
 * invariant to aspect distortion, so no aspect correction is needed.
 */
export const pointInPolygon = (pt: PercentPoint, polygon: PercentPoint[]): boolean => {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].pctX, yi = polygon[i].pctY;
    const xj = polygon[j].pctX, yj = polygon[j].pctY;
    const intersect =
      (yi > pt.pctY) !== (yj > pt.pctY) &&
      pt.pctX < ((xj - xi) * (pt.pctY - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

/**
 * Shoelace area of a polygon ring, in percent² units (always non-negative).
 * NOTE: percent space is anisotropic, so this is NOT a real-world area — use it
 * only for RELATIVE comparisons (e.g. picking the larger of two candidate
 * regions). Real-world area is computed at save time from the image's pixel
 * dimensions (`computeLabelArea` / `saveNewUnitFromPopover`).
 */
export const polygonAreaPct = (points: PercentPoint[]): number => {
  if (!points || points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].pctX * points[j].pctY - points[j].pctX * points[i].pctY;
  }
  return Math.abs(area) / 2;
};

export interface SnapResult {
  pctX: number;
  pctY: number;
  snapped: boolean;
}

/**
 * Corner gravity only kicks in inside this fraction of the snap radius. Tighter
 * than the full radius so a *thick* wall's far corner (or a crossing wall's
 * corner) no longer hijacks a point being placed along an edge — the #1 cause of
 * snapping to the wrong wall face at junctions. Snapping to a real room corner
 * still works because you are genuinely very close to it there.
 */
const CORNER_ZONE_FRACTION = 0.6;

export const getSnappedCoordinate = (
  cursorPctX: number,
  cursorPctY: number,
  rBushTree: RBush<RBushItem> | null,
  aspect: number,
  drawW: number,
  stageScale: number,
  strength: number = 15,
  /**
   * Optional interior reference (e.g. the centroid of the points placed so far
   * while tracing a room). When supplied, the snap prefers the wall face on the
   * INTERIOR side of the cursor — so on a thick wall it lands on the inside face
   * the tracer is meant to follow, even when the outer face is a touch closer.
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

  // Interior-aware bias. `dir` is the aspect-corrected direction from the cursor
  // toward the room interior. A candidate whose offset from the cursor points
  // AWAY from the interior (dot < 0) sits deeper into / through the wall, so we
  // push it back by INTERIOR_PENALTY. The penalty (≥ the largest in-range
  // distance) guarantees any interior-side face within range beats a far-side
  // one, while never moving the snapped coordinate itself off the chosen line.
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

  nearbyLines.forEach(({ lineData }) => {
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
    if (l2 === 0) return;

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
  });

  // Corner gravity (softened): only leap to a vertex when the cursor is genuinely
  // in the corner zone, not anywhere within the full radius.
  if (bestVertexRaw < snapRadiusX * CORNER_ZONE_FRACTION && bestVertex !== null) {
    return { pctX: (bestVertex as PercentPoint).pctX, pctY: (bestVertex as PercentPoint).pctY, snapped: true };
  }

  // Since bestEdgeRaw uses aspect-corrected distance, it is in the scale of pctX.
  if (bestEdgeRaw < snapRadiusX) {
    return { ...bestPoint, snapped: true };
  }

  return { pctX: cursorPctX, pctY: cursorPctY, snapped: false };
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

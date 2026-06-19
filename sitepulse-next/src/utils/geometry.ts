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

export const getSnappedCoordinate = (
  cursorPctX: number, 
  cursorPctY: number, 
  rBushTree: RBush<RBushItem> | null, 
  aspect: number, 
  drawW: number, 
  stageScale: number, 
  strength: number = 15
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

  let closestDist = Infinity;
  let bestPoint = { pctX: cursorPctX, pctY: cursorPctY };
  
  let closestVertexDist = Infinity;
  let bestVertex: PercentPoint | null = null;

  nearbyLines.forEach(({ lineData }) => {
    const { start, end } = lineData;
    
    // Check vertices (corners) for priority snapping
    const dStart = Math.sqrt(sqr(cursorPctX - start.pctX) + sqr((cursorPctY - start.pctY) / aspect));
    if (dStart < closestVertexDist) {
       closestVertexDist = dStart;
       bestVertex = start;
    }
    
    const dEnd = Math.sqrt(sqr(cursorPctX - end.pctX) + sqr((cursorPctY - end.pctY) / aspect));
    if (dEnd < closestVertexDist) {
       closestVertexDist = dEnd;
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

    const dist = Math.sqrt(sqr(cursorPctX - projX) + sqr((cursorPctY - projY) / aspect));

    if (dist < closestDist) {
      closestDist = dist;
      bestPoint = { pctX: projX, pctY: projY };
    }
  });

  // Corner gravity: if a vertex is within the snap radius, strictly prefer it over a straight edge projection
  if (closestVertexDist < snapRadiusX && bestVertex !== null) {
    return { pctX: (bestVertex! as any).pctX, pctY: (bestVertex! as any).pctY, snapped: true };
  }

  // Since closestDist uses aspect-corrected distance, it is in the scale of pctX.
  if (closestDist < snapRadiusX) {
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

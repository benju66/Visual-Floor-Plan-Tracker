import type { PercentPoint } from '@/types/domain';
import { getCentroid } from '@/utils/geometry';

// Stamp & Fast Markup — Phase 1. The single source of truth for the stamp
// placement math: mirror + aspect-correct rotation + centroid re-anchoring, all in
// percentage space. Pure + deterministic (no I/O, no Date.now) so it is unit-tested
// in isolation. `FloorplanCanvas`'s existing `handleFlip` / `handleRotatePolygon` call
// `flipPolygon` / `rotatePolygon` here so the flip/rotate math lives in ONE place.

/**
 * The transient orientation a stamp is placed with. Held in `useMapStore` only while
 * `toolMode === 'stamp'` and reset on tool change — NOT persisted. `rotation` counts
 * net 90° CLOCKWISE steps (may go negative for CCW); `flipX` / `flipY` are the
 * horizontal (left↔right) / vertical (top↔bottom) mirror toggles.
 */
export interface StampTransform {
  rotation: number;
  flipX: boolean;
  flipY: boolean;
}

export const IDENTITY_STAMP_TRANSFORM: StampTransform = { rotation: 0, flipX: false, flipY: false };

export type FlipAxis = 'horizontal' | 'vertical';
export type RotateDir = 'left' | 'right';

/**
 * Mirror a polygon about its bounding-box center on one axis. 'horizontal' flips
 * left↔right (mirrors X); 'vertical' flips top↔bottom (mirrors Y). Ported verbatim
 * from `FloorplanCanvas.handleFlip` so the saved/pending-shape flip is unchanged.
 */
export function flipPolygon(points: PercentPoint[], axis: FlipAxis): PercentPoint[] {
  if (points.length === 0) return [];
  if (axis === 'horizontal') {
    const xs = points.map((p) => p.pctX);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    return points.map((p) => ({ pctX: centerX - (p.pctX - centerX), pctY: p.pctY }));
  }
  const ys = points.map((p) => p.pctY);
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  return points.map((p) => ({ pctX: p.pctX, pctY: centerY - (p.pctY - centerY) }));
}

/**
 * Aspect-correct 90° rotation about the centroid. `aspect` is drawW/drawH: percentage
 * space is stretched into "real" space, rotated, then un-stretched so a square stays a
 * square on a non-square sheet. 'left' = CCW, 'right' = CW. Ported verbatim from
 * `FloorplanCanvas.handleRotatePolygon`. A non-positive aspect is a no-op (returns a copy).
 */
export function rotatePolygon(points: PercentPoint[], dir: RotateDir, aspect: number): PercentPoint[] {
  if (points.length === 0 || !(aspect > 0)) return points.map((p) => ({ ...p }));
  const centroid = getCentroid(points);
  const cx = centroid.pctX || 0;
  const cy = centroid.pctY || 0;
  return points.map((p) => {
    const dx = p.pctX - cx;
    const dy = p.pctY - cy;
    const realX = dx * aspect;
    const realY = dy;
    let rotX: number;
    let rotY: number;
    if (dir === 'left') {
      rotX = realY;
      rotY = -realX;
    } else {
      rotX = -realY;
      rotY = realX;
    }
    return { pctX: cx + rotX / aspect, pctY: cy + rotY };
  });
}

/** Recenter a polygon so its centroid sits at the origin (0,0). */
export function normalizeToCentroid(points: PercentPoint[]): PercentPoint[] {
  if (points.length === 0) return [];
  const c = getCentroid(points);
  return points.map((p) => ({ pctX: p.pctX - c.pctX, pctY: p.pctY - c.pctY }));
}

/** Translate a centroid-relative polygon so its centroid lands on `anchor`. */
export function placeAtAnchor(centroidRelativePoints: PercentPoint[], anchor: PercentPoint): PercentPoint[] {
  return centroidRelativePoints.map((p) => ({ pctX: p.pctX + anchor.pctX, pctY: p.pctY + anchor.pctY }));
}

/**
 * Build the final stamp polygon to preview / commit: apply the flips, then the net
 * rotation (about the shape's own frame), then re-anchor its centroid onto `anchor`
 * (the snapped drop point). The transform order is FIXED (flips → rotation) so the
 * result depends only on the transform STATE, not the order keys were pressed.
 */
export function buildStampPolygon(
  sourcePoints: PercentPoint[],
  transform: StampTransform,
  aspect: number,
  anchor: PercentPoint,
): PercentPoint[] {
  if (sourcePoints.length === 0) return [];
  let pts = sourcePoints.map((p) => ({ ...p }));
  if (transform.flipX) pts = flipPolygon(pts, 'horizontal');
  if (transform.flipY) pts = flipPolygon(pts, 'vertical');
  const steps = ((transform.rotation % 4) + 4) % 4;
  for (let i = 0; i < steps; i += 1) pts = rotatePolygon(pts, 'right', aspect);
  return placeAtAnchor(normalizeToCentroid(pts), anchor);
}

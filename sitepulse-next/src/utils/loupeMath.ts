/**
 * loupeMath — pure geometry for the magnifier loupe. No DOM, no Konva: shared
 * between LoupeOverlay (per-frame draw) and useLoupeRenderer, and unit-testable.
 *
 * Coordinates here are normalized [0–1] page percentages (the same space as
 * `ViewportRect` and unit polygons), so the loupe is independent of zoom/pan.
 */

import type { ViewportRect } from './pdfRenderMath';

export interface LensProjection {
  /** layout.drawW — page draw width at stage scale 1, in CSS px. */
  drawW: number;
  /** layout.drawH — page draw height at stage scale 1, in CSS px. */
  drawH: number;
  /** Konva stage scale (zoom). */
  scale: number;
}

/**
 * The page region (normalized pct) a lens centered on the cursor covers.
 *
 * The lens shows `lensSizeCss / magnification` screen CSS px across its
 * diameter; one screen CSS px spans `1 / (drawW * scale)` of the page in X
 * (and the drawH equivalent in Y), so the covered half-span follows directly.
 */
export function lensCoverage(
  cursorPctX: number,
  cursorPctY: number,
  lensSizeCss: number,
  magnification: number,
  proj: LensProjection,
): ViewportRect {
  const srcCss = lensSizeCss / magnification;
  const halfX = srcCss / 2 / (proj.drawW * proj.scale);
  const halfY = srcCss / 2 / (proj.drawH * proj.scale);
  return {
    minPctX: cursorPctX - halfX,
    maxPctX: cursorPctX + halfX,
    minPctY: cursorPctY - halfY,
    maxPctY: cursorPctY + halfY,
  };
}

/**
 * True when `inner` lies fully inside `outer`, after shrinking `outer` by
 * `shrink` (a fraction of its size) on every edge. `shrink = 0` is a plain
 * containment test; a positive shrink creates a re-render margin so a fresh
 * patch is requested before the lens actually reaches the cached patch's edge.
 */
export function rectContains(outer: ViewportRect, inner: ViewportRect, shrink = 0): boolean {
  const sx = ((outer.maxPctX - outer.minPctX) * shrink) / 2;
  const sy = ((outer.maxPctY - outer.minPctY) * shrink) / 2;
  return (
    inner.minPctX >= outer.minPctX + sx &&
    inner.maxPctX <= outer.maxPctX - sx &&
    inner.minPctY >= outer.minPctY + sy &&
    inner.maxPctY <= outer.maxPctY - sy
  );
}

/**
 * Grow a lens-coverage rect into the larger patch we ask the worker to render,
 * so small cursor moves stay inside the cached bitmap. Clamped to the page.
 */
export function expandPatchRect(coverage: ViewportRect, factor: number): ViewportRect {
  const cx = (coverage.minPctX + coverage.maxPctX) / 2;
  const cy = (coverage.minPctY + coverage.maxPctY) / 2;
  const halfX = ((coverage.maxPctX - coverage.minPctX) / 2) * factor;
  const halfY = ((coverage.maxPctY - coverage.minPctY) / 2) * factor;
  return {
    minPctX: Math.max(0, cx - halfX),
    maxPctX: Math.min(1, cx + halfX),
    minPctY: Math.max(0, cy - halfY),
    maxPctY: Math.min(1, cy + halfY),
  };
}

/** The worker reports a patch's covered region as an x/y/width/height box. */
export interface PatchPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Convert a worker patch `position` box into a min/max ViewportRect. */
export function positionToRect(pos: PatchPosition): ViewportRect {
  return {
    minPctX: pos.x,
    minPctY: pos.y,
    maxPctX: pos.x + pos.width,
    maxPctY: pos.y + pos.height,
  };
}

/** Source rect (in bitmap px) for drawing `region` out of a patch bitmap. */
export function regionToBitmapSrc(
  region: ViewportRect,
  patchPos: PatchPosition,
  bmpW: number,
  bmpH: number,
): { sx: number; sy: number; sw: number; sh: number } {
  return {
    sx: ((region.minPctX - patchPos.x) / patchPos.width) * bmpW,
    sy: ((region.minPctY - patchPos.y) / patchPos.height) * bmpH,
    sw: ((region.maxPctX - region.minPctX) / patchPos.width) * bmpW,
    sh: ((region.maxPctY - region.minPctY) / patchPos.height) * bmpH,
  };
}

/**
 * minimapMath — pure projection helpers for the bottom-right mini-map overlay.
 *
 * The mini-map is a thumbnail of the WHOLE sheet (percent space `0..1` on both
 * axes) drawn into a `miniW × miniH` box sized to the sheet's aspect ratio, with
 * a rectangle marking the region currently visible in the main Konva stage.
 *
 * Everything here is framework-free and deterministic (no Date.now / Math.random,
 * no Konva, no React) so the load-bearing projection is unit-testable both
 * directions (AGENTS §9): the viewport box matches the visible %, and a click on
 * the thumbnail recenters the main view on that point.
 */

import type { CanvasLayout } from '@/types/domain';

/** Sheet layout plus the stage (viewport) pixel size — the canvas's `layoutRef`. */
export interface MiniMapLayout extends CanvasLayout {
  stageW: number;
  stageH: number;
}

/** Visible region of the sheet in percent space (0..1 spans the drawn sheet). */
export interface PctRect {
  minPctX: number;
  minPctY: number;
  maxPctX: number;
  maxPctY: number;
}

/** A positioned rectangle inside the mini-map, in mini-map pixels. */
export interface MiniBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Fit a mini-map box to the sheet's aspect ratio within a max envelope, so the
 * thumbnail fills it with no letterboxing or distortion (percent space then maps
 * linearly onto the box). `aspect = drawW / drawH`.
 */
export function fitMiniSize(
  aspect: number,
  maxW = 160,
  maxH = 120,
): { miniW: number; miniH: number } {
  if (!aspect || !Number.isFinite(aspect) || aspect <= 0) {
    return { miniW: maxW, miniH: maxH };
  }
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { miniW: Math.round(w), miniH: Math.round(h) };
}

/**
 * Project the visible percent-region onto the mini-map. Clamped to the thumbnail
 * so the box never spills outside it when the stage is zoomed out past the sheet
 * edges (visible region extends beyond `0..1`).
 */
export function viewportRectToMiniBox(visible: PctRect, miniW: number, miniH: number): MiniBox {
  const left = clamp01(visible.minPctX) * miniW;
  const top = clamp01(visible.minPctY) * miniH;
  const right = clamp01(visible.maxPctX) * miniW;
  const bottom = clamp01(visible.maxPctY) * miniH;
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * The visible region of the sheet in percent space, derived from the live stage
 * transform. Mirrors FloorplanCanvas's `visibleBoundingBox` math WITHOUT its
 * ±5% culling pad — the mini-map box should mark exactly what's on screen.
 */
export function stageToVisiblePctRect(
  scale: number,
  stagePos: { x: number; y: number },
  layout: MiniMapLayout,
): PctRect {
  const { offsetX, offsetY, drawW, drawH, stageW, stageH } = layout;
  if (!drawW || !drawH) {
    return { minPctX: 0, minPctY: 0, maxPctX: 1, maxPctY: 1 };
  }
  return {
    minPctX: ((-stagePos.x / scale) - offsetX) / drawW,
    minPctY: ((-stagePos.y / scale) - offsetY) / drawH,
    maxPctX: (((stageW - stagePos.x) / scale) - offsetX) / drawW,
    maxPctY: (((stageH - stagePos.y) / scale) - offsetY) / drawH,
  };
}

/**
 * The `stagePosition` that recenters the main view on the clicked thumbnail
 * point, keeping the current `scale`. Inverse of `stageToVisiblePctRect`'s
 * center: a click maps to a percent point, then to its unscaled content coords,
 * then to the stage offset that places that content point at viewport center.
 * Returns the raw (unclamped) target — the caller clamps before applying.
 */
export function miniClickToStagePosition(
  clickPx: { x: number; y: number },
  miniW: number,
  miniH: number,
  layout: MiniMapLayout,
  scale: number,
): { x: number; y: number } {
  const { offsetX, offsetY, drawW, drawH, stageW, stageH } = layout;
  const pctX = clamp01(miniW > 0 ? clickPx.x / miniW : 0);
  const pctY = clamp01(miniH > 0 ? clickPx.y / miniH : 0);
  // Content point (unscaled stage coords) under the click.
  const contentX = offsetX + pctX * drawW;
  const contentY = offsetY + pctY * drawH;
  // Place that content point at the center of the viewport.
  return {
    x: stageW / 2 - contentX * scale,
    y: stageH / 2 - contentY * scale,
  };
}

// Pure layout + visible-unit-culling math for the floor-plan canvas
// (FloorplanCanvas Decomposition — Phase 1). Extracted verbatim from the
// `layout` / `visibleBoundingBox` / `visibleUnits` memos in FloorplanCanvas.tsx;
// the component keeps its `useMemo` wrappers (they own the React deps) and each
// memo body just calls these. Framework-free and deterministic — no Konva, no
// React, no `Date.now()` — so the arithmetic is unit-testable in isolation.

import type { PercentPoint } from '@/types/domain';
import type { ToolMode } from '@/store/useMapStore';

/**
 * How the floor-plan image is fitted into the stage box: the image is scaled
 * to fit (`Math.min` of the two axis ratios, i.e. "contain") and centered,
 * leaving `offsetX`/`offsetY` letterbox margins. All values are stage pixels
 * at scale 1 (pan/zoom are applied on top by Konva's stage transform).
 */
export type CanvasLayout = {
  offsetX: number;
  offsetY: number;
  drawW: number;
  drawH: number;
  stageW: number;
  stageH: number;
};

/**
 * The currently-visible slice of the image in percent space (the same 0..1
 * `pctX`/`pctY` space as `units.polygon_coordinates`), padded by ±0.05 so
 * markers straddling the viewport edge don't pop in/out mid-pan.
 */
export type VisibleBox = {
  minPctX: number;
  maxPctX: number;
  minPctY: number;
  maxPctY: number;
};

/**
 * Fit-and-center the image into the stage box.
 * - Stage not measured yet (either dim falsy) → all-zero layout.
 * - Image dims unknown (either dim falsy) → fill the stage, zero offsets.
 * - Else contain-fit: `scale = min(stageW/imgW, stageH/imgH)`, centered.
 */
export function computeLayout(
  stageW: number,
  stageH: number,
  imgW: number,
  imgH: number,
): CanvasLayout {
  if (!stageW || !stageH) {
    return { offsetX: 0, offsetY: 0, drawW: 0, drawH: 0, stageW: 0, stageH: 0 };
  }

  if (!imgW || !imgH) {
    return { offsetX: 0, offsetY: 0, drawW: stageW, drawH: stageH, stageW, stageH };
  }
  const scale = Math.min(stageW / imgW, stageH / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const offsetX = (stageW - drawW) / 2;
  const offsetY = (stageH - drawH) / 2;
  return { offsetX, offsetY, drawW, drawH, stageW, stageH };
}

/**
 * Map the on-screen viewport (stage pan/zoom over the fitted image) back into
 * percent space, padded by ±0.05 on every side. Returns `null` while the
 * layout or the container box is degenerate (nothing measurable to cull by).
 */
export function computeVisibleBox(
  layout: CanvasLayout,
  stagePosition: { x: number; y: number },
  stageScale: number,
  dimensions: { width: number; height: number },
): VisibleBox | null {
  if (!layout.drawW || !layout.drawH || !dimensions.width || !dimensions.height) return null;
  const minX = ((-stagePosition.x / stageScale) - layout.offsetX) / layout.drawW;
  const minY = ((-stagePosition.y / stageScale) - layout.offsetY) / layout.drawH;
  const maxX = (((dimensions.width - stagePosition.x) / stageScale) - layout.offsetX) / layout.drawW;
  const maxY = (((dimensions.height - stagePosition.y) / stageScale) - layout.offsetY) / layout.drawH;
  return {
    minPctX: minX - 0.05,
    maxPctX: maxX + 0.05,
    minPctY: minY - 0.05,
    maxPctY: maxY + 0.05,
  };
}

/**
 * Cull the unit list down to what's on-screen: keep a mapped unit when ANY of
 * its polygon vertices falls inside the (already padded) visible box.
 * - No box yet / layout not ready (`layoutDrawW` falsy) → passthrough (render all).
 * - Unmapped units (no polygon) have nothing to draw — excluded, EXCEPT in
 *   draw mode, where clicking the canvas can target any unit slot.
 * Generic over the unit shape so tests don't need full DB-row fixtures.
 */
export function cullVisibleUnits<T extends { polygon_coordinates: PercentPoint[] | null }>(
  units: T[],
  box: VisibleBox | null,
  layoutDrawW: number,
  toolMode: ToolMode,
): T[] {
  if (!box || !layoutDrawW) return units;
  const { minPctX, maxPctX, minPctY, maxPctY } = box;

  return units.filter(unit => {
    if (!unit.polygon_coordinates || unit.polygon_coordinates.length === 0) {
      return toolMode === 'draw';
    }

    return unit.polygon_coordinates.some(pt =>
      pt.pctX >= minPctX &&
      pt.pctX <= maxPctX &&
      pt.pctY >= minPctY &&
      pt.pctY <= maxPctY
    );
  });
}

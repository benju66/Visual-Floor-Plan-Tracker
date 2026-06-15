/**
 * pdfRenderMath — pure math shared between usePdfRenderer (main thread) and
 * pdfRender.worker (render thread). No DOM, no pdf.js imports: keep this file
 * unit-testable and safe to bundle into both contexts.
 */

// Desktop-only target (no iPad). 67M is safe for Safari desktop (lowest desktop
// ceiling). Chrome/Edge support 268M+, Firefox 124M+. This gives maxScale ≈ 3.86×
// for typical 36"×24" architectural sheets — 2× headroom over the previous 16M cap.
export const MAX_CANVAS_PIXELS = 67_000_000;

// Zoom threshold: beyond this stageScale, we re-render the visible viewport
// at higher resolution (and lazily kick off the 4× LOD render). 1.2 (not 1.5)
// so high-DPR screens don't sit in a soft band between 1.0× and the overlay —
// the worker absorbs the extra renders for free.
export const DEEP_ZOOM_THRESHOLD = 1.2;

// Pixel cap for the deep-zoom viewport overlay (smaller than MAX_CANVAS_PIXELS,
// which the LOD pyramid keeps). The overlay only needs to be sharp for the
// VISIBLE viewport (~10M px covers 2560×1440 @ DPR 1.5 with padding).
export const OVERLAY_MAX_PIXELS = 24_000_000;

// After motion settles, wait this long before re-rendering the sharp overlay.
export const OVERLAY_SETTLE_MS = 100;

// Low-quality preview scale for instant visual feedback
export const PREVIEW_RENDER_SCALE = 1.0;

// LOD high-res scale: rendered lazily the first time the user crosses
// DEEP_ZOOM_THRESHOLD. clampScaleToPixelBudget caps it (~3.87× for 36"×24").
export const LOD_HIGH_SCALE = 4.0;

/** Visible region in normalized [0–1] PDF page coordinates */
export interface ViewportRect {
  minPctX: number;
  minPctY: number;
  maxPctX: number;
  maxPctY: number;
}

/** Largest scale ≤ targetScale whose full-page canvas stays within maxPixels. */
export function clampScaleToPixelBudget(
  pageW: number,
  pageH: number,
  targetScale: number,
  maxPixels: number = MAX_CANVAS_PIXELS,
): number {
  const maxScale = Math.sqrt(maxPixels / (pageW * pageH));
  return Math.min(targetScale, maxScale);
}

export type LodLevel = 'low' | 'base' | 'high';

/**
 * Pick the sharpest available LOD bitmap that won't stretch more than ~2×.
 * Falls back toward whatever is available. `placeholder` is the server-side
 * 4× preview PNG shown before any pdf.js output exists — sharper than the 1×
 * preview, so it outranks `low` until the base render lands (it is closed and
 * nulled at that point).
 */
export function pickLodBitmap<T>(
  stageScale: number,
  lods: { placeholder: T | null; low: T | null; base: T | null; high: T | null },
): T | null {
  if (stageScale >= 2.0 && lods.high) return lods.high;
  if (stageScale < 1.0 && lods.low) return lods.low;
  return lods.base ?? lods.placeholder ?? lods.low;
}

export interface ViewportRenderParams {
  /** Canvas dimensions for the overlay render */
  finalW: number;
  finalH: number;
  /** pdf.js viewport offset (negated when passed as offsetX/offsetY) */
  clipX: number;
  clipY: number;
  /** pdf.js render scale after the pixel-budget clamp */
  effectiveScale: number;
  /** Normalized [0–1] position of the overlay on the PDF page */
  position: { x: number; y: number; width: number; height: number };
}

/**
 * Compute the render geometry for a deep-zoom viewport overlay.
 *
 * @param rect      Visible region in normalized [0–1] page coordinates
 * @param pageW1x   Page width at scale 1 (CSS px)
 * @param pageH1x   Page height at scale 1 (CSS px)
 * @param stageScale Current Konva stage zoom
 * @param dpr       window.devicePixelRatio
 */
export function computeViewportRenderParams(
  rect: ViewportRect,
  pageW1x: number,
  pageH1x: number,
  stageScale: number,
  dpr: number,
  maxPixels: number = OVERLAY_MAX_PIXELS,
): ViewportRenderParams | null {
  const vMinX = Math.max(0, rect.minPctX);
  const vMinY = Math.max(0, rect.minPctY);
  const vMaxX = Math.min(1, rect.maxPctX);
  const vMaxY = Math.min(1, rect.maxPctY);
  const vW = vMaxX - vMinX;
  const vH = vMaxY - vMinY;
  if (vW <= 0 || vH <= 0) return null;

  let effectiveScale = stageScale * dpr;

  const rawW = Math.ceil(pageW1x * vW * effectiveScale);
  const rawH = Math.ceil(pageH1x * vH * effectiveScale);
  const totalPixels = rawW * rawH;

  if (totalPixels > maxPixels) {
    effectiveScale *= Math.sqrt(maxPixels / totalPixels);
  }

  const finalW = Math.ceil(pageW1x * vW * effectiveScale);
  const finalH = Math.ceil(pageH1x * vH * effectiveScale);
  if (finalW <= 0 || finalH <= 0) return null;

  return {
    finalW,
    finalH,
    clipX: Math.floor(vMinX * pageW1x * effectiveScale),
    clipY: Math.floor(vMinY * pageH1x * effectiveScale),
    effectiveScale,
    position: { x: vMinX, y: vMinY, width: vW, height: vH },
  };
}

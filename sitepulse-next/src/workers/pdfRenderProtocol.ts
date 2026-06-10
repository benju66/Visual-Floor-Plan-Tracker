/**
 * Message protocol between usePdfRenderer (main thread) and pdfRender.worker.
 *
 * Every response carries the `loadId` of the document it belongs to; the hook
 * drops replies whose loadId no longer matches (sheet switched mid-render).
 * Viewport replies additionally carry a `requestId` so stale overlay renders
 * are discarded.
 */

import type { LodLevel, ViewportRect } from '@/utils/pdfRenderMath';

export type PdfWorkerRequest =
  | {
      type: 'load';
      loadId: number;
      /** PDF bytes — transferred, the worker takes ownership */
      buffer: ArrayBuffer;
      /** Base LOD render scale (e.g. devicePixelRatio, min 2) */
      baseScale: number;
    }
  | { type: 'render-high'; loadId: number }
  | {
      type: 'render-viewport';
      loadId: number;
      requestId: number;
      rect: ViewportRect;
      stageScale: number;
      dpr: number;
    }
  | { type: 'cancel-viewport' };

export type PdfWorkerResponse =
  | {
      type: 'page-info';
      loadId: number;
      /** Base-LOD pixel dimensions (rotation applied) — drives canvas layout */
      pageWidth: number;
      pageHeight: number;
    }
  | { type: 'lod'; loadId: number; level: LodLevel; bitmap: ImageBitmap }
  | {
      type: 'viewport';
      loadId: number;
      requestId: number;
      bitmap: ImageBitmap;
      position: { x: number; y: number; width: number; height: number };
    }
  | { type: 'error'; loadId: number; message: string };

/**
 * pdfRender.worker — owns the pdf.js document lifecycle and ALL rasterization,
 * keeping the main thread free for Konva pan/zoom. Receives PDF bytes via a
 * transferred ArrayBuffer, renders LOD bitmaps + deep-zoom viewport crops to
 * OffscreenCanvas, and transfers ImageBitmaps back to the hook.
 *
 * Inside this worker pdf.js either nests its own parser worker (Chromium,
 * Firefox) or falls back to its "fake worker" on this thread — both are
 * off-main-thread, so either path is fine for the desktop-only target.
 */

import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import {
  clampScaleToPixelBudget,
  computeViewportRenderParams,
  LOD_HIGH_SCALE,
  PREVIEW_RENDER_SCALE,
} from '../utils/pdfRenderMath';
import type { PdfWorkerRequest, PdfWorkerResponse } from './pdfRenderProtocol';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

/**
 * pdf.js's default DOMCanvasFactory calls document.createElement for the temp
 * canvases it needs (pattern fills, soft masks, transparency groups) — but
 * there is no document in a worker. Same duck-typed interface, OffscreenCanvas
 * backed. Passed as a constructor via getDocument's CanvasFactory param.
 */
class OffscreenCanvasFactory {
  create(width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) };
  }
  reset(canvasAndContext: { canvas: OffscreenCanvas | null }, width: number, height: number) {
    if (!canvasAndContext.canvas) throw new Error('Canvas is not specified');
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext: { canvas: OffscreenCanvas | null; context: unknown }) {
    if (!canvasAndContext.canvas) return;
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

/**
 * pdf.js's default DOMFilterFactory builds SVG filter elements via the DOM
 * (used for transfer functions / highlight color maps — rare in CAD prints).
 * Returning 'none' skips those filters instead of crashing the worker.
 */
class WorkerFilterFactory {
  addFilter() { return 'none'; }
  addHCMFilter() { return 'none'; }
  addAlphaFilter() { return 'none'; }
  addLuminosityFilter() { return 'none'; }
  addHighlightHCMFilter() { return 'none'; }
  destroy() {}
}

// Embedded fonts: pdf.js's FontLoader only needs document.fonts (a
// FontFaceSet). Workers expose their own FontFaceSet as self.fonts (Chromium,
// Firefox, Safari 16.4+) — hand it over via a minimal ownerDocument shim. If a
// browser lacks it, disableFontFace makes pdf.js draw glyph outlines as paths
// instead of crashing in FontLoader.insertRule (document.createElement).
const workerFontFaceSet = (self as unknown as { fonts?: unknown }).fonts;
const fontDocumentParams = workerFontFaceSet
  ? { ownerDocument: { fonts: workerFontFaceSet } as unknown as Document }
  : { disableFontFace: true };

const workerScope = self as unknown as {
  postMessage(message: PdfWorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<PdfWorkerRequest>) => void) | null;
};

function post(message: PdfWorkerResponse, transfer?: Transferable[]): void {
  workerScope.postMessage(message, transfer);
}

function isRenderCancel(err: unknown): boolean {
  return (
    !!err && typeof err === 'object' && 'name' in err &&
    (err as { name: string }).name === 'RenderingCancelledException'
  );
}

let currentLoadId = 0;
let pdfDoc: PDFDocumentProxy | null = null;
let page: PDFPageProxy | null = null;
let activeLodTask: RenderTask | null = null;
let activeViewportTask: RenderTask | null = null;

// Serializes load + LOD renders so a render-high request never competes with
// the base render for this thread. Viewport renders intentionally run outside
// the chain (pdf.js supports concurrent renders of one page to different
// canvases) so deep-zoom sharpening is never starved by the 4× LOD render.
let opChain: Promise<void> = Promise.resolve();

/** Render the full page at targetScale (clamped to the pixel budget). */
async function renderFullPage(targetScale: number): Promise<ImageBitmap | null> {
  if (!page) return null;
  const pageW = page.view[2];
  const pageH = page.view[3];
  const safeScale = clampScaleToPixelBudget(pageW, pageH, targetScale);
  const rotation = page.rotate || 0;
  const viewport = page.getViewport({ scale: safeScale, rotation });

  const canvas = new OffscreenCanvas(
    Math.floor(viewport.width),
    Math.floor(viewport.height),
  );

  // pdf.js v5 accepts OffscreenCanvas at runtime; its types only name HTMLCanvasElement
  const task = page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    viewport,
  });
  activeLodTask = task;

  try {
    await task.promise;
    return canvas.transferToImageBitmap();
  } catch (err: unknown) {
    if (isRenderCancel(err)) return null;
    throw err;
  }
}

async function handleLoad(msg: Extract<PdfWorkerRequest, { type: 'load' }>): Promise<void> {
  const { loadId, buffer, baseScale } = msg;
  try {
    if (pdfDoc) {
      await pdfDoc.destroy().catch(() => {});
      pdfDoc = null;
      page = null;
    }
    if (loadId !== currentLoadId) return;

    const doc = await pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      CanvasFactory: OffscreenCanvasFactory,
      FilterFactory: WorkerFilterFactory,
      ...fontDocumentParams,
    }).promise;
    if (loadId !== currentLoadId) {
      doc.destroy().catch(() => {});
      return;
    }
    pdfDoc = doc;
    page = await doc.getPage(1);
    if (loadId !== currentLoadId) return;

    const pageW = page.view[2];
    const pageH = page.view[3];
    const rotation = page.rotate || 0;
    const isRotated = rotation === 90 || rotation === 270;
    const baseSafe = clampScaleToPixelBudget(pageW, pageH, baseScale);

    post({
      type: 'page-info',
      loadId,
      pageWidth: Math.floor((isRotated ? pageH : pageW) * baseSafe),
      pageHeight: Math.floor((isRotated ? pageW : pageH) * baseSafe),
    });

    const preview = await renderFullPage(PREVIEW_RENDER_SCALE);
    if (loadId !== currentLoadId) {
      preview?.close();
      return;
    }
    if (preview) post({ type: 'lod', loadId, level: 'low', bitmap: preview }, [preview]);

    const base = await renderFullPage(baseScale);
    if (loadId !== currentLoadId) {
      base?.close();
      return;
    }
    if (base) post({ type: 'lod', loadId, level: 'base', bitmap: base }, [base]);
  } catch (err: unknown) {
    if (loadId !== currentLoadId) return;
    const message = err instanceof Error ? err.message : 'Unknown error rendering PDF';
    post({ type: 'error', loadId, message });
  }
}

async function handleRenderHigh(loadId: number): Promise<void> {
  if (loadId !== currentLoadId || !page) return;
  try {
    const high = await renderFullPage(LOD_HIGH_SCALE);
    if (loadId !== currentLoadId) {
      high?.close();
      return;
    }
    if (high) post({ type: 'lod', loadId, level: 'high', bitmap: high }, [high]);
  } catch {
    // Non-fatal: base LOD + viewport overlay still cover deep zoom.
  }
}

async function handleRenderViewport(
  msg: Extract<PdfWorkerRequest, { type: 'render-viewport' }>,
): Promise<void> {
  if (msg.loadId !== currentLoadId || !page) return;

  const rotation = page.rotate || 0;
  const refViewport = page.getViewport({ scale: 1, rotation });
  const params = computeViewportRenderParams(
    msg.rect,
    refViewport.width,
    refViewport.height,
    msg.stageScale,
    msg.dpr,
  );
  if (!params) return;

  const canvas = new OffscreenCanvas(params.finalW, params.finalH);

  const viewport = page.getViewport({
    scale: params.effectiveScale,
    rotation,
    offsetX: -params.clipX,
    offsetY: -params.clipY,
  });

  const task = page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    viewport,
  });
  activeViewportTask = task;

  try {
    await task.promise;
    if (msg.loadId !== currentLoadId) return;
    const bitmap = canvas.transferToImageBitmap();
    post(
      { type: 'viewport', loadId: msg.loadId, requestId: msg.requestId, bitmap, position: params.position },
      [bitmap],
    );
  } catch {
    // Cancelled or failed — non-fatal, the LOD pyramid stays visible.
  }
}

workerScope.onmessage = (ev: MessageEvent<PdfWorkerRequest>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'load':
      currentLoadId = msg.loadId;
      activeLodTask?.cancel();
      activeViewportTask?.cancel();
      opChain = opChain.then(() => handleLoad(msg)).catch(() => {});
      break;
    case 'render-high':
      opChain = opChain.then(() => handleRenderHigh(msg.loadId)).catch(() => {});
      break;
    case 'render-viewport':
      activeViewportTask?.cancel();
      void handleRenderViewport(msg);
      break;
    case 'cancel-viewport':
      activeViewportTask?.cancel();
      break;
  }
};

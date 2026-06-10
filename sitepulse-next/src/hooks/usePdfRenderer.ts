"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  DEEP_ZOOM_THRESHOLD,
  OVERLAY_SETTLE_MS,
  pickLodBitmap,
  type ViewportRect,
} from '@/utils/pdfRenderMath';
import { getPdfBytes, putPdfBytes, invalidatePdfBytes } from '@/utils/pdfByteCache';
import { fetchOriginalPdfBytes, withVersion } from '@/utils/pdfSource';
import type { PdfWorkerRequest, PdfWorkerResponse } from '@/workers/pdfRenderProtocol';

export type { ViewportRect };

// Base render scale: match physical screen density for retina sharpness.
// Math.max ensures at least 2× on standard screens.
const BASE_RENDER_SCALE = typeof window !== 'undefined'
  ? Math.max(window.devicePixelRatio || 1, 2.0)
  : 2.0;

// After the 2× base LOD lands, wait this long before pre-rendering the 4×
// deep-zoom LOD in the worker, so the first deep zoom is already sharp. The
// on-demand path (first crossing of DEEP_ZOOM_THRESHOLD) remains as fallback.
const HIGH_LOD_IDLE_MS = 2000;

interface PdfRenderState {
  imageBitmap: ImageBitmap | null;
  pageWidth: number;
  pageHeight: number;
  isLoading: boolean;
  /** True between the 1× preview appearing and the 2× base LOD arriving —
   *  the drawing is visible and interactive, just not yet full sharpness. */
  isSharpening: boolean;
  error: string | null;
  retry: () => void;
  // Viewport overlay for deep zoom
  viewportBitmap: ImageBitmap | null;
  /** Normalized [0–1] position of the viewport overlay on the PDF page */
  viewportPosition: {
    x: number; y: number;
    width: number; height: number;
  } | null;
}

/**
 * usePdfRenderer — thin client of pdfRender.worker.
 *
 * Downloads a PDF from the 'floorplans' Supabase Storage bucket (with a
 * module-level LRU byte cache so level switches are instant), then hands the
 * bytes to a dedicated Web Worker that does ALL pdf.js rasterization off the
 * main thread. The worker streams back an LOD bitmap pyramid (1× preview →
 * 2× base eagerly; 4× lazily on first deep zoom) plus sharp viewport crops
 * when zoomed past DEEP_ZOOM_THRESHOLD.
 *
 * @param sheetId     - The sheet UUID (null/empty = idle)
 * @param renderScale - Base render scale (e.g., 2.0 for retina)
 * @param stageScale  - Current Konva stage zoom level
 * @param viewportRect - Current visible bounding box in [0-1] coordinates
 * @param baseImageUrl - Public URL of the server-rendered 4× preview PNG
 *                       (sheets.base_image_url) — instant placeholder
 * @param pdfVersion  - sheets.pdf_version, cache-busts the public PDF/PNG URLs
 */
export function usePdfRenderer(
  sheetId: string | null,
  renderScale: number = BASE_RENDER_SCALE,
  stageScale: number,
  viewportRect: ViewportRect | null,
  baseImageUrl?: string | null,
  pdfVersion?: string | null,
): PdfRenderState {
  // LOD bitmap pyramid — placeholder PNG plus three pdf.js quality levels
  const [placeholderBitmap, setPlaceholderBitmap] = useState<ImageBitmap | null>(null); // 4× PNG
  const [lodLowBitmap, setLodLowBitmap] = useState<ImageBitmap | null>(null);   // 1× preview
  const [lodBaseBitmap, setLodBaseBitmap] = useState<ImageBitmap | null>(null); // 2× base
  const [lodHighBitmap, setLodHighBitmap] = useState<ImageBitmap | null>(null); // 4× deep

  const imageBitmap = useMemo(
    () => pickLodBitmap(stageScale, {
      placeholder: placeholderBitmap,
      low: lodLowBitmap,
      base: lodBaseBitmap,
      high: lodHighBitmap,
    }),
    [stageScale, lodHighBitmap, lodBaseBitmap, lodLowBitmap, placeholderBitmap],
  );

  const [pageWidth, setPageWidth] = useState(0);
  const [pageHeight, setPageHeight] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSharpening, setIsSharpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  // Viewport overlay state for deep zoom
  const [viewportBitmap, setViewportBitmap] = useState<ImageBitmap | null>(null);
  const [viewportPosition, setViewportPosition] = useState<PdfRenderState['viewportPosition']>(null);

  const workerRef = useRef<Worker | null>(null);
  const loadIdRef = useRef(0);
  const viewportRequestIdRef = useRef(0);
  const highRequestedRef = useRef(false);
  const highIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True once the base LOD arrived for the current load — a late-arriving
  // placeholder PNG must be discarded, not displayed over sharper output.
  const baseArrivedRef = useRef(false);
  // True once page-info arrived for the current load — PDF dims take priority
  // over the placeholder PNG's dims (identical aspect, different resolution).
  const pageInfoArrivedRef = useRef(false);
  const mountedRef = useRef(true);

  // Ref-based viewportRect and stageScale so the overlay effect reads the
  // freshest post-settle values without churning on every pan frame.
  const viewportRectRef = useRef<ViewportRect | null>(null);
  viewportRectRef.current = viewportRect;

  const stageScaleRef = useRef(stageScale);
  stageScaleRef.current = stageScale;

  const handleWorkerMessage = useCallback((ev: MessageEvent<PdfWorkerResponse>) => {
    const msg = ev.data;
    // Drop replies from a superseded load (sheet switched mid-render)
    const stale = msg.loadId !== loadIdRef.current || !mountedRef.current;

    switch (msg.type) {
      case 'page-info':
        if (stale) return;
        pageInfoArrivedRef.current = true;
        setPageWidth(msg.pageWidth);
        setPageHeight(msg.pageHeight);
        break;
      case 'lod':
        if (stale) { msg.bitmap.close(); return; }
        if (msg.level === 'low') {
          setLodLowBitmap((prev) => { prev?.close(); return msg.bitmap; });
          setIsLoading(false);
          setIsSharpening(true);
        } else if (msg.level === 'base') {
          setLodBaseBitmap((prev) => { prev?.close(); return msg.bitmap; });
          // The base render supersedes the placeholder PNG for good.
          baseArrivedRef.current = true;
          setPlaceholderBitmap((prev) => { prev?.close(); return null; });
          setIsSharpening(false);
          // Idle pre-render of the 4× LOD so the first deep zoom is sharp.
          const loadIdAtBase = msg.loadId;
          if (highIdleTimerRef.current) clearTimeout(highIdleTimerRef.current);
          highIdleTimerRef.current = setTimeout(() => {
            if (loadIdAtBase !== loadIdRef.current || highRequestedRef.current) return;
            highRequestedRef.current = true;
            const highMsg: PdfWorkerRequest = { type: 'render-high', loadId: loadIdAtBase };
            workerRef.current?.postMessage(highMsg);
          }, HIGH_LOD_IDLE_MS);
        } else {
          setLodHighBitmap((prev) => { prev?.close(); return msg.bitmap; });
        }
        break;
      case 'viewport':
        if (stale || msg.requestId !== viewportRequestIdRef.current) {
          msg.bitmap.close();
          return;
        }
        setViewportBitmap((prev) => { prev?.close(); return msg.bitmap; });
        setViewportPosition(msg.position);
        break;
      case 'error':
        if (stale) return;
        setError(msg.message);
        setIsLoading(false);
        setIsSharpening(false);
        break;
    }
  }, []);

  // Lazily create the worker. Constructing it starts fetching/compiling the
  // worker bundle (incl. pdf.js) in parallel with the Supabase download.
  const ensureWorker = useCallback((): Worker | null => {
    if (typeof window === 'undefined') return null;
    if (!workerRef.current) {
      const worker = new Worker(
        new URL('../workers/pdfRender.worker.ts', import.meta.url),
        { type: 'module', name: 'pdf-render' },
      );
      worker.onmessage = handleWorkerMessage;
      workerRef.current = worker;
    }
    return workerRef.current;
  }, [handleWorkerMessage]);

  // Main download + load effect
  useEffect(() => {
    if (!sheetId) {
      setIsLoading(false);
      setError(null);
      return;
    }

    const loadId = ++loadIdRef.current;
    highRequestedRef.current = false;
    pageInfoArrivedRef.current = false;
    baseArrivedRef.current = false;
    viewportRequestIdRef.current++;
    if (highIdleTimerRef.current) {
      clearTimeout(highIdleTimerRef.current);
      highIdleTimerRef.current = null;
    }
    setIsLoading(true);
    setIsSharpening(false);
    setError(null);
    // Clear the previous sheet's bitmaps so the LOD selector can never show
    // the wrong drawing while the new one loads.
    setPlaceholderBitmap((prev) => { prev?.close(); return null; });
    setLodLowBitmap((prev) => { prev?.close(); return null; });
    setLodBaseBitmap((prev) => { prev?.close(); return null; });
    setLodHighBitmap((prev) => { prev?.close(); return null; });
    setViewportBitmap((prev) => { prev?.close(); return null; });
    setViewportPosition(null);

    const worker = ensureWorker();
    if (!worker) return;

    const controller = new AbortController();

    // Instant first paint: decode the server-rendered 4× preview PNG (usually
    // already in the browser HTTP cache via the project page's preload <img>)
    // while the PDF downloads and parses in parallel.
    if (baseImageUrl) {
      (async () => {
        try {
          const res = await fetch(withVersion(baseImageUrl, pdfVersion ?? null), {
            signal: controller.signal,
            cache: pdfVersion ? 'default' : 'no-cache',
          });
          if (!res.ok) return;
          const blob = await res.blob();
          const bitmap = await createImageBitmap(blob);
          if (
            controller.signal.aborted ||
            loadIdRef.current !== loadId ||
            baseArrivedRef.current ||
            !mountedRef.current
          ) {
            bitmap.close();
            return;
          }
          // PNG dims are the page aspect at 4× — good enough for layout until
          // page-info arrives (which then overwrites with the PDF-derived dims).
          if (!pageInfoArrivedRef.current) {
            setPageWidth(bitmap.width);
            setPageHeight(bitmap.height);
          }
          setPlaceholderBitmap((prev) => { prev?.close(); return bitmap; });
          setIsLoading(false);
          setIsSharpening(true);
        } catch {
          // Non-fatal — the pdf.js preview covers first paint instead.
        }
      })();
    }

    const run = async () => {
      try {
        let buffer = getPdfBytes(sheetId);
        if (!buffer) {
          // Public URL fetch (browser/CDN cacheable), authed download fallback
          buffer = await fetchOriginalPdfBytes(sheetId, pdfVersion ?? null, controller.signal);
          if (controller.signal.aborted || loadIdRef.current !== loadId) return;
          putPdfBytes(sheetId, buffer);
        }

        // Transfer a copy — the cached original must stay usable for the
        // next visit (postMessage transfer detaches the ArrayBuffer).
        const transferable = buffer.slice(0);
        const loadMsg: PdfWorkerRequest = {
          type: 'load',
          loadId,
          buffer: transferable,
          baseScale: renderScale,
        };
        worker.postMessage(loadMsg, [transferable]);
      } catch (err: unknown) {
        if (controller.signal.aborted || loadIdRef.current !== loadId) return;
        const message = err instanceof Error ? err.message : 'Unknown error loading PDF';
        if (mountedRef.current) {
          setError(message);
          setIsLoading(false);
        }
      }
    };

    run();

    return () => {
      controller.abort();
    };
  }, [sheetId, renderScale, retryNonce, ensureWorker, baseImageUrl, pdfVersion]);

  // Lazy 4× LOD: request once per load, the first time the user deep-zooms.
  useEffect(() => {
    if (isLoading || error || !sheetId) return;
    if (stageScale <= DEEP_ZOOM_THRESHOLD || highRequestedRef.current) return;
    highRequestedRef.current = true;
    const msg: PdfWorkerRequest = { type: 'render-high', loadId: loadIdRef.current };
    workerRef.current?.postMessage(msg);
  }, [stageScale, isLoading, error, sheetId]);

  // Deep zoom viewport re-render effect
  useEffect(() => {
    if (!sheetId || error || isLoading) return;

    if (stageScale <= DEEP_ZOOM_THRESHOLD) {
      // Bump the request id so any in-flight overlay reply is dropped.
      viewportRequestIdRef.current++;
      const cancelMsg: PdfWorkerRequest = { type: 'cancel-viewport' };
      workerRef.current?.postMessage(cancelMsg);
      setViewportBitmap((prev) => { prev?.close(); return null; });
      setViewportPosition(null);
      return;
    }

    // Debounce so rapid pan/zoom-end events coalesce into a single render.
    // Both stageScale (zoom) and viewportRect (pan) drive this effect; the
    // refs below ensure the render reflects the post-settle viewport.
    const timer = setTimeout(() => {
      const rect = viewportRectRef.current;
      if (!rect) return;
      const msg: PdfWorkerRequest = {
        type: 'render-viewport',
        loadId: loadIdRef.current,
        requestId: ++viewportRequestIdRef.current,
        rect,
        stageScale: stageScaleRef.current,
        dpr: window.devicePixelRatio || 1,
      };
      workerRef.current?.postMessage(msg);
    }, OVERLAY_SETTLE_MS);

    return () => clearTimeout(timer);
  }, [stageScale, viewportRect, sheetId, error, isLoading]);

  // Unmount cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (highIdleTimerRef.current) clearTimeout(highIdleTimerRef.current);
      workerRef.current?.terminate();
      workerRef.current = null;
      setPlaceholderBitmap((prev) => { prev?.close(); return null; });
      setLodLowBitmap((prev) => { prev?.close(); return null; });
      setLodBaseBitmap((prev) => { prev?.close(); return null; });
      setLodHighBitmap((prev) => { prev?.close(); return null; });
      setViewportBitmap((prev) => { prev?.close(); return null; });
    };
  }, []);

  const retry = useCallback(() => {
    if (sheetId) invalidatePdfBytes(sheetId);
    setError(null);
    setRetryNonce((n) => n + 1);
  }, [sheetId]);

  return {
    imageBitmap,
    pageWidth,
    pageHeight,
    isLoading,
    isSharpening,
    error,
    retry,
    viewportBitmap,
    viewportPosition,
  };
}

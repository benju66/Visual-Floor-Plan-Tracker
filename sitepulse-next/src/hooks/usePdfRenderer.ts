"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '@/supabaseClient';

// Desktop-only target (no iPad). 67M is safe for Safari desktop (lowest desktop
// ceiling). Chrome/Edge support 268M+, Firefox 124M+. This gives maxScale ≈ 3.86×
// for typical 36"×24" architectural sheets — 2× headroom over the previous 16M cap.
const MAX_CANVAS_PIXELS = 67_000_000;

// Zoom threshold: beyond this stageScale, we re-render the visible viewport
// at higher resolution. Lowered from 3.0 to catch blur early.
const DEEP_ZOOM_THRESHOLD = 1.5;

// After motion settles, wait this long before re-rendering the sharp overlay.
// Coalesces rapid pan/zoom-end events into a single pdf.js render so panning at
// deep zoom re-sharpens on settle without spamming render tasks mid-gesture.
const OVERLAY_SETTLE_MS = 150;

// Base render scale: match physical screen density for retina sharpness.
// Math.max ensures at least 2× on standard screens.
const BASE_RENDER_SCALE = typeof window !== 'undefined'
  ? Math.max(window.devicePixelRatio || 1, 2.0)
  : 2.0;

// Low-quality preview scale for instant visual feedback
const PREVIEW_RENDER_SCALE = 1.0;

// LOD high-res scale: pre-rendered in background for smooth deep zoom.
// renderPage clamps this to MAX_CANVAS_PIXELS internally (~3.87× for 36"×24").
const LOD_HIGH_SCALE = 4.0;

/** Visible region in normalized [0–1] PDF page coordinates */
export interface ViewportRect {
  minPctX: number;
  minPctY: number;
  maxPctX: number;
  maxPctY: number;
}

interface PdfRenderState {
  imageBitmap: ImageBitmap | null;
  pageWidth: number;
  pageHeight: number;
  isLoading: boolean;
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

// Helper: create canvas with OffscreenCanvas feature detection
function createRenderCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

// Helper: extract ImageBitmap from canvas
async function canvasToImageBitmap(
  canvas: OffscreenCanvas | HTMLCanvasElement,
): Promise<ImageBitmap> {
  if ('transferToImageBitmap' in canvas) {
    return (canvas as OffscreenCanvas).transferToImageBitmap();
  }
  return createImageBitmap(canvas as HTMLCanvasElement);
}

/**
 * usePdfRenderer — Core pdf.js rendering hook for FloorplanCanvas.
 *
 * Downloads a PDF from the 'floorplans' Supabase Storage bucket, renders it
 * via pdf.js into an ImageBitmap suitable for Konva. Renders high-resolution
 * viewport-crops dynamically as the user zooms in past the threshold.
 *
 * @param sheetId     - The sheet UUID (null/empty = idle)
 * @param renderScale - Base render scale (e.g., 2.0 for retina)
 * @param stageScale  - Current Konva stage zoom level
 * @param viewportRect - Current visible bounding box in [0-1] coordinates
 */
export function usePdfRenderer(
  sheetId: string | null,
  renderScale: number = BASE_RENDER_SCALE,
  stageScale: number,
  viewportRect: ViewportRect | null,
): PdfRenderState {
  // LOD bitmap pyramid — three pre-rendered quality levels
  const [lodLowBitmap, setLodLowBitmap] = useState<ImageBitmap | null>(null);   // 1× preview
  const [lodBaseBitmap, setLodBaseBitmap] = useState<ImageBitmap | null>(null); // 2× base
  const [lodHighBitmap, setLodHighBitmap] = useState<ImageBitmap | null>(null); // 4× deep

  // LOD selection — pick the sharpest bitmap that won't stretch more than ~2×
  const imageBitmap = useMemo(() => {
    if (stageScale >= 2.0 && lodHighBitmap) return lodHighBitmap;
    if (stageScale < 1.0 && lodLowBitmap) return lodLowBitmap;
    if (lodBaseBitmap) return lodBaseBitmap;
    return lodLowBitmap;
  }, [stageScale, lodHighBitmap, lodBaseBitmap, lodLowBitmap]);

  const [pageWidth, setPageWidth] = useState(0);
  const [pageHeight, setPageHeight] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Viewport overlay state for deep zoom
  const [viewportBitmap, setViewportBitmap] = useState<ImageBitmap | null>(null);
  const [viewportPosition, setViewportPosition] = useState<PdfRenderState['viewportPosition']>(null);

  // Refs for cleanup and race condition prevention
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRenderRef = useRef<{ cancel: () => void } | null>(null);
  const activeViewportRenderRef = useRef<{ cancel: () => void } | null>(null);
  const pdfDocRef = useRef<{ destroy: () => Promise<void> } | null>(null);
  const cachedArrayBufferRef = useRef<{ sheetId: string; buffer: ArrayBuffer } | null>(null);
  const currentSheetIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  // Track the active render scale to avoid redundant re-renders
  const activeScaleRef = useRef(0);

  // Cached pdf.js page object
  const cachedPageRef = useRef<any>(null);

  // Ref-based viewportRect and stageScale to prevent useEffect churn during pan/zoom
  const viewportRectRef = useRef<ViewportRect | null>(null);
  viewportRectRef.current = viewportRect;

  const stageScaleRef = useRef(stageScale);
  stageScaleRef.current = stageScale;

  // Cleanup helper
  const cleanup = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    activeRenderRef.current?.cancel();
    activeRenderRef.current = null;

    activeViewportRenderRef.current?.cancel();
    activeViewportRenderRef.current = null;

    if (pdfDocRef.current) {
      pdfDocRef.current.destroy().catch(() => {});
      pdfDocRef.current = null;
    }
    cachedPageRef.current = null;
  }, []);

  // Core render function
  const renderPage = useCallback(async (
    page: any,
    targetScale: number,
  ): Promise<ImageBitmap | null> => {
    const pageW = page.view[2] as number;
    const pageH = page.view[3] as number;
    const maxScale = Math.sqrt(MAX_CANVAS_PIXELS / (pageW * pageH));
    const safeScale = Math.min(targetScale, maxScale);

    const rotation = (page.rotate as number) || 0;
    const viewport = page.getViewport({ scale: safeScale, rotation });

    activeRenderRef.current?.cancel();

    const canvas = createRenderCanvas(
      Math.floor(viewport.width),
      Math.floor(viewport.height),
    );
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2d context');

    const renderTask = page.render({ canvasContext: ctx, viewport });
    activeRenderRef.current = renderTask;

    try {
      await renderTask.promise;
      activeScaleRef.current = safeScale;
      return await canvasToImageBitmap(canvas);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'RenderingCancelledException') {
        return null;
      }
      throw err;
    }
  }, []);

  // Viewport-clipped render for deep zoom
  const renderViewportRegion = useCallback(async (
    page: any,
    rect: ViewportRect,
    currentStageScale: number,
  ): Promise<{
    bitmap: ImageBitmap;
    position: { x: number; y: number; width: number; height: number };
  } | null> => {
    const rotation = (page.rotate as number) || 0;

    const refViewport = page.getViewport({ scale: 1, rotation });
    const vpWidth = refViewport.width as number;
    const vpHeight = refViewport.height as number;

    const vMinX = Math.max(0, rect.minPctX);
    const vMinY = Math.max(0, rect.minPctY);
    const vMaxX = Math.min(1, rect.maxPctX);
    const vMaxY = Math.min(1, rect.maxPctY);
    const vW = vMaxX - vMinX;
    const vH = vMaxY - vMinY;
    if (vW <= 0 || vH <= 0) return null;

    const dpr = window.devicePixelRatio || 1;
    let effectiveScale = currentStageScale * dpr;

    const rawW = Math.ceil(vpWidth * vW * effectiveScale);
    const rawH = Math.ceil(vpHeight * vH * effectiveScale);
    const totalPixels = rawW * rawH;

    if (totalPixels > MAX_CANVAS_PIXELS) {
      effectiveScale *= Math.sqrt(MAX_CANVAS_PIXELS / totalPixels);
    }

    const finalW = Math.ceil(vpWidth * vW * effectiveScale);
    const finalH = Math.ceil(vpHeight * vH * effectiveScale);
    if (finalW <= 0 || finalH <= 0) return null;

    activeViewportRenderRef.current?.cancel();

    const canvas = createRenderCanvas(finalW, finalH);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const clipX = Math.floor(vMinX * vpWidth * effectiveScale);
    const clipY = Math.floor(vMinY * vpHeight * effectiveScale);

    const viewport = page.getViewport({
      scale: effectiveScale,
      rotation,
      offsetX: -clipX,
      offsetY: -clipY,
    });

    const renderTask = page.render({ canvasContext: ctx, viewport });
    activeViewportRenderRef.current = renderTask;

    try {
      await renderTask.promise;
      const bitmap = await canvasToImageBitmap(canvas);
      return {
        bitmap,
        position: { x: vMinX, y: vMinY, width: vW, height: vH },
      };
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'name' in err &&
          (err as { name: string }).name === 'RenderingCancelledException') {
        return null;
      }
      throw err;
    }
  }, []);

  // Main download + render effect
  useEffect(() => {
    if (!sheetId) {
      setIsLoading(false);
      setError(null);
      return;
    }

    currentSheetIdRef.current = sheetId;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const run = async () => {
      setIsLoading(true);
      setError(null);

      try {
        let arrayBuffer: ArrayBuffer;
        if (
          cachedArrayBufferRef.current &&
          cachedArrayBufferRef.current.sheetId === sheetId
        ) {
          arrayBuffer = cachedArrayBufferRef.current.buffer;
        } else {
          cachedArrayBufferRef.current = null;

          // Download PDF directly from originals folder in floorplans bucket
          const { data: blob, error: dlError } = await supabase.storage
            .from('floorplans')
            .download(`originals/${sheetId}.pdf`);

          if (controller.signal.aborted) return;
          if (dlError || !blob) {
            throw new Error(dlError?.message || 'Original PDF not found for this level. Please attach a blueprint PDF in Settings.');
          }

          arrayBuffer = await blob.arrayBuffer();
          if (controller.signal.aborted) return;

          cachedArrayBufferRef.current = { sheetId, buffer: arrayBuffer };
        }

        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

        if (controller.signal.aborted) return;

        if (pdfDocRef.current) {
          await pdfDocRef.current.destroy().catch(() => {});
        }

        const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        if (controller.signal.aborted) {
          doc.destroy().catch(() => {});
          return;
        }
        pdfDocRef.current = doc;

        const page = await doc.getPage(1);
        if (controller.signal.aborted) return;
        cachedPageRef.current = page;

        const pageW = page.view[2] as number;
        const pageH = page.view[3] as number;
        const rotation = (page.rotate as number) || 0;
        const isRotated = rotation === 90 || rotation === 270;

        const previewBitmap = await renderPage(page, PREVIEW_RENDER_SCALE);
        if (controller.signal.aborted || currentSheetIdRef.current !== sheetId) {
          previewBitmap?.close();
          return;
        }

        if (previewBitmap && mountedRef.current) {
          setLodLowBitmap((prev) => { prev?.close(); return previewBitmap; });

          const baseMaxScale = Math.sqrt(MAX_CANVAS_PIXELS / (pageW * pageH));
          const baseSafe = Math.min(renderScale, baseMaxScale);
          const w = isRotated ? Math.floor(pageH * baseSafe) : Math.floor(pageW * baseSafe);
          const h = isRotated ? Math.floor(pageW * baseSafe) : Math.floor(pageH * baseSafe);
          setPageWidth(w);
          setPageHeight(h);
          setIsLoading(false);
        }

        const fullBitmap = await renderPage(page, renderScale);
        if (controller.signal.aborted || currentSheetIdRef.current !== sheetId) {
          fullBitmap?.close();
          return;
        }

        if (fullBitmap && mountedRef.current) {
          setLodBaseBitmap((prev) => { prev?.close(); return fullBitmap; });
        }

        const hqBitmap = await renderPage(page, LOD_HIGH_SCALE);
        if (controller.signal.aborted || currentSheetIdRef.current !== sheetId) {
          hqBitmap?.close();
          return;
        }

        if (hqBitmap && mountedRef.current) {
          setLodHighBitmap((prev) => { prev?.close(); return hqBitmap; });
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
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
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetId, renderScale]);

  // Deep zoom viewport re-render effect
  useEffect(() => {
    if (!sheetId || error || isLoading) return;

    if (stageScale <= DEEP_ZOOM_THRESHOLD) {
      setViewportBitmap(prev => { prev?.close(); return null; });
      setViewportPosition(null);
      return;
    }

    let cancelled = false;

    const renderOverlay = async () => {
      if (currentSheetIdRef.current !== sheetId) return;

      // Read the freshest region/scale via refs so the render reflects the
      // post-settle viewport (the deps below merely schedule this).
      const currentRect = viewportRectRef.current;
      if (!currentRect) return;

      try {
        const page = cachedPageRef.current;
        if (!page) return;

        const currentScale = stageScaleRef.current;
        const result = await renderViewportRegion(page, currentRect, currentScale);

        if (cancelled || currentSheetIdRef.current !== sheetId) {
          result?.bitmap.close();
          return;
        }

        if (result && mountedRef.current) {
          setViewportBitmap(prev => { prev?.close(); return result.bitmap; });
          setViewportPosition(result.position);
        }
      } catch {
        // Non-fatal fallback
      }
    };

    // Debounce so rapid pan/zoom-end events coalesce into a single render. Both
    // stageScale (zoom) and viewportRect (pan) drive this effect; without the
    // viewportRect dep, panning at deep zoom never re-sharpened the new region.
    const timer = setTimeout(renderOverlay, OVERLAY_SETTLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      activeViewportRenderRef.current?.cancel();
    };
  }, [stageScale, viewportRect, sheetId, error, isLoading, renderViewportRegion]);

  // Unmount cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanup();
      setLodLowBitmap((prev) => { prev?.close(); return null; });
      setLodBaseBitmap((prev) => { prev?.close(); return null; });
      setLodHighBitmap((prev) => { prev?.close(); return null; });
      setViewportBitmap((prev) => { prev?.close(); return null; });
      cachedArrayBufferRef.current = null;
    };
  }, [cleanup]);

  const retry = useCallback(() => {
    setError(null);
    setIsLoading(false);
    cachedArrayBufferRef.current = null;
    cleanup();
    currentSheetIdRef.current = null;
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
    }, 0);
  }, [cleanup]);

  return {
    imageBitmap,
    pageWidth,
    pageHeight,
    isLoading,
    error,
    retry,
    viewportBitmap,
    viewportPosition,
  };
}

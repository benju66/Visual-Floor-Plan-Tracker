"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPdfBytes, putPdfBytes } from '@/utils/pdfByteCache';
import { fetchOriginalPdfBytes } from '@/utils/pdfSource';
import type { ViewportRect } from '@/utils/pdfRenderMath';
import type { PdfWorkerRequest, PdfWorkerResponse } from '@/workers/pdfRenderProtocol';

/**
 * useLoupeRenderer — owns a DEDICATED pdf.js worker for the magnifier loupe,
 * fully isolated from the main view's renderer (usePdfRenderer). It renders
 * small, very-high-resolution crops of the page under the cursor, so the loupe
 * can show genuinely more detail than the canvas's zoom ceiling.
 *
 * A separate worker (vs. reusing the main one) matters: the main renderer drives
 * its own `render-viewport` overlay for deep zoom, and the two would cancel each
 * other's in-flight crops if they shared a worker. The worker is created lazily
 * the first time the loupe is activated, reuses the module-level PDF byte cache
 * (already populated by the main view, so no second download), and loads with
 * `skipLods` so it never wastes time on the full-page LOD pyramid.
 */

export interface LoupePatch {
  bitmap: ImageBitmap;
  /** Normalized [0–1] page region the bitmap covers. */
  position: { x: number; y: number; width: number; height: number };
}

export interface LoupeRenderer {
  /** Latest high-res crop, or null before the first render / on a raster sheet. */
  patch: LoupePatch | null;
  /** Render a crop of `rect` at `stageScale * magnification` effective zoom. */
  requestPatch: (rect: ViewportRect, stageScale: number, magnification: number) => void;
}

// Required by the load message but unused on the loupe path (skipLods short-
// circuits before any full-page render uses it).
const LOUPE_BASE_SCALE = 2;

export function useLoupeRenderer(
  sheetId: string | null,
  pdfVersion: string | null | undefined,
  active: boolean,
): LoupeRenderer {
  const [patch, setPatch] = useState<LoupePatch | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const loadIdRef = useRef(0);
  const reqIdRef = useRef(0);
  const readyRef = useRef(false);
  const loadedKeyRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const handleMessage = useCallback((ev: MessageEvent<PdfWorkerResponse>) => {
    const msg = ev.data;
    const stale = msg.loadId !== loadIdRef.current || !mountedRef.current;
    if (stale) {
      if (msg.type === 'viewport' || msg.type === 'lod') msg.bitmap.close();
      return;
    }
    switch (msg.type) {
      case 'page-info':
        readyRef.current = true;
        break;
      case 'viewport':
        // Drop a crop that a newer request has already superseded.
        if (msg.requestId !== reqIdRef.current) {
          msg.bitmap.close();
          return;
        }
        setPatch((prev) => {
          prev?.bitmap.close();
          return { bitmap: msg.bitmap, position: msg.position };
        });
        break;
      case 'lod':
        // skipLods means the worker shouldn't emit these — close defensively.
        msg.bitmap.close();
        break;
      case 'error':
        readyRef.current = false;
        break;
    }
  }, []);

  const ensureWorker = useCallback((): Worker | null => {
    if (typeof window === 'undefined') return null;
    if (!workerRef.current) {
      const worker = new Worker(
        new URL('../workers/pdfRender.worker.ts', import.meta.url),
        { type: 'module', name: 'pdf-loupe' },
      );
      worker.onmessage = handleMessage;
      workerRef.current = worker;
    }
    return workerRef.current;
  }, [handleMessage]);

  // Load the page on first activation and whenever the sheet changes. The worker
  // is kept alive across M taps (only the sheet key gates a reload), so repeated
  // hold-M never thrashes the worker or re-parses the PDF.
  useEffect(() => {
    if (!active || !sheetId) return;
    const key = `${sheetId}:${pdfVersion ?? ''}`;
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;

    const worker = ensureWorker();
    if (!worker) return;

    const loadId = ++loadIdRef.current;
    reqIdRef.current++;
    readyRef.current = false;
    setPatch((prev) => { prev?.bitmap.close(); return null; });

    const controller = new AbortController();
    (async () => {
      try {
        let buffer = getPdfBytes(sheetId);
        if (!buffer) {
          buffer = await fetchOriginalPdfBytes(sheetId, pdfVersion ?? null, controller.signal);
          if (controller.signal.aborted || loadIdRef.current !== loadId) return;
          putPdfBytes(sheetId, buffer);
        }
        // Transfer a copy — the cached original must stay usable (transfer detaches).
        const transferable = buffer.slice(0);
        const msg: PdfWorkerRequest = {
          type: 'load',
          loadId,
          buffer: transferable,
          baseScale: LOUPE_BASE_SCALE,
          skipLods: true,
        };
        worker.postMessage(msg, [transferable]);
      } catch {
        // No original PDF (raster sheet) or download failed — the loupe falls
        // back to the soft on-screen upscale, so reset the key to retry later.
        loadedKeyRef.current = null;
      }
    })();

    return () => controller.abort();
  }, [active, sheetId, pdfVersion, ensureWorker]);

  const requestPatch = useCallback(
    (rect: ViewportRect, stageScale: number, magnification: number) => {
      const worker = workerRef.current;
      if (!worker || !readyRef.current) return;
      const msg: PdfWorkerRequest = {
        type: 'render-viewport',
        loadId: loadIdRef.current,
        requestId: ++reqIdRef.current,
        rect,
        // Boost effective scale by the lens magnification; the worker clamps to
        // its pixel budget, but a tiny crop stays well under it → full sharpness.
        stageScale: stageScale * magnification,
        dpr: window.devicePixelRatio || 1,
      };
      worker.postMessage(msg);
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      workerRef.current?.terminate();
      workerRef.current = null;
      setPatch((prev) => { prev?.bitmap.close(); return null; });
    };
  }, []);

  return { patch, requestPatch };
}

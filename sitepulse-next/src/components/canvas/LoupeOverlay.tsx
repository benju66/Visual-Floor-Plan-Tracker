"use client";
import { useEffect, useRef } from 'react';
import type { PointerStore } from '@/utils/pointerStore';
import type { CanvasLayout } from '@/types/domain';
import type { ViewportRect } from '@/utils/pdfRenderMath';
import type { LoupePatch } from '@/hooks/useLoupeRenderer';
import {
  lensCoverage,
  rectContains,
  expandPatchRect,
  regionToBitmapSrc,
  positionToRect,
} from '@/utils/loupeMath';

/**
 * Magnifier loupe — a circular lens that follows the cursor for precise node
 * placement past the canvas's zoom ceiling. Like CrosshairOverlay it subscribes
 * to the pointer store and mutates DOM directly via refs, so moving the mouse
 * never re-renders React.
 *
 * Two image sources, layered for instant feedback AND true sharpness:
 *  1. Soft base — an upscale of the current on-screen render via stage.toCanvas().
 *     Always available, shown immediately while a sharp crop is in flight.
 *  2. Sharp crop — a fresh high-resolution pdf.js render of the patch under the
 *     cursor (from useLoupeRenderer), drawn on top once it covers the lens. This
 *     is the real win: it resolves detail the 15× stage zoom can't.
 *
 * The sharp crop is rendered LARGER than the lens, so ordinary small cursor
 * moves sample the cached bitmap (cheap drawImage) — a new crop is only
 * requested when the lens nears the cached patch's edge.
 */
interface LoupeOverlayProps {
  pointerStore: PointerStore;
  /** The Konva Stage ref from FloorplanCanvas. */
  stageRef: React.RefObject<any>;
  /** Current canvas layout (offsets + draw size), for pct→screen projection. */
  layout: CanvasLayout;
  /** Linear magnification over the current on-screen view. */
  magnification?: number;
  /** Lens diameter in CSS px. */
  size?: number;
  /** Latest high-res crop from useLoupeRenderer (null on raster sheets). */
  patch: LoupePatch | null;
  requestPatch: (rect: ViewportRect, stageScale: number, magnification: number) => void;
}

// The sharp crop covers this multiple of the lens span, centered on the cursor.
const PATCH_SPAN_FACTOR = 2.4;
// Re-request a crop once the lens enters this margin (fraction) of the patch edge.
const REQUEST_SHRINK = 0.18;

export default function LoupeOverlay({
  pointerStore,
  stageRef,
  layout,
  magnification = 3,
  size = 200,
  patch,
  requestPatch,
}: LoupeOverlayProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Mirror fast-changing props into refs so the per-frame draw reads fresh values
  // without re-subscribing or re-rendering.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const patchRef = useRef(patch);
  patchRef.current = patch;
  const magRef = useRef(magnification);
  magRef.current = magnification;
  const lastRequestRef = useRef<{ cx: number; cy: number } | null>(null);

  // Size the backing canvas to device pixels for retina crispness.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
  }, [size]);

  // The draw routine is invoked on every pointer frame and once when a fresh
  // patch lands (mouse may be still). Held in a ref so the patch effect can call
  // the latest closure.
  const drawRef = useRef<() => void>(() => {});
  useEffect(() => {
    const draw = () => {
      const wrap = wrapRef.current;
      const canvas = canvasRef.current;
      const stage = stageRef.current;
      const s = pointerStore.get();
      if (!wrap || !canvas) return;
      if (!s || !stage) {
        wrap.style.display = 'none';
        return;
      }
      wrap.style.display = 'block';
      wrap.style.transform = `translate3d(${s.screenX - size / 2}px, ${s.screenY - size / 2}px, 0)`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const mag = magRef.current;
      const lay = layoutRef.current;
      const scale = stage.scaleX?.() ?? 1;
      const srcCss = size / mag;

      const dark =
        typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
      const backdrop = dark ? '#0f172a' : '#ffffff';

      const hasLayout = lay.drawW > 0 && lay.drawH > 0;
      const coverage = hasLayout
        ? lensCoverage(s.pctX, s.pctY, size, mag, { drawW: lay.drawW, drawH: lay.drawH, scale })
        : null;

      const p = patchRef.current;
      const patchRect = p ? positionToRect(p.position) : null;
      const covered = !!(coverage && p?.bitmap && patchRect && rectContains(patchRect, coverage, 0));

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = backdrop;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (covered && coverage && p) {
        // Sharp path — sample the cached high-res crop (cheap).
        const src = regionToBitmapSrc(coverage, p.position, p.bitmap.width, p.bitmap.height);
        try {
          ctx.drawImage(p.bitmap, src.sx, src.sy, src.sw, src.sh, 0, 0, canvas.width, canvas.height);
        } catch {
          // Bitmap was closed mid-frame (sheet switch) — fall back next frame.
        }
      } else {
        // Soft fallback — upscale the current on-screen render (instant).
        try {
          const cap = stage.toCanvas({
            x: s.screenX - srcCss / 2,
            y: s.screenY - srcCss / 2,
            width: srcCss,
            height: srcCss,
            pixelRatio: mag * dpr,
          });
          ctx.drawImage(cap, 0, 0, canvas.width, canvas.height);
        } catch {
          // Stage not ready — leave the backdrop.
        }
      }

      // Ask for a fresh sharp crop when none covers the lens (or it nears the
      // patch edge). Throttled by cursor travel so an in-flight request isn't
      // re-fired every frame.
      if (coverage) {
        const needsPatch = !patchRect || !rectContains(patchRect, coverage, REQUEST_SHRINK);
        if (needsPatch) {
          const last = lastRequestRef.current;
          const covW = coverage.maxPctX - coverage.minPctX;
          const movedEnough =
            !last || Math.hypot(s.pctX - last.cx, s.pctY - last.cy) > covW * 0.3;
          if (movedEnough) {
            lastRequestRef.current = { cx: s.pctX, cy: s.pctY };
            requestPatch(expandPatchRect(coverage, PATCH_SPAN_FACTOR), scale, mag);
          }
        }
      }
    };
    drawRef.current = draw;
    draw();
    return pointerStore.subscribe(draw);
  }, [pointerStore, stageRef, size, requestPatch]);

  // A freshly-arrived patch should upgrade the lens to sharp even if the mouse
  // is momentarily still.
  useEffect(() => {
    drawRef.current();
  }, [patch]);

  return (
    <div
      ref={wrapRef}
      style={{ display: 'none', width: size, height: size, left: 0, top: 0 }}
      className="pointer-events-none absolute z-30 rounded-full overflow-hidden shadow-2xl ring-2 ring-white/90 dark:ring-slate-900/60 will-change-transform"
    >
      <canvas ref={canvasRef} style={{ width: size, height: size }} className="block" />
      {/* Center crosshair — the raw cursor / placement point when not snapped. */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/2 left-0 right-0 -translate-y-1/2 border-t border-rose-500/60" />
        <div className="absolute left-1/2 top-0 bottom-0 -translate-x-1/2 border-l border-rose-500/60" />
        <div className="absolute top-1/2 left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-rose-500/90" />
      </div>
      {/* Magnification readout. */}
      <div className="pointer-events-none absolute bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/70 px-2 py-0.5 text-[10px] font-semibold text-white">
        {magnification}×
      </div>
    </div>
  );
}

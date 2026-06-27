"use client";
import { useEffect, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import {
  fitMiniSize,
  viewportRectToMiniBox,
  stageToVisiblePctRect,
  miniClickToStagePosition,
  type MiniMapLayout,
} from '@/utils/minimapMath';

/**
 * Mini-map — a small bottom-right thumbnail of the WHOLE sheet with a rectangle
 * marking the region currently visible in the main Konva stage, so you don't get
 * lost when zoomed in. Plain HTML/CSS (NOT Konva): an `<img>` thumbnail plus an
 * absolutely-positioned `<div>` box.
 *
 * Like CrosshairOverlay / LoupeOverlay, the live tracking is imperative: a
 * lightweight rAF loop reads the canvas's `liveViewportRef` and writes the box's
 * position directly to the DOM, so panning/zooming the main stage never triggers
 * a React re-render here (AGENTS §3). The box position is set ONLY imperatively —
 * never via JSX style — so parent re-renders can't fight it.
 *
 * Interaction (desktop / mouse, per the project's canvas-nav convention):
 *  - click anywhere on the thumbnail → eased recenter there (`onRecenter`),
 *  - press inside the box and drag → continuous pan (`onPanTo` per move, `onPanEnd` on release),
 *  - drag the top-left corner handle → resize the mini-map (aspect locked, persisted).
 */
interface MiniMapOverlayProps {
  /** Versioned full-sheet thumbnail URL (server preview PNG). Empty → backdrop only. */
  thumbnailUrl: string;
  /** Sheet aspect ratio (drawW / drawH) — sizes the mini-map box. */
  aspect: number;
  /** Live Konva transform, mutated every frame by the canvas (zero-re-render source). */
  liveViewportRef: React.RefObject<{ scale: number; x: number; y: number }>;
  /** Live sheet layout + stage pixel size, mutated by the canvas. */
  layoutRef: React.RefObject<MiniMapLayout>;
  /** Persisted size multiplier over the ~160×120 base envelope (default 1). */
  sizeScale: number;
  /** Eased recenter on the given (unclamped) stage position — a click. */
  onRecenter: (stagePos: { x: number; y: number }) => void;
  /** Immediate pan to the given (unclamped) stage position — each drag move. */
  onPanTo: (stagePos: { x: number; y: number }) => void;
  /** Drag finished — let the canvas commit/flush its viewport state. */
  onPanEnd: () => void;
  /** Persist a new size multiplier (called once when a resize drag ends). */
  onResize: (scale: number) => void;
}

// Base mini-map envelope (px) and its diagonal — the unit the size multiplier scales.
const BASE_W = 160;
const BASE_H = 120;
// How small / large the user can drag the mini-map (multiplier of the base envelope).
const MIN_SCALE = 0.7;
const MAX_SCALE = 3;

export default function MiniMapOverlay({
  thumbnailUrl,
  aspect,
  liveViewportRef,
  layoutRef,
  sizeScale,
  onRecenter,
  onPanTo,
  onPanEnd,
  onResize,
}: MiniMapOverlayProps) {
  // During a resize drag we track the size locally for instant feedback, then
  // persist once on release. `effScale` is the live size; `miniW/miniH` follow it.
  const [liveScale, setLiveScale] = useState<number | null>(null);
  const effScale = liveScale ?? sizeScale;
  const { miniW, miniH } = fitMiniSize(aspect, BASE_W * effScale, BASE_H * effScale);

  const wrapRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // Mirror callbacks into a ref so the rAF/effect closures always call the latest
  // without re-subscribing.
  const cbRef = useRef({ onRecenter, onPanTo, onPanEnd, onResize });
  cbRef.current = { onRecenter, onPanTo, onPanEnd, onResize };

  // Live tracking: a rAF loop reads the live viewport ref and positions the box.
  // Only runs while the (opt-in, default-off) mini-map is mounted. Cheap: a few
  // multiplies + a compare; the DOM is touched only when the box actually moves.
  useEffect(() => {
    let raf = 0;
    let last = { left: -1, top: -1, width: -1, height: -1 };
    const tick = () => {
      const box = boxRef.current;
      const vp = liveViewportRef.current;
      const lay = layoutRef.current;
      if (box && vp && lay && lay.drawW > 0 && lay.drawH > 0) {
        const visible = stageToVisiblePctRect(vp.scale, { x: vp.x, y: vp.y }, lay);
        const b = viewportRectToMiniBox(visible, miniW, miniH);
        if (b.left !== last.left || b.top !== last.top || b.width !== last.width || b.height !== last.height) {
          box.style.left = `${b.left}px`;
          box.style.top = `${b.top}px`;
          box.style.width = `${b.width}px`;
          box.style.height = `${b.height}px`;
          last = b;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [liveViewportRef, layoutRef, miniW, miniH]);

  // Native wheel isolation (AGENTS §3): stop wheel events over the mini-map from
  // reaching the Konva stage so scrolling/zooming the thumbnail can't pan/zoom the
  // main canvas. `overscroll-contain` (className) also blocks scroll chaining.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Pointer position within the mini-map, clamped to its bounds.
  const localPoint = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(e.clientX - rect.left, miniW)),
      y: Math.max(0, Math.min(e.clientY - rect.top, miniH)),
    };
  };

  // The current viewport box (mini-map px), or null when layout isn't ready.
  const currentBox = () => {
    const vp = liveViewportRef.current;
    const lay = layoutRef.current;
    if (!vp || !lay || lay.drawW <= 0 || lay.drawH <= 0) return null;
    return viewportRectToMiniBox(stageToVisiblePctRect(vp.scale, { x: vp.x, y: vp.y }, lay), miniW, miniH);
  };

  // Stage position that puts the given mini-map point at the viewport center.
  const targetFor = (pt: { x: number; y: number }): { x: number; y: number } | null => {
    const vp = liveViewportRef.current;
    const lay = layoutRef.current;
    if (!vp || !lay || lay.drawW <= 0 || lay.drawH <= 0) return null;
    return miniClickToStagePosition(pt, miniW, miniH, lay, vp.scale);
  };

  // While dragging the box, the offset (mini-px) between the grab point and the
  // box center — so the box tracks the cursor without snapping its center to it.
  const grabOffsetRef = useRef({ x: 0, y: 0 });

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const pt = localPoint(e);
    const box = currentBox();
    const inside =
      !!box && pt.x >= box.left && pt.x <= box.left + box.width && pt.y >= box.top && pt.y <= box.top + box.height;
    if (inside && box) {
      // Press inside the box → grab it; pan starts on the first move (no jump).
      draggingRef.current = true;
      grabOffsetRef.current = { x: pt.x - (box.left + box.width / 2), y: pt.y - (box.top + box.height / 2) };
      wrapRef.current?.setPointerCapture(e.pointerId);
    } else {
      // Press elsewhere → eased recenter on that point (a click).
      const target = targetFor(pt);
      if (target) cbRef.current.onRecenter(target);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    const pt = localPoint(e);
    const target = targetFor({ x: pt.x - grabOffsetRef.current.x, y: pt.y - grabOffsetRef.current.y });
    if (target) cbRef.current.onPanTo(target);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    wrapRef.current?.releasePointerCapture?.(e.pointerId);
    cbRef.current.onPanEnd();
  };

  // ── Resize handle (top-left corner) ───────────────────────────────────────
  // The mini-map is anchored bottom-right, so its bottom-right corner is fixed;
  // dragging the top-left handle resizes it toward/away from that anchor. Scaling
  // is RELATIVE to the grab (startScale × distanceRatio) so it never jumps on
  // grab regardless of the sheet's aspect, and the aspect stays locked.
  const resizingRef = useRef(false);
  const resizeStartRef = useRef({ anchorX: 0, anchorY: 0, startDist: 1, startScale: 1 });

  const handleResizeDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = wrapRef.current!.getBoundingClientRect();
    const anchorX = rect.right;
    const anchorY = rect.bottom;
    resizeStartRef.current = {
      anchorX,
      anchorY,
      startDist: Math.max(1, Math.hypot(anchorX - e.clientX, anchorY - e.clientY)),
      startScale: effScale,
    };
    resizingRef.current = true;
    handleRef.current?.setPointerCapture(e.pointerId);
  };

  const handleResizeMove = (e: React.PointerEvent) => {
    if (!resizingRef.current) return;
    e.preventDefault();
    const { anchorX, anchorY, startDist, startScale } = resizeStartRef.current;
    const dist = Math.hypot(anchorX - e.clientX, anchorY - e.clientY);
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, (startScale * dist) / startDist));
    setLiveScale(next);
  };

  const handleResizeUp = (e: React.PointerEvent) => {
    if (!resizingRef.current) return;
    resizingRef.current = false;
    handleRef.current?.releasePointerCapture?.(e.pointerId);
    cbRef.current.onResize(effScale);
    setLiveScale(null);
  };

  return (
    <div
      ref={wrapRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{ width: miniW, height: miniH }}
      className="absolute right-3 bottom-12 z-20 cursor-pointer overflow-hidden rounded-lg border shadow-xl backdrop-blur-md overscroll-contain select-none touch-none"
    >
      <div
        className="absolute inset-0"
        style={{ background: 'var(--glass-bg, rgba(255,255,255,0.7))', borderColor: 'var(--glass-border, rgba(226,232,240,0.5))' }}
      />
      {thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnailUrl}
          alt="Sheet mini-map"
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-fill opacity-90"
        />
      )}
      {/* Viewport box — left/top/width/height are set ONLY imperatively by the
          rAF loop above. They are deliberately absent from this JSX style so a
          parent re-render can't reset them (React leaves style props it doesn't
          manage untouched), the same imperative-positioning trick LoupeOverlay
          uses for its transform. */}
      <div
        ref={boxRef}
        className="pointer-events-none absolute border-2 border-sky-500 bg-sky-500/15 shadow-[0_0_0_1px_rgba(255,255,255,0.6)]"
      />
      {/* Resize handle — top-left corner (the mini-map grows toward the cursor). */}
      <div
        ref={handleRef}
        onPointerDown={handleResizeDown}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeUp}
        onPointerCancel={handleResizeUp}
        title="Drag to resize the mini-map"
        className="absolute left-0 top-0 flex h-4 w-4 cursor-nwse-resize items-center justify-center rounded-br-md bg-slate-900/55 text-white/90 hover:bg-slate-900/75"
      >
        <Maximize2 size={10} className="rotate-90" />
      </div>
    </div>
  );
}

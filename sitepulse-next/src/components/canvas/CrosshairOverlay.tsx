"use client";
import { useEffect, useRef } from 'react';
import type { PointerStore } from '@/utils/pointerStore';
import type { MapSettings } from '@/store/useSettingsStore';

type CrosshairStyle = NonNullable<MapSettings['crosshairStyle']>;

/**
 * Which sub-elements each crosshair style renders. `gap` punches a CAD-style hole
 * in the full-bleed lines around the cursor so the exact point isn't covered.
 * Each entry is a stable object reference — used directly as the effect dep so the
 * positioning loop re-binds (and re-positions newly mounted elements) on any style
 * change, while per-frame mouse moves never re-render.
 */
const STYLE_SPEC: Record<CrosshairStyle, { lines: boolean; dot: boolean; ring: boolean; gap: boolean }> = {
  'lines':     { lines: true,  dot: false, ring: false, gap: false },
  'lines-dot': { lines: true,  dot: true,  ring: false, gap: false },
  'ring':      { lines: false, dot: false, ring: true,  gap: false },
  'ring-dot':  { lines: false, dot: true,  ring: true,  gap: false },
  'gap-cross': { lines: true,  dot: false, ring: false, gap: true  },
};

/** Half-width (px) of the gap punched around the cursor for the `gap-cross` style. */
const GAP_PX = 8;

/**
 * Cursor crosshair drawn as DOM elements over the canvas. Subscribes to the pointer
 * store and mutates positions directly via refs — the component never re-renders
 * while the mouse moves (only when `style` changes). The wrapper's
 * `mix-blend-difference` keeps every variant visible on both light and dark sheets.
 */
export default function CrosshairOverlay({
  pointerStore,
  style = 'lines',
}: {
  pointerStore: PointerStore;
  style?: CrosshairStyle;
}) {
  const spec = STYLE_SPEC[style] ?? STYLE_SPEC['lines'];

  const wrapRef = useRef<HTMLDivElement>(null);
  const vLineRef = useRef<HTMLDivElement>(null);
  const hLineRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const s = pointerStore.get();
      if (!s) {
        wrap.style.display = 'none';
        return;
      }
      wrap.style.display = 'block';

      const v = vLineRef.current;
      const h = hLineRef.current;
      if (v && h) {
        v.style.left = `${s.screenX}px`;
        h.style.top = `${s.screenY}px`;
        if (spec.gap) {
          // Punch a hole in each full-bleed line around the cursor (the gap tracks
          // the cursor along the line's long axis).
          const maskV = `linear-gradient(to bottom, #000 ${s.screenY - GAP_PX}px, transparent ${s.screenY - GAP_PX}px, transparent ${s.screenY + GAP_PX}px, #000 ${s.screenY + GAP_PX}px)`;
          const maskH = `linear-gradient(to right, #000 ${s.screenX - GAP_PX}px, transparent ${s.screenX - GAP_PX}px, transparent ${s.screenX + GAP_PX}px, #000 ${s.screenX + GAP_PX}px)`;
          v.style.setProperty('mask-image', maskV);
          v.style.setProperty('-webkit-mask-image', maskV);
          h.style.setProperty('mask-image', maskH);
          h.style.setProperty('-webkit-mask-image', maskH);
        } else {
          v.style.removeProperty('mask-image');
          v.style.removeProperty('-webkit-mask-image');
          h.style.removeProperty('mask-image');
          h.style.removeProperty('-webkit-mask-image');
        }
      }

      const dot = dotRef.current;
      if (dot) {
        dot.style.left = `${s.screenX}px`;
        dot.style.top = `${s.screenY}px`;
      }
      const ring = ringRef.current;
      if (ring) {
        ring.style.left = `${s.screenX}px`;
        ring.style.top = `${s.screenY}px`;
      }
    };
    update();
    return pointerStore.subscribe(update);
    // `spec` is a stable per-style object: this re-binds on any style change so a
    // still cursor still gets newly mounted dot/ring positioned immediately.
  }, [pointerStore, spec]);

  return (
    <div
      ref={wrapRef}
      style={{ display: 'none' }}
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden mix-blend-difference opacity-40"
    >
      {spec.lines && (
        <>
          <div ref={vLineRef} className="absolute top-0 bottom-0 border-l border-dashed border-white" />
          <div ref={hLineRef} className="absolute left-0 right-0 border-t border-dashed border-white" />
        </>
      )}
      {spec.ring && (
        <div
          ref={ringRef}
          className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white"
        />
      )}
      {spec.dot && (
        <div
          ref={dotRef}
          className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
        />
      )}
    </div>
  );
}

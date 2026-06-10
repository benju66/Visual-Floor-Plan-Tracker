"use client";
import { useEffect, useRef } from 'react';
import type { PointerStore } from '@/utils/pointerStore';

/**
 * Cursor crosshair drawn as DOM lines over the canvas. Subscribes to the pointer
 * store and mutates the line positions directly via refs — the component never
 * re-renders while the mouse moves.
 */
export default function CrosshairOverlay({ pointerStore }: { pointerStore: PointerStore }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const vLineRef = useRef<HTMLDivElement>(null);
  const hLineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      const wrap = wrapRef.current;
      const v = vLineRef.current;
      const h = hLineRef.current;
      if (!wrap || !v || !h) return;
      const s = pointerStore.get();
      if (!s) {
        wrap.style.display = 'none';
        return;
      }
      wrap.style.display = 'block';
      v.style.left = `${s.screenX}px`;
      h.style.top = `${s.screenY}px`;
    };
    update();
    return pointerStore.subscribe(update);
  }, [pointerStore]);

  return (
    <div
      ref={wrapRef}
      style={{ display: 'none' }}
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden mix-blend-difference opacity-40"
    >
      <div ref={vLineRef} className="absolute top-0 bottom-0 border-l border-dashed border-white" />
      <div ref={hLineRef} className="absolute left-0 right-0 border-t border-dashed border-white" />
    </div>
  );
}

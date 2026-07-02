"use client";
import React from 'react';

interface ResizableDividerProps {
  /** Called on every move with the CUMULATIVE horizontal delta (px) since drag start,
   *  so the parent applies it to the width captured at drag start (stable baseline). */
  onResize: (cumulativeDeltaX: number) => void;
  ariaLabel: string;
}

/**
 * A thin draggable vertical splitter between two Schedule-view panels (VS Code-style).
 * Reports the incremental pointer delta so the parent can grow/shrink an adjacent panel
 * and clamp it. Uses window-level pointer listeners attached only for the duration of a
 * drag (fresh closure each drag — no stale-state or re-subscription), consistent with the
 * repo's native-DOM interaction pattern (AGENTS.md §3). Desktop pointer only.
 */
export default function ResizableDivider({ onResize, ariaLabel }: ResizableDividerProps) {
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const move = (ev: PointerEvent) => {
      onResize(ev.clientX - startX);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onPointerDown={handlePointerDown}
      className="group relative w-2 shrink-0 cursor-col-resize self-stretch flex items-center justify-center"
    >
      {/* The visible hairline; thickens/highlights on hover + while dragging. */}
      <span className="w-0.5 h-full rounded-full bg-slate-200 dark:bg-white/10 group-hover:bg-sky-400 group-active:bg-sky-500 transition-colors" />
    </div>
  );
}

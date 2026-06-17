"use client";
import React from 'react';
import type { GanttBarModel } from '@/utils/ganttMath';

interface GanttBarProps {
  bar: GanttBarModel;
  x: number;
  width: number;
  rowHeight: number;
  /** Open the date editor anchored to this bar. */
  onOpen: (rect: DOMRect) => void;
}

/**
 * A single milestone bar on a location's timeline row. Read-only in Phase 3a
 * (no drag) — clicking opens the shared date editor. Overdue slots (past their
 * own planned end, not completed) get a red ring.
 */
export default function GanttBar({ bar, x, width, rowHeight, onOpen }: GanttBarProps) {
  const barH = 18;
  const title =
    `${bar.milestone}: ${bar.plannedStart ?? '—'} → ${bar.plannedEnd ?? '—'} · ${bar.temporalState}` +
    (bar.overdue ? ' · overdue' : '');
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => onOpen(e.currentTarget.getBoundingClientRect())}
      className={`absolute rounded-md text-[10px] font-semibold text-white truncate px-1.5 flex items-center cursor-pointer transition-shadow hover:ring-2 hover:ring-sky-400/70 ${
        bar.overdue ? 'ring-2 ring-red-500' : ''
      }`}
      style={{
        left: x,
        width: Math.max(width, 8),
        top: (rowHeight - barH) / 2,
        height: barH,
        background: bar.color || '#64748b',
        opacity: bar.temporalState === 'completed' ? 1 : 0.92,
      }}
    >
      <span className="truncate [text-shadow:0_1px_1px_rgba(0,0,0,0.35)]">{bar.milestone}</span>
    </button>
  );
}

"use client";
/* eslint-disable @next/next/no-img-element */
import React from 'react';
import { Map as MapIcon, X } from 'lucide-react';
import type { Sheet, Unit } from '@/types/domain';

interface SchedulePlanPanelProps {
  sheet: Sheet | undefined;
  /** The active level's locations (their polygons overlay the plan). */
  units: Unit[];
  /** The Gantt row currently hovered — its polygon lights up. */
  highlightUnitId: string | null;
  onClose: () => void;
}

/**
 * A lightweight floor-plan reference beside the Gantt (Phase 3a: "floor plan
 * present for space-bound authoring"). A plain <img> of the level's converted
 * drawing with an SVG overlay of the traced location polygons — hovering a
 * Gantt row highlights its room, so sequencing decisions keep their spatial
 * context. Deliberately NOT the Konva canvas (no pdf.js worker, no snapping,
 * no editing) — the Interactive Map stays the home for drawing.
 */
export default function SchedulePlanPanel({ sheet, units, highlightUnitId, onClose }: SchedulePlanPanelProps) {
  return (
    <aside className="w-full h-full flex flex-col min-h-0 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-sm">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200 dark:border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          <MapIcon size={15} className="text-sky-500 shrink-0" />
          <span className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{sheet?.sheet_name || 'Floor plan'}</span>
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors" title="Hide floor plan">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-2">
        {sheet?.base_image_url ? (
          <div className="relative">
            <img src={sheet.base_image_url} alt={`${sheet.sheet_name} floor plan`} className="w-full h-auto rounded-lg" />
            {/* polygon_coordinates are 0–1 fractions of the drawing, so a unit viewBox
                stretched over the image maps them 1:1 (non-scaling-stroke keeps borders
                at screen-pixel width). */}
            <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
              {units.map((u) => {
                const coords = u.polygon_coordinates;
                if (!coords || coords.length < 3) return null;
                const highlighted = u.id === highlightUnitId;
                return (
                  <polygon
                    key={u.id}
                    points={coords.map((p) => `${p.pctX},${p.pctY}`).join(' ')}
                    fill={highlighted ? 'rgba(14,165,233,0.45)' : 'rgba(100,116,139,0.14)'}
                    stroke={highlighted ? '#0ea5e9' : 'rgba(100,116,139,0.45)'}
                    strokeWidth={highlighted ? 2 : 1}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-slate-500 text-center px-4">
            This level has no floor plan image yet.
          </div>
        )}
      </div>
      <div className="px-3 py-2 border-t border-slate-200 dark:border-white/10 text-[10px] text-slate-400">
        Reference only — hover a schedule row to locate it. Draw and edit rooms on the Interactive Map.
      </div>
    </aside>
  );
}

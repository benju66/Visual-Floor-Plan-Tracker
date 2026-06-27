'use client';

import React from 'react';
import { DoorOpen, X } from 'lucide-react';
import { OPENING_TYPES, type OpeningType } from '@/types/domain';
import { OPENING_TYPE_LABELS, OPENING_TYPE_RGB, OPENING_TYPE_KEY } from '@/utils/openingEdges';

// Openings session panel (AI Tracing Assist — Phase 4a). The floating control for
// tagging floor-level passages on a room's perimeter: pick the active type, then
// either hold `O` while tracing (the next edge becomes an opening) or — with a saved
// room selected — click its boundary edges to tag/clear. Mirrors the GridlinePanel
// role; all state lives in useWorkbenchStore (AGENTS.md §2).

interface OpeningModePanelProps {
  activeType: OpeningType;
  onActiveTypeChange: (t: OpeningType) => void;
  /** Total tagged openings across the sheet (a quick "is anything tagged?" readout). */
  totalOpenings: number;
  /** The room selected for edit-after, or null (then the hint is the in-draw flow). */
  editingUnitName: string | null;
  onClose: () => void;
}

export default function OpeningModePanel({
  activeType,
  onActiveTypeChange,
  totalOpenings,
  editingUnitName,
  onClose,
}: OpeningModePanelProps) {
  return (
    <div
      className="absolute bottom-4 left-4 z-30 w-64 rounded-2xl border p-3 shadow-xl"
      style={{
        background: 'var(--glass-bg, rgba(255, 255, 255, 0.85))',
        borderColor: 'var(--glass-border, rgba(226, 232, 240, 0.6))',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <DoorOpen size={15} className="text-emerald-500 shrink-0" />
        <span className="text-sm font-bold text-slate-800 dark:text-slate-100">Openings</span>
        <span className="ml-auto text-[11px] text-slate-400">
          {totalOpenings} tagged
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close openings"
          className="p-1 rounded-lg text-slate-400 hover:bg-slate-200/60 dark:hover:bg-white/10"
        >
          <X size={14} />
        </button>
      </div>

      {/* Active-type selector */}
      <div className="grid grid-cols-2 gap-1.5">
        {OPENING_TYPES.map((t) => {
          const active = t === activeType;
          const rgb = OPENING_TYPE_RGB[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => onActiveTypeChange(t)}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                active
                  ? 'text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 border-slate-300/70 dark:border-white/15 hover:bg-slate-100/60 dark:hover:bg-white/5'
              }`}
              style={active ? { background: `rgb(${rgb})`, borderColor: `rgb(${rgb})` } : undefined}
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: active ? '#ffffff' : `rgb(${rgb})` }}
              />
              <span className="truncate">{OPENING_TYPE_LABELS[t]}</span>
              <kbd
                className={`ml-auto px-1 py-0.5 rounded font-mono text-[9px] leading-none ${
                  active ? 'bg-white/25 text-white' : 'bg-slate-200/80 dark:bg-white/10 text-slate-500 dark:text-slate-300'
                }`}
              >
                {OPENING_TYPE_KEY[t]}
              </kbd>
            </button>
          );
        })}
      </div>

      {/* Contextual hint */}
      <p className="mt-2.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
        {editingUnitName ? (
          <>
            Editing <span className="font-semibold text-slate-700 dark:text-slate-200">{editingUnitName}</span> —
            click a boundary edge to set it to <span className="font-semibold">{OPENING_TYPE_LABELS[activeType]}</span>,
            or click a matching one again to clear it.
          </>
        ) : (
          <>
            While tracing, hold a type key (
            <kbd className="px-1 py-0.5 rounded bg-slate-200/80 dark:bg-white/10 font-mono text-[10px]">
              {OPENING_TYPE_KEY[activeType]}
            </kbd>
            ) and click the far jamb — that edge becomes a {OPENING_TYPE_LABELS[activeType].toLowerCase()}. Or select a
            saved room to tag its edges. Tag <span className="font-semibold">all</span> passages on a room.
          </>
        )}
      </p>
    </div>
  );
}

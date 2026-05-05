"use client";
import React from 'react';

/**
 * Pure presentational component — no Zustand imports.
 * Renders the milestone picker button + temporal state select for a unit row.
 *
 * Props:
 *   unit           — the unit object
 *   baseLog        — the current committed log from the server (may be null)
 *   pendingChange  — pendingChanges[unit.id] or undefined
 *   onChooseStatus — (unit, onSelect) => void  — opens the milestone command menu
 *   onLocalUpdate  — (unit, baseLog, state, extraProps) => void
 *   isApplying     — boolean — disables inputs while apply is in-flight
 *   savingUnitId   — string | null — shows spinner when this unit is saving
 *   large          — boolean — larger padding/text for card hero variant
 */
export default function StatusTrigger({
  unit,
  baseLog,
  pendingChange,
  onChooseStatus,
  onLocalUpdate,
  isApplying,
  savingUnitId,
  large = false,
}) {
  const log = pendingChange ? { ...baseLog, temporal_state: pendingChange.state } : baseLog;
  const currentMilestone = pendingChange?.extraProps?.milestoneObj?.name || log?.milestone || '';

  return (
    <div className="flex flex-col sm:flex-row gap-2 w-full">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onChooseStatus?.(unit, (m) =>
            onLocalUpdate(unit, baseLog, pendingChange?.state || log?.temporal_state || 'completed', { milestoneObj: m })
          );
        }}
        disabled={savingUnitId === unit.id || isApplying}
        className={`w-full sm:flex-1 text-left rounded-xl border ${
          pendingChange?.extraProps?.milestoneObj
            ? 'border-amber-400 dark:border-amber-500 ring-2 ring-amber-500/20'
            : 'border-slate-200/80 dark:border-white/10'
        } bg-white/40 dark:bg-black/15 px-3 py-2 text-sm font-medium text-slate-800 dark:text-slate-100 shadow-sm transition hover:bg-white/70 dark:hover:bg-black/25 disabled:opacity-50 ${large ? 'py-3 text-base' : ''}`}
      >
        {currentMilestone || 'Choose status…'}
      </button>

      {currentMilestone && (
        <select
          value={log?.temporal_state || 'completed'}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation();
            onLocalUpdate(unit, baseLog, e.target.value);
          }}
          disabled={savingUnitId === unit.id || isApplying}
          className={`w-full sm:w-auto rounded-xl border ${
            pendingChange?.state && pendingChange.state !== baseLog?.temporal_state
              ? 'border-amber-400 dark:border-amber-500 ring-2 ring-amber-500/20'
              : 'border-slate-200/80 dark:border-white/10'
          } bg-white/60 dark:bg-black/25 px-2 py-2 text-sm font-medium text-slate-800 dark:text-slate-100 shadow-sm outline-none focus:ring-2 focus:ring-blue-500/40 ${large ? 'py-3 text-base' : ''}`}
        >
          <option value="none">No status (Choose status)</option>
          <option value="planned">Planned</option>
          <option value="ongoing">Ongoing</option>
          <option value="completed">Completed</option>
        </select>
      )}
    </div>
  );
}

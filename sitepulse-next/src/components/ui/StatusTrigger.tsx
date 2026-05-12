"use client";
import React from 'react';
import { getTemporalStateStyle } from './FieldStatusAtoms';
import type { Unit, StatusLog, PendingChange, TemporalState, Milestone } from '@/types/domain';

export interface StatusTriggerProps {
  unit: Unit;
  baseLog: StatusLog | null;
  pendingChange?: PendingChange;
  onChooseStatus?: (unit: Unit, onSelect: (m: Partial<Milestone>) => void) => void;
  onLocalUpdate: (unit: Unit, baseLog: StatusLog | null, state: TemporalState, extraProps?: Record<string, any>) => void;
  isApplying?: boolean;
  savingUnitId?: string | null;
  large?: boolean;
}

/**
 * Pure presentational component — no Zustand imports.
 * Renders the milestone picker button + temporal state select for a unit row.
 */
export default function StatusTrigger({
  unit,
  baseLog,
  pendingChange,
  onChooseStatus,
  onLocalUpdate,
  isApplying = false,
  savingUnitId = null,
  large = false,
}: StatusTriggerProps) {
  const log = pendingChange ? { ...baseLog, temporal_state: pendingChange.state } : baseLog;
  const currentMilestone = pendingChange?.extraProps?.milestoneObj?.name || log?.milestone || '';

  return (
    <div className="flex flex-col sm:flex-row gap-2 w-full">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onChooseStatus?.(unit, (m) =>
            onLocalUpdate(unit, baseLog, pendingChange?.state || (log?.temporal_state as TemporalState) || 'completed', { milestoneObj: m })
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
            onLocalUpdate(unit, baseLog, e.target.value as TemporalState);
          }}
          disabled={savingUnitId === unit.id || isApplying}
          className={`w-full sm:w-auto rounded-lg border ${
            pendingChange?.state && pendingChange.state !== baseLog?.temporal_state
              ? 'ring-2 ring-amber-500/50 shadow-[0_0_8px_rgba(245,158,11,0.4)]'
              : ''
          } px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider shadow-sm outline-none focus:ring-2 focus:ring-blue-500/40 cursor-pointer ${large ? 'py-2.5 text-xs' : ''} ${getTemporalStateStyle((log?.temporal_state as TemporalState) || 'none')}`}
        >
          <option value="none">Not Set (Choose status)</option>
          <option value="planned">Planned</option>
          <option value="ongoing">Ongoing</option>
          <option value="completed">Completed</option>
        </select>
      )}
    </div>
  );
}

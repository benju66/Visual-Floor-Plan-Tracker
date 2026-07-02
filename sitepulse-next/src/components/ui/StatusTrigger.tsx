"use client";
import React from 'react';
import { StatusSegments } from './FieldStatusAtoms';
import type { Unit, StatusLog, PendingChange, TemporalState, Activity } from '@/types/domain';

export interface StatusTriggerProps {
  unit: Unit;
  baseLog: StatusLog | null;
  pendingChange?: PendingChange;
  onChooseStatus?: (unit: Unit, onSelect: (m: Partial<Activity>) => void) => void;
  onLocalUpdate: (unit: Unit, baseLog: StatusLog | null, state: TemporalState, extraProps?: Record<string, any>) => void;
  isApplying?: boolean;
  savingUnitId?: string | null;
  large?: boolean;
  /** Control rendered inline to the right of the status segments (e.g. the N/A toggle). */
  statusTrailing?: React.ReactNode;
}

/**
 * Pure presentational component — no Zustand imports.
 * Renders the activity picker button + temporal state select for a unit row.
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
  statusTrailing,
}: StatusTriggerProps) {
  const log = pendingChange ? { ...baseLog, temporal_state: pendingChange.state } : baseLog;
  const currentActivity = pendingChange?.extraProps?.activityObj?.name || log?.activityName || '';

  return (
    <div className="flex flex-col gap-2 w-full">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onChooseStatus?.(unit, (m) =>
            onLocalUpdate(unit, baseLog, pendingChange?.state || (log?.temporal_state as TemporalState) || 'completed', { activityObj: m })
          );
        }}
        disabled={savingUnitId === unit.id || isApplying}
        className={`w-full text-left rounded-xl border ${
          pendingChange?.extraProps?.activityObj
            ? 'border-amber-400 dark:border-amber-500 ring-2 ring-amber-500/20'
            : 'border-slate-200/80 dark:border-white/10'
        } bg-white/40 dark:bg-black/15 px-3 py-2 text-sm font-medium text-slate-800 dark:text-slate-100 shadow-sm transition hover:bg-white/70 dark:hover:bg-black/25 disabled:opacity-50 ${large ? 'py-3 text-base' : ''}`}
      >
        {currentActivity || 'Choose status…'}
      </button>

      {currentActivity && (
        <div className="flex items-center gap-2">
          <StatusSegments
            value={(log?.temporal_state as TemporalState) || 'none'}
            onChange={(s) => onLocalUpdate(unit, baseLog, s as TemporalState)}
            disabled={savingUnitId === unit.id || isApplying}
            pending={!!pendingChange && pendingChange.state !== baseLog?.temporal_state}
            size={large ? 'lg' : 'sm'}
            ariaLabel={`Status for ${currentActivity}`}
          />
          {statusTrailing}
        </div>
      )}
    </div>
  );
}

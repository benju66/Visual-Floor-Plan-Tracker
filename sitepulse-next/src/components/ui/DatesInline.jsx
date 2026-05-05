"use client";
import React from 'react';

/**
 * Pure presentational component — no Zustand imports.
 * Renders planned start / planned finish / actual complete date inputs for a unit.
 *
 * Props:
 *   unit          — the unit object
 *   baseLog       — the current committed log from the server (may be null)
 *   pendingChange — pendingChanges[unit.id] or undefined
 *   onLocalUpdate — (unit, baseLog, state, extraProps) => void
 *   isApplying    — boolean — disables inputs while apply is in-flight
 */
export default function DatesInline({ unit, baseLog, pendingChange, onLocalUpdate, isApplying }) {
  if (!baseLog) return null;

  const log = pendingChange
    ? {
        ...baseLog,
        planned_start_date:
          pendingChange.extraProps?.startDate !== undefined
            ? pendingChange.extraProps.startDate
            : baseLog.planned_start_date,
        planned_end_date:
          pendingChange.extraProps?.endDate !== undefined
            ? pendingChange.extraProps.endDate
            : baseLog.planned_end_date,
        logged_date:
          pendingChange.extraProps?.loggedDate !== undefined
            ? pendingChange.extraProps.loggedDate
            : baseLog.logged_date,
        temporal_state: pendingChange.state || baseLog.temporal_state,
      }
    : baseLog;

  return (
    <div className="flex flex-row flex-wrap items-center gap-2 mt-2 pt-2 border-t border-slate-200/50 dark:border-white/5">
      <label className="flex flex-col flex-1 min-w-[120px]">
        <span className="text-[10px] text-slate-500 font-semibold uppercase mb-0.5">Planned Start</span>
        <input
          type="date"
          value={log.planned_start_date || ''}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) =>
            onLocalUpdate(unit, baseLog, pendingChange?.state || log.temporal_state, {
              startDate: e.target.value,
              endDate: log.planned_end_date,
            })
          }
          disabled={isApplying}
          className={`bg-transparent border ${
            pendingChange?.extraProps?.startDate !== undefined
              ? 'border-amber-400 dark:border-amber-500 text-amber-600 dark:text-amber-400'
              : 'border-slate-300 dark:border-white/10'
          } rounded px-2 py-1 text-xs font-medium outline-none hover:bg-slate-100 dark:hover:bg-slate-800 focus:ring-2 focus:ring-blue-500/40`}
        />
      </label>

      <label className="flex flex-col flex-1 min-w-[120px]">
        <span className="text-[10px] text-slate-500 font-semibold uppercase mb-0.5">Planned Finish</span>
        <input
          type="date"
          value={log.planned_end_date || ''}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) =>
            onLocalUpdate(unit, baseLog, pendingChange?.state || log.temporal_state, {
              startDate: log.planned_start_date,
              endDate: e.target.value,
            })
          }
          disabled={isApplying}
          className={`bg-transparent border ${
            pendingChange?.extraProps?.endDate !== undefined
              ? 'border-amber-400 dark:border-amber-500 text-amber-600 dark:text-amber-400'
              : 'border-slate-300 dark:border-white/10'
          } rounded px-2 py-1 text-xs font-medium outline-none hover:bg-slate-100 dark:hover:bg-slate-800 focus:ring-2 focus:ring-blue-500/40`}
        />
      </label>

      {log.temporal_state === 'completed' && (
        <div className="flex flex-col flex-1 min-w-[120px]">
          <span className="text-[10px] text-slate-500 font-semibold uppercase mb-0.5">Actual Complete</span>
          <input
            type="date"
            value={log.logged_date || ''}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              onLocalUpdate(unit, baseLog, pendingChange?.state || log.temporal_state, {
                startDate: log.planned_start_date,
                endDate: log.planned_end_date,
                loggedDate: e.target.value,
              })
            }
            disabled={isApplying}
            className={`bg-transparent border ${
              pendingChange?.extraProps?.loggedDate !== undefined
                ? 'border-amber-400 dark:border-amber-500 text-amber-600 dark:text-amber-400'
                : 'border-slate-300 dark:border-white/10'
            } rounded px-2 py-1 text-xs font-bold ${
              !pendingChange?.extraProps?.loggedDate ? 'text-emerald-600 dark:text-emerald-400' : ''
            } outline-none hover:bg-slate-100 dark:hover:bg-slate-800 focus:ring-2 focus:ring-blue-500/40`}
          />
        </div>
      )}
    </div>
  );
}

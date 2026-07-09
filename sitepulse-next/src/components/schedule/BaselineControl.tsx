"use client";
import React, { useMemo, useState } from 'react';
import { Flag, Camera, Trash2 } from 'lucide-react';
import { useAllProjectUnits, useAllProjectStatuses, useCurrentUserRole } from '@/hooks/useProjectQueries';
import { useScheduleBaselines, useSetScheduleBaseline, useDeleteScheduleBaseline } from '@/hooks/useScheduleBaselines';
import { buildBaselineSnapshot, resolveCurrentBaseline } from '@/utils/scheduleBaseline';
import { useUIStore } from '@/store/useUIStore';
import type { Sheet } from '@/types/domain';

/** Baseline capture/delete is privileged, matching the schedule_baselines RLS
 *  INSERT/DELETE policy (owner/admin/pm — never anon). */
const PRIVILEGED = new Set(['owner', 'admin', 'pm']);

interface BaselineControlProps {
  projectId: string;
  /** Sheets supply the level layer of the snapshot (their `activity_schedules`). */
  sheets: Pick<Sheet, 'id' | 'activity_schedules'>[];
  /**
   * Whether to load the all-project statuses a capture needs. Default true; pass
   * a modal's `open` flag when embedding so a closed surface stays idle.
   */
  active?: boolean;
  className?: string;
}

/**
 * The first-class "current baseline" control (Band vs Promise — Phase 3).
 *
 * A baseline only has value if it's actually captured, so this surfaces capture
 * OUTSIDE the MSP importer — a plain, always-reachable strip that shows the
 * current baseline's name + capture date, or an honest "no baseline yet" empty
 * state with the capture button inline. Reuses the existing `schedule_baselines`
 * hooks + the pure `buildBaselineSnapshot`/`resolveCurrentBaseline` math (never
 * a fork). Online-first + append-only by contract; a bad baseline is fixed by
 * delete + re-capture, never edited. v1 uses the NEWEST baseline as the current
 * one (no picker).
 */
export default function BaselineControl({ projectId, sheets, active = true, className }: BaselineControlProps) {
  const setToast = useUIStore((s) => s.setToast);
  const { data: role } = useCurrentUserRole(projectId);
  const canCapture = !!role && PRIVILEGED.has(role);

  const { data: baselines = [] } = useScheduleBaselines(projectId);
  const current = useMemo(() => resolveCurrentBaseline(baselines), [baselines]);

  const setBaseline = useSetScheduleBaseline(projectId);
  const deleteBaseline = useDeleteScheduleBaseline(projectId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Capturing snapshots the whole-project plan (both layers). Only privileged
  // users can capture, so only they pay for the all-levels fetch — and the
  // button is held until it lands so a premature click can't snapshot an empty
  // location layer. Same query keys as the importer/Gantt all-levels scope, so
  // this shares their cache rather than double-fetching.
  const loadPlan = active && canCapture;
  const sheetIds = useMemo(() => sheets.map((s) => s.id), [sheets]);
  const unitsQuery = useAllProjectUnits(loadPlan ? sheetIds : []);
  const unitIds = useMemo(() => (unitsQuery.data ?? []).map((u) => u.id), [unitsQuery.data]);
  const statusesQuery = useAllProjectStatuses(loadPlan ? unitIds : []);
  // Ready once the enabled queries have finished their initial load. A disabled
  // query (no units → no location layer) reports isLoading:false, which is
  // correct — the sheets' level layer still forms a valid baseline.
  const planReady = loadPlan && sheetIds.length > 0 && !unitsQuery.isLoading && !statusesQuery.isLoading;

  const handleCapture = async () => {
    if (!planReady) return;
    try {
      const snapshot = buildBaselineSnapshot({ sheets, statuses: statusesQuery.data ?? [], track: 'all' });
      await setBaseline.mutateAsync({ name: 'Baseline', track: 'all', snapshot });
      setToast({ message: 'Baseline captured — the current plan is now the reference for drift.', type: 'success' });
    } catch (err) {
      setToast({ message: (err as Error)?.message || 'Could not capture the baseline.', type: 'error' });
    }
  };

  const handleDelete = async () => {
    if (!current) return;
    try {
      await deleteBaseline.mutateAsync(current.row.id);
      setToast({ message: 'Baseline removed.', type: 'success' });
    } catch (err) {
      setToast({ message: (err as Error)?.message || 'Could not remove the baseline.', type: 'error' });
    } finally {
      setConfirmingDelete(false);
    }
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 ${className ?? ''}`}>
      <Flag size={12} className="shrink-0 text-slate-400" />
      {current ? (
        <span>
          Current baseline: <b className="text-slate-600 dark:text-slate-300">{current.row.name}</b> · captured{' '}
          {new Date(current.row.created_at).toLocaleDateString()}
        </span>
      ) : (
        <span>
          {canCapture
            ? 'No baseline captured — snapshot the current plan to track drift.'
            : 'No baseline captured yet.'}
        </span>
      )}

      {canCapture && (
        <button
          type="button"
          disabled={setBaseline.isPending || !planReady}
          onClick={handleCapture}
          title={current ? 'Snapshot the current plan as a new baseline' : 'Snapshot the current plan as your baseline'}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-600 text-[11px] font-semibold py-1 px-2 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-50"
        >
          <Camera size={12} />
          {setBaseline.isPending ? 'Capturing…' : !planReady ? 'Preparing…' : current ? 'Recapture' : 'Capture baseline'}
        </button>
      )}

      {canCapture && current && (
        confirmingDelete ? (
          <span className="inline-flex items-center gap-1">
            <button
              type="button"
              disabled={deleteBaseline.isPending}
              onClick={handleDelete}
              className="inline-flex items-center gap-1 rounded-md border border-rose-300 dark:border-rose-500/50 text-rose-600 dark:text-rose-400 text-[11px] font-bold py-1 px-2 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50"
            >
              {deleteBaseline.isPending ? 'Removing…' : 'Remove baseline?'}
            </button>
            <button
              type="button"
              disabled={deleteBaseline.isPending}
              onClick={() => setConfirmingDelete(false)}
              className="text-[11px] font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 py-1 px-1"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            title="Remove the current baseline (fix a mis-captured one, then re-capture)"
            onClick={() => setConfirmingDelete(true)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-600 text-[11px] font-semibold py-1 px-2 hover:bg-slate-100 dark:hover:bg-white/10"
          >
            <Trash2 size={12} /> Remove
          </button>
        )
      )}
    </div>
  );
}

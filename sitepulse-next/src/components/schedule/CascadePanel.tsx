"use client";
import React, { useEffect, useMemo, useState } from 'react';
import { X, ArrowDownToLine, Save } from 'lucide-react';
import { useUpdateSheetSchedule, useBulkInsertStatusLogs } from '@/hooks/useProjectQueries';
import { useUIStore } from '@/store/useUIStore';
import { orderedTrackMilestones } from '@/utils/progressAnalytics';
import { cascadeLevelToLocations } from '@/utils/ganttMath';
import type { ApplicabilityIndex } from '@/utils/applicability';
import type { Sheet, Milestone, Unit, StatusLog, MilestoneSchedules } from '@/types/domain';

interface CascadePanelProps {
  open: boolean;
  onClose: () => void;
  /** The active level — cascade always targets this level's locations. */
  sheet: Sheet | undefined;
  milestones: Milestone[];
  track: string;
  /** Active-level units + their current-state logs. */
  units: Unit[];
  existing: StatusLog[];
  applicabilityIndex: ApplicabilityIndex;
  projectId: string;
}

/**
 * Level → location date cascade (Phase 3a). Edit a level's per-milestone default
 * dates (`sheets.milestone_schedules`) and flow them down to its locations.
 * Non-destructive by default (only fills locations without their own dates);
 * an explicit toggle overwrites. Writes are online via the existing hooks.
 */
export default function CascadePanel({
  open,
  onClose,
  sheet,
  milestones,
  track,
  units,
  existing,
  applicabilityIndex,
  projectId,
}: CascadePanelProps) {
  const setToast = useUIStore((s) => s.setToast);
  const updateSheetSchedule = useUpdateSheetSchedule(projectId);
  const bulkInsert = useBulkInsertStatusLogs(sheet?.id || '');

  const [draft, setDraft] = useState<MilestoneSchedules>({});
  const [overrideExisting, setOverrideExisting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  // Seed the draft from the level's saved defaults whenever it opens / changes level.
  useEffect(() => {
    if (!open || !sheet) return;
    setDraft(((sheet.activity_schedules as MilestoneSchedules) || {}) as MilestoneSchedules);
    setConfirming(false);
    setOverrideExisting(false);
  }, [open, sheet]);

  const trackMs = useMemo(() => orderedTrackMilestones(milestones, track), [milestones, track]);

  const writes = useMemo(() => {
    if (!sheet) return [];
    return cascadeLevelToLocations({
      levelSchedule: draft,
      units: units.map((u) => ({ id: u.id, unit_type: u.unit_type })),
      milestones,
      track,
      existing,
      overrideExisting,
      applicabilityIndex,
    });
  }, [sheet, draft, units, milestones, track, existing, overrideExisting, applicabilityIndex]);

  const affectedUnits = useMemo(() => new Set(writes.map((w) => w.unit_id)).size, [writes]);

  if (!open) return null;

  const updateDraft = (name: string, field: 'start_date' | 'end_date', value: string) => {
    setDraft((prev) => ({ ...prev, [name]: { ...prev[name], [field]: value || null } }));
    setConfirming(false);
  };

  const saveDefaults = () => {
    if (!sheet) return;
    updateSheetSchedule.mutate({ sheetId: sheet.id, activity_schedules: draft });
    setToast({ message: 'Level dates saved.', type: 'success' });
  };

  const applyCascade = async () => {
    if (!sheet || writes.length === 0) return;
    setBusy(true);
    try {
      // Persist the level defaults that were just applied, then write the slots.
      await updateSheetSchedule.mutateAsync({ sheetId: sheet.id, activity_schedules: draft });
      await bulkInsert.mutateAsync(writes as unknown as StatusLog[]);
      setToast({ message: `Applied to ${affectedUnits} location${affectedUnits === 1 ? '' : 's'}.`, type: 'success' });
      onClose();
    } catch (err) {
      setToast({ message: (err as Error)?.message || 'Cascade failed.', type: 'error' });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const inputCls =
    'rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" role="presentation" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border p-6 shadow-2xl glass-panel max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <div>
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Level schedule — {sheet?.sheet_name || '—'}</h3>
            <p className="text-xs text-slate-500 mt-0.5">Set default dates per milestone, then apply them down to this level’s locations.</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto mt-3 -mx-1 px-1">
          {trackMs.length === 0 ? (
            <div className="text-sm text-slate-500 py-6 text-center">No milestones on the {track} track.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-slate-400 text-left">
                  <th className="py-1.5 font-semibold">Milestone</th>
                  <th className="py-1.5 font-semibold">Start</th>
                  <th className="py-1.5 font-semibold">End</th>
                </tr>
              </thead>
              <tbody>
                {trackMs.map((m) => {
                  const entry = draft[m.name] || {};
                  return (
                    <tr key={m.id} className="border-t border-slate-100 dark:border-white/5">
                      <td className="py-1.5 pr-3">
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: m.color }} />
                          <span className="font-semibold text-slate-700 dark:text-slate-200">{m.name}</span>
                        </span>
                      </td>
                      <td className="py-1.5 pr-2">
                        <input type="date" value={entry.start_date || ''} onChange={(e) => updateDraft(m.name, 'start_date', e.target.value)} className={inputCls} />
                      </td>
                      <td className="py-1.5">
                        <input type="date" value={entry.end_date || ''} onChange={(e) => updateDraft(m.name, 'end_date', e.target.value)} className={inputCls} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-slate-200 dark:border-white/10">
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 mb-3 cursor-pointer">
            <input type="checkbox" checked={overrideExisting} onChange={(e) => { setOverrideExisting(e.target.checked); setConfirming(false); }} />
            Overwrite locations that already have their own dates
          </label>

          {confirming ? (
            <div className="flex items-center gap-2 rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-500/60 px-3 py-2">
              <span className="text-sm font-semibold text-amber-800 dark:text-amber-200 mr-auto">
                Apply {writes.length} milestone date{writes.length === 1 ? '' : 's'} across {affectedUnits} location{affectedUnits === 1 ? '' : 's'}
                {overrideExisting ? ' (overwriting existing)' : ' (only empty ones)'}?
              </span>
              <button type="button" disabled={busy} onClick={applyCascade} className="rounded-md bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold py-1.5 px-3 disabled:opacity-60">
                {busy ? 'Applying…' : 'Confirm'}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="rounded-md border border-slate-300 dark:border-slate-600 text-xs font-semibold py-1.5 px-3">
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button type="button" onClick={saveDefaults} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 dark:border-slate-600 text-xs font-semibold py-1.5 px-3 hover:bg-slate-100 dark:hover:bg-white/10">
                <Save size={14} /> Save level dates
              </button>
              <span className="text-xs text-slate-400 mr-auto">
                {writes.length === 0 ? 'Nothing to apply yet' : `${writes.length} date${writes.length === 1 ? '' : 's'} · ${affectedUnits} location${affectedUnits === 1 ? '' : 's'}`}
              </span>
              <button
                type="button"
                disabled={writes.length === 0}
                onClick={() => setConfirming(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold py-1.5 px-3 disabled:opacity-50"
              >
                <ArrowDownToLine size={14} /> Apply to locations
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

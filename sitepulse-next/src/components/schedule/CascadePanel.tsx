"use client";
import React, { useEffect, useMemo, useState } from 'react';
import { X, ArrowDownToLine, Save } from 'lucide-react';
import { useUpdateSheetSchedule, useBulkInsertStatusLogs } from '@/hooks/useProjectQueries';
import { useActivityDependencies } from '@/hooks/useActivityDependencies';
import { useUIStore } from '@/store/useUIStore';
import { orderedTrackActivities } from '@/utils/progressAnalytics';
import { reflowLevelToLocations, cascadeFillCounts, deriveDuration } from '@/utils/ganttMath';
import { chainLevelSchedule } from '@/utils/dateRipple';
import type { DistributionMode } from '@/utils/scheduleReconcile';
import type { ApplicabilityIndex } from '@/utils/applicability';
import type { Sheet, Activity, Unit, StatusLog, ActivitySchedules } from '@/types/domain';

interface CascadePanelProps {
  open: boolean;
  onClose: () => void;
  /** The active level — cascade always targets this level's locations. */
  sheet: Sheet | undefined;
  activities: Activity[];
  track: string;
  /** Active-level units + their current-state logs. */
  units: Unit[];
  existing: StatusLog[];
  applicabilityIndex: ApplicabilityIndex;
  projectId: string;
}

/**
 * Level → location date cascade (Phase 3a). Edit a level's per-activity default
 * dates (`sheets.activity_schedules`) and flow them down to its locations.
 * Non-destructive by default (only fills locations without their own dates);
 * an explicit toggle overwrites. Writes are online via the existing hooks.
 */
export default function CascadePanel({
  open,
  onClose,
  sheet,
  activities,
  track,
  units,
  existing,
  applicabilityIndex,
  projectId,
}: CascadePanelProps) {
  const setToast = useUIStore((s) => s.setToast);
  const updateSheetSchedule = useUpdateSheetSchedule(projectId);
  const bulkInsert = useBulkInsertStatusLogs(sheet?.id || '');
  // FS edges — only ripple_dates-opted links chain level windows (Phase 3).
  const { data: dependencies = [] } = useActivityDependencies(projectId);

  const [draft, setDraft] = useState<ActivitySchedules>({});
  const [overrideExisting, setOverrideExisting] = useState(false);
  // Unified Schedule Engine Phase 1: how the level window lands on locations.
  // 'subdivide' = crew-flow stagger (default, mirroring the importer's default);
  // 'envelope' = the pre-Phase-1 behavior (same window everywhere).
  const [flowMode, setFlowMode] = useState<DistributionMode>('subdivide');
  // Activities whose level window was PUSHED by a predecessor edit (Phase 3) —
  // flagged in their rows so the chain is visible before confirming.
  const [chainedNames, setChainedNames] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  // The level's SAVED plan — the provenance baseline for the re-flow (a slot
  // matching what THIS plan produced is cascade-owned and safe to re-stagger).
  const savedSchedule = useMemo(
    () => ((sheet?.activity_schedules as ActivitySchedules) || {}) as ActivitySchedules,
    [sheet]
  );

  // Seed the draft from the level's saved defaults whenever it opens / changes level.
  useEffect(() => {
    if (!open || !sheet) return;
    setDraft(((sheet.activity_schedules as ActivitySchedules) || {}) as ActivitySchedules);
    setConfirming(false);
    setOverrideExisting(false);
    setFlowMode('subdivide');
    setChainedNames(new Set());
  }, [open, sheet]);

  const trackMs = useMemo(() => orderedTrackActivities(activities, track), [activities, track]);

  const { writes, preservedHandEdits } = useMemo(() => {
    if (!sheet) return { writes: [], preservedHandEdits: 0 };
    return reflowLevelToLocations({
      levelSchedule: draft,
      savedSchedule,
      // Crew-flow fields ride along so 'subdivide' can order (walk_sequence →
      // numeric unit_number) and weight (computed_area) the stagger.
      units: units.map((u) => ({
        id: u.id,
        unit_type: u.unit_type,
        unit_number: u.unit_number,
        walk_sequence: u.walk_sequence,
        computed_area: u.computed_area,
      })),
      activities,
      track,
      existing,
      overrideExisting,
      applicabilityIndex,
      flowMode,
    });
  }, [sheet, draft, savedSchedule, units, activities, track, existing, overrideExisting, applicabilityIndex, flowMode]);

  const affectedUnits = useMemo(() => new Set(writes.map((w) => w.unit_id)).size, [writes]);

  // Per-activity "already dated vs could be filled" counts (Phase 2) — makes the
  // two layers legible: the level plan above, what it lands on below.
  const fillCounts = useMemo(() => {
    return cascadeFillCounts({
      units: units.map((u) => ({
        id: u.id,
        unit_type: u.unit_type,
        unit_number: u.unit_number,
        walk_sequence: u.walk_sequence,
        computed_area: u.computed_area,
      })),
      activities,
      track,
      existing,
      applicabilityIndex,
    });
  }, [units, activities, track, existing, applicabilityIndex]);

  if (!open) return null;

  const updateDraft = (name: string, field: 'start_date' | 'end_date', value: string) => {
    const next = { ...draft, [name]: { ...draft[name], [field]: value || null } };
    // Chain FS successors' level windows (ripple_dates-opted edges only) so
    // dependent rows visibly move BEFORE the count-confirm (Phase 3).
    const { schedule, chained } = chainLevelSchedule({
      saved: savedSchedule,
      draft: next,
      activities,
      track,
      edges: dependencies,
    });
    setDraft(schedule);
    setChainedNames(new Set(chained.map((c) => c.name)));
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
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Level plan — {sheet?.sheet_name || '—'}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Plan each activity&rsquo;s window here → it flows down to this level&rsquo;s {units.length} location{units.length === 1 ? '' : 's'}.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto mt-3 -mx-1 px-1">
          {trackMs.length === 0 ? (
            <div className="text-sm text-slate-500 py-6 text-center">No activities on the {track} track.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-slate-400 text-left">
                  <th className="py-1.5 font-semibold">Activity</th>
                  <th className="py-1.5 font-semibold">Start</th>
                  <th className="py-1.5 font-semibold">End</th>
                  <th className="py-1.5 font-semibold pl-2">Duration</th>
                  <th className="py-1.5 font-semibold pl-2">Locations</th>
                </tr>
              </thead>
              <tbody>
                {trackMs.map((m) => {
                  const entry = draft[m.name] || {};
                  const duration = deriveDuration(entry.start_date, entry.end_date);
                  const fill = fillCounts[m.name];
                  const willFill = fill ? (overrideExisting ? fill.applicable : fill.applicable - fill.dated) : 0;
                  const hasWindow = !!(entry.start_date || entry.end_date);
                  return (
                    <tr key={m.id} className="border-t border-slate-100 dark:border-white/5">
                      <td className="py-1.5 pr-3">
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: m.color }} />
                          <span className="font-semibold text-slate-700 dark:text-slate-200">{m.name}</span>
                          {chainedNames.has(m.name) && (
                            <span className="text-[10px] font-semibold text-sky-600 dark:text-sky-400" title="This window was pushed by its predecessor's change (Finish-to-Start link with date ripple on)">
                              ↳ chained
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2">
                        {/* max/min keep the window forward-only: start can't be after end, end can't be before start. */}
                        <input type="date" value={entry.start_date || ''} max={entry.end_date || undefined} onChange={(e) => updateDraft(m.name, 'start_date', e.target.value)} className={inputCls} />
                      </td>
                      <td className="py-1.5">
                        <input type="date" value={entry.end_date || ''} min={entry.start_date || undefined} onChange={(e) => updateDraft(m.name, 'end_date', e.target.value)} className={inputCls} />
                      </td>
                      {/* Derived, never typed: end − start IS the duration (inclusive days). */}
                      <td className="py-1.5 pl-2 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap tabular-nums">
                        {duration != null ? `${duration} day${duration === 1 ? '' : 's'}` : '—'}
                      </td>
                      {/* The lower layer made visible: how many locations already carry
                          their own dates, and how many this window would fill. */}
                      <td className="py-1.5 pl-2 text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap tabular-nums">
                        {fill && fill.applicable > 0 ? (
                          <>
                            {fill.dated}/{fill.applicable} dated
                            {hasWindow && willFill > 0 && (
                              <span className="text-sky-600 dark:text-sky-400 font-semibold"> · fills {willFill}</span>
                            )}
                          </>
                        ) : '—'}
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
          {/* Flow mode (Unified Schedule Engine Phase 1) — mirrors the importer's control. */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-3 text-xs text-slate-600 dark:text-slate-300">
            <div className="flex rounded-lg border border-slate-300/80 dark:border-white/15 overflow-hidden">
              {([
                { key: 'subdivide', label: 'Spread across locations' },
                { key: 'envelope', label: 'Same window for every location' },
              ] as { key: DistributionMode; label: string }[]).map((m, i) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => { setFlowMode(m.key); setConfirming(false); }}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                    flowMode === m.key
                      ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                      : 'bg-white/70 dark:bg-black/20 hover:bg-slate-100 dark:hover:bg-white/10'
                  } ${i > 0 ? 'border-l border-slate-300/80 dark:border-white/10' : ''}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          {flowMode === 'subdivide' && (
            <p className="text-[10px] text-slate-400 mb-3">
              Each activity&rsquo;s window is divided across this level&rsquo;s locations in walk order — weighted by room area when every room has a measured area, split evenly otherwise.
            </p>
          )}
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 mb-3 cursor-pointer">
            <input type="checkbox" checked={overrideExisting} onChange={(e) => { setOverrideExisting(e.target.checked); setConfirming(false); }} />
            Overwrite locations that already have their own dates
          </label>

          {confirming ? (
            <div className="flex items-center gap-2 rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-500/60 px-3 py-2">
              <span className="text-sm font-semibold text-amber-800 dark:text-amber-200 mr-auto">
                Apply {writes.length} activity date{writes.length === 1 ? '' : 's'} across {affectedUnits} location{affectedUnits === 1 ? '' : 's'}
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
              {/* Quiet secondary (owner decision, Phase 2): persist the level plan
                  WITHOUT touching any location dates — for drafting ahead. */}
              <button type="button" onClick={saveDefaults} className="inline-flex items-center gap-1.5 rounded-md text-xs font-medium py-1.5 px-2.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-white/10">
                <Save size={13} /> Save dates only
              </button>
              <span className="text-xs text-slate-400 mr-auto">
                {writes.length === 0 ? 'Nothing to apply yet' : `${writes.length} date${writes.length === 1 ? '' : 's'} · ${affectedUnits} location${affectedUnits === 1 ? '' : 's'}`}
                {preservedHandEdits > 0 && (
                  <span className="text-emerald-600 dark:text-emerald-400"> · {preservedHandEdits} hand-edited kept</span>
                )}
              </span>
              <button
                type="button"
                disabled={writes.length === 0}
                onClick={() => setConfirming(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold py-1.5 px-3 disabled:opacity-50"
              >
                <ArrowDownToLine size={14} /> Save &amp; apply to locations
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

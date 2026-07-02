"use client";
import React, { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X, FileUp, Flag, CheckCircle2, AlertTriangle, ArrowRight, Plus, ListPlus } from 'lucide-react';
import {
  useAllProjectUnits,
  useAllProjectStatuses,
  useBulkInsertStatusLogs,
} from '@/hooks/useProjectQueries';
import { useActivityDictionary, useProposePendingActivity } from '@/hooks/useActivityDictionary';
import { resolveActivityByName, activityPickToFields, type ActivityPickResult } from '@/utils/activityDictionary';
import ActivityDictionaryField from '@/components/ActivityDictionaryField';
import { useUIStore } from '@/store/useUIStore';
import { parseMspXml, leafTasks, type MspParseResult, type MspTask } from '@/utils/mspImport';
import {
  matchTasksToActivities,
  suggestSheetForTask,
  buildImportWrites,
  type DistributionMode,
  type ImportAssignment,
  type MatchKind,
  type TargetUnit,
} from '@/utils/scheduleReconcile';
import type { ApplicabilityIndex } from '@/utils/applicability';
import type { Sheet, Milestone, StatusLog, Unit, ActivityDictionaryEntry, ActivityType } from '@/types/domain';

interface MspImportPanelProps {
  open: boolean;
  onClose: () => void;
  sheets: Sheet[];
  /** The project's activities (page.jsx still names them milestones). */
  milestones: Milestone[];
  applicabilityIndex: ApplicabilityIndex;
  activeSheetId: string;
  /** Add a missing activity inline (dictionary-backed), so an unmatched task can be
   *  mapped without leaving the importer. Same handler the Activities panel uses. */
  onAddMilestone?: (name: string, color: string, track: string, dictionaryId?: string | null) => void;
}

/** Per-imported-task reconciliation state (the human-adjustable mapping). */
interface RowState {
  activityId: string | null;
  /** Target sheet id, 'all' for every level, or null (unassigned). */
  sheetId: string | null;
  include: boolean;
  /** How the auto-match found the activity; null once the human overrides. */
  matchKind: MatchKind | null;
}

const ALL_LEVELS = 'all';

/**
 * MS Project import → reconciliation → planned dates (Scheduling Foundation
 * Slice A, Phase 4b). Drop an MSPDI `.xml` export in, match each imported task
 * to one of the project's activities (aliases auto-match most), pick the
 * levels/locations it covers, and write the planned windows onto those
 * locations' status slots — through the SAME `useBulkInsertStatusLogs` upsert
 * the level cascade uses (never plain insert, never the offline queue).
 * Non-destructive by default and gated behind an explicit
 * "N dates across M locations" confirmation, mirroring CascadePanel.
 */
export default function MspImportPanel({
  open,
  onClose,
  sheets,
  milestones,
  applicabilityIndex,
  activeSheetId,
  onAddMilestone,
}: MspImportPanelProps) {
  const setToast = useUIStore((s) => s.setToast);
  const queryClient = useQueryClient();
  const bulkInsert = useBulkInsertStatusLogs(activeSheetId);
  const { data: dictionary = [] } = useActivityDictionary();
  const proposePendingActivity = useProposePendingActivity();

  // Inline "add a missing activity" (Phase 4) — dictionary-backed, mirrors the Activities
  // panel's add flow so an unmatched imported task can be mapped without leaving.
  const [showAddActivity, setShowAddActivity] = useState(false);
  const [addName, setAddName] = useState('');
  const [addEntry, setAddEntry] = useState<ActivityDictionaryEntry | null>(null);
  const [addTrack, setAddTrack] = useState('');
  const existingTracks = useMemo(() => [...new Set(milestones.map((m) => m.track))], [milestones]);

  const handleAddActivity = async () => {
    const trimmed = addName.trim();
    if (!trimmed || !onAddMilestone) return;
    const picked =
      addEntry && addEntry.name.trim().toLowerCase() === trimmed.toLowerCase()
        ? addEntry
        : resolveActivityByName(dictionary, trimmed);
    const result: ActivityPickResult = picked
      ? { kind: 'entry', dictionaryId: picked.id, name: picked.name, track: picked.track, type: picked.type as ActivityType }
      : { kind: 'pending', name: trimmed, track: null };
    const fields = await activityPickToFields(result, (vars) => proposePendingActivity.mutateAsync(vars));
    onAddMilestone(fields.name, '#3b82f6', addTrack.trim() || existingTracks[0] || 'Production', fields.dictionary_id);
    setAddName('');
    setAddEntry(null);
  };

  // Cross-level targets: the import can span every sheet, so fetch all units +
  // their current-state logs (same hooks/keys the all-levels Gantt scope uses).
  const sheetIds = useMemo(() => sheets.map((s) => s.id), [sheets]);
  const { data: allUnits = [] } = useAllProjectUnits(open ? sheetIds : []);
  const allUnitIds = useMemo(() => allUnits.map((u) => u.id), [allUnits]);
  const { data: allStatuses = [] } = useAllProjectStatuses(open ? allUnitIds : []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parse, setParse] = useState<MspParseResult | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [mode, setMode] = useState<DistributionMode>('subdivide');
  const [overrideExisting, setOverrideExisting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const activityById = useMemo(() => new Map(milestones.map((m) => [m.id, m])), [milestones]);
  const activityOptions = useMemo(
    () => [...milestones].sort((a, b) => (a.track || '').localeCompare(b.track || '') || (a.sequence_order ?? 0) - (b.sequence_order ?? 0)),
    [milestones]
  );

  const leaves: MspTask[] = useMemo(
    () => (parse?.ok ? leafTasks(parse.tasks) : []),
    [parse]
  );

  const unitsBySheet = useMemo(() => {
    const map = new Map<string, Unit[]>();
    for (const u of allUnits) {
      if (!u.sheet_id) continue;
      const arr = map.get(u.sheet_id);
      if (arr) arr.push(u);
      else map.set(u.sheet_id, [u]);
    }
    return map;
  }, [allUnits]);

  const toTarget = (u: Unit): TargetUnit => ({
    id: u.id,
    unit_number: u.unit_number,
    unit_type: u.unit_type,
    computed_area: u.computed_area,
    walk_sequence: u.walk_sequence,
  });

  const handleFile = async (file: File) => {
    const text = await file.text();
    const result = parseMspXml(text);
    setFileName(file.name);
    setParse(result);
    setConfirming(false);
    if (!result.ok) {
      setRows({});
      return;
    }
    const importable = leafTasks(result.tasks);
    const matches = matchTasksToActivities(importable, milestones, dictionary);
    const matchByUid = new Map(matches.map((m) => [m.taskUid, m]));
    const next: Record<string, RowState> = {};
    for (const t of importable) {
      const match = matchByUid.get(t.uid);
      const sheetId = suggestSheetForTask(t, sheets.map((s) => ({ id: s.id, sheet_name: s.sheet_name })));
      const activityId = match?.activityId ?? null;
      next[t.uid] = {
        activityId,
        sheetId,
        include: !!(activityId && sheetId && (t.start || t.finish)),
        matchKind: match?.matchKind ?? null,
      };
    }
    setRows(next);
  };

  const updateRow = (uid: string, patch: Partial<RowState>) => {
    setRows((prev) => {
      const cur = prev[uid];
      if (!cur) return prev;
      const next = { ...cur, ...patch };
      // Picking both sides by hand implies intent to import.
      if ((patch.activityId || patch.sheetId) && next.activityId && next.sheetId) next.include = true;
      if (patch.activityId !== undefined) next.matchKind = null; // human override
      return { ...prev, [uid]: next };
    });
    setConfirming(false);
  };

  // The confirmed mappings → the exact status_logs upserts (pure, recomputed live).
  const assignments: ImportAssignment[] = useMemo(() => {
    const out: ImportAssignment[] = [];
    for (const t of leaves) {
      const row = rows[t.uid];
      if (!row || !row.include || !row.activityId || !row.sheetId) continue;
      const activity = activityById.get(row.activityId);
      if (!activity) continue;
      const units = row.sheetId === ALL_LEVELS ? allUnits : unitsBySheet.get(row.sheetId) || [];
      if (units.length === 0) continue;
      out.push({ task: t, activity, units: units.map(toTarget), mode });
    }
    return out;
  }, [leaves, rows, activityById, allUnits, unitsBySheet, mode]);

  const plan = useMemo(
    () => buildImportWrites(assignments, { existing: allStatuses, overrideExisting, applicabilityIndex }),
    [assignments, allStatuses, overrideExisting, applicabilityIndex]
  );

  const matchedCount = useMemo(
    () => leaves.filter((t) => rows[t.uid]?.activityId).length,
    [leaves, rows]
  );

  if (!open) return null;

  const applyImport = async () => {
    if (plan.writes.length === 0) return;
    setBusy(true);
    try {
      await bulkInsert.mutateAsync(plan.writes as unknown as StatusLog[]);
      // The import can write ACROSS levels; refresh every per-sheet status cache,
      // not just the active one the hook invalidates.
      queryClient.invalidateQueries({ queryKey: ['statuses'] });
      setToast({
        message: `Imported ${plan.writes.length} planned date${plan.writes.length === 1 ? '' : 's'} across ${plan.affectedUnitCount} location${plan.affectedUnitCount === 1 ? '' : 's'}.`,
        type: 'success',
      });
      onClose();
    } catch (err) {
      setToast({ message: (err as Error)?.message || 'Import failed.', type: 'error' });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const inputCls =
    'rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs max-w-full';
  const badge = (kind: MatchKind | null, hasActivity: boolean) => {
    if (!hasActivity) return <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400"><AlertTriangle size={11} /> unmatched</span>;
    if (kind === 'exact') return <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">exact</span>;
    if (kind === 'alias') return <span className="text-[10px] font-bold text-sky-600 dark:text-sky-400">alias</span>;
    if (kind === 'fuzzy') return <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400">close match</span>;
    return <span className="text-[10px] font-bold text-slate-400">manual</span>;
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" role="presentation" onClick={onClose}>
      <div className="w-full max-w-5xl rounded-2xl border p-6 shadow-2xl glass-panel max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* ── Header ── */}
        <div className="flex items-start justify-between mb-1">
          <div>
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Import an MS Project schedule</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Export the schedule from Microsoft Project as <b>XML</b> (MSPDI), match its tasks to your activities, and the planned dates flow onto your locations.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500">
            <X size={18} />
          </button>
        </div>

        {/* ── File chooser ── */}
        <div className="mt-3 flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xml,text/xml,application/xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold py-1.5 px-3"
          >
            <FileUp size={14} /> {parse ? 'Choose a different file' : 'Choose .xml file'}
          </button>
          {fileName && <span className="text-xs text-slate-500 truncate">{fileName}</span>}
          {parse?.ok && (
            <span className="text-xs text-slate-500 ml-auto shrink-0">
              <b>{parse.projectName || 'Untitled schedule'}</b> · {leaves.length} tasks · {matchedCount} matched automatically
            </span>
          )}
        </div>

        {/* ── First-run explainer (before a file is chosen) ── */}
        {!parse && (
          <div className="mt-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/5 p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">How this works</div>
            <ol className="space-y-2.5">
              {[
                { n: 1, t: 'Export from MS Project as XML', d: 'In Microsoft Project: File → Save As → “XML (*.xml)”. Binary .mpp and Primavera .xer aren’t supported.' },
                { n: 2, t: 'Match tasks to your activities', d: 'Each imported task is auto-matched to one of your activities (synonyms are recognised). Fix any from the dropdowns — or add a missing activity right here.' },
                { n: 3, t: 'Pick the levels each task covers', d: 'Choose which level(s)/locations each task applies to — “LEVEL 3” is guessed from the task name.' },
                { n: 4, t: 'Write the planned dates', d: 'Confirm, and each task’s window spreads across its locations as planned start/finish dates — no hand-entry.' },
              ].map((s) => (
                <li key={s.n} className="flex gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-sky-100 dark:bg-sky-500/20 text-sky-600 dark:text-sky-300 text-xs font-bold flex items-center justify-center">{s.n}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{s.t}</div>
                    <div className="text-xs text-slate-500">{s.d}</div>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-[11px] text-slate-400">Nothing is written until you review the mappings and confirm.</p>
          </div>
        )}

        {parse && !parse.ok && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border-2 border-red-400 bg-red-50 dark:bg-red-900/20 dark:border-red-500/60 px-3 py-2 text-sm font-semibold text-red-700 dark:text-red-300">
            <AlertTriangle size={16} className="shrink-0" /> {parse.error}
          </div>
        )}

        {/* ── Reconciliation table ── */}
        {parse?.ok && (
          <div className="flex-1 min-h-0 overflow-auto mt-3 -mx-1 px-1">
            {/* Inline "add a missing activity" — map an unmatched task without leaving */}
            {onAddMilestone && (
              <div className="mb-3 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/5 p-2">
                {!showAddActivity ? (
                  <button type="button" onClick={() => setShowAddActivity(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-600 dark:text-sky-300 hover:underline">
                    <ListPlus size={14} /> Add a missing activity
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex-1 min-w-[200px]">
                      <ActivityDictionaryField value={addName} onChange={setAddName} selectedEntry={addEntry} onSelectEntry={setAddEntry} placeholder="Activity name…" />
                    </div>
                    <input type="text" list="msp-add-tracks" value={addTrack} onChange={(e) => setAddTrack(e.target.value)} placeholder={existingTracks[0] || 'Production'} className="w-32 rounded-lg border border-slate-300 dark:border-white/15 bg-white dark:bg-black/25 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-500/40" />
                    <datalist id="msp-add-tracks">{existingTracks.map((t) => <option key={t} value={t} />)}</datalist>
                    <button type="button" disabled={!addName.trim()} onClick={handleAddActivity} className="inline-flex items-center gap-1 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold py-1.5 px-3 disabled:opacity-40"><Plus size={13} /> Add</button>
                    <button type="button" onClick={() => { setShowAddActivity(false); setAddName(''); setAddEntry(null); }} className="text-xs font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">Done</button>
                  </div>
                )}
              </div>
            )}
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur">
                <tr className="text-[10px] uppercase tracking-wide text-slate-400 text-left">
                  <th className="py-1.5 pr-2 font-semibold w-8"></th>
                  <th className="py-1.5 pr-3 font-semibold">Imported task</th>
                  <th className="py-1.5 pr-2 font-semibold w-6"></th>
                  <th className="py-1.5 pr-3 font-semibold">Activity</th>
                  <th className="py-1.5 pr-3 font-semibold">Level</th>
                  <th className="py-1.5 font-semibold w-24">Match</th>
                </tr>
              </thead>
              <tbody>
                {leaves.map((t) => {
                  const row = rows[t.uid];
                  if (!row) return null;
                  const dateless = !t.start && !t.finish;
                  return (
                    <tr key={t.uid} className={`border-t border-slate-100 dark:border-white/5 ${row.include ? '' : 'opacity-55'}`}>
                      <td className="py-1.5 pr-2 align-top">
                        <input
                          type="checkbox"
                          checked={row.include}
                          disabled={dateless || !row.activityId || !row.sheetId}
                          onChange={(e) => updateRow(t.uid, { include: e.target.checked })}
                          title={dateless ? 'This task has no dates' : undefined}
                        />
                      </td>
                      <td className="py-1.5 pr-3 align-top">
                        <div className="font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5">
                          {t.isMilestone && <Flag size={12} className="text-slate-400 shrink-0" />}
                          {t.name}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {t.path.length > 0 && <span>{t.path[t.path.length - 1]} · </span>}
                          {dateless ? 'no dates' : `${t.start ?? '—'} → ${t.finish ?? '—'}`}
                        </div>
                      </td>
                      <td className="py-1.5 pr-2 align-top text-slate-300 dark:text-slate-600"><ArrowRight size={13} /></td>
                      <td className="py-1.5 pr-3 align-top">
                        <select
                          value={row.activityId || ''}
                          onChange={(e) => updateRow(t.uid, { activityId: e.target.value || null })}
                          className={inputCls}
                        >
                          <option value="">— skip / no match —</option>
                          {activityOptions.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}{a.track ? ` (${a.track})` : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 pr-3 align-top">
                        <select
                          value={row.sheetId || ''}
                          onChange={(e) => updateRow(t.uid, { sheetId: e.target.value || null })}
                          className={inputCls}
                        >
                          <option value="">— pick a level —</option>
                          <option value={ALL_LEVELS}>All levels</option>
                          {sheets.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.sheet_name || 'Untitled level'} ({(unitsBySheet.get(s.id) || []).length})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 align-top">{badge(row.matchKind, !!row.activityId)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Options + confirm footer ── */}
        {parse?.ok && (
          <div className="mt-4 pt-3 border-t border-slate-200 dark:border-white/10">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-3 text-xs text-slate-600 dark:text-slate-300">
              <div className="flex rounded-lg border border-slate-300/80 dark:border-white/15 overflow-hidden">
                {([
                  { key: 'subdivide', label: 'Spread across locations' },
                  { key: 'envelope', label: 'Same window for every location' },
                ] as { key: DistributionMode; label: string }[]).map((m, i) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => { setMode(m.key); setConfirming(false); }}
                    className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                      mode === m.key
                        ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                        : 'bg-white/70 dark:bg-black/20 hover:bg-slate-100 dark:hover:bg-white/10'
                    } ${i > 0 ? 'border-l border-slate-300/80 dark:border-white/10' : ''}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={overrideExisting} onChange={(e) => { setOverrideExisting(e.target.checked); setConfirming(false); }} />
                Overwrite locations that already have their own dates
              </label>
            </div>
            {mode === 'subdivide' && (
              <p className="text-[10px] text-slate-400 mb-3">
                Each task&rsquo;s window is divided across its locations in walk order — weighted by room area when every room has a measured area, split evenly otherwise.
              </p>
            )}

            {confirming ? (
              <div className="flex items-center gap-2 rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-500/60 px-3 py-2">
                <span className="text-sm font-semibold text-amber-800 dark:text-amber-200 mr-auto">
                  Write {plan.writes.length} planned date{plan.writes.length === 1 ? '' : 's'} across {plan.affectedUnitCount} location{plan.affectedUnitCount === 1 ? '' : 's'}
                  {overrideExisting ? ' (overwriting existing)' : ' (only empty ones)'}?
                </span>
                <button type="button" disabled={busy} onClick={applyImport} className="rounded-md bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold py-1.5 px-3 disabled:opacity-60">
                  {busy ? 'Importing…' : 'Confirm import'}
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="rounded-md border border-slate-300 dark:border-slate-600 text-xs font-semibold py-1.5 px-3">
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 mr-auto">
                  {plan.writes.length === 0 ? (
                    'Nothing to import yet — match tasks to activities and levels above.'
                  ) : (
                    <>
                      <CheckCircle2 size={12} className="inline mr-1 text-emerald-500" />
                      {plan.writes.length} planned date{plan.writes.length === 1 ? '' : 's'} · {plan.affectedUnitCount} location{plan.affectedUnitCount === 1 ? '' : 's'}
                      {plan.skippedExisting > 0 && ` · ${plan.skippedExisting} kept (already dated)`}
                      {plan.skippedNotApplicable > 0 && ` · ${plan.skippedNotApplicable} skipped (N/A)`}
                    </>
                  )}
                </span>
                <button
                  type="button"
                  disabled={plan.writes.length === 0}
                  onClick={() => setConfirming(true)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold py-1.5 px-3 disabled:opacity-50"
                >
                  <FileUp size={14} /> Import dates
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

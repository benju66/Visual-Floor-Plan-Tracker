"use client";
import React, { useMemo, useState } from 'react';
import { BookOpenCheck, Plus, ListChecks, Layers, Search, X } from 'lucide-react';
import { useProject, useCurrentUserRole, useCreateActivitiesBulk } from '@/hooks/useProjectQueries';
import { useActivityDictionary } from '@/hooks/useActivityDictionary';
import { usePlaybooks, useApplyPlaybook } from '@/hooks/usePlaybooks';
import { useActivityScopes } from '@/hooks/useActivityScopes';
import { activeScopeNames } from '@/utils/activityScopes';
import { activitiesForProjectType, PENDING_ACTIVITY_NAME } from '@/utils/activityDictionary';
import { applyPlaybook, playbooksForProjectType } from '@/utils/playbooks';
import ScopeCombobox from './ScopeCombobox';
import { useUIStore } from '@/store/useUIStore';
import type { ProjectType, PlaybookWithItems, Activity } from '@/types/domain';

// Rotating default colors for seeded activities (all editable afterwards).
export const SEED_COLORS = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#f59e0b',
  '#10b981', '#14b8a6', '#06b6d4', '#6366f1', '#84cc16',
];

interface ScheduleSetupWizardProps {
  projectId: string;
  /** Show the (empty) manager panel instead — "start blank". First-run only. */
  onStartBlank: () => void;
  /** When true, render as a reopenable modal (not the first-run inline card) and APPEND
   *  to the project's existing activities instead of assuming an empty project. */
  asModal?: boolean;
  onClose?: () => void;
  /** The project's current activities — used (in modal mode) to append + skip duplicates. */
  existingActivities?: Activity[];
}

type WizardMode = 'playbook' | 'pick';

const norm = (s: string) => s.trim().toLowerCase();

/**
 * The Schedule view's "set up the schedule" flow: seed a project's activities in one action,
 * either from a saved PLAYBOOK (dictionary activities + their default FS links — Phase 5) or
 * by hand-picking dictionary entries (Phase 3a). Shown two ways: as the FIRST-RUN inline card
 * (empty project), and — reopenable any time from the Schedule toolbar — as a MODAL that
 * APPENDS to the current activities (skipping ones already present). A playbook is never
 * required; everything seeded is fully editable in the Activities panel afterwards.
 */
export default function ScheduleSetupWizard({
  projectId,
  onStartBlank,
  asModal = false,
  onClose,
  existingActivities = [],
}: ScheduleSetupWizardProps) {
  const { data: project } = useProject(projectId);
  const { data: currentUserRole } = useCurrentUserRole(projectId);
  const canEdit = currentUserRole === 'owner' || currentUserRole === 'admin' || currentUserRole === 'pm';
  const { data: dict = [] } = useActivityDictionary();
  const { data: playbooks = [] } = usePlaybooks();
  const { data: managedScopes = [] } = useActivityScopes();
  const createActivities = useCreateActivitiesBulk(projectId);
  const applyPlaybookMut = useApplyPlaybook(projectId);
  const setToast = useUIStore((s) => s.setToast);

  const [track, setTrack] = useState('Production');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickedMode, setPickedMode] = useState<WizardMode | null>(null);
  const [search, setSearch] = useState('');

  const projectType = (project?.project_type as ProjectType | null) ?? null;

  // Active entries only, defaults for this project's vertical first (never restricted).
  const ordered = useMemo(() => {
    const active = dict.filter(e => e.status === 'active' && e.name !== PENDING_ACTIVITY_NAME);
    return activitiesForProjectType(projectType, active);
  }, [dict, projectType]);

  // #6 — searchable picker: filter the displayed list by name or track tag (selection
  // is unaffected; handleSeed still reads `selected` so a filtered-out pick stays chosen).
  const visibleOrdered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter(e => e.name.toLowerCase().includes(q) || (e.track || '').toLowerCase().includes(q));
  }, [ordered, search]);

  // #5 — scope combobox suggestions: the managed scope palette FIRST (in its curated
  // order), then any other scope still present on the dictionary or existing activities.
  const scopeSuggestions = useMemo(() => {
    const managed = activeScopeNames(managedScopes);
    const extra = [...new Set([
      ...dict.map(e => (e.track || '').trim()),
      ...existingActivities.map(m => (m.track || '').trim()),
    ].filter(t => t.length > 0))]
      .filter(t => !managed.includes(t))
      .sort((a, b) => a.localeCompare(b));
    return [...managed, ...extra];
  }, [managedScopes, dict, existingActivities]);

  // Append-mode support (reopened modal): skip activities the project already has in a scope,
  // and start new sequence_order after the current max. Empty project → keys empty, start at 0.
  const existingKeys = useMemo(() => {
    const set = new Set<string>();
    for (const m of existingActivities) {
      const t = norm(m.track || '');
      if (m.dictionary_id) set.add(`dict:${m.dictionary_id} ${t}`);
      set.add(`name:${norm(m.name)} ${t}`);
    }
    return set;
  }, [existingActivities]);
  const nextOrder = useMemo(
    () => existingActivities.reduce((mx, m) => Math.max(mx, m.sequence_order ?? 0), -1) + 1,
    [existingActivities],
  );

  // Active playbooks, scoped/ordered for this project type (never restricted).
  const activePlaybooks = useMemo(() => {
    const active = playbooks.filter(p => p.status === 'active');
    return playbooksForProjectType(projectType, active);
  }, [playbooks, projectType]);

  // Default to the playbook tab when any playbook exists; the user can switch.
  const mode: WizardMode = pickedMode ?? (activePlaybooks.length > 0 ? 'playbook' : 'pick');

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSeed = () => {
    const trackName = track.trim() || 'Production';
    const t = norm(trackName);
    // Preserve the displayed (project-type-aware) order; APPEND after the current max and
    // skip anything already in this scope (append-mode; a no-op for an empty first-run project).
    const rows = ordered
      .filter(e => selected.has(e.id))
      .filter(e => !existingKeys.has(`dict:${e.id} ${t}`) && !existingKeys.has(`name:${norm(e.name)} ${t}`))
      .map((e, i) => ({
        name: e.name,
        color: SEED_COLORS[(nextOrder + i) % SEED_COLORS.length],
        track: trackName,
        sequence_order: nextOrder + i,
        dictionary_id: e.id,
        type: e.type,
      }));
    if (rows.length === 0) {
      setToast({ message: selected.size ? `Those activities are already in ${trackName}.` : 'Pick at least one activity.', type: 'info' });
      return;
    }
    createActivities.mutate(rows, {
      onSuccess: () => {
        setToast({ message: `Added ${rows.length} ${rows.length === 1 ? 'activity' : 'activities'} to ${trackName}.`, type: 'success' });
        setSelected(new Set());
        if (asModal) onClose?.();
      },
      onError: (err) => setToast({ message: (err as Error)?.message || 'Could not add activities.', type: 'error' }),
    });
  };

  const handleApplyPlaybook = (pb: PlaybookWithItems) => {
    const trackName = track.trim() || 'Production';
    // Append to whatever the project already has (skipping duplicates); `dict` is the full
    // dictionary (name/type source). For an empty first-run project this seeds from 0.
    const existing = existingActivities.map(m => ({ dictionary_id: m.dictionary_id ?? null, name: m.name, track: m.track }));
    const { activities, edges } = applyPlaybook({
      playbook: pb,
      dictionary: dict,
      existing,
      track: trackName,
      startSequenceOrder: nextOrder,
      colors: SEED_COLORS,
    });
    if (activities.length === 0) {
      setToast({ message: `“${pb.name}” adds nothing new — those activities are already here.`, type: 'info' });
      return;
    }
    applyPlaybookMut.mutate({ activities, edges }, {
      onSuccess: ({ created, edges: e }) => {
        setToast({
          message: `Added ${created} ${created === 1 ? 'activity' : 'activities'}${e ? ` and ${e} ${e === 1 ? 'link' : 'links'}` : ''} from “${pb.name}”.`,
          type: 'success',
        });
        if (asModal) onClose?.();
      },
      onError: (err) => setToast({ message: (err as Error)?.message || 'Could not apply the playbook.', type: 'error' }),
    });
  };

  if (!canEdit) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-slate-500 border rounded-xl border-slate-200 dark:border-white/10">
        No activities yet — a project admin or PM sets up the schedule here.
      </div>
    );
  }

  const applying = applyPlaybookMut.isPending;

  const body = (
    <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl bg-sky-100 dark:bg-sky-500/20 flex items-center justify-center text-sky-500 shrink-0">
            <BookOpenCheck size={22} />
          </div>
          <div>
            <h3 className="font-bold text-base text-slate-800 dark:text-slate-100">
              {asModal ? 'Add activities to the schedule' : 'Set up this project’s schedule'}
            </h3>
            <p className="text-sm text-slate-500 mt-0.5 text-balance">
              Start from a saved playbook (a ready-made activity sequence) or hand-pick from your
              company&apos;s activity dictionary.{asModal ? ' New activities are appended; ones you already have are skipped.' : ' Everything is editable afterwards.'}
            </p>
          </div>
          {asModal && (
            <button type="button" onClick={onClose} className="ml-auto p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors shrink-0">
              <X size={18} />
            </button>
          )}
        </div>

        {/* Mode tabs — playbook shown only when at least one exists */}
        {activePlaybooks.length > 0 && (
          <div className="flex rounded-lg border border-slate-300/80 dark:border-white/15 overflow-hidden shadow-sm w-fit">
            {([
              { key: 'playbook' as const, label: 'From a playbook', Icon: Layers },
              { key: 'pick' as const, label: 'Pick activities', Icon: ListChecks },
            ]).map(({ key, label, Icon }, i) => (
              <button
                key={key}
                type="button"
                onClick={() => setPickedMode(key)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  mode === key
                    ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                    : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
                } ${i > 0 ? 'border-l border-slate-300/80 dark:border-white/10' : ''}`}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <label className="text-xs font-bold uppercase tracking-widest text-slate-400 shrink-0">Scope of work</label>
          <ScopeCombobox
            value={track}
            onChange={setTrack}
            suggestions={scopeSuggestions}
            placeholder="Pick or type…"
            className="w-48"
          />
          <span className="text-[11px] text-slate-400">
            {mode === 'playbook' ? 'used for activities the playbook doesn’t already scope' : 'the track these activities are added to'}
          </span>
        </div>

        {mode === 'playbook' ? (
          <div className="flex flex-col gap-2">
            {activePlaybooks.map((pb) => {
              const count = pb.items.length;
              const isDefault = projectType != null && pb.default_project_types.includes(projectType);
              return (
                <div
                  key={pb.id}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-white/10 px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{pb.name}</span>
                      {isDefault && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-300 bg-sky-100 dark:bg-sky-500/20 rounded px-1.5 py-0.5 shrink-0">
                          suggested
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      {count} {count === 1 ? 'activity' : 'activities'}
                      {pb.description ? ` · ${pb.description}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={applying || count === 0}
                    onClick={() => handleApplyPlaybook(pb)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold py-1.5 px-3.5 shadow-sm disabled:opacity-50 shrink-0"
                  >
                    <Plus size={15} /> {applying ? 'Adding…' : 'Use this'}
                  </button>
                </div>
              );
            })}
          </div>
        ) : ordered.length === 0 ? (
          <div className="text-sm text-slate-500 py-4 text-center border border-dashed border-slate-300 dark:border-slate-700 rounded-xl">
            The company dictionary is empty — start blank and add activities by hand.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search activities…"
                className="w-full bg-white dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500"
              />
              {selected.size > 0 && (
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-sky-600 dark:text-sky-300">
                  {selected.size} selected
                </span>
              )}
            </div>
            {visibleOrdered.length === 0 ? (
              <div className="text-sm text-slate-500 py-4 text-center border border-dashed border-slate-300 dark:border-slate-700 rounded-xl">
                No activities match “{search}”.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {visibleOrdered.map(entry => {
                  const checked = selected.has(entry.id);
                  return (
                    <label
                      key={entry.id}
                      className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                        checked
                          ? 'border-sky-400 bg-sky-50 dark:bg-sky-900/30 dark:border-sky-600'
                          : 'border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'
                      }`}
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggle(entry.id)} className="accent-sky-500" />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{entry.name}</span>
                      {entry.track && <span className="ml-auto text-[10px] text-slate-400 shrink-0">{entry.track}</span>}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          {mode === 'pick' && (
            <button
              type="button"
              disabled={selected.size === 0 || createActivities.isPending}
              onClick={handleSeed}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold py-2 px-4 shadow-sm disabled:opacity-50"
            >
              <Plus size={16} />
              {createActivities.isPending ? 'Adding…' : `Add ${selected.size || ''} ${selected.size === 1 ? 'activity' : 'activities'}`}
            </button>
          )}
          {asModal ? (
            <button
              type="button"
              onClick={onClose}
              className="text-sm font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={onStartBlank}
              className="text-sm font-semibold text-slate-500 hover:text-sky-600 dark:hover:text-sky-300 transition-colors"
            >
              Start blank instead
            </button>
          )}
        </div>
    </div>
  );

  if (asModal) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" role="presentation" onClick={onClose}>
        <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
          {body}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-sm">
      <div className="max-w-2xl mx-auto p-8">{body}</div>
    </div>
  );
}

"use client";
import React, { useMemo, useState } from 'react';
import { BookOpenCheck, Plus, ListChecks, Layers } from 'lucide-react';
import { useProject, useCurrentUserRole, useCreateActivitiesBulk } from '@/hooks/useProjectQueries';
import { useActivityDictionary } from '@/hooks/useActivityDictionary';
import { usePlaybooks, useApplyPlaybook } from '@/hooks/usePlaybooks';
import { activitiesForProjectType, PENDING_ACTIVITY_NAME } from '@/utils/activityDictionary';
import { applyPlaybook, playbooksForProjectType } from '@/utils/playbooks';
import { useUIStore } from '@/store/useUIStore';
import type { ProjectType, PlaybookWithItems } from '@/types/domain';

// Rotating default colors for seeded activities (all editable afterwards).
export const SEED_COLORS = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#f59e0b',
  '#10b981', '#14b8a6', '#06b6d4', '#6366f1', '#84cc16',
];

interface ScheduleSetupWizardProps {
  projectId: string;
  /** Show the (empty) manager panel instead — "start blank". */
  onStartBlank: () => void;
}

type WizardMode = 'playbook' | 'pick';

/**
 * First-run empty state for the Schedule view: a project with no activities yet can
 * seed its list in one action, either from a saved PLAYBOOK (an ordered set of
 * dictionary activities + their default Finish-to-Start links — Phase 5) or by
 * hand-picking dictionary entries (Phase 3a). A playbook is never required; both the
 * hand-pick and "start blank" paths remain. Everything seeded here is fully editable
 * in the Activities panel afterwards.
 */
export default function ScheduleSetupWizard({ projectId, onStartBlank }: ScheduleSetupWizardProps) {
  const { data: project } = useProject(projectId);
  const { data: currentUserRole } = useCurrentUserRole(projectId);
  const canEdit = currentUserRole === 'owner' || currentUserRole === 'admin' || currentUserRole === 'pm';
  const { data: dict = [] } = useActivityDictionary();
  const { data: playbooks = [] } = usePlaybooks();
  const createActivities = useCreateActivitiesBulk(projectId);
  const applyPlaybookMut = useApplyPlaybook(projectId);
  const setToast = useUIStore((s) => s.setToast);

  const [track, setTrack] = useState('Production');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickedMode, setPickedMode] = useState<WizardMode | null>(null);

  const projectType = (project?.project_type as ProjectType | null) ?? null;

  // Active entries only, defaults for this project's vertical first (never restricted).
  const ordered = useMemo(() => {
    const active = dict.filter(e => e.status === 'active' && e.name !== PENDING_ACTIVITY_NAME);
    return activitiesForProjectType(projectType, active);
  }, [dict, projectType]);

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
    // Preserve the displayed (project-type-aware) order as the initial sequence.
    const rows = ordered
      .filter(e => selected.has(e.id))
      .map((e, i) => ({
        name: e.name,
        color: SEED_COLORS[i % SEED_COLORS.length],
        track: trackName,
        sequence_order: i,
        dictionary_id: e.id,
        type: e.type,
      }));
    if (rows.length === 0) return;
    createActivities.mutate(rows, {
      onSuccess: () => setToast({ message: `Added ${rows.length} activities to ${trackName}.`, type: 'success' }),
      onError: (err) => setToast({ message: (err as Error)?.message || 'Could not add activities.', type: 'error' }),
    });
  };

  const handleApplyPlaybook = (pb: PlaybookWithItems) => {
    const trackName = track.trim() || 'Production';
    // The wizard only shows for an EMPTY project → no existing activities to de-dupe
    // against; seed from sequence 0. `dict` is the full dictionary (name/type source).
    const { activities, edges } = applyPlaybook({
      playbook: pb,
      dictionary: dict,
      existing: [],
      track: trackName,
      startSequenceOrder: 0,
      colors: SEED_COLORS,
    });
    if (activities.length === 0) {
      setToast({ message: `“${pb.name}” has no activities to add.`, type: 'info' });
      return;
    }
    applyPlaybookMut.mutate({ activities, edges }, {
      onSuccess: ({ created, edges: e }) => setToast({
        message: `Added ${created} ${created === 1 ? 'activity' : 'activities'}${e ? ` and ${e} ${e === 1 ? 'link' : 'links'}` : ''} from “${pb.name}”.`,
        type: 'success',
      }),
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

  return (
    <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-sm">
      <div className="max-w-2xl mx-auto p-8 flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl bg-sky-100 dark:bg-sky-500/20 flex items-center justify-center text-sky-500 shrink-0">
            <BookOpenCheck size={22} />
          </div>
          <div>
            <h3 className="font-bold text-base text-slate-800 dark:text-slate-100">Set up this project&apos;s schedule</h3>
            <p className="text-sm text-slate-500 mt-0.5 text-balance">
              Start from a saved playbook (a ready-made activity sequence) or hand-pick from your
              company&apos;s activity dictionary. Everything is editable afterwards.
            </p>
          </div>
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
          <input
            type="text"
            value={track}
            onChange={(e) => setTrack(e.target.value)}
            className="w-48 bg-white dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {ordered.map(entry => {
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
          <button
            type="button"
            onClick={onStartBlank}
            className="text-sm font-semibold text-slate-500 hover:text-sky-600 dark:hover:text-sky-300 transition-colors"
          >
            Start blank instead
          </button>
        </div>
      </div>
    </div>
  );
}

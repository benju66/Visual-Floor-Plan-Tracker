"use client";
import React, { useMemo, useState } from 'react';
import { Flag, Plus, Trash2, Pencil, GripVertical, X, CornerDownRight, Link2, BookMarked } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useProject, useCurrentUserRole, useReorderActivities, useUpdateActivityRules } from '@/hooks/useProjectQueries';
import { useActivityDictionary, useProposePendingActivity } from '@/hooks/useActivityDictionary';
import { useActivityScopes } from '@/hooks/useActivityScopes';
import { activeScopeNames } from '@/utils/activityScopes';
import { useActivityDependencies, useSetActivityPredecessor } from '@/hooks/useActivityDependencies';
import { useSaveProjectAsPlaybook } from '@/hooks/usePlaybooks';
import { predecessorEdgeFor, wouldCreateCycle, dependencyLabel } from '@/utils/activityDependencies';
import { resolveActivityByName, activityPickToFields, type ActivityPickResult } from '@/utils/activityDictionary';
import ActivityDictionaryField from '@/components/ActivityDictionaryField';
import ScopeCombobox from './ScopeCombobox';
import { useUIStore } from '@/store/useUIStore';
import { getAppliesTo } from '@/types/domain';
import type { Activity, ActivityDependency, ActivityDictionaryEntry, ActivityType, ProjectType } from '@/types/domain';
import type { AppSettings } from '@/store/useSettingsStore';

interface SortableActivityItemProps {
  m: Activity;
  canEdit: boolean;
  editingId: string | null;
  editName: string;
  setEditName: (name: string) => void;
  editColor: string;
  setEditColor: (color: string) => void;
  editAppliesTo: string[] | null;
  setEditAppliesTo: (val: string[] | null) => void;
  editPredecessorId: string;
  setEditPredecessorId: (id: string) => void;
  editLagDays: string;
  setEditLagDays: (v: string) => void;
  projectUnitTypes: string[];
  /** Same-track activities eligible as a predecessor (self + cycles excluded). */
  predecessorOptions: Activity[];
  dependency: ActivityDependency | null;
  dependencyText: string | null;
  onBeginEdit: (m: Activity) => void;
  onSave: (m: Activity) => void;
  onDelete: (m: Activity) => void;
}

/**
 * One activity row in the Schedule view's manager (moved here from the Settings
 * "Activities" tab in Phase 3a — Settings no longer owns activity management).
 * Collapsed: color dot, name, applies-to count, dictionary Linked/Review badge,
 * and the FS-dependency chip. Editing: name/color, applies-to chips, and the
 * Phase 3b predecessor picker + lag (coarse FS-only — no CPM).
 */
function SortableActivityItem({
  m, canEdit, editingId,
  editName, setEditName, editColor, setEditColor,
  editAppliesTo, setEditAppliesTo,
  editPredecessorId, setEditPredecessorId, editLagDays, setEditLagDays,
  projectUnitTypes, predecessorOptions, dependency, dependencyText,
  onBeginEdit, onSave, onDelete,
}: SortableActivityItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: m.id, disabled: !canEdit });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const savedRule = getAppliesTo(m);
  // null = applies to all unit types; chips show the effective selection
  const effectiveSelection = editAppliesTo ?? projectUnitTypes;

  const toggleAppliesTo = (type: string) => {
    const next = effectiveSelection.includes(type)
      ? effectiveSelection.filter(t => t !== type)
      : [...effectiveSelection, type];
    // All selected (or none) collapses back to the "applies to all" rule
    if (next.length === 0 || next.length === projectUnitTypes.length) {
      setEditAppliesTo(null);
    } else {
      setEditAppliesTo(next);
    }
  };

  return (
    <li ref={setNodeRef} style={style} className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-2 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {canEdit && (
            <button {...attributes} {...listeners} type="button" className="p-1 cursor-grab text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
              <GripVertical size={16} />
            </button>
          )}
          {editingId === m.id ? (
            <div className="flex flex-col bg-white dark:bg-black/30 border border-slate-300 dark:border-white/10 rounded-lg p-1 w-full gap-2 flex-1">
              <div className="flex gap-2 items-center w-full">
                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus className="w-full bg-transparent text-sm font-medium outline-none px-2 text-slate-900 dark:text-white" />
                <input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} className="w-7 h-7 border-0 cursor-pointer bg-transparent shrink-0" />
                <button type="button" onClick={() => onSave(m)} className="px-3 bg-sky-500 hover:bg-sky-600 text-white rounded-md text-sm font-bold h-7 transition-colors">Save</button>
              </div>
              <div className="px-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                  Applies to {editAppliesTo === null ? 'all space types' : `${effectiveSelection.length} of ${projectUnitTypes.length} space types`}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {projectUnitTypes.map(type => {
                    const active = effectiveSelection.includes(type);
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => toggleAppliesTo(type)}
                        className={`px-2 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                          active
                            ? 'bg-sky-100 text-sky-700 border-sky-300 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-700'
                            : 'bg-slate-100 text-slate-400 border-slate-200 line-through dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700'
                        }`}
                      >
                        {type}
                      </button>
                    );
                  })}
                </div>
                <div className="text-[10px] text-slate-400 italic mt-1.5">Deselected types are tracked as N/A for this activity.</div>
              </div>
              <div className="px-2 pb-1 border-t border-slate-200/70 dark:border-white/10 pt-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                  Starts after (finish-to-start)
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={editPredecessorId}
                    onChange={(e) => setEditPredecessorId(e.target.value)}
                    className="flex-1 min-w-0 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md px-2 py-1 text-xs outline-none"
                  >
                    <option value="">— No predecessor —</option>
                    {predecessorOptions.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-[11px] text-slate-500 shrink-0">
                    <input
                      type="number"
                      step="1"
                      value={editLagDays}
                      disabled={!editPredecessorId}
                      onChange={(e) => setEditLagDays(e.target.value)}
                      className="w-14 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md px-1.5 py-1 text-xs outline-none disabled:opacity-50"
                    />
                    lag (days)
                  </label>
                </div>
                <div className="text-[10px] text-slate-400 italic mt-1.5">Coarse sequencing only — “this starts after that finishes, plus N days”.</div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="w-4 h-4 rounded-full shadow-sm shrink-0" style={{ backgroundColor: m.color }} />
              <span className="font-semibold text-sm truncate text-slate-800 dark:text-slate-200">{m.name}</span>
              {savedRule && (
                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 bg-slate-200/70 dark:bg-slate-800 px-1.5 py-0.5 rounded-full shrink-0" title={`Applies only to: ${savedRule.join(', ')}`}>
                  {savedRule.length} type{savedRule.length === 1 ? '' : 's'}
                </span>
              )}
              {m.dictionary_id ? (
                <span className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 shrink-0" title="Linked to the company activity dictionary">
                  <Link2 size={10} />
                </span>
              ) : (
                <span className="text-[9px] font-bold uppercase tracking-widest text-amber-600/80 dark:text-amber-400/80 bg-amber-100/70 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-full shrink-0" title="Not yet linked to the company activity dictionary (review queue)">
                  Review
                </span>
              )}
            </div>
          )}
        </div>

        {canEdit && editingId !== m.id && (
          <div className="flex items-center gap-1 shrink-0 ml-2">
            <button type="button" onClick={() => onBeginEdit(m)} className="p-1.5 text-slate-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-slate-800 rounded-lg transition-colors" title="Edit">
              <Pencil size={14} />
            </button>
            <button type="button" onClick={() => onDelete(m)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-slate-800 rounded-lg transition-colors" title="Delete">
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>

      {editingId !== m.id && dependency && dependencyText && (
        <div className={`flex items-center gap-1 mt-1 text-[10px] text-slate-400 ${canEdit ? 'pl-7' : 'pl-1'}`} title={dependencyText}>
          <CornerDownRight size={11} className="shrink-0" />
          <span className="truncate">{dependencyText}</span>
        </div>
      )}
    </li>
  );
}

export interface ActivityManagerPanelProps {
  projectId: string;
  /** The full project activity list (all tracks). */
  activities: Activity[];
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
  onAddActivity?: (name: string, color: string, track: string, dictionaryId?: string | null) => void;
  onUpdateActivity?: (id: string, oldName: string, newName: string, newColor: string) => void;
  onDeleteActivity?: (id: string) => void;
  /** Seed the active scope tab (usually the map's trackingMode). */
  initialTrack?: string;
  onClose: () => void;
}

/**
 * The activity-management home (Scheduling Foundation Slice A, Phase 3a). This
 * panel — scopes of work, auto-advance, the dictionary-backed add row, and the
 * drag-sortable activity list — MOVED here from the Settings "Activities" tab so
 * the Schedule view is the single place a project's activities are built and
 * sequenced. It reuses the existing hooks (useReorderActivities,
 * useUpdateActivityRules, useProjectActions handlers via props) — no forks.
 * Writes are RLS-enforced (owner/admin/pm); `canEdit` only hides the controls.
 */
export default function ActivityManagerPanel({
  projectId,
  activities,
  settings,
  onUpdateSettings,
  onAddActivity,
  onUpdateActivity,
  onDeleteActivity,
  initialTrack,
  onClose,
}: ActivityManagerPanelProps) {
  const { data: project } = useProject(projectId);
  const { data: currentUserRole } = useCurrentUserRole(projectId);
  const canEdit = currentUserRole === 'owner' || currentUserRole === 'admin' || currentUserRole === 'pm';
  const setConfirmModal = useUIStore((s) => s.setConfirmModal);
  const setToast = useUIStore((s) => s.setToast);
  const saveAsPlaybook = useSaveProjectAsPlaybook(projectId);

  const projectType = (project?.project_type as ProjectType | null) ?? null;
  // "Save current project as a playbook" (Phase 5 authoring, privileged) — a small
  // footer form; the full add/remove playbook editor rides the dictionary-admin
  // pattern later.
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [pbName, setPbName] = useState('');
  const [pbDesc, setPbDesc] = useState('');
  const [pbScopeToType, setPbScopeToType] = useState(true);

  const handleSaveAsPlaybook = () => {
    const name = pbName.trim();
    if (!name) return;
    saveAsPlaybook.mutate(
      {
        name,
        description: pbDesc.trim() || null,
        defaultProjectTypes: pbScopeToType && projectType ? [projectType] : [],
      },
      {
        onSuccess: ({ itemCount, skippedUnlinked }) => {
          setToast({
            message: `Saved “${name}” as a playbook (${itemCount} ${itemCount === 1 ? 'activity' : 'activities'})${
              skippedUnlinked > 0 ? ` · ${skippedUnlinked} unlinked left out` : ''
            }.`,
            type: 'success',
          });
          setShowSaveForm(false);
          setPbName('');
          setPbDesc('');
        },
        onError: (err) => setToast({ message: (err as Error)?.message || 'Could not save the playbook.', type: 'error' }),
      },
    );
  };

  const baseScopes = [...new Set(activities.map(m => m.track))];
  if (baseScopes.length === 0) baseScopes.push('Production');

  const [activeTrack, setActiveTrack] = useState(
    initialTrack && baseScopes.includes(initialTrack) ? initialTrack : baseScopes[0]
  );
  const [newTrackInput, setNewTrackInput] = useState('');
  // Scopes a user just added but hasn't put an activity in yet. Merged with the
  // derived scopes so a brand-new scope shows its tab IMMEDIATELY (fixes the
  // "new scope button doesn't appear" bug); it materialises for real once an
  // activity lands in it. Ephemeral across reload — an empty scope has nothing to persist.
  const [draftScopes, setDraftScopes] = useState<string[]>([]);
  const uniqueScopes = [...new Set([...baseScopes, ...draftScopes])];

  // Add (or switch to) a scope from the combobox — pick an existing one or type a new one.
  const addOrSelectScope = (raw: string) => {
    const val = raw.trim();
    if (!val) return;
    if (!uniqueScopes.includes(val)) setDraftScopes(prev => [...prev, val]);
    setActiveTrack(val);
    setNewTrackInput('');
  };
  const [newActivityName, setNewActivityName] = useState('');
  const [newActivityColor, setNewActivityColor] = useState('#3b82f6');
  // The explicitly-picked dictionary entry for the activity being added (null = free-typed).
  const [selectedDictEntry, setSelectedDictEntry] = useState<ActivityDictionaryEntry | null>(null);
  const { data: activityDictionary = [] } = useActivityDictionary();
  const { data: managedScopes = [] } = useActivityScopes();
  const proposePendingActivity = useProposePendingActivity();

  // Combobox suggestions for the "add scope" field: the managed scope palette FIRST (in
  // its curated order), then the project's own scopes + dictionary track hints. Pick or type.
  const scopeSuggestions = useMemo(() => {
    const managed = activeScopeNames(managedScopes);
    const rest = [...new Set([
      ...baseScopes,
      ...draftScopes,
      ...activityDictionary.map(e => (e.track || '').trim()),
    ].filter(t => t.length > 0))]
      .filter(t => !managed.includes(t))
      .sort((a, b) => a.localeCompare(b));
    return [...managed, ...rest];
  }, [managedScopes, activityDictionary, baseScopes, draftScopes]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editAppliesTo, setEditAppliesTo] = useState<string[] | null>(null);
  const [editPredecessorId, setEditPredecessorId] = useState('');
  const [editLagDays, setEditLagDays] = useState('0');

  const reorderActivitiesMutation = useReorderActivities(projectId);
  const updateActivityRulesMutation = useUpdateActivityRules(projectId);
  const { data: dependencies = [] } = useActivityDependencies(projectId);
  const setPredecessorMutation = useSetActivityPredecessor(projectId);

  const projectUnitTypes = (project?.unit_types as string[]) || ['Apartment Unit', 'Common Area', 'Back of House', 'Commercial Space', 'Other'];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const currentScopeActivities = activities
    .filter(m => m.track === activeTrack)
    .sort((a, b) => (a.sequence_order || 0) - (b.sequence_order || 0));

  const nameById = useMemo(() => new Map(activities.map(m => [m.id, m.name])), [activities]);

  // Add an activity from the governed dictionary: link it if the typed name matches an
  // entry by name OR alias (or one was picked from the dropdown); otherwise propose it as
  // "Other (pending)" (non-blocking) and link to that. A denied propose (RLS) degrades to
  // an unlinked activity (dictionary_id = null → the review queue) — the add is never blocked.
  const handleAddActivityFromDictionary = async () => {
    const trimmed = newActivityName.trim();
    if (!trimmed) return;
    const picked =
      selectedDictEntry && selectedDictEntry.name.trim().toLowerCase() === trimmed.toLowerCase()
        ? selectedDictEntry
        : resolveActivityByName(activityDictionary, trimmed);
    const result: ActivityPickResult = picked
      ? { kind: 'entry', dictionaryId: picked.id, name: picked.name, track: picked.track, type: picked.type as ActivityType }
      : { kind: 'pending', name: trimmed, track: null };
    const fields = await activityPickToFields(result, vars => proposePendingActivity.mutateAsync(vars));
    // The activity keeps the scope tab the user is on; the dictionary track is only a hint.
    onAddActivity?.(fields.name, newActivityColor, activeTrack, fields.dictionary_id);
    setNewActivityName('');
    setSelectedDictEntry(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (active.id !== over?.id && over) {
      const oldIndex = currentScopeActivities.findIndex(m => m.id === active.id);
      const newIndex = currentScopeActivities.findIndex(m => m.id === over.id);
      const newArray = arrayMove(currentScopeActivities, oldIndex, newIndex);
      const updates = newArray.map((m, index) => ({ ...m, sequence_order: index }));
      reorderActivitiesMutation.mutate(updates);
    }
  };

  const beginEdit = (m: Activity) => {
    setEditingId(m.id);
    setEditName(m.name);
    setEditColor(m.color);
    setEditAppliesTo(getAppliesTo(m));
    const edge = predecessorEdgeFor(dependencies, m.id);
    setEditPredecessorId(edge?.predecessor_activity_id ?? '');
    setEditLagDays(String(edge?.lag_days ?? 0));
  };

  const saveEdit = (m: Activity) => {
    onUpdateActivity?.(m.id, m.name, editName, editColor);
    const savedRule = getAppliesTo(m);
    if (JSON.stringify(editAppliesTo) !== JSON.stringify(savedRule)) {
      updateActivityRulesMutation.mutate({ id: m.id, applies_to_unit_types: editAppliesTo });
    }
    const edge = predecessorEdgeFor(dependencies, m.id);
    const prevPred = edge?.predecessor_activity_id ?? '';
    const prevLag = edge?.lag_days ?? 0;
    const nextLag = Math.trunc(Number(editLagDays)) || 0;
    if (editPredecessorId !== prevPred || (editPredecessorId && nextLag !== prevLag)) {
      setPredecessorMutation.mutate({
        successorId: m.id,
        predecessorId: editPredecessorId || null,
        lagDays: nextLag,
      });
    }
    setEditingId(null);
  };

  const confirmDelete = (m: Activity) => {
    setConfirmModal({
      message: `Delete “${m.name}”? Its current status entries on locations are removed too (the audit history is kept).`,
      // ConfirmModal leaves closing to the callback — clear it before deleting.
      onConfirm: () => { setConfirmModal(null); onDeleteActivity?.(m.id); },
    });
  };

  return (
    <aside className="w-full h-full flex flex-col min-h-0 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-sm">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200 dark:border-white/10">
        <div className="flex items-center gap-2">
          <Flag size={15} className="text-sky-500" />
          <span className="text-sm font-bold text-slate-800 dark:text-slate-100">Activities</span>
          <span className="text-xs text-slate-400">· {currentScopeActivities.length} in {activeTrack}</span>
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors" title="Hide activities panel">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4 custom-scrollbar">
        {/* Scopes of Work */}
        <div className="flex flex-col">
          <span className="text-xs font-bold mb-2 text-slate-700 dark:text-slate-200">Scopes of Work</span>
          <div className="flex flex-wrap gap-2">
            {uniqueScopes.map(scope => (
              <button
                key={scope}
                type="button"
                onClick={() => setActiveTrack(scope)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors border ${activeTrack === scope ? 'bg-sky-500 text-white border-sky-600 shadow-sm' : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
              >
                {scope}
              </button>
            ))}
            {canEdit && (
              <div className="flex items-center gap-1">
                <ScopeCombobox
                  value={newTrackInput}
                  onChange={setNewTrackInput}
                  onCommit={addOrSelectScope}
                  suggestions={scopeSuggestions}
                  placeholder="Pick or add scope"
                  className="w-40"
                  inputClassName="w-full bg-white dark:bg-black/20 border border-slate-300 dark:border-slate-700 rounded-lg pl-2.5 pr-7 py-1 text-xs outline-none focus:ring-2 focus:ring-sky-500"
                />
                <button
                  type="button"
                  onClick={() => addOrSelectScope(newTrackInput)}
                  className="p-1 rounded-md bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 shrink-0"
                  title="Add this scope of work"
                >
                  <Plus size={14} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Auto-Advance */}
        <div className="flex items-center justify-between bg-white/50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl p-3">
          <div className="pr-2">
            <span className="font-semibold block text-sm">Auto-Advance {activeTrack}</span>
            <span className="text-xs text-slate-500">Automatically plan the next step when an activity is completed.</span>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              className="sr-only peer"
              disabled={!canEdit}
              checked={settings.auto_advance_tracks?.[activeTrack] || false}
              onChange={(e) => onUpdateSettings({
                ...settings,
                auto_advance_tracks: {
                  ...(settings.auto_advance_tracks || {}),
                  [activeTrack]: e.target.checked
                }
              })}
            />
            <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500 peer-disabled:opacity-50"></div>
          </label>
        </div>

        {/* Add from the governed dictionary */}
        {canEdit && (
          <div>
            <div className="flex gap-2">
              <ActivityDictionaryField
                value={newActivityName}
                onChange={setNewActivityName}
                selectedEntry={selectedDictEntry}
                onSelectEntry={setSelectedDictEntry}
                placeholder={`Add to ${activeTrack}...`}
              />
              <input
                type="color"
                value={newActivityColor}
                onChange={e => setNewActivityColor(e.target.value)}
                className="w-10 h-10 border-0 rounded-lg cursor-pointer bg-white dark:bg-black/20 p-1 shrink-0"
              />
              <button
                type="button"
                onClick={handleAddActivityFromDictionary}
                className="h-10 px-3 bg-sky-500 hover:bg-sky-600 text-white rounded-lg flex items-center justify-center transition-colors shadow-sm shrink-0"
              >
                <Plus size={18} />
              </button>
            </div>
            <div className="mt-1.5 text-[11px] text-slate-400">
              Pick a company-standard activity (matched by name or alias) to keep naming consistent across projects, or type a new one — it&apos;ll be proposed automatically.
            </div>
          </div>
        )}

        {/* Sortable list */}
        <div className="flex flex-col space-y-1">
          {canEdit && <div className="text-xs text-slate-500 italic mb-2">Drag to reorder sequence within scope.</div>}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={currentScopeActivities.map(m => m.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-2">
                {currentScopeActivities.map(m => {
                  const edge = predecessorEdgeFor(dependencies, m.id);
                  // Same-scope activities only; exclude self + anything that would loop.
                  const options = currentScopeActivities.filter(
                    p => p.id !== m.id && !wouldCreateCycle(dependencies.filter(d => d.successor_activity_id !== m.id), p.id, m.id)
                  );
                  return (
                    <SortableActivityItem
                      key={m.id}
                      m={m}
                      canEdit={canEdit}
                      editingId={editingId}
                      editName={editName}
                      setEditName={setEditName}
                      editColor={editColor}
                      setEditColor={setEditColor}
                      editAppliesTo={editAppliesTo}
                      setEditAppliesTo={setEditAppliesTo}
                      editPredecessorId={editPredecessorId}
                      setEditPredecessorId={setEditPredecessorId}
                      editLagDays={editLagDays}
                      setEditLagDays={setEditLagDays}
                      projectUnitTypes={projectUnitTypes}
                      predecessorOptions={options}
                      dependency={edge}
                      dependencyText={edge ? dependencyLabel(edge, nameById) : null}
                      onBeginEdit={beginEdit}
                      onSave={saveEdit}
                      onDelete={confirmDelete}
                    />
                  );
                })}
              </ul>
            </SortableContext>
          </DndContext>
          {currentScopeActivities.length === 0 && (
            <div className="text-center py-6 text-slate-500 text-sm bg-slate-50 dark:bg-slate-900/50 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl">
              No activities in {activeTrack}{canEdit ? ' — add the first one above.' : '.'}
            </div>
          )}
        </div>
      </div>

      {/* Save this project's activities as a reusable playbook (Phase 5 authoring) */}
      {canEdit && activities.length > 0 && (
        <div className="border-t border-slate-200 dark:border-white/10 p-3">
          {!showSaveForm ? (
            <button
              type="button"
              onClick={() => { setShowSaveForm(true); setPbName(project?.name ? `${project.name}` : ''); }}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/70 dark:bg-black/20 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
              title="Save this project's activities + sequence + FS links as a reusable playbook"
            >
              <BookMarked size={14} /> Save as playbook
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <BookMarked size={14} className="text-sky-500 shrink-0" />
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200">Save as playbook</span>
              </div>
              <input
                type="text"
                autoFocus
                value={pbName}
                onChange={(e) => setPbName(e.target.value)}
                placeholder="Playbook name"
                className="w-full bg-white dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500"
              />
              <input
                type="text"
                value={pbDesc}
                onChange={(e) => setPbDesc(e.target.value)}
                placeholder="Description (optional)"
                className="w-full bg-white dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-500"
              />
              {projectType && (
                <label className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <input type="checkbox" checked={pbScopeToType} onChange={(e) => setPbScopeToType(e.target.checked)} className="accent-sky-500" />
                  Suggest this playbook for {projectType} projects
                </label>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!pbName.trim() || saveAsPlaybook.isPending}
                  onClick={handleSaveAsPlaybook}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold py-1.5 px-3.5 shadow-sm disabled:opacity-50"
                >
                  {saveAsPlaybook.isPending ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowSaveForm(false); setPbName(''); setPbDesc(''); }}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
              <p className="text-[10px] text-slate-400 leading-snug">
                Captures every dictionary-linked activity, its scope, order and FS links. Unlinked
                (“Review”) activities are left out.
              </p>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

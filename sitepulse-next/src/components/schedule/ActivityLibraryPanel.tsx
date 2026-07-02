"use client";
import React, { useMemo, useState } from 'react';
import {
  Plus, Check, X, Search, AlertCircle, Loader2, Tag, CornerDownRight, Flag, Eraser, Building2,
} from 'lucide-react';
import {
  useActivityDictionary,
  useUpsertActivityDictionaryEntry,
  useSetActivityDictionaryStatus,
  useAddActivityAlias,
} from '@/hooks/useActivityDictionary';
import { useActivityScopes } from '@/hooks/useActivityScopes';
import { activeScopeNames } from '@/utils/activityScopes';
import { PENDING_ACTIVITY_NAME } from '@/utils/activityDictionary';
import { PROJECT_TYPES } from '@/utils/locationTaxonomy';
import ScopeCombobox from './ScopeCombobox';
import ScopesManagerBar from './ScopesManagerBar';
import {
  filterActivitiesForAdmin,
  groupActivitiesByTrack,
  type ActivityAdminStatusFilter,
} from '@/utils/activityLibraryAdmin';
import type { ActivityDictionaryEntry, ActivityDictionaryStatus, ActivityType, ProjectType } from '@/types/domain';

const STATUS_FILTERS: { value: ActivityAdminStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'deprecated', label: 'Retired' },
];

const STATUS_BADGE: Record<ActivityDictionaryStatus, string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  deprecated: 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
};

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong — please try again.';
}

interface ActivityLibraryPanelProps {
  /** Writes are RLS-gated to owner/admin/pm; false renders the list read-only. */
  canManage?: boolean;
}

/**
 * Global "Scopes & Activities" admin (Scheduling UX Hardening) — the scheduling twin
 * of {@link LocationLibraryPanel}. Lives in the cross-project Global Settings modal
 * because both the activity dictionary and the scope palette are single shared lists;
 * editing either changes every project. Surfaces, top to bottom:
 *   1. a collapsible {@link ScopesManagerBar} — manage the scope-of-work palette; its
 *      chips double as the activity-list filter;
 *   2. a review queue of `status='pending'` proposals → promote / alias / retire;
 *   3. add an activity (name + type + default scope + which project types show it);
 *   4. the dictionary grouped by default-scope (`track`), filterable by status +
 *      searchable, each row with per-row status / alias / editable scope / project-type
 *      controls; plus a bulk "clear all default-scope tags".
 */
export default function ActivityLibraryPanel({ canManage = true }: ActivityLibraryPanelProps) {
  const { data: entries = [], isLoading } = useActivityDictionary();
  const { data: scopes = [] } = useActivityScopes();
  const upsert = useUpsertActivityDictionaryEntry();
  const setStatus = useSetActivityDictionaryStatus();
  const addAlias = useAddActivityAlias();

  const [statusFilter, setStatusFilter] = useState<ActivityAdminStatusFilter>('all');
  const [activeScope, setActiveScope] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<ActivityType>('task');
  const [newTrack, setNewTrack] = useState('');
  const [newProjectTypes, setNewProjectTypes] = useState<ProjectType[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);

  const pending = entries.filter((e) => e.status === 'pending' && e.name !== PENDING_ACTIVITY_NAME);
  const activeEntries = entries.filter((e) => e.status === 'active' && e.name !== PENDING_ACTIVITY_NAME);
  const realEntries = entries.filter((e) => e.name !== PENDING_ACTIVITY_NAME);

  const byStatusAndSearch = filterActivitiesForAdmin(entries, statusFilter, search);
  const filtered = activeScope
    ? byStatusAndSearch.filter((e) => (e.track || '').trim() === activeScope)
    : byStatusAndSearch;
  const grouped = groupActivitiesByTrack(filtered);

  // Scope-picker suggestions: the managed palette first, then any legacy track still
  // present on an entry (so nothing silently disappears until it's cleaned up).
  const trackSuggestions = useMemo(() => {
    const legacy = entries.map((e) => (e.track || '').trim()).filter((t) => t.length > 0);
    return [...new Set([...activeScopeNames(scopes), ...legacy])];
  }, [scopes, entries]);

  const taggedCount = useMemo(() => entries.filter((e) => (e.track || '').trim().length > 0).length, [entries]);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try { await fn(); } catch (e) { setError(errMessage(e)); }
  };

  const toggleNewProjectType = (pt: ProjectType) =>
    setNewProjectTypes((prev) => (prev.includes(pt) ? prev.filter((p) => p !== pt) : [...prev, pt]));

  const handleAdd = () =>
    run(async () => {
      const name = newName.trim();
      if (!name) return;
      await upsert.mutateAsync({
        name,
        type: newType,
        track: newTrack.trim() || null,
        defaultProjectTypes: newProjectTypes,
        status: 'active',
      });
      setNewName('');
      setNewTrack('');
      setNewType('task');
      setNewProjectTypes([]);
      setAdding(false);
    });

  const clearAllTags = () =>
    run(async () => {
      const tagged = entries.filter((e) => (e.track || '').trim().length > 0);
      await Promise.all(tagged.map((e) => upsert.mutateAsync({ id: e.id, name: e.name, track: null })));
      setConfirmClear(false);
    });

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-slate-500 dark:text-slate-400 text-balance">
        Two shared lists used across <span className="font-semibold">all</span> projects: your
        <span className="font-semibold"> scopes of work</span> (the buckets activities group into) and the
        <span className="font-semibold"> activities</span> themselves. A “default scope” just sets which bucket an
        activity drops into when you add it to a project — each project can still move it. Changes here apply everywhere.
      </p>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-xs font-medium text-red-700 dark:text-red-300">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Scopes of Work (manage + filter) ─────────────────────────── */}
      <ScopesManagerBar
        scopes={scopes}
        entryTracks={realEntries.map((e) => e.track)}
        activeScope={activeScope}
        onSelectScope={setActiveScope}
        canManage={canManage}
        onError={setError}
      />

      {/* ── Review queue ─────────────────────────────────────────────── */}
      {pending.length > 0 && (
        <section className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/5 p-3">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-300">
            <Tag size={15} /> Review queue
            <span className="rounded-full bg-amber-200 dark:bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-bold">{pending.length}</span>
          </h3>
          <p className="mb-2.5 text-[11px] text-amber-700/80 dark:text-amber-300/70">
            Proposed while building a schedule. Promote one to a real activity, fold it into an existing one, or retire it.
          </p>
          <div className="space-y-2">
            {pending.map((e) => (
              <ReviewQueueItem
                key={e.id}
                entry={e}
                activeEntries={activeEntries}
                canManage={canManage}
                onPromote={() => run(() => setStatus.mutateAsync({ id: e.id, status: 'active' }))}
                onDeprecate={() => run(() => setStatus.mutateAsync({ id: e.id, status: 'deprecated' }))}
                onMerge={(targetId) =>
                  run(async () => {
                    await addAlias.mutateAsync({ id: targetId, alias: e.name });
                    await setStatus.mutateAsync({ id: e.id, status: 'deprecated' });
                  })
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Add an activity ──────────────────────────────────────────── */}
      {canManage && (
        <section>
          {!adding ? (
            <button
              type="button"
              onClick={() => { setAdding(true); setError(''); }}
              className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 dark:border-white/15 px-3 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
            >
              <Plus size={15} /> Add an activity
            </button>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">New activity</span>
                <button type="button" onClick={() => setAdding(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={15} /></button>
              </div>
              <input
                type="text"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
                placeholder="Name (e.g. MEP Rough-In)"
                className="mb-2.5 w-full rounded-lg border border-slate-300 dark:border-white/15 bg-white dark:bg-black/25 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500/40"
              />
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Type</span>
                  {(['task', 'milestone'] as ActivityType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setNewType(t)}
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
                        newType === t ? 'border-sky-500 bg-sky-500 text-white' : 'border-slate-300 dark:border-white/15 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
                      }`}
                    >
                      {t === 'task' ? 'Task' : 'Milestone'}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Default scope</span>
                  <ScopeCombobox
                    value={newTrack}
                    onChange={setNewTrack}
                    suggestions={trackSuggestions}
                    placeholder="optional"
                    className="w-36"
                    inputClassName="w-full rounded-lg border border-slate-300 dark:border-white/15 bg-white dark:bg-black/25 pl-2 pr-7 py-1 text-xs outline-none focus:ring-2 focus:ring-sky-500/40"
                  />
                </div>
              </div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Show in these project types</div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {PROJECT_TYPES.map((pt) => {
                  const on = newProjectTypes.includes(pt);
                  return (
                    <button
                      key={pt}
                      type="button"
                      onClick={() => toggleNewProjectType(pt)}
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                        on
                          ? 'border-sky-300 bg-sky-100 text-sky-700 dark:border-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
                          : 'border-slate-200 dark:border-white/10 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10'
                      }`}
                    >
                      {pt}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={handleAdd}
                disabled={!newName.trim() || upsert.isPending}
                className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-600 disabled:opacity-40 transition-colors"
              >
                {upsert.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add to dictionary
              </button>
            </div>
          )}
        </section>
      )}

      {/* ── Filter bar + bulk tag cleanup ────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
                statusFilter === f.value ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[160px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search names or aliases…"
            className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-sky-500/40"
          />
        </div>
        {canManage && taggedCount > 0 && (
          confirmClear ? (
            <div className="flex items-center gap-1">
              <button type="button" onClick={clearAllTags} className="rounded-lg bg-red-500 px-2.5 py-1 text-xs font-bold text-white hover:bg-red-600 transition-colors">
                Clear {taggedCount} tags
              </button>
              <button type="button" onClick={() => setConfirmClear(false)} className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">Cancel</button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              title="Remove the default-scope tag from every activity (clean up the messy imported tags)"
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-white/15 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
            >
              <Eraser size={13} /> Clear all tags
            </button>
          )
        )}
      </div>

      {/* ── Dictionary list (grouped by default-scope tag) ───────────── */}
      {isLoading ? (
        <div className="flex justify-center py-10 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : grouped.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-white/10 py-8 text-center text-sm text-slate-500">
          {activeScope ? `No activities in “${activeScope}”.` : 'No activities match.'}
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => (
            <div key={group.track || '__none__'}>
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <Flag size={11} /> {group.label}
              </div>
              <div className="space-y-1.5">
                {group.items.map((e) => (
                  <ActivityRow
                    key={e.id}
                    entry={e}
                    canManage={canManage}
                    trackSuggestions={trackSuggestions}
                    onSetStatus={(status) => run(() => setStatus.mutateAsync({ id: e.id, status }))}
                    onAddAlias={(alias) => run(() => addAlias.mutateAsync({ id: e.id, alias }))}
                    onSetTrack={(track) => run(() => upsert.mutateAsync({ id: e.id, name: e.name, track }))}
                    onSetProjectTypes={(types) => run(() => upsert.mutateAsync({ id: e.id, name: e.name, defaultProjectTypes: types }))}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Review-queue item ───────────────────────────────────────────────────────

interface ReviewQueueItemProps {
  entry: ActivityDictionaryEntry;
  activeEntries: ActivityDictionaryEntry[];
  canManage: boolean;
  onPromote: () => void;
  onDeprecate: () => void;
  onMerge: (targetId: string) => void;
}

function ReviewQueueItem({ entry, activeEntries, canManage, onPromote, onDeprecate, onMerge }: ReviewQueueItemProps) {
  const [merging, setMerging] = useState(false);
  const [target, setTarget] = useState('');
  return (
    <div className="rounded-lg border border-amber-200/70 dark:border-amber-500/20 bg-white dark:bg-black/20 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{entry.name}</span>
          {entry.proposed_note && entry.proposed_note !== entry.name && (
            <p className="mt-0.5 text-[11px] italic text-slate-500 dark:text-slate-400">“{entry.proposed_note}”</p>
          )}
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={onPromote} className="rounded-md bg-emerald-500 px-2 py-1 text-[11px] font-bold text-white hover:bg-emerald-600 transition-colors">Promote</button>
            <button type="button" onClick={() => setMerging((m) => !m)} className="rounded-md border border-slate-300 dark:border-white/15 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">Alias into…</button>
            <button type="button" onClick={onDeprecate} className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">Retire</button>
          </div>
        )}
      </div>
      {merging && (
        <div className="mt-2 flex items-center gap-1.5 border-t border-amber-200/50 dark:border-amber-500/10 pt-2">
          <CornerDownRight size={14} className="shrink-0 text-slate-400" />
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="flex-1 min-w-0 rounded-md border border-slate-300 dark:border-white/15 bg-white dark:bg-black/30 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-sky-500/40">
            <option value="">Fold into which activity?</option>
            {activeEntries.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button type="button" disabled={!target} onClick={() => { if (target) { onMerge(target); setMerging(false); setTarget(''); } }} className="rounded-md bg-sky-500 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-sky-600 disabled:opacity-40 transition-colors">Fold in</button>
        </div>
      )}
    </div>
  );
}

// ── Dictionary row ──────────────────────────────────────────────────────────

interface ActivityRowProps {
  entry: ActivityDictionaryEntry;
  canManage: boolean;
  trackSuggestions: string[];
  onSetStatus: (status: ActivityDictionaryStatus) => void;
  onAddAlias: (alias: string) => void;
  onSetTrack: (track: string | null) => void;
  onSetProjectTypes: (types: ProjectType[]) => void;
}

function ActivityRow({ entry, canManage, trackSuggestions, onSetStatus, onAddAlias, onSetTrack, onSetProjectTypes }: ActivityRowProps) {
  const [editingTrack, setEditingTrack] = useState(false);
  const [trackDraft, setTrackDraft] = useState(entry.track || '');
  const [aliasing, setAliasing] = useState(false);
  const [aliasText, setAliasText] = useState('');
  const [editingTypes, setEditingTypes] = useState(false);
  const [draftTypes, setDraftTypes] = useState<ProjectType[]>(entry.default_project_types);

  const saveTrack = () => {
    const next = trackDraft.trim();
    setEditingTrack(false);
    if (next !== (entry.track || '')) onSetTrack(next || null);
  };

  const openTypes = () => { setDraftTypes(entry.default_project_types); setEditingTypes(true); };
  const toggleDraftType = (pt: ProjectType) =>
    setDraftTypes((prev) => (prev.includes(pt) ? prev.filter((p) => p !== pt) : [...prev, pt]));
  const commitTypes = () => { onSetProjectTypes(draftTypes); setEditingTypes(false); };

  const allTypes = entry.default_project_types.length === PROJECT_TYPES.length;
  const typesSummary = allTypes
    ? 'All project types'
    : entry.default_project_types.length
      ? entry.default_project_types.join(', ')
      : 'All project types';

  return (
    <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`text-sm font-semibold ${entry.status === 'deprecated' ? 'text-slate-400 line-through' : 'text-slate-800 dark:text-slate-100'}`}>{entry.name}</span>
          <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{entry.type}</span>
          <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${STATUS_BADGE[entry.status as ActivityDictionaryStatus]}`}>{entry.status === 'deprecated' ? 'retired' : entry.status}</span>
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => (editingTypes ? setEditingTypes(false) : openTypes())}
              title="Choose which project types show this activity"
              className={`rounded-md p-1 transition-colors ${editingTypes ? 'text-sky-500 bg-sky-50 dark:bg-sky-500/10' : 'text-slate-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-500/10'}`}
            >
              <Building2 size={14} />
            </button>
            <button type="button" onClick={() => setAliasing((a) => !a)} className="rounded-md border border-slate-300 dark:border-white/15 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">Alias</button>
            {entry.status === 'deprecated' ? (
              <button type="button" onClick={() => onSetStatus('active')} className="rounded-md px-2 py-0.5 text-[11px] font-semibold text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors">Restore</button>
            ) : (
              <button type="button" onClick={() => onSetStatus('deprecated')} className="rounded-md px-2 py-0.5 text-[11px] font-semibold text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">Retire</button>
            )}
          </div>
        )}
      </div>

      {/* Default-scope tag (editable) */}
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
        <span className="text-slate-400">Default scope:</span>
        {editingTrack && canManage ? (
          <ScopeCombobox
            value={trackDraft}
            onChange={setTrackDraft}
            onCommit={() => saveTrack()}
            commitOnBlur
            autoFocus
            suggestions={trackSuggestions}
            placeholder="none"
            className="w-40"
            inputClassName="w-full rounded border border-slate-300 dark:border-white/15 bg-white dark:bg-black/30 pl-1.5 pr-6 py-0.5 text-[11px] outline-none focus:ring-2 focus:ring-sky-500/40"
          />
        ) : (
          <button
            type="button"
            disabled={!canManage}
            onClick={() => { setTrackDraft(entry.track || ''); setEditingTrack(true); }}
            className={`rounded px-1.5 py-0.5 font-semibold transition-colors ${
              entry.track ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' : 'text-slate-400 italic'
            } ${canManage ? 'hover:ring-1 hover:ring-sky-400 cursor-pointer' : ''}`}
          >
            {entry.track || 'none — click to set'}
          </button>
        )}
      </div>

      {/* Project-type visibility (summary + inline editor) */}
      <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
        <Building2 size={11} className="shrink-0" />
        <span className="truncate" title={typesSummary}>{typesSummary}</span>
      </div>

      {editingTypes && canManage && (
        <div className="mt-2 border-t border-slate-100 dark:border-white/5 pt-2">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Show in these project types</div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {PROJECT_TYPES.map((pt) => {
              const on = draftTypes.includes(pt);
              return (
                <button
                  key={pt}
                  type="button"
                  onClick={() => toggleDraftType(pt)}
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    on
                      ? 'border-sky-300 bg-sky-100 text-sky-700 dark:border-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
                      : 'border-slate-200 dark:border-white/10 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10'
                  }`}
                >
                  {pt}
                </button>
              );
            })}
          </div>
          <p className="mb-2 text-[10px] italic text-slate-400">Leave all off to show this activity for every project type.</p>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={commitTypes} className="flex items-center gap-1 rounded-md bg-sky-500 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-sky-600 transition-colors"><Check size={13} /> Save</button>
            <button type="button" onClick={() => setEditingTypes(false)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">Cancel</button>
          </div>
        </div>
      )}

      {/* Aliases */}
      {entry.aliases.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {entry.aliases.map((a) => (
            <span key={a} className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-400">{a}</span>
          ))}
        </div>
      )}

      {aliasing && canManage && (
        <div className="mt-2 flex items-center gap-1.5 border-t border-slate-200/70 dark:border-white/10 pt-2">
          <CornerDownRight size={13} className="shrink-0 text-slate-400" />
          <input
            type="text"
            value={aliasText}
            onChange={(e) => setAliasText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const a = aliasText.trim(); if (a) { onAddAlias(a); setAliasText(''); setAliasing(false); } } }}
            placeholder="Add a synonym (e.g. Rough-Ins)"
            className="flex-1 min-w-0 rounded-md border border-slate-300 dark:border-white/15 bg-white dark:bg-black/30 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-sky-500/40"
          />
          <button type="button" disabled={!aliasText.trim()} onClick={() => { const a = aliasText.trim(); if (a) { onAddAlias(a); setAliasText(''); setAliasing(false); } }} className="rounded-md bg-sky-500 px-2 py-1 text-[11px] font-bold text-white hover:bg-sky-600 disabled:opacity-40 transition-colors"><Check size={13} /></button>
        </div>
      )}
    </div>
  );
}

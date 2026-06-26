"use client";
import React, { useState } from 'react';
import {
  Plus, Check, X, Search, AlertCircle, Loader2, Tag, CornerDownRight, Info, Building2,
} from 'lucide-react';
import {
  useSubtypes, useUpsertSubtype, useSetSubtypeStatus, useAddSubtypeAlias,
} from '@/hooks/useSubtypes';
import { useTaxonomyAdminStore } from '@/store/useTaxonomyAdminStore';
import { filterSubtypesForAdmin, groupSubtypesByRole, type AdminStatusFilter } from '@/utils/subtypes';
import { CANONICAL_ROLES, PROJECT_TYPES, roleLabel } from '@/utils/locationTaxonomy';
import type { Subtype, SubtypeStatus, TopLevelRole, ProjectType } from '@/types/domain';

const STATUS_FILTERS: { value: AdminStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'deprecated', label: 'Retired' },
];

const STATUS_BADGE: Record<SubtypeStatus, string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  deprecated: 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
};

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong — please try again.';
}

interface LocationLibraryPanelProps {
  /** Writes are RLS-gated to owner/admin/pm; false renders the list read-only. */
  canManage?: boolean;
}

/**
 * Global Location Library admin (Location Taxonomy, Phase 4). Lives in the
 * cross-project Global Settings modal because the sub-type dictionary is a
 * single shared list — editing it changes every project. Surfaces:
 *   1. a review queue of `status='pending'` proposals (the "Other (pending)"
 *      entries field users tagged while tracing) → promote / alias / retire;
 *   2. add a sub-type (name + canonical role + default project-type scoping);
 *   3. the full dictionary grouped by canonical role, filterable by status +
 *      searchable across names and aliases, with per-row status + alias controls.
 *
 * Canonical vs display: the stored value is always the canonical role; we render
 * it via `roleLabel`. An alias maps an alias *name* → a canonical sub-type; it
 * never changes a stored role.
 */
export default function LocationLibraryPanel({ canManage = true }: LocationLibraryPanelProps) {
  const { data: subtypes = [], isLoading } = useSubtypes();
  const upsert = useUpsertSubtype();
  const setStatus = useSetSubtypeStatus();
  const addAlias = useAddSubtypeAlias();

  const { statusFilter, setStatusFilter, search, setSearch } = useTaxonomyAdminStore();

  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<TopLevelRole>('program');
  const [newDefaults, setNewDefaults] = useState<ProjectType[]>([]);

  const pending = subtypes.filter(s => s.status === 'pending');
  const activeSubtypes = subtypes.filter(s => s.status === 'active');
  const filtered = filterSubtypesForAdmin(subtypes, statusFilter, search);
  const grouped = groupSubtypesByRole(filtered);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try { await fn(); } catch (e) { setError(errMessage(e)); }
  };

  const handleAdd = () =>
    run(async () => {
      const name = newName.trim();
      if (!name) return;
      await upsert.mutateAsync({ name, role: newRole, defaultProjectTypes: newDefaults, status: 'active' });
      setNewName('');
      setNewDefaults([]);
      setAdding(false);
    });

  const toggleDefault = (pt: ProjectType) =>
    setNewDefaults(prev => (prev.includes(pt) ? prev.filter(p => p !== pt) : [...prev, pt]));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400 text-balance">
          A single shared list of location types used across <span className="font-semibold">all</span> projects.
          Add or retire types, fold synonyms into a canonical name, choose which project types each one shows up
          for, and review the proposals your team tags while tracing. Changes here apply everywhere.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-xs font-medium text-red-700 dark:text-red-300">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Review queue ─────────────────────────────────────────────── */}
      {pending.length > 0 && (
        <section className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/5 p-3">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-300">
            <Tag size={15} /> Review queue
            <span className="rounded-full bg-amber-200 dark:bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-bold">
              {pending.length}
            </span>
          </h3>
          <p className="mb-2.5 text-[11px] text-amber-700/80 dark:text-amber-300/70">
            Proposed while tracing. Promote one to a real type, fold it into an existing type, or retire it.
          </p>
          <div className="space-y-2">
            {pending.map(s => (
              <ReviewQueueItem
                key={s.id}
                subtype={s}
                activeSubtypes={activeSubtypes}
                canManage={canManage}
                onPromote={() => run(() => setStatus.mutateAsync({ id: s.id, status: 'active' }))}
                onDeprecate={() => run(() => setStatus.mutateAsync({ id: s.id, status: 'deprecated' }))}
                onMerge={(targetId) =>
                  run(async () => {
                    await addAlias.mutateAsync({ id: targetId, alias: s.name });
                    await setStatus.mutateAsync({ id: s.id, status: 'deprecated' });
                  })
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Add a sub-type ───────────────────────────────────────────── */}
      {canManage && (
        <section>
          {!adding ? (
            <button
              type="button"
              onClick={() => { setAdding(true); setError(''); }}
              className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 dark:border-white/15 px-3 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
            >
              <Plus size={15} /> Add a location type
            </button>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">New location type</span>
                <button type="button" onClick={() => setAdding(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                  <X size={15} />
                </button>
              </div>
              <input
                type="text"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
                placeholder="Name (e.g. Imaging/Radiology)"
                className="mb-2.5 w-full rounded-lg border border-slate-300 dark:border-white/15 bg-white dark:bg-black/25 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500/40"
              />
              <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Category</div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {CANONICAL_ROLES.map(role => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setNewRole(role)}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
                      newRole === role
                        ? 'border-sky-500 bg-sky-500 text-white'
                        : 'border-slate-300 dark:border-white/15 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
                    }`}
                  >
                    {roleLabel(role, null)}
                  </button>
                ))}
              </div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Show in these project types
              </div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {PROJECT_TYPES.map(pt => {
                  const on = newDefaults.includes(pt);
                  return (
                    <button
                      key={pt}
                      type="button"
                      onClick={() => toggleDefault(pt)}
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

      {/* ── Filter bar ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
                statusFilter === f.value
                  ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10'
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
      </div>

      {/* ── Dictionary list ──────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex justify-center py-10 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-white/10 py-8 text-center text-sm text-slate-500">
          No location types match.
        </div>
      ) : (
        <div className="space-y-4">
          {CANONICAL_ROLES.map(role =>
            grouped[role].length > 0 ? (
              <div key={role}>
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {roleLabel(role, null)}
                </div>
                <div className="space-y-1.5">
                  {grouped[role].map(s => (
                    <DictionaryRow
                      key={s.id}
                      subtype={s}
                      canManage={canManage}
                      onSetStatus={(status) => run(() => setStatus.mutateAsync({ id: s.id, status }))}
                      onAddAlias={(alias) => run(() => addAlias.mutateAsync({ id: s.id, alias }))}
                      onSetProjectTypes={(defaults) =>
                        run(() =>
                          upsert.mutateAsync({
                            id: s.id,
                            name: s.name,
                            role: s.top_level_role as TopLevelRole,
                            defaultProjectTypes: defaults,
                          }),
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </div>
      )}

      {/* Concept #2 (deferred) — old locations with a category but no specific type. */}
      <div className="flex items-start gap-2 rounded-lg bg-slate-50 dark:bg-white/5 px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400">
        <Info size={13} className="mt-0.5 shrink-0" />
        <span>
          Assigning a specific type to older locations that only have a category is a per-location job —
          it’ll live in the Manage workspace’s bulk edit, not here.
        </span>
      </div>
    </div>
  );
}

// ── Review-queue item ───────────────────────────────────────────────────────

interface ReviewQueueItemProps {
  subtype: Subtype;
  activeSubtypes: Subtype[];
  canManage: boolean;
  onPromote: () => void;
  onDeprecate: () => void;
  onMerge: (targetId: string) => void;
}

function ReviewQueueItem({ subtype, activeSubtypes, canManage, onPromote, onDeprecate, onMerge }: ReviewQueueItemProps) {
  const [merging, setMerging] = useState(false);
  const [target, setTarget] = useState('');

  return (
    <div className="rounded-lg border border-amber-200/70 dark:border-amber-500/20 bg-white dark:bg-black/20 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{subtype.name}</span>
          <span className="ml-2 text-[11px] text-slate-400">{roleLabel(subtype.top_level_role as TopLevelRole, null)}</span>
          {subtype.proposed_note && subtype.proposed_note !== subtype.name && (
            <p className="mt-0.5 text-[11px] italic text-slate-500 dark:text-slate-400">“{subtype.proposed_note}”</p>
          )}
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onPromote}
              className="rounded-md bg-emerald-500 px-2 py-1 text-[11px] font-bold text-white hover:bg-emerald-600 transition-colors"
            >
              Promote
            </button>
            <button
              type="button"
              onClick={() => setMerging(m => !m)}
              className="rounded-md border border-slate-300 dark:border-white/15 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
            >
              Alias into…
            </button>
            <button
              type="button"
              onClick={onDeprecate}
              className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              Retire
            </button>
          </div>
        )}
      </div>
      {merging && (
        <div className="mt-2 flex items-center gap-1.5 border-t border-amber-200/50 dark:border-amber-500/10 pt-2">
          <CornerDownRight size={14} className="shrink-0 text-slate-400" />
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="flex-1 min-w-0 rounded-md border border-slate-300 dark:border-white/15 bg-white dark:bg-black/30 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-sky-500/40"
          >
            <option value="">Fold into which type?</option>
            {activeSubtypes.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={!target}
            onClick={() => { if (target) { onMerge(target); setMerging(false); setTarget(''); } }}
            className="rounded-md bg-sky-500 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-sky-600 disabled:opacity-40 transition-colors"
          >
            Fold in
          </button>
        </div>
      )}
    </div>
  );
}

// ── Dictionary row ──────────────────────────────────────────────────────────

interface DictionaryRowProps {
  subtype: Subtype;
  canManage: boolean;
  onSetStatus: (status: SubtypeStatus) => void;
  onAddAlias: (alias: string) => void;
  onSetProjectTypes: (defaults: ProjectType[]) => void;
}

function DictionaryRow({ subtype, canManage, onSetStatus, onAddAlias, onSetProjectTypes }: DictionaryRowProps) {
  const aliasingId = useTaxonomyAdminStore(s => s.aliasingId);
  const setAliasingId = useTaxonomyAdminStore(s => s.setAliasingId);
  const open = aliasingId === subtype.id;
  const [aliasText, setAliasText] = useState('');

  // Inline project-type visibility editor (which project types this type shows
  // up for in the tracing picker). Local, transient state — multiple rows can be
  // open independently; the draft commits as one upsert via onSetProjectTypes.
  const [editingTypes, setEditingTypes] = useState(false);
  const [draftTypes, setDraftTypes] = useState<ProjectType[]>(subtype.default_project_types);

  const openTypes = () => { setDraftTypes(subtype.default_project_types); setEditingTypes(true); };
  const toggleDraft = (pt: ProjectType) =>
    setDraftTypes(prev => (prev.includes(pt) ? prev.filter(p => p !== pt) : [...prev, pt]));
  const commitTypes = () => { onSetProjectTypes(draftTypes); setEditingTypes(false); };

  const allTypes = subtype.default_project_types.length === PROJECT_TYPES.length;
  const typesSummary = allTypes
    ? 'All project types'
    : subtype.default_project_types.length
      ? subtype.default_project_types.join(', ')
      : 'No project types';

  const commitAlias = () => {
    const v = aliasText.trim();
    if (!v) return;
    onAddAlias(v);
    setAliasText('');
    setAliasingId(null);
  };

  return (
    <div className={`rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 p-2.5 ${subtype.status === 'deprecated' ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{subtype.name}</span>
          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${STATUS_BADGE[subtype.status as SubtypeStatus]}`}>
            {subtype.status === 'deprecated' ? 'retired' : subtype.status}
          </span>
          {subtype.aliases.length > 0 && (
            <span className="text-[11px] text-slate-400" title={subtype.aliases.join(', ')}>
              {subtype.aliases.length} alias{subtype.aliases.length === 1 ? '' : 'es'}
            </span>
          )}
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => (editingTypes ? setEditingTypes(false) : openTypes())}
              className={`rounded-md p-1 transition-colors ${editingTypes ? 'text-sky-500 bg-sky-50 dark:bg-sky-500/10' : 'text-slate-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-500/10'}`}
              title="Choose which project types show this type"
            >
              <Building2 size={14} />
            </button>
            <button
              type="button"
              onClick={() => { setAliasingId(open ? null : subtype.id); setAliasText(''); }}
              className="rounded-md p-1 text-slate-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-500/10 transition-colors"
              title="Add an alias (synonym)"
            >
              <Tag size={14} />
            </button>
            <select
              value={subtype.status}
              onChange={(e) => onSetStatus(e.target.value as SubtypeStatus)}
              className="rounded-md border border-slate-200 dark:border-white/15 bg-slate-50 dark:bg-black/20 px-1.5 py-1 text-[11px] font-semibold outline-none focus:ring-2 focus:ring-sky-500/40"
            >
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="deprecated">Retired</option>
            </select>
          </div>
        )}
      </div>

      {/* Current project-type visibility (always shown, read-only summary). */}
      <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
        <Building2 size={11} className="shrink-0" />
        <span className="truncate" title={typesSummary}>{typesSummary}</span>
      </div>

      {editingTypes && canManage && (
        <div className="mt-2 border-t border-slate-100 dark:border-white/5 pt-2">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Show in these project types
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {PROJECT_TYPES.map(pt => {
              const on = draftTypes.includes(pt);
              return (
                <button
                  key={pt}
                  type="button"
                  onClick={() => toggleDraft(pt)}
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
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={commitTypes}
              className="flex items-center gap-1 rounded-md bg-sky-500 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-sky-600 transition-colors"
            >
              <Check size={13} /> Save
            </button>
            <button
              type="button"
              onClick={() => setEditingTypes(false)}
              className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {subtype.aliases.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {subtype.aliases.map(a => (
            <span key={a} className="rounded bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-400">
              {a}
            </span>
          ))}
        </div>
      )}

      {open && canManage && (
        <div className="mt-2 flex items-center gap-1.5 border-t border-slate-100 dark:border-white/5 pt-2">
          <input
            type="text"
            autoFocus
            value={aliasText}
            onChange={(e) => setAliasText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitAlias(); } }}
            placeholder={`Synonym for “${subtype.name}”…`}
            className="flex-1 min-w-0 rounded-md border border-slate-300 dark:border-white/15 bg-white dark:bg-black/30 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-sky-500/40"
          />
          <button
            type="button"
            onClick={commitAlias}
            disabled={!aliasText.trim()}
            className="rounded-md bg-sky-500 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-sky-600 disabled:opacity-40 transition-colors"
          >
            <Check size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

"use client";
import React, { useState } from 'react';
import {
  Layers, ChevronDown, ChevronRight, Plus, Check, X, Pencil,
  Archive, ArchiveRestore, Trash2, ArrowUp, ArrowDown, Loader2,
} from 'lucide-react';
import {
  useAddActivityScope,
  useRenameActivityScope,
  useSetActivityScopeStatus,
  useDeleteActivityScope,
  useReorderActivityScopes,
} from '@/hooks/useActivityScopes';
import { buildScopeChips } from '@/utils/activityScopes';
import type { ActivityScope } from '@/types/domain';

interface ScopesManagerBarProps {
  scopes: ActivityScope[];
  /** Each activity's `track`, for per-scope usage counts + surfacing unmanaged scopes. */
  entryTracks: (string | null | undefined)[];
  /** Active scope filter (by name) applied to the activity list below; null = all. */
  activeScope: string | null;
  onSelectScope: (name: string | null) => void;
  canManage: boolean;
  onError: (msg: string) => void;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong — please try again.';
}

/**
 * The collapsible "Scopes of Work" bar that sits atop the Activity Library
 * (Scheduling UX Hardening). Collapsed, it's a row of scope chips that double as the
 * activity-list FILTER (click one to narrow the list; "All" clears it). Expanded, it's
 * the manager: add / rename / reorder / archive / delete the company-wide scope palette
 * (`activity_scopes`). Managed scopes link to activities by name only, so nothing here
 * touches the status/progress pipeline. Writes are RLS-gated to owner/admin/pm.
 */
export default function ScopesManagerBar({
  scopes, entryTracks, activeScope, onSelectScope, canManage, onError,
}: ScopesManagerBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const add = useAddActivityScope();
  const rename = useRenameActivityScope();
  const setStatus = useSetActivityScopeStatus();
  const del = useDeleteActivityScope();
  const reorder = useReorderActivityScopes();

  const chips = buildScopeChips(scopes, entryTracks);

  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { onError(errMessage(e)); }
  };

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    run(async () => { await add.mutateAsync({ name }); setNewName(''); setAdding(false); });
  };

  const saveRename = (s: ActivityScope) => {
    const next = editDraft.trim();
    setEditingId(null);
    if (next && next !== s.name) run(() => rename.mutateAsync({ id: s.id, oldName: s.name, name: next }));
  };

  const move = (index: number, dir: -1 | 1) => {
    const next = [...scopes];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    run(() => reorder.mutateAsync({ orderedIds: next.map((s) => s.id) }));
  };

  return (
    <section className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.03]">
      {/* ── Header + chip filter row ─────────────────────────────────── */}
      <div className="flex items-start gap-2 p-2.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-500 hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors"
          title={expanded ? 'Collapse' : 'Manage scopes'}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Layers size={13} /> Scopes of Work
        </button>

        <div className="flex flex-1 flex-wrap items-center gap-1.5">
          <FilterChip label="All" active={activeScope === null} onClick={() => onSelectScope(null)} />
          {chips.map((c) => (
            <FilterChip
              key={c.name}
              label={c.name}
              count={c.count}
              active={activeScope === c.name}
              unmanaged={!c.managed}
              onClick={() => onSelectScope(activeScope === c.name ? null : c.name)}
            />
          ))}
          {chips.length === 0 && (
            <span className="text-[11px] italic text-slate-400">No scopes yet — expand to add one.</span>
          )}
        </div>
      </div>

      {/* ── Expanded manager ─────────────────────────────────────────── */}
      {expanded && (
        <div className="border-t border-slate-200 dark:border-white/10 p-2.5">
          <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
            The company-wide list of scope-of-work buckets. Add, rename, reorder, or retire them —
            they feed every scope picker in the app. Reordering sets the order scopes appear as tabs.
          </p>

          <div className="space-y-1.5">
            {scopes.map((s, i) => {
              const usage = chips.find((c) => c.name === s.name)?.count ?? 0;
              const archived = s.status === 'archived';
              return (
                <div
                  key={s.id}
                  className={`flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 px-2 py-1.5 ${archived ? 'opacity-60' : ''}`}
                >
                  {canManage && !archived && (
                    <div className="flex flex-col">
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-slate-300 hover:text-slate-600 dark:hover:text-slate-200 disabled:opacity-30"><ArrowUp size={12} /></button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === scopes.length - 1} className="text-slate-300 hover:text-slate-600 dark:hover:text-slate-200 disabled:opacity-30"><ArrowDown size={12} /></button>
                    </div>
                  )}

                  {editingId === s.id && canManage ? (
                    <input
                      type="text"
                      autoFocus
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveRename(s); } if (e.key === 'Escape') setEditingId(null); }}
                      onBlur={() => saveRename(s)}
                      className="flex-1 min-w-0 rounded border border-slate-300 dark:border-white/15 bg-white dark:bg-black/30 px-2 py-0.5 text-sm outline-none focus:ring-2 focus:ring-sky-500/40"
                    />
                  ) : (
                    <span className="flex-1 min-w-0 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {s.name}
                      {archived && <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">archived</span>}
                    </span>
                  )}

                  <span className="shrink-0 rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400" title={`${usage} activit${usage === 1 ? 'y' : 'ies'} use this scope`}>
                    {usage}
                  </span>

                  {canManage && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      {!archived && editingId !== s.id && (
                        <button type="button" onClick={() => { setEditingId(s.id); setEditDraft(s.name); }} title="Rename" className="rounded p-1 text-slate-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-500/10"><Pencil size={13} /></button>
                      )}
                      {archived ? (
                        <button type="button" onClick={() => run(() => setStatus.mutateAsync({ id: s.id, status: 'active' }))} title="Restore" className="rounded p-1 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"><ArchiveRestore size={13} /></button>
                      ) : (
                        <button type="button" onClick={() => run(() => setStatus.mutateAsync({ id: s.id, status: 'archived' }))} title="Archive (hide, keep history)" className="rounded p-1 text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10"><Archive size={13} /></button>
                      )}
                      {confirmDeleteId === s.id ? (
                        <span className="flex items-center gap-0.5">
                          <button type="button" onClick={() => { run(() => del.mutateAsync({ id: s.id })); setConfirmDeleteId(null); }} className="rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-red-600">Delete</button>
                          <button type="button" onClick={() => setConfirmDeleteId(null)} className="rounded p-0.5 text-slate-400 hover:text-slate-600"><X size={12} /></button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setConfirmDeleteId(s.id)} title="Delete permanently" className="rounded p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"><Trash2 size={13} /></button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add a scope */}
          {canManage && (
            <div className="mt-2">
              {!adding ? (
                <button
                  type="button"
                  onClick={() => { setAdding(true); }}
                  className="flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 dark:border-white/15 px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                >
                  <Plus size={14} /> Add a scope
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } if (e.key === 'Escape') { setAdding(false); setNewName(''); } }}
                    placeholder="New scope name (e.g. Sitework)"
                    className="flex-1 min-w-0 rounded-lg border border-slate-300 dark:border-white/15 bg-white dark:bg-black/25 px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500/40"
                  />
                  <button type="button" onClick={handleAdd} disabled={!newName.trim() || add.isPending} className="flex items-center gap-1 rounded-lg bg-sky-500 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-sky-600 disabled:opacity-40">
                    {add.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Add
                  </button>
                  <button type="button" onClick={() => { setAdding(false); setNewName(''); }} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">Cancel</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── Filter chip ─────────────────────────────────────────────────────────────

interface FilterChipProps {
  label: string;
  count?: number;
  active: boolean;
  unmanaged?: boolean;
  onClick: () => void;
}

function FilterChip({ label, count, active, unmanaged, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={unmanaged ? 'Used by an activity but not in the managed list — expand to add it' : undefined}
      className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
        active
          ? 'border-sky-500 bg-sky-500 text-white'
          : unmanaged
            ? 'border-dashed border-amber-300 dark:border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/10'
            : 'border-slate-300 dark:border-white/15 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
      }`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className={`rounded-full px-1 text-[9px] font-bold ${active ? 'bg-white/25' : 'bg-slate-200/70 dark:bg-white/10'}`}>{count}</span>
      )}
    </button>
  );
}

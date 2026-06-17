"use client";
import React, { useState } from 'react';
import { Check, Plus, ChevronLeft } from 'lucide-react';
import { CANONICAL_ROLES, roleLabel } from '@/utils/locationTaxonomy';
import { orderedSubtypesByRole, type TaxonomyResult } from '@/utils/subtypes';
import type { Subtype, ProjectType, TopLevelRole } from '@/types/domain';

interface TaxonomyPickerProps {
  subtypes: Subtype[];
  projectType: ProjectType | null;
  /** Highlight the row matching this sub-type id (the location's current sub-type). */
  selectedSubtypeId?: string | null;
  /** Fired when the user picks an existing sub-type or commits an "Other (pending)" proposal. */
  onPick: (result: TaxonomyResult) => void;
  /** `menu` = denser styling for the Manage row dropdown; `popover` = the trace popover. */
  variant?: 'menu' | 'popover';
}

/**
 * Shared role + sub-type picker (Location Taxonomy, Phase 3). Lists the governed
 * dictionary grouped by canonical role (friendly labels via `roleLabel`), ordered
 * defaults-first for the project type, plus a non-blocking "Other (pending)"
 * proposal affordance. Used by both the trace popover and the Manage "Change type"
 * menu so the two surfaces stay identical. Presentation-only: the canonical role
 * is what gets stored/exported, never the display label.
 */
export default function TaxonomyPicker({
  subtypes,
  projectType,
  selectedSubtypeId,
  onPick,
  variant = 'popover',
}: TaxonomyPickerProps) {
  const groups = orderedSubtypesByRole(subtypes, projectType);
  const [proposing, setProposing] = useState(false);
  const [pendingRole, setPendingRole] = useState<TopLevelRole>('other');
  const [pendingName, setPendingName] = useState('');

  const rowBase =
    'w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-left rounded-lg transition-colors';
  const rowIdle = 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10';
  const rowActive = 'bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 font-semibold';

  const commitPending = () => {
    const name = pendingName.trim();
    if (!name) return;
    onPick({ kind: 'pending', role: pendingRole, name });
    setPendingName('');
    setProposing(false);
  };

  return (
    <div className={variant === 'menu' ? 'py-1' : ''}>
      {projectType == null && (
        <p className="px-2 pb-2 text-[11px] leading-snug text-slate-400">
          Set a project type in Settings for tailored ordering.
        </p>
      )}

      <div className="max-h-[230px] overflow-y-auto overscroll-contain pr-0.5">
        {CANONICAL_ROLES.map((role) =>
          groups[role].length > 0 ? (
            <div key={role} className="mb-1.5 last:mb-0">
              <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                {roleLabel(role, projectType)}
              </div>
              {groups[role].map((s) => {
                const active = s.id === selectedSubtypeId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() =>
                      onPick({ kind: 'subtype', subtypeId: s.id, name: s.name, role: s.top_level_role as TopLevelRole })
                    }
                    className={`${rowBase} ${active ? rowActive : rowIdle}`}
                  >
                    <span className="flex-1 truncate">{s.name}</span>
                    {active && <Check size={15} className="shrink-0 text-sky-500" />}
                  </button>
                );
              })}
            </div>
          ) : null,
        )}
      </div>

      {/* Other (pending) — non-blocking proposal of a new governed sub-type. */}
      <div className="mt-1.5 border-t border-slate-200 dark:border-white/10 pt-1.5">
        {!proposing ? (
          <button
            type="button"
            onClick={() => setProposing(true)}
            className={`${rowBase} ${rowIdle} text-slate-500 dark:text-slate-400`}
          >
            <Plus size={15} className="shrink-0" />
            <span className="flex-1">Other (pending)…</span>
          </button>
        ) : (
          <div className="px-1.5 pb-1">
            <button
              type="button"
              onClick={() => setProposing(false)}
              className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 mb-1.5"
            >
              <ChevronLeft size={13} /> Back
            </button>
            <div className="flex flex-wrap gap-1 mb-2">
              {CANONICAL_ROLES.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setPendingRole(role)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-colors ${
                    pendingRole === role
                      ? 'bg-sky-500 border-sky-500 text-white'
                      : 'border-slate-300 dark:border-white/15 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
                  }`}
                >
                  {roleLabel(role, projectType)}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                autoFocus
                value={pendingName}
                onChange={(e) => setPendingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitPending();
                  }
                }}
                placeholder="Name this space…"
                className="flex-1 min-w-0 text-sm border border-slate-300 dark:border-white/15 rounded-lg px-2 py-1 bg-white/70 dark:bg-black/25 outline-none focus:ring-2 focus:ring-sky-500/40"
              />
              <button
                type="button"
                onClick={commitPending}
                disabled={!pendingName.trim()}
                className="px-2.5 py-1 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold disabled:opacity-40 transition-colors"
              >
                Add
              </button>
            </div>
            <p className="mt-1 text-[10px] leading-snug text-slate-400">
              Saved as “pending” for review — never blocks your save.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

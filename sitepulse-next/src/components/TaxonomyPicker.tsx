"use client";
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, Plus, ChevronLeft, Search } from 'lucide-react';
import { CANONICAL_ROLES, roleLabel } from '@/utils/locationTaxonomy';
import {
  orderedSubtypesByRole,
  restrictSubtypesToProjectType,
  fuzzyRankSubtypes,
  type TaxonomyResult,
} from '@/utils/subtypes';
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
  /**
   * Restrict the (no-search) list to types whose `default_project_types` includes
   * `projectType` — the naming popovers pass `true`; Manage/Review keep the full
   * list. Search ALWAYS bypasses this (the escape hatch). Never restricts when
   * `projectType` is null.
   */
  restrictToProjectType?: boolean;
  /** AI-suggested type id — force-kept visible even when the filter would hide it. */
  suggestedSubtypeId?: string | null;
  /** Sub-type ids of locations already present — rendered as a "Used in this project" row. */
  recentSubtypeIds?: string[];
  /** The popover attaches this so it can move focus into the search box on Tab from the name field. */
  searchRef?: React.RefObject<HTMLInputElement | null>;
  /** Tab from the list commits the highlight and calls this (the popover focuses Save). */
  onAdvance?: () => void;
  /** Autofocus the search box on mount. Default true; the naming popovers pass false (name field owns focus). */
  autoFocusSearch?: boolean;
}

/** A rendered row: a non-navigable group header, or a navigable option carrying its flat index. */
type PickerRow =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'option'; key: string; subtype: Subtype; index: number };

/**
 * Shared role + sub-type picker (Location Taxonomy). A search-box-over-a-list
 * combobox: type to fuzzy-search the full dictionary, ↑/↓ move a highlight, Enter
 * picks, Tab (when the host wires `onAdvance`) commits + moves on. The no-search
 * view groups by canonical role (defaults-first per project type), optionally
 * restricted to the project type, with a "Used in this project" row on top.
 *
 * KEYBOARD ↔ CANVAS: focus stays on the `<input>` and the active option is tracked
 * via `aria-activedescendant` — NEVER roving focus onto the option elements. The
 * floor-plan canvas only ignores keystrokes while a text input is focused
 * (`activeElement.tagName === 'INPUT'`), so moving focus onto a row would leak
 * arrows/Enter to the canvas. Do not change this to roving tabindex.
 *
 * Presentation-only: the canonical role is what gets stored/exported, never the label.
 */
export default function TaxonomyPicker({
  subtypes,
  projectType,
  selectedSubtypeId,
  onPick,
  variant = 'popover',
  restrictToProjectType = false,
  suggestedSubtypeId = null,
  recentSubtypeIds = [],
  searchRef,
  onAdvance,
  autoFocusSearch = true,
}: TaxonomyPickerProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [proposing, setProposing] = useState(false);
  const [pendingRole, setPendingRole] = useState<TopLevelRole>('other');
  const [pendingName, setPendingName] = useState('');

  const internalRef = useRef<HTMLInputElement | null>(null);
  const inputRef = searchRef ?? internalRef;
  const activeOptionRef = useRef<HTMLLIElement | null>(null);
  const reactId = useId();
  const listboxId = `taxonomy-${reactId}`;

  const { rows, options } = useMemo(() => {
    const active = subtypes.filter((s) => s.status === 'active');
    const built: PickerRow[] = [];
    const opts: Subtype[] = [];
    const pushOption = (s: Subtype) => {
      built.push({ kind: 'option', key: s.id, subtype: s, index: opts.length });
      opts.push(s);
    };

    const q = query.trim();
    if (q) {
      // Search bypasses the project-type filter (escape hatch): rank the FULL
      // active dictionary, flat (no role headers).
      for (const s of fuzzyRankSubtypes(active, q)) pushOption(s);
      return { rows: built, options: opts };
    }

    const keepIds = new Set<string>(
      [selectedSubtypeId, suggestedSubtypeId].filter((x): x is string => !!x),
    );

    // "Used in this project" recents — active only, given order, de-duped.
    const recentIdSet = new Set<string>();
    const recents: Subtype[] = [];
    for (const id of recentSubtypeIds) {
      if (recentIdSet.has(id)) continue;
      const s = active.find((a) => a.id === id);
      if (s) {
        recents.push(s);
        recentIdSet.add(id);
      }
    }
    if (recents.length) {
      built.push({ kind: 'header', key: 'h-recent', label: 'Used in this project' });
      for (const s of recents) pushOption(s);
    }

    // Main list: optional project-type filter, recents removed (no duplicate
    // navigation stops), grouped + ordered by role.
    const filtered = restrictToProjectType
      ? restrictSubtypesToProjectType(active, projectType, keepIds)
      : active;
    const main = filtered.filter((s) => !recentIdSet.has(s.id));
    const groups = orderedSubtypesByRole(main, projectType);
    for (const role of CANONICAL_ROLES) {
      if (groups[role].length) {
        built.push({ kind: 'header', key: `h-${role}`, label: roleLabel(role, projectType) });
        for (const s of groups[role]) pushOption(s);
      }
    }
    return { rows: built, options: opts };
  }, [subtypes, query, projectType, restrictToProjectType, selectedSubtypeId, suggestedSubtypeId, recentSubtypeIds]);

  // Keep the highlight in range as the option set changes.
  useEffect(() => {
    setActiveIndex((i) => (options.length === 0 ? 0 : Math.min(i, options.length - 1)));
  }, [options.length]);

  // On the grouped (no-search) view, start the highlight on the AI-suggested or
  // currently-selected type so it scrolls into view — instead of the list opening
  // at the top with the match buried below (the fuzzy guess can sit far down).
  // Search mode already ranks the best match first, so we skip it there; and we
  // don't fight the user's arrow keys because the option set only rebuilds when its
  // inputs change, not on plain navigation.
  const preferredOptionId = suggestedSubtypeId ?? selectedSubtypeId ?? null;
  useEffect(() => {
    if (query.trim() || !preferredOptionId) return;
    const idx = options.findIndex((s) => s.id === preferredOptionId);
    if (idx >= 0) setActiveIndex(idx);
    // `query` intentionally omitted: `options` already rebuilds when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, preferredOptionId]);

  // Scroll the highlighted option into view on keyboard navigation. Optional call:
  // some environments (jsdom in tests) don't implement scrollIntoView.
  useEffect(() => {
    activeOptionRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  const commit = (s: Subtype | undefined) => {
    if (!s) return;
    onPick({ kind: 'subtype', subtypeId: s.id, name: s.name, role: s.top_level_role as TopLevelRole });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (options.length) setActiveIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (options.length) setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (options.length) {
        e.preventDefault();
        e.stopPropagation();
        commit(options[activeIndex]);
      }
    } else if (e.key === 'Tab' && !e.shiftKey && onAdvance && options.length) {
      // Commit the highlight and hand focus to the host's next control (Save).
      e.preventDefault();
      commit(options[activeIndex]);
      onAdvance();
    } else if (e.key === 'Escape' && query) {
      // Clear the search first; an empty-query Escape bubbles to the popover (cancel).
      e.preventDefault();
      e.stopPropagation();
      setQuery('');
      setActiveIndex(0);
    }
  };

  const rowBase =
    'w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-left rounded-lg transition-colors';
  const rowIdle = 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10';

  const commitPending = () => {
    const name = pendingName.trim();
    if (!name) return;
    onPick({ kind: 'pending', role: pendingRole, name });
    setPendingName('');
    setProposing(false);
  };

  return (
    <div className={variant === 'menu' ? 'py-1' : ''}>
      {/* Search box — the single tab stop; ↑/↓ move the highlight via aria-activedescendant. */}
      <div className="relative mb-1.5">
        <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded
          aria-controls={listboxId}
          aria-activedescendant={options.length ? `${listboxId}-opt-${activeIndex}` : undefined}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocusSearch}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
          onKeyDown={handleKeyDown}
          placeholder="Search types…"
          className="w-full text-sm border border-slate-300/80 dark:border-white/15 rounded-lg pl-7 pr-2 py-1.5 bg-white/70 dark:bg-black/25 outline-none focus:ring-2 focus:ring-sky-500/40"
        />
      </div>

      {restrictToProjectType && !projectType && (
        <p className="px-2 pb-1.5 text-[11px] leading-snug text-slate-400">
          Set a project type in Settings to shorten this list.
        </p>
      )}

      <ul id={listboxId} role="listbox" className="max-h-[230px] overflow-y-auto overscroll-contain pr-0.5">
        {rows.length === 0 && (
          <li role="presentation" className="px-2 py-2 text-[12px] text-slate-400">
            No types match “{query.trim()}”.
          </li>
        )}
        {rows.map((row) => {
          if (row.kind === 'header') {
            return (
              <li
                key={row.key}
                role="presentation"
                className="px-2 pt-1.5 pb-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-400"
              >
                {row.label}
              </li>
            );
          }
          const s = row.subtype;
          const isActive = row.index === activeIndex;
          const isSelected = s.id === selectedSubtypeId;
          return (
            <li
              key={row.key}
              id={`${listboxId}-opt-${row.index}`}
              role="option"
              aria-selected={isSelected}
              ref={isActive ? activeOptionRef : undefined}
              onMouseEnter={() => setActiveIndex(row.index)}
              onClick={() => commit(s)}
              className={`${rowBase} cursor-pointer ${
                isActive
                  ? 'bg-sky-100 dark:bg-sky-500/20 text-sky-800 dark:text-sky-200'
                  : isSelected
                    ? 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 font-semibold'
                    : rowIdle
              }`}
            >
              <span className="flex-1 break-words">{s.name}</span>
              {/* The location category (Primary Spaces / Common Areas / Back of
                  House / Other), shown on every row so the role is legible even in
                  the flat search view where the group headers are absent. */}
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {roleLabel(s.top_level_role as TopLevelRole, projectType)}
              </span>
              {isSelected && <Check size={15} className="shrink-0 text-sky-500" />}
            </li>
          );
        })}
      </ul>

      {/* Other (pending) — non-blocking proposal of a new governed sub-type. */}
      <div className="mt-1.5 border-t border-slate-200 dark:border-white/10 pt-1.5">
        {!proposing ? (
          <button
            type="button"
            onClick={() => { setProposing(true); if (!pendingName) setPendingName(query.trim()); }}
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
                // eslint-disable-next-line jsx-a11y/no-autofocus
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

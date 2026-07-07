"use client";
import React from 'react';
import { Search, X, ArrowUp, ArrowDown, ListChecks, Layers, Rows2, Rows4 } from 'lucide-react';
import type { Activity } from '@/types/domain';
import type { Updater } from '@/types/utils';
import type { ManageScope } from '@/store/useManageStore';
import type { ListDensity } from '@/store/useSettingsStore';
import {
  type ManageFilters,
  type StateFacet,
  emptyFilters,
  activeFilterCount,
} from '@/utils/locationFilters';

const STATE_OPTS: { key: StateFacet; label: string }[] = [
  { key: 'not_started', label: 'Not started' },
  { key: 'planned', label: 'Planned' },
  { key: 'ongoing', label: 'Ongoing' },
  { key: 'completed', label: 'Completed' },
];

interface ManageToolbarProps {
  filters: ManageFilters;
  setFilters: (val: Updater<ManageFilters>) => void;
  projectUnitTypes: string[];
  activities: Activity[];
  totalCount: number;
  matchingCount: number;
  selectedCount: number;
  onSelectAllMatching: () => void;
  scope: ManageScope;
  setScope: (val: ManageScope) => void;
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
  onRouteSort: () => void;
  onEditRoute: () => void;
  /** Row density for the desktop table (UI Polish plan, Phase 4). */
  density: ListDensity;
  setDensity: (d: ListDensity) => void;
}

const chip = (active: boolean) =>
  `px-3 py-1.5 text-[11px] font-bold rounded-lg border shadow-sm transition-colors ${
    active
      ? 'bg-slate-800 text-white border-slate-800 dark:bg-white dark:text-slate-900 dark:border-white'
      : 'bg-white/70 dark:bg-black/20 text-slate-600 dark:text-slate-300 border-slate-300/80 dark:border-white/15 hover:bg-slate-100 dark:hover:bg-white/10'
  }`;

export default function ManageToolbar({
  filters,
  setFilters,
  projectUnitTypes,
  activities,
  totalCount,
  matchingCount,
  selectedCount,
  onSelectAllMatching,
  scope,
  setScope,
  sortColumn,
  sortDirection,
  onRouteSort,
  onEditRoute,
  density,
  setDensity,
}: ManageToolbarProps) {
  const toggleState = (s: StateFacet) =>
    setFilters((f) => ({
      ...f,
      states: f.states.includes(s) ? f.states.filter((x) => x !== s) : [...f.states, s],
    }));

  const typeValue = filters.types[0] ?? '';
  const activityValue = filters.activities[0] ?? '';
  const activeCount = activeFilterCount(filters);
  const isFiltered = matchingCount !== totalCount;

  return (
    <div className="hidden md:flex flex-col gap-2.5 mb-3">
      {/* Row 1 — scope, search, type, activity, count, route controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-300/80 dark:border-white/15 overflow-hidden shadow-sm shrink-0">
          <button
            type="button"
            onClick={() => setScope('level')}
            className={`px-3 py-1.5 text-xs font-bold transition-colors ${
              scope === 'level'
                ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                : 'bg-white/70 dark:bg-black/20 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
            }`}
          >
            This level
          </button>
          <button
            type="button"
            onClick={() => setScope('all')}
            className={`px-3 py-1.5 text-xs font-bold border-l border-slate-300/80 dark:border-white/10 flex items-center gap-1 transition-colors ${
              scope === 'all'
                ? 'bg-amber-500 text-amber-950'
                : 'bg-white/70 dark:bg-black/20 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
            }`}
          >
            <Layers size={13} /> All levels
          </button>
        </div>

        <div className="relative flex items-center flex-1 min-w-[200px] max-w-sm">
          <Search size={15} className="absolute left-3 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={filters.query}
            onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
            placeholder="Search location or type…"
            className="w-full pl-9 pr-8 py-1.5 rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/70 dark:bg-black/20 text-sm shadow-sm outline-none focus:ring-2 focus:ring-sky-500/40 text-slate-700 dark:text-slate-200"
          />
          {filters.query && (
            <button
              type="button"
              onClick={() => setFilters((f) => ({ ...f, query: '' }))}
              className="absolute right-2 p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <select
          value={typeValue}
          onChange={(e) => setFilters((f) => ({ ...f, types: e.target.value ? [e.target.value] : [] }))}
          className="appearance-none py-1.5 pl-3 pr-7 rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/70 dark:bg-black/20 text-xs font-bold shadow-sm cursor-pointer text-slate-700 dark:text-slate-200"
        >
          <option value="">All spaces</option>
          {projectUnitTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <select
          value={activityValue}
          onChange={(e) => setFilters((f) => ({ ...f, activities: e.target.value ? [e.target.value] : [] }))}
          className="appearance-none py-1.5 pl-3 pr-7 rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/70 dark:bg-black/20 text-xs font-bold shadow-sm cursor-pointer text-slate-700 dark:text-slate-200"
        >
          <option value="">All activities</option>
          {activities.map((m) => (
            <option key={m.id} value={m.name}>{m.name}</option>
          ))}
        </select>

        <div
          className="flex items-center justify-center gap-1 bg-slate-200/80 dark:bg-slate-700/80 text-[11px] font-bold text-slate-600 dark:text-slate-300 rounded-lg px-2.5 h-8 shrink-0 border border-slate-300/80 dark:border-white/15 shadow-sm"
          title={`${matchingCount} of ${totalCount} locations match`}
        >
          {isFiltered ? <span>{matchingCount}<span className="text-slate-400">/{totalCount}</span></span> : totalCount}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <div
            className="flex rounded-lg border border-slate-300/80 dark:border-white/15 overflow-hidden shadow-sm shrink-0"
            role="group"
            aria-label="Row density"
          >
            <button
              type="button"
              title="Comfortable rows"
              aria-pressed={density === 'comfortable'}
              onClick={() => setDensity('comfortable')}
              className={`px-2.5 py-1.5 transition-colors ${
                density === 'comfortable'
                  ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-white/70 dark:bg-black/20 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
              }`}
            >
              <Rows2 size={14} />
            </button>
            <button
              type="button"
              title="Compact rows"
              aria-pressed={density === 'compact'}
              onClick={() => setDensity('compact')}
              className={`px-2.5 py-1.5 border-l border-slate-300/80 dark:border-white/10 transition-colors ${
                density === 'compact'
                  ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-white/70 dark:bg-black/20 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
              }`}
            >
              <Rows4 size={14} />
            </button>
          </div>
          <button
            type="button"
            onClick={onRouteSort}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg border shadow-sm flex items-center gap-1 transition-colors ${
              sortColumn === 'walk_sequence'
                ? 'bg-emerald-500 text-white border-emerald-600'
                : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200 border-slate-300/80 dark:border-white/15 hover:bg-slate-100 dark:hover:bg-white/10'
            }`}
          >
            Route Sort
            {sortColumn === 'walk_sequence' &&
              (sortDirection === 'asc' ? <ArrowDown size={14} /> : <ArrowUp size={14} />)}
          </button>
          <button
            type="button"
            onClick={onEditRoute}
            className="text-xs font-semibold text-slate-500 hover:text-sky-600 dark:hover:text-sky-400 underline decoration-slate-300 dark:decoration-slate-700 underline-offset-4 transition-colors px-1"
          >
            Edit Route
          </button>
        </div>
      </div>

      {/* Row 2 — status facet chips + select-all-matching + clear */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setFilters((f) => ({ ...f, states: [], behindSchedule: false }))} className={chip(filters.states.length === 0 && !filters.behindSchedule)}>
          All statuses
        </button>
        {STATE_OPTS.map((s) => (
          <button key={s.key} type="button" onClick={() => toggleState(s.key)} className={chip(filters.states.includes(s.key))}>
            {s.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setFilters((f) => ({ ...f, behindSchedule: !f.behindSchedule }))}
          className={chip(filters.behindSchedule)}
        >
          Behind schedule
        </button>

        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => setFilters(emptyFilters())}
            className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors flex items-center gap-1"
          >
            <X size={12} /> Clear filters ({activeCount})
          </button>
        )}

        {matchingCount > 0 && (
          <button
            type="button"
            onClick={onSelectAllMatching}
            className="ml-auto px-3 py-1.5 text-[11px] font-bold rounded-lg border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/50 shadow-sm transition-colors flex items-center gap-1.5"
            title="Select every location matching the current filters"
          >
            <ListChecks size={14} /> Select all {matchingCount}
            {selectedCount > 0 && <span className="text-sky-400">· {selectedCount} selected</span>}
          </button>
        )}
      </div>
    </div>
  );
}

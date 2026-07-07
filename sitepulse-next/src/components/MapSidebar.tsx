import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, Crosshair, Search, X, ListChecks } from 'lucide-react';
import { useMapStore } from '@/store/useMapStore';
import { useUnits } from '@/hooks/useProjectQueries';
import {
  summarizeUnit,
  summarizeSheetProgress,
  countUnitsByCurrentActivity,
  type UnitSummary,
} from '@/utils/unitProgress';
import type { ApplicabilityIndex } from '@/utils/applicability';
import UnitInspector from './UnitInspector';
import type { Activity, Unit, Sheet, StatusLog, TemporalState } from '@/types/domain';
import { STATUS_DOT_CLASS } from '@/utils/statusColors';

export interface MapSidebarProps {
  activities?: Activity[];
  filterActivity: string | null;
  setFilterActivity: React.Dispatch<React.SetStateAction<string | null>>;
  temporalFilters: TemporalState[];
  setTemporalFilters: React.Dispatch<React.SetStateAction<TemporalState[]>>;
  activeSheet: Sheet | null | undefined;
  activeStatuses: StatusLog[];
  applicabilityIndex: ApplicabilityIndex;
  savingUnitId?: string | null;
  onRenameUnitInitiate: (id: string) => void;
  onDeleteUnit: (id: string) => void;
  onLocateUnit?: (unitId: string) => void;
  onCommitStatus: (unit: Unit, activity: Activity, state: TemporalState, extraProps?: Record<string, unknown>) => void;
  onToggleApplicability: (unit: Unit, activity: Activity, isApplicable: boolean, currentState?: TemporalState) => void;
  onOpenHistory: (unitId: string) => void;
}

// Stage keys ('done' from unitProgress summaries + raw temporal states) → the
// canonical dot classes (UI Polish P2 — single status-color language).
const STAGE_DOT: Record<string, string> = {
  done: STATUS_DOT_CLASS.completed,
  completed: STATUS_DOT_CLASS.completed,
  ongoing: STATUS_DOT_CLASS.ongoing,
  planned: STATUS_DOT_CLASS.planned,
  none: STATUS_DOT_CLASS.none,
};

type SortMode = 'number' | 'progress';

function MapSidebar({
  activities = [],
  filterActivity,
  setFilterActivity,
  temporalFilters,
  setTemporalFilters,
  activeSheet,
  activeStatuses,
  applicabilityIndex,
  savingUnitId,
  onRenameUnitInitiate,
  onDeleteUnit,
  onLocateUnit,
  onCommitStatus,
  onToggleApplicability,
  onOpenHistory,
}: MapSidebarProps) {
  const activeSheetId = useMapStore(s => s.activeSheetId);
  const trackingMode = useMapStore(s => s.trackingMode);
  const selectedUnitIds = useMapStore(s => s.selectedUnitIds);
  const setToolMode = useMapStore(s => s.setToolMode);
  const setSelectedUnitIds = useMapStore(s => s.setSelectedUnitIds);
  const clearSelectedUnits = useMapStore(s => s.clearSelectedUnits);

  const [isLegendExpanded, setIsLegendExpanded] = useState(true);
  const [isStatusExpanded, setIsStatusExpanded] = useState(true);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('number');

  const { data: units = [] } = useUnits(activeSheetId);

  const trackActivities = useMemo(
    () =>
      activities
        .filter(m => m.track === trackingMode)
        .sort((a, b) => (a.sequence_order || 0) - (b.sequence_order || 0)),
    [activities, trackingMode],
  );

  // One summary per unit — drives row dots, sort, and the roll-up.
  const summaries = useMemo(() => {
    const map = new Map<string, UnitSummary>();
    for (const u of units) {
      map.set(u.id, summarizeUnit(u, activeStatuses, trackActivities, applicabilityIndex, trackingMode));
    }
    return map;
  }, [units, activeStatuses, trackActivities, applicabilityIndex, trackingMode]);

  const sheetProgress = useMemo(
    () => summarizeSheetProgress(units, activeStatuses, trackActivities, applicabilityIndex, trackingMode),
    [units, activeStatuses, trackActivities, applicabilityIndex, trackingMode],
  );

  const activityCounts = useMemo(
    () => countUnitsByCurrentActivity(units, activeStatuses, trackActivities, applicabilityIndex, trackingMode),
    [units, activeStatuses, trackActivities, applicabilityIndex, trackingMode],
  );

  const visibleUnits = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? units.filter(
          u =>
            u.unit_number.toLowerCase().includes(q) ||
            (u.unit_type || '').toLowerCase().includes(q),
        )
      : units;
    const sorted = [...filtered];
    if (sortMode === 'progress') {
      sorted.sort((a, b) => {
        const sa = summaries.get(a.id);
        const sb = summaries.get(b.id);
        const pa = sa && sa.totalCount ? sa.doneCount / sa.totalCount : 1;
        const pb = sb && sb.totalCount ? sb.doneCount / sb.totalCount : 1;
        if (pa !== pb) return pa - pb; // least complete first
        return a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true, sensitivity: 'base' });
      });
    } else {
      sorted.sort((a, b) =>
        a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true, sensitivity: 'base' }),
      );
    }
    return sorted;
  }, [units, search, sortMode, summaries]);

  const listRefs = useRef<Record<string, HTMLLIElement | null>>({});
  useEffect(() => {
    if (selectedUnitIds?.length && listRefs.current[selectedUnitIds[0]]) {
      listRefs.current[selectedUnitIds[0]]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedUnitIds]);

  // ---- Inspector mode (exactly one selected) ----
  const singleUnit =
    selectedUnitIds?.length === 1 ? units.find(u => u.id === selectedUnitIds[0]) : undefined;

  if (singleUnit) {
    return (
      <div className="w-full h-full p-4 rounded-xl border flex flex-col min-h-0 flex-shrink-0 glass-panel">
        <UnitInspector
          unit={singleUnit}
          activities={activities}
          trackingMode={trackingMode}
          activeStatuses={activeStatuses}
          applicabilityIndex={applicabilityIndex}
          savingUnitId={savingUnitId}
          onBack={clearSelectedUnits}
          onLocateUnit={onLocateUnit}
          onRenameUnitInitiate={onRenameUnitInitiate}
          onDeleteUnit={onDeleteUnit}
          onCommitStatus={onCommitStatus}
          onToggleApplicability={onToggleApplicability}
          onOpenHistory={onOpenHistory}
        />
      </div>
    );
  }

  const multiCount = selectedUnitIds?.length ?? 0;

  // ---- Overview / multi mode ----
  return (
    <div className="w-full h-full p-4 rounded-xl border flex flex-col min-h-0 flex-shrink-0 glass-panel">
      {multiCount >= 2 && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-purple-100/60 dark:bg-purple-900/30 border border-purple-200/70 dark:border-purple-800/40 flex-shrink-0">
          <ListChecks size={16} className="text-purple-600 dark:text-purple-300 shrink-0" />
          <span className="text-xs font-semibold text-purple-800 dark:text-purple-200 flex-1">
            {multiCount} locations selected
          </span>
          <button
            type="button"
            onClick={clearSelectedUnits}
            className="text-[11px] font-semibold text-purple-600 hover:text-purple-800 dark:text-purple-300 dark:hover:text-white transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* Sheet progress roll-up */}
      <div className="flex-shrink-0 mb-4">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="font-bold text-lg text-slate-800 dark:text-slate-100 truncate" title={activeSheet?.sheet_name || 'Level'}>
            {activeSheet?.sheet_name || 'Level'}
          </span>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
            {sheetProgress.totalUnits} {sheetProgress.totalUnits === 1 ? 'unit' : 'units'}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-slate-900 dark:text-white font-mono tabular-nums leading-none">
            {sheetProgress.percentComplete}%
          </span>
          <span className="text-[11px] text-slate-400 dark:text-slate-500">complete</span>
        </div>
        {/* segmented bar by current stage */}
        <div className="flex h-2 mt-2 rounded-full overflow-hidden bg-slate-200/70 dark:bg-white/10">
          {(['done', 'ongoing', 'planned'] as const).map(k => {
            const w = sheetProgress.totalUnits ? (sheetProgress.buckets[k] / sheetProgress.totalUnits) * 100 : 0;
            if (w <= 0) return null;
            return <div key={k} className={STAGE_DOT[k]} style={{ width: `${w}%` }} />;
          })}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${STATUS_DOT_CLASS.completed}`} />{sheetProgress.buckets.done} done</span>
          <span className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${STATUS_DOT_CLASS.ongoing}`} />{sheetProgress.buckets.ongoing} ongoing</span>
          <span className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${STATUS_DOT_CLASS.planned}`} />{sheetProgress.buckets.planned} planned</span>
        </div>
      </div>

      {/* Live legend (activity filter) */}
      <button
        onClick={() => setIsLegendExpanded(p => !p)}
        className="w-full font-bold text-sm mb-2 border-b border-slate-200/60 dark:border-white/10 pb-2 flex-shrink-0 text-slate-800 dark:text-slate-100 flex items-center justify-between hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
      >
        Live legend
        {isLegendExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>

      {isLegendExpanded && (
        <div className="flex flex-wrap gap-1.5 mb-4 max-h-[120px] overflow-y-auto pr-1">
          <button
            type="button"
            onClick={() => setFilterActivity(null)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer ${
              !filterActivity
                ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900 border-transparent hover:opacity-90'
                : 'bg-white/50 dark:bg-black/20 border-slate-200/80 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10'
            }`}
          >
            All
          </button>
          {trackActivities.map(m => {
            const count = activityCounts[m.name] || 0;
            const active = filterActivity === m.name;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setFilterActivity(prev => (prev === m.name ? null : (m.name as string)))}
                className={`px-2.5 py-1 rounded-full text-[10px] font-medium border max-w-[150px] flex items-center gap-1.5 transition-all cursor-pointer hover:opacity-80 ${
                  active ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-slate-900 scale-[1.02]' : 'hover:scale-[1.02]'
                }`}
                style={{ background: m.color, borderColor: 'var(--glass-border)' }}
                title={`${m.name}${count ? ` — ${count} here now` : ''}`}
              >
                <span className="truncate">{m.name.length > 18 ? `${m.name.slice(0, 16)}…` : m.name}</span>
                {count > 0 && (
                  <span className="shrink-0 px-1 rounded-full bg-black/15 dark:bg-white/20 text-[9px] font-bold tabular-nums">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Status toggles */}
      <button
        onClick={() => setIsStatusExpanded(p => !p)}
        className="w-full font-bold text-sm mb-2 text-slate-800 dark:text-slate-100 border-b border-slate-200/60 dark:border-white/10 pb-2 flex items-center justify-between hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
      >
        Progress status toggles
        {isStatusExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>

      {isStatusExpanded && (
        <div className="flex flex-wrap gap-2 mb-4">
          {([
            { value: 'none', label: 'No Status' },
            { value: 'planned', label: 'Planned' },
            { value: 'ongoing', label: 'Ongoing' },
            { value: 'completed', label: 'Completed' },
          ] as { value: TemporalState; label: string }[]).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setTemporalFilters(prev => (prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]));
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                temporalFilters.includes(value)
                  ? 'bg-blue-600/90 text-white border-blue-600 hover:bg-blue-700/90'
                  : 'bg-white/50 dark:bg-black/20 text-slate-500 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-white/10'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Search + sort */}
      <div className="flex items-center gap-2 mb-2 flex-shrink-0">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Find a location…"
            className="w-full pl-8 pr-7 py-1.5 text-xs rounded-lg border border-slate-200/80 dark:border-white/10 bg-white/50 dark:bg-black/20 text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-blue-500/40"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              title="Clear"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <select
          value={sortMode}
          onChange={e => setSortMode(e.target.value as SortMode)}
          className="py-1.5 px-2 text-xs rounded-lg border border-slate-200/80 dark:border-white/10 bg-white/50 dark:bg-black/20 text-slate-600 dark:text-slate-300 outline-none focus:ring-2 focus:ring-blue-500/40 cursor-pointer"
          title="Sort locations"
        >
          <option value="number">Number</option>
          <option value="progress">Least done</option>
        </select>
      </div>

      {/* Locations list */}
      <div className="overflow-y-auto flex-1 -mr-1 pr-1 min-h-0">
        {units.length === 0 ? (
          <p className="text-slate-500 text-sm italic">
            No locations mapped on this level yet. Use Draw on the map dock to begin.
          </p>
        ) : visibleUnits.length === 0 ? (
          <p className="text-slate-500 text-sm italic">No locations match “{search}”.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {visibleUnits.map(unit => {
              const summary = summaries.get(unit.id);
              const stage = summary?.stage ?? 'none';
              const isSelected = selectedUnitIds?.includes(unit.id);
              return (
                <li
                  key={unit.id}
                  ref={el => {
                    listRefs.current[unit.id] = el;
                  }}
                  onClick={() => {
                    setToolMode('select');
                    setSelectedUnitIds([unit.id]);
                  }}
                  className={`group cursor-pointer flex items-center gap-2.5 pl-2.5 pr-2 py-2 rounded-lg border transition-colors ${
                    isSelected
                      ? 'bg-purple-100/60 dark:bg-purple-900/30 border-purple-200/70 dark:border-purple-800/40'
                      : 'border-transparent hover:bg-white/60 dark:hover:bg-white/5'
                  }`}
                >
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${STAGE_DOT[stage]}`} title={stage} />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200 font-mono">
                    {unit.unit_number}
                  </span>
                  {unit.unit_type && (
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate">{unit.unit_type}</span>
                  )}
                  <span className="ml-auto flex items-center gap-2 shrink-0">
                    {summary && summary.totalCount > 0 && (
                      <span className="text-[11px] tabular-nums text-slate-400 dark:text-slate-500 font-mono">
                        {summary.doneCount}/{summary.totalCount}
                      </span>
                    )}
                    {onLocateUnit && (
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          onLocateUnit(unit.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded transition-all"
                        title="Locate on map"
                      >
                        <Crosshair size={13} />
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default MapSidebar;

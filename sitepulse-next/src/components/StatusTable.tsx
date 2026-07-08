"use client";
import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, ArrowDown, History, ChevronRight, ChevronDown, Ban, RotateCcw } from 'lucide-react';
import { BottleneckIndicator, UpdatingRing, getTemporalStateStyle, StatusSegments } from '@/components/ui/FieldStatusAtoms';
import StatusTrigger, { type StatusTriggerProps } from '@/components/ui/StatusTrigger';
import RowActionsMenu from './manage/RowActionsMenu';
import AssigneeCell from './manage/AssigneeCell';
import ExpandedActivityAudit from './manage/ExpandedActivityAudit';
import { applicableActivities, isActivityApplicable, type ApplicabilityIndex } from '@/utils/applicability';
import { activitySchedule, computeUnitVariance, orderedTrackActivities, resolveActualStartIso, varianceCompletedColor, varianceFill, varianceLabel, type VarianceInfo } from '@/utils/progressAnalytics';
import { lastActivityIso, formatAge } from '@/utils/staleness';
import { formatPlannedDate } from '@/utils/formatPlannedDate';
import type { ListDensity } from '@/store/useSettingsStore';
import type { LocationRow } from '@/utils/locationFilters';
import type { TaxonomyResult } from '@/utils/subtypes';
import type { MemberLike } from './manage/assignee';
import type {
  Unit,
  StatusLog,
  Activity,
  Subtype,
  ProjectType,
  TemporalState,
  TrackingMode,
  PendingChangesMap,
} from '@/types/domain';

/**
 * DateChipCell — quiet date cell (UI Polish plan, Phase 4). At rest it renders
 * the date as a flat text chip ("—" when unset); click / Enter / Space swaps in
 * the native `<input type="date">` (auto-focused, picker opened), which reverts
 * to the chip on blur. Purely presentational: `value` and `onChange` are the
 * exact value/handler the always-visible input used before — zero
 * mutation-path changes, the offline `pendingChanges` flow is untouched.
 */
function DateChipCell({
  value,
  pending,
  disabled,
  onChange,
  ariaLabel,
  compact,
  completedTone,
  stopClickPropagation,
}: {
  /** Current display value (`''` when unset) — pending-aware, computed by the caller. */
  value: string;
  /** A pending (unapplied) change exists for this date field → amber treatment. */
  pending: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  ariaLabel: string;
  compact: boolean;
  /** Emerald text for the "Actual Completed" column (matches the old input). */
  completedTone?: boolean;
  /** The logged-date cell stops row-click propagation today — preserved. */
  stopClickPropagation?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    try {
      el.showPicker?.();
    } catch {
      // showPicker needs user activation in some browsers; focus alone still works.
    }
  }, [editing]);

  const pad = compact ? 'py-1' : 'py-1.5';

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="date"
        value={value}
        onClick={stopClickPropagation ? (e) => e.stopPropagation() : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        disabled={disabled}
        aria-label={ariaLabel}
        className={`bg-transparent border ${
          pending
            ? 'border-amber-400 dark:border-amber-500 text-amber-600 dark:text-amber-400'
            : 'border-slate-300 dark:border-white/10'
        } rounded px-2 ${pad} text-xs font-medium w-[125px] outline-none hover:bg-slate-100 dark:hover:bg-slate-800 focus:ring-2 focus:ring-blue-500/40`}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => { if (stopClickPropagation) e.stopPropagation(); setEditing(true); }}
      disabled={disabled}
      aria-label={ariaLabel}
      title={`${ariaLabel} — click to edit`}
      className={`rounded border px-2 ${pad} text-xs font-medium whitespace-nowrap transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default ${
        pending
          ? 'border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400'
          : `border-transparent hover:border-slate-300 dark:hover:border-white/10 hover:bg-slate-100 dark:hover:bg-slate-800 ${
              value
                ? completedTone
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-600 dark:text-slate-300'
                : 'text-slate-400 italic'
            }`
      }`}
    >
      {formatPlannedDate(value || null)}
    </button>
  );
}

/**
 * StatusTable — the desktop data table presenter (isDesktop).
 *
 * Owns: lastClickedIndex (Shift+Click multi-select context).
 *       renderSortIcon (Q1 resolution: JSX stays in presenter, not in hook).
 *       allVisibleSelected / toggleSelectAll (derived from props, no store access).
 *
 * Props:
 *   visible              — { unit, log }[] from useFieldData (LocationRow shape)
 *   pendingChanges       — object from useFieldData
 *   handleLocalUpdate    — fn from useFieldData
 *   savingUnitId         — string | null from page
 *   isApplying           — boolean from useFieldData
 *   sortColumn           — string from useFieldData
 *   sortDirection        — 'asc' | 'desc' from useFieldData
 *   handleSort           — fn from useFieldData
 *   selectedUnitIds      — string[] from useMapStore (via container)
 *   toggleSelectedUnitId — fn from useMapStore (via container)
 *   setSelectedUnitIds   — fn from useMapStore (via container)
 *   setHistoryModalUnitId — fn from useUIStore (via container)
 *   onChooseStatus       — fn from page
 */
interface StatusTableProps {
  visible: LocationRow[];
  pendingChanges: PendingChangesMap;
  // The status-update handler shape shared by handleLocalUpdate / handleTimelineUpdate,
  // identical to StatusTrigger's onLocalUpdate contract (both come from useFieldData).
  handleLocalUpdate: StatusTriggerProps['onLocalUpdate'];
  savingUnitId?: string | null;
  isApplying: boolean;
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
  handleSort: (col: string) => void;
  selectedUnitIds: string[];
  toggleSelectedUnitId: (id: string) => void;
  setSelectedUnitIds: (ids: string[]) => void;
  setHistoryModalUnitId: (id: string) => void;
  onChooseStatus?: StatusTriggerProps['onChooseStatus'];
  pendingCount: number;
  handleDiscardAll: () => void;
  handleApplyAll: () => void | Promise<{ succeeded: number; failed: number }>;
  handleTimelineUpdate: StatusTriggerProps['onLocalUpdate'];
  rawStatuses: StatusLog[];
  currentActivities: Activity[];
  pendingTimelineChanges: PendingChangesMap;
  trackingMode: TrackingMode;
  applicabilityIndex?: ApplicabilityIndex;
  onToggleApplicability?: (
    unit: Unit,
    activity: Activity,
    isApplicable: boolean,
    currentState?: TemporalState | string | null
  ) => void;
  levelByUnitId?: Record<string, string>;
  subtypes: Subtype[];
  projectType: ProjectType | null;
  onRenameLocation?: (unit: Unit) => void;
  onChangeUnitType?: (unitId: string, result: TaxonomyResult) => void;
  onLocateUnit?: (unitId: string) => void;
  onDeleteLocation?: (unitId: string) => void;
  members?: MemberLike[];
  onAssignUnit?: (unitId: string, userId: string | null) => void;
  /** Row density (UI Polish plan, Phase 4). Persisted in useSettingsStore;
   *  the container reads it via useHydratedStore. Default comfortable. */
  density?: ListDensity;
  /** subcontractor_id → company name, for the Owner cell's muted sub line (Data Storytelling P3). */
  companyNameById?: Record<string, string>;
}

export default function StatusTable({
  visible,
  pendingChanges,
  handleLocalUpdate,
  savingUnitId,
  isApplying,
  sortColumn,
  sortDirection,
  handleSort,
  selectedUnitIds,
  toggleSelectedUnitId,
  setSelectedUnitIds,
  setHistoryModalUnitId,
  onChooseStatus,
  pendingCount,
  handleDiscardAll,
  handleApplyAll,
  handleTimelineUpdate,
  rawStatuses,
  currentActivities,
  pendingTimelineChanges,
  trackingMode,
  applicabilityIndex,
  onToggleApplicability,
  levelByUnitId,
  subtypes,
  projectType,
  onRenameLocation,
  onChangeUnitType,
  onLocateUnit,
  onDeleteLocation,
  members,
  onAssignUnit,
  density = 'comfortable',
  companyNameById,
}: StatusTableProps) {
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [expandedUnitIds, setExpandedUnitIds] = useState<Set<string>>(new Set());

  // Density-conditional paddings (comfortable keeps today's exact metrics).
  const isCompact = density === 'compact';
  const headPad = isCompact ? 'px-5 py-2' : 'px-5 py-3';
  const cellPad = isCompact ? 'px-5 py-1.5' : 'px-5 py-3';
  const cellPadTight = isCompact ? 'px-5 py-1' : 'px-5 py-2';

  // Clear expansions when activities change (e.g., track changes)
  React.useEffect(() => {
    setExpandedUnitIds(new Set());
  }, [currentActivities]);

  // Measure the sticky header so an expanded location's row can pin flush
  // *underneath* it (top: headerH), not behind it. Measured (not hardcoded) so
  // it stays correct across font-size / browser-zoom changes.
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const [headerH, setHeaderH] = useState(0);
  useLayoutEffect(() => {
    const el = theadRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setHeaderH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const logMap = React.useMemo(() => {
    const map = new Map<string, StatusLog>();
    if (rawStatuses) {
      rawStatuses.forEach(log => {
        map.set(`${log.unit_id}_${log.activityName}`, log);
      });
    }
    return map;
  }, [rawStatuses]);

  // Display-only "now" — stable for this mount so the age + variance derivations
  // memoize (no Date.now() in the pure utils; this is presentation chrome).
  const today = React.useMemo(() => new Date(), []);
  const todayIso = React.useMemo(() => today.toISOString(), [today]);

  // Per-unit last-activity ISO (max client_timestamp across ALL the unit's rows,
  // any track) → drives the age chip. Uses already-loaded rawStatuses, no query.
  const staleByUnitId = React.useMemo(() => {
    const byUnit = new Map<string, StatusLog[]>();
    for (const s of rawStatuses || []) {
      if (!s.unit_id) continue;
      const arr = byUnit.get(s.unit_id);
      if (arr) arr.push(s);
      else byUnit.set(s.unit_id, [s]);
    }
    const out = new Map<string, string | null>();
    byUnit.forEach((logs, uid) => out.set(uid, lastActivityIso(logs)));
    return out;
  }, [rawStatuses]);

  // Per-unit schedule variance (bottleneck-based, applicability-respecting) →
  // drives the days-behind number. Reuses the single-source-of-truth pace math.
  const varianceByUnitId = React.useMemo(() => {
    const trackActs = orderedTrackActivities(currentActivities || [], trackingMode);
    const byUnit = new Map<string, StatusLog[]>();
    for (const s of rawStatuses || []) {
      if (!s.unit_id || s.track !== trackingMode) continue;
      const arr = byUnit.get(s.unit_id);
      if (arr) arr.push(s);
      else byUnit.set(s.unit_id, [s]);
    }
    const out = new Map<string, VarianceInfo>();
    for (const { unit } of visible) {
      if (out.has(unit.id)) continue;
      const appActs = applicabilityIndex
        ? applicableActivities(trackActs, unit, applicabilityIndex)
        : trackActs;
      out.set(unit.id, computeUnitVariance(byUnit.get(unit.id) || [], appActs, today));
    }
    return out;
  }, [visible, rawStatuses, currentActivities, trackingMode, applicabilityIndex, today]);

  const isAllExpanded = expandedUnitIds.size === visible.length && visible.length > 0;

  const toggleExpandAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isAllExpanded) {
      setExpandedUnitIds(new Set());
    } else {
      const allIds = new Set(visible.map(r => r.unit.id));
      setExpandedUnitIds(allIds);
    }
  };

  const toggleRowExpanded = (e: React.MouseEvent, unitId: string) => {
    e.stopPropagation();
    setExpandedUnitIds(prev => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  };

  // Q1 resolution: renderSortIcon lives here, not in the hook (no JSX from hooks)
  const renderSortIcon = (col: string) => {
    if (sortColumn !== col) return null;
    return sortDirection === 'asc'
      ? <ArrowUp size={14} className="inline-block ml-1" />
      : <ArrowDown size={14} className="inline-block ml-1" />;
  };

  const handleRowClick = (e: React.MouseEvent, unitId: string, index: number) => {
    if (e.shiftKey && lastClickedIndex !== null) {
      const start = Math.min(lastClickedIndex, index);
      const end = Math.max(lastClickedIndex, index);
      const idsToSelect = visible.slice(start, end + 1).map((r) => r.unit.id);
      const newSelected = new Set(selectedUnitIds);
      idsToSelect.forEach((id) => newSelected.add(id));
      setSelectedUnitIds(Array.from(newSelected));
    } else {
      toggleSelectedUnitId(unitId);
    }
    setLastClickedIndex(index);
  };

  const allVisibleSelected =
    visible.length > 0 && visible.every((r) => selectedUnitIds.includes(r.unit.id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedUnitIds(selectedUnitIds.filter((id) => !visible.find((r) => r.unit.id === id)));
    } else {
      const newSelected = new Set(selectedUnitIds);
      visible.forEach((r) => newSelected.add(r.unit.id));
      setSelectedUnitIds(Array.from(newSelected));
    }
  };

  return (
    <>
      <div className="w-full h-full overflow-auto rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-black/15 shadow-sm relative">
      <table className={`w-full text-left border-collapse ${isCompact ? 'text-xs' : 'text-sm'} text-slate-800 dark:text-slate-200 relative`}>
        <thead ref={theadRef} className="sticky top-0 z-20 bg-white dark:bg-slate-900 shadow-sm after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-slate-300 dark:after:border-white/10">
          <tr>
            <th className={`${headPad} w-10`}>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
              />
            </th>
            <th
              onClick={() => handleSort('unit')}
              className={`${headPad} font-semibold text-slate-900 dark:text-slate-100 w-1/4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 select-none transition-colors`}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleExpandAll}
                  className="p-0.5 rounded text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  {isAllExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                Location {renderSortIcon('unit')}
              </div>
            </th>
            <th
              onClick={() => handleSort('unit_type')}
              className={`${headPad} font-semibold text-slate-900 dark:text-slate-100 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 select-none transition-colors`}
            >
              Type / Assignee {renderSortIcon('unit_type')}
            </th>
            <th
              onClick={() => handleSort('status')}
              className={`${headPad} font-semibold text-slate-900 dark:text-slate-100 min-w-[200px] cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 select-none transition-colors`}
            >
              Activity &amp; Status {renderSortIcon('status')}
            </th>
            <th className={`${headPad} font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap`}>
              Planned Start
            </th>
            <th className={`${headPad} font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap`}>
              Planned Completion
            </th>
            <th
              onClick={() => handleSort('updated')}
              className={`${headPad} font-semibold text-slate-900 dark:text-slate-100 w-1/4 text-right cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 select-none transition-colors`}
            >
              <div className="flex justify-end items-center gap-1">
                Actual Completed {renderSortIcon('updated')}
              </div>
            </th>
            <th className={`${headPad} w-10`} />
          </tr>
        </thead>
        {visible.map(({ unit, log }, index) => {
            const pending = pendingChanges[unit.id];
            // Spreading a possibly-null `log` yields optional props, so annotate the result:
            // when `log` is null the branch is a partial `{ temporal_state }`, which StatusTrigger
            // tolerates (it re-spreads baseLog) — same runtime shape as the original .jsx.
            const dLog: StatusLog | null = pending ? ({ ...log, temporal_state: pending.state } as StatusLog) : log;
            // The location's active/current activity is shown inline in this row (it is skipped
            // in the expanded child list below), so its N/A toggle has to live here too — otherwise
            // the current task is the one activity that can never be marked Not Applicable from
            // the table. Resolve the activity object so onToggleApplicability gets its id.
            const activeActivity = log?.activityName
              ? currentActivities?.find((m) => m.name === log.activityName)
              : null;
            const isExpanded = expandedUnitIds.has(unit.id);
            const isSelected = selectedUnitIds.includes(unit.id);

            // Data Storytelling P3 — the three at-a-glance accountability cues.
            const variance = varianceByUnitId.get(unit.id);
            const showVariance = !!variance && (variance.kind === 'behind' || variance.kind === 'ahead');
            const lastIso = staleByUnitId.get(unit.id) ?? null;
            const age = formatAge(lastIso, todayIso);
            const subId = activeActivity?.subcontractor_id ?? null;
            const subName = subId ? companyNameById?.[subId] : undefined;

            return (
              // Each location is its own <tbody> so an expanded row's sticky pin is
              // bounded to *its* activity group — it releases the moment the group
              // scrolls past, and the next location takes over.
              <tbody key={unit.id}>
              <tr
                onClick={(e) => handleRowClick(e, unit.id, index)}
                style={isExpanded ? { top: headerH } : undefined}
                className={`border-b border-slate-200 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors cursor-pointer ${
                  isExpanded
                    ? `sticky z-10 shadow-[0_2px_4px_-2px_rgba(0,0,0,0.18)] ${
                        isSelected ? 'bg-purple-50 dark:bg-purple-950' : 'bg-white dark:bg-slate-900'
                      }`
                    : isSelected
                      ? 'bg-purple-50 dark:bg-purple-900/10'
                      : ''
                }`}
              >
                <td className={`${cellPad} align-middle text-center`}>
                  <input
                    type="checkbox"
                    checked={selectedUnitIds.includes(unit.id)}
                    readOnly
                    className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                  />
                </td>
                <td className={`${cellPad} font-bold text-slate-900 dark:text-slate-100 align-middle`}>
                  <div className="flex items-start gap-2 relative">
                    <button
                      type="button"
                      onClick={(e) => toggleRowExpanded(e, unit.id)}
                      className="mt-0.5 p-0.5 rounded text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                    >
                      {expandedUnitIds.has(unit.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <div className="flex items-center gap-2">
                        {unit.unit_number}
                        {levelByUnitId?.[unit.id] && (
                          <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 whitespace-nowrap">· {levelByUnitId[unit.id]}</span>
                        )}
                        <BottleneckIndicator
                          unit={unit}
                          outOfSequence={log?.outOfSequence as unknown as React.ComponentProps<typeof BottleneckIndicator>['outOfSequence']}
                          onUpdateStatus={handleTimelineUpdate as unknown as React.ComponentProps<typeof BottleneckIndicator>['onUpdateStatus']}
                        />
                        {savingUnitId === unit.id && <UpdatingRing />}
                      </div>
                      {(showVariance || age !== '—') && (
                        <div className="flex items-center gap-2 text-[10px] font-medium">
                          {showVariance && variance && (
                            <span
                              className="inline-flex items-center gap-1 whitespace-nowrap"
                              style={{ color: varianceFill(variance) }}
                              title={varianceLabel(variance)}
                            >
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: varianceFill(variance) }} />
                              {variance.days}d {variance.kind === 'behind' ? 'late' : 'early'}
                            </span>
                          )}
                          {age !== '—' && (
                            <span
                              className="ml-auto text-slate-400 dark:text-slate-500 font-normal whitespace-nowrap"
                              title={lastIso ? `Last update ${new Date(lastIso).toLocaleString()}` : undefined}
                            >
                              {age}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className={`${cellPadTight} align-middle text-slate-600 dark:text-slate-400`} onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-col gap-1.5 items-start">
                    <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">
                      {unit.unit_type || 'Unknown'}
                    </span>
                    <AssigneeCell
                      assignedTo={unit.assigned_to}
                      members={members || []}
                      onAssign={(userId) => onAssignUnit?.(unit.id, userId)}
                    />
                    {subName && (
                      <span
                        className="max-w-[150px] truncate text-[10px] text-slate-400 dark:text-slate-500 pl-1.5"
                        title={`Subcontractor on ${activeActivity?.name ?? 'current activity'}: ${subName}`}
                      >
                        {subName}
                      </span>
                    )}
                  </div>
                </td>
                <td className={`${cellPadTight} align-middle`}>
                  <StatusTrigger
                    unit={unit}
                    baseLog={dLog}
                    pendingChange={pending}
                    onChooseStatus={onChooseStatus}
                    onLocalUpdate={handleLocalUpdate}
                    isApplying={isApplying}
                    savingUnitId={savingUnitId}
                    large={false}
                    statusTrailing={
                      onToggleApplicability && activeActivity ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onToggleApplicability(unit, activeActivity, false, dLog?.temporal_state); }}
                          disabled={savingUnitId === unit.id || isApplying}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                          title="Mark current activity Not Applicable for this location"
                          aria-label={`Mark ${log?.activityName} not applicable for this location`}
                        >
                          <Ban size={14} />
                        </button>
                      ) : null
                    }
                  />
                </td>
                <td className={`${cellPadTight} align-middle`}>
                  {log ? (
                    <DateChipCell
                      value={
                        pending?.extraProps?.startDate !== undefined
                          ? pending.extraProps.startDate ?? ''
                          : log?.planned_start_date || ''
                      }
                      pending={pending?.extraProps?.startDate !== undefined}
                      onChange={(val) =>
                        handleLocalUpdate(unit, log || ({} as StatusLog), pending?.state || (log.temporal_state as TemporalState) || 'none', {
                          startDate: val,
                          endDate: log.planned_end_date,
                        })
                      }
                      disabled={isApplying}
                      ariaLabel={`Planned start — ${unit.unit_number}`}
                      compact={isCompact}
                    />
                  ) : (
                    <span className="text-slate-400 text-xs italic">—</span>
                  )}
                </td>
                <td className={`${cellPadTight} align-middle`}>
                  {log ? (
                    <DateChipCell
                      value={
                        pending?.extraProps?.endDate !== undefined
                          ? pending.extraProps.endDate ?? ''
                          : log?.planned_end_date || ''
                      }
                      pending={pending?.extraProps?.endDate !== undefined}
                      onChange={(val) =>
                        handleLocalUpdate(unit, log || ({} as StatusLog), pending?.state || (log.temporal_state as TemporalState) || 'none', {
                          startDate: log.planned_start_date,
                          endDate: val,
                        })
                      }
                      disabled={isApplying}
                      ariaLabel={`Planned completion — ${unit.unit_number}`}
                      compact={isCompact}
                    />
                  ) : (
                    <span className="text-slate-400 text-xs italic">—</span>
                  )}
                </td>
                <td className={`${cellPad} text-xs text-slate-500 dark:text-slate-400 text-right align-middle font-medium`}>
                  {(pending?.state || log?.temporal_state) === 'completed' ? (
                    <DateChipCell
                      value={
                        pending?.extraProps?.loggedDate !== undefined
                          ? pending.extraProps.loggedDate ?? ''
                          : log?.logged_date || ''
                      }
                      pending={pending?.extraProps?.loggedDate !== undefined}
                      onChange={(val) =>
                        handleLocalUpdate(unit, log || ({} as StatusLog), pending?.state || (log!.temporal_state as TemporalState) || 'none', {
                          startDate: log!.planned_start_date,
                          endDate: log!.planned_end_date,
                          loggedDate: val,
                        })
                      }
                      disabled={isApplying}
                      ariaLabel={`Actual completed — ${unit.unit_number}`}
                      compact={isCompact}
                      completedTone
                      stopClickPropagation
                    />
                  ) : (
                    <span className="text-slate-400 text-xs italic">—</span>
                  )}
                </td>
                <td className={`${cellPad} align-middle text-right`} onClick={(e) => e.stopPropagation()}>
                  <RowActionsMenu
                    unitNumber={unit.unit_number}
                    currentSubtypeId={unit.subtype_id}
                    subtypes={subtypes || []}
                    projectType={projectType}
                    onRename={() => onRenameLocation?.(unit)}
                    onChangeType={(result) => onChangeUnitType?.(unit.id, result)}
                    onLocate={onLocateUnit ? () => onLocateUnit(unit.id) : undefined}
                    onDelete={onDeleteLocation ? () => onDeleteLocation(unit.id) : undefined}
                    onHistory={() => setHistoryModalUnitId(unit.id)}
                  />
                </td>
              </tr>
              {expandedUnitIds.has(unit.id) && (
              <ExpandedActivityAudit unitId={unit.id} track={trackingMode}>
              {(auditByActivity) => currentActivities?.map(activity => {
                if (activity.name === log?.activityName) return null;

                const notApplicable = applicabilityIndex && !isActivityApplicable(activity, unit, applicabilityIndex);
                if (notApplicable) {
                  return (
                    <tr key={`${unit.id}_${activity.name}`} className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/5 opacity-60">
                      <td className={cellPadTight}></td>
                      <td className={`${cellPadTight} font-medium text-slate-500 dark:text-slate-400 align-middle pl-10`}>
                        <div className="flex items-center gap-2 italic">
                          <span className="text-slate-400 font-bold">↳</span>
                          {activity.name}
                        </div>
                      </td>
                      <td className={cellPadTight}></td>
                      <td className={`${cellPadTight} align-middle`}>
                        <div className="flex items-center gap-2">
                          <span className={`inline-block rounded-lg border px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider italic ${getTemporalStateStyle('none')}`}>
                            N/A
                          </span>
                          {onToggleApplicability && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onToggleApplicability(unit, activity, true); }}
                              disabled={savingUnitId === unit.id || isApplying}
                              className="p-1.5 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-lg transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                              title="Restore — mark this activity applicable for this location"
                              aria-label={`Restore ${activity.name} for this location`}
                            >
                              <RotateCcw size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className={`${cellPadTight} align-middle`}><span className="text-slate-400 text-xs italic">—</span></td>
                      <td className={`${cellPadTight} align-middle`}><span className="text-slate-400 text-xs italic">—</span></td>
                      <td className={`${cellPad} text-xs text-right align-middle`}><span className="text-slate-400 italic">—</span></td>
                      <td className={`${cellPad} align-middle text-right`}></td>
                    </tr>
                  );
                }

                const childLog =
                  logMap.get(`${unit.id}_${activity.name}`) ||
                  ({
                    unit_id: unit.id,
                    activityName: activity.name,
                    status_color: activity.color,
                    track: trackingMode,
                    temporal_state: 'none',
                  } as unknown as StatusLog);
                const childPending = pendingTimelineChanges[`${unit.id}_${activity.name}`];
                const dChildLog = childPending ? { ...childLog, temporal_state: childPending.state } : childLog;

                // Schedule Variance Columns Phase 2 + 3 — the full per-activity
                // schedule story on the expanded row. The CHEAP pair (Planned
                // Duration + Variance Completed) needs only childLog dates; the
                // AUDIT-backed set (Actual Started/Duration + Variance Start/Duration)
                // needs the location's audit timeline, loaded lazily by the enclosing
                // <ExpandedActivityAudit> (per-location, no level-wide prefetch).
                const childState = (childLog.temporal_state as string) || 'none';
                const actualStartIso = resolveActualStartIso(
                  auditByActivity.get(activity.name) || [],
                  { state: childState, loggedDate: childLog.logged_date },
                );
                // Ongoing → count the actual duration to today; completed → to its
                // logged completion day. (Variance Completed stays gated on completion
                // below, so today-as-end never reads as a "finished N late".)
                const actualEndIso = childState === 'completed'
                  ? childLog.logged_date
                  : childState === 'ongoing' && actualStartIso ? todayIso : null;
                const childMetrics = activitySchedule({
                  plannedStart: childLog.planned_start_date,
                  plannedEnd: childLog.planned_end_date,
                  actualStart: actualStartIso,
                  actualEnd: actualEndIso,
                });

                // Cheap pair. Variance Completed only reads once the slot is actually
                // completed (an ongoing slot's end is `today`, which must not surface
                // as "finished N late" — blank until it truly finishes).
                const plannedDur = childMetrics.plannedDuration;
                const vc = childState === 'completed' ? childMetrics.varianceCompleted : null;
                const varianceCompletedLabel =
                  vc === null ? null : vc > 0 ? `${vc}d late` : vc < 0 ? `${Math.abs(vc)}d early` : 'on time';

                // Audit-backed set. Each null-propagates → a blank, never a false 0d.
                const isChildOngoing = childState === 'ongoing';
                const actualStartText = actualStartIso ? formatPlannedDate(actualStartIso) : null;
                const vs = childMetrics.varianceStart;
                const varianceStartLabel =
                  vs === null ? null : vs > 0 ? `${vs}d late` : vs < 0 ? `${Math.abs(vs)}d early` : 'on time';
                const actualDur = childMetrics.actualDuration;
                const vd = childMetrics.varianceDuration;
                const varianceDurationLabel =
                  vd === null ? null : vd > 0 ? `${vd}d over` : vd < 0 ? `${Math.abs(vd)}d under` : 'on plan';
                const durationParts = [
                  plannedDur !== null ? `planned ${plannedDur}d` : null,
                  actualDur !== null ? `ran ${actualDur}d${isChildOngoing ? ' →' : ''}` : null,
                ].filter(Boolean);

                return (
                  <tr key={`${unit.id}_${activity.name}`} className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/5">
                    <td className={cellPadTight}></td>
                    <td className={`${cellPadTight} font-medium text-slate-700 dark:text-slate-300 align-middle pl-10`}>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 font-bold">↳</span>
                        {activity.name}
                      </div>
                    </td>
                    <td className={cellPadTight}></td>
                    <td className={`${cellPadTight} align-middle`}>
                      <div className="flex items-center gap-2">
                        <StatusSegments
                          value={(dChildLog.temporal_state as TemporalState) || 'none'}
                          onChange={(s) => handleTimelineUpdate(unit, childLog, s, { activityObj: activity })}
                          disabled={savingUnitId === unit.id || isApplying}
                          pending={!!(childPending?.state && childPending.state !== childLog.temporal_state)}
                          ariaLabel={`Status for ${activity.name}`}
                          size="sm"
                        />
                        {onToggleApplicability && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onToggleApplicability(unit, activity, false, dChildLog.temporal_state); }}
                            disabled={savingUnitId === unit.id || isApplying}
                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                            title="Mark Not Applicable for this location"
                            aria-label={`Mark ${activity.name} not applicable for this location`}
                          >
                            <Ban size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className={`${cellPadTight} align-top`}>
                      <div className="flex flex-col gap-0.5 items-start">
                        {childLog ? (
                          <DateChipCell
                            value={
                              childPending?.extraProps?.startDate !== undefined
                                ? childPending.extraProps.startDate ?? ''
                                : childLog.planned_start_date || ''
                            }
                            pending={childPending?.extraProps?.startDate !== undefined}
                            onChange={(val) =>
                              handleTimelineUpdate(unit, childLog, childPending?.state || (childLog.temporal_state as TemporalState) || 'none', {
                                startDate: val,
                                endDate: childLog.planned_end_date,
                                activityObj: activity
                              })
                            }
                            disabled={isApplying}
                            ariaLabel={`Planned start — ${activity.name}, ${unit.unit_number}`}
                            compact={isCompact}
                          />
                        ) : (
                          <span className="text-slate-400 text-xs italic">—</span>
                        )}
                        {actualStartText && (
                          <span
                            className="pl-2 text-[10px] font-normal text-slate-400 dark:text-slate-500 whitespace-nowrap"
                            title={`Actually started ${actualStartText}`}
                          >
                            started {actualStartText}
                          </span>
                        )}
                        {varianceStartLabel && (
                          <span
                            className="pl-2 text-[10px] font-semibold whitespace-nowrap"
                            style={{ color: varianceCompletedColor(vs) }}
                            title={`Started ${varianceStartLabel} vs planned start`}
                          >
                            {varianceStartLabel} to start
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={`${cellPadTight} align-top`}>
                      <div className="flex flex-col gap-0.5 items-start">
                        {childLog ? (
                          <DateChipCell
                            value={
                              childPending?.extraProps?.endDate !== undefined
                                ? childPending.extraProps.endDate ?? ''
                                : childLog.planned_end_date || ''
                            }
                            pending={childPending?.extraProps?.endDate !== undefined}
                            onChange={(val) =>
                              handleTimelineUpdate(unit, childLog, childPending?.state || (childLog.temporal_state as TemporalState) || 'none', {
                                startDate: childLog.planned_start_date,
                                endDate: val,
                                activityObj: activity
                              })
                            }
                            disabled={isApplying}
                            ariaLabel={`Planned completion — ${activity.name}, ${unit.unit_number}`}
                            compact={isCompact}
                          />
                        ) : (
                          <span className="text-slate-400 text-xs italic">—</span>
                        )}
                        {durationParts.length > 0 && (
                          <span
                            className="pl-2 text-[10px] font-normal text-slate-400 dark:text-slate-500 whitespace-nowrap"
                            title={
                              (plannedDur !== null ? `Planned ${plannedDur} day${plannedDur === 1 ? '' : 's'}` : '') +
                              (actualDur !== null ? `${plannedDur !== null ? ' · ' : ''}ran ${actualDur} day${actualDur === 1 ? '' : 's'}${isChildOngoing ? ' so far' : ''}` : '')
                            }
                          >
                            {durationParts.join(' · ')}
                          </span>
                        )}
                        {varianceDurationLabel && (
                          <span
                            className="pl-2 text-[10px] font-semibold whitespace-nowrap"
                            style={{ color: varianceCompletedColor(vd) }}
                            title={`Ran ${varianceDurationLabel} vs planned length`}
                          >
                            {varianceDurationLabel}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={`${cellPad} text-xs text-slate-500 dark:text-slate-400 text-right align-top font-medium`}>
                      <div className="flex flex-col gap-0.5 items-end">
                        {(childPending?.state || childLog.temporal_state) === 'completed' ? (
                          <DateChipCell
                            value={
                              childPending?.extraProps?.loggedDate !== undefined
                                ? childPending.extraProps.loggedDate ?? ''
                                : childLog.logged_date || ''
                            }
                            pending={childPending?.extraProps?.loggedDate !== undefined}
                            onChange={(val) =>
                              handleTimelineUpdate(unit, childLog, childPending?.state || (childLog.temporal_state as TemporalState) || 'none', {
                                startDate: childLog.planned_start_date,
                                endDate: childLog.planned_end_date,
                                loggedDate: val,
                                activityObj: activity
                              })
                            }
                            disabled={isApplying}
                            ariaLabel={`Actual completed — ${activity.name}, ${unit.unit_number}`}
                            compact={isCompact}
                            completedTone
                            stopClickPropagation
                          />
                        ) : (
                          <span className="text-slate-400 text-xs italic">—</span>
                        )}
                        {varianceCompletedLabel && (
                          <span
                            className="pr-2 text-[10px] font-semibold whitespace-nowrap"
                            style={{ color: varianceCompletedColor(vc) }}
                            title={`Finished ${varianceCompletedLabel} vs planned completion`}
                          >
                            {varianceCompletedLabel}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={`${cellPad} align-middle text-right`}></td>
                  </tr>
                );
              })}
              </ExpandedActivityAudit>
              )}
              </tbody>
            );
          })}
      </table>
      </div>

      {/* Desktop FAB for Pending Changes */}
      <AnimatePresence>
        {pendingCount > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed bottom-6 right-6 z-50 flex justify-center pointer-events-none"
          >
            <div className="bg-slate-900 dark:bg-slate-800 text-white p-3 rounded-full shadow-2xl flex items-center gap-4 pointer-events-auto border border-slate-700 dark:border-slate-600">
              <span className="text-sm font-bold ml-2">
                {pendingCount} pending
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDiscardAll}
                  disabled={isApplying}
                  className="px-4 py-2 text-xs font-bold text-slate-300 hover:text-white hover:bg-slate-800 dark:hover:bg-slate-700 rounded-full transition-colors disabled:opacity-50"
                >
                  Discard
                </button>
                <button
                  onClick={handleApplyAll}
                  disabled={isApplying}
                  className="px-5 py-2 text-xs font-bold bg-amber-500 hover:bg-amber-400 text-amber-950 rounded-full transition-colors shadow-md disabled:opacity-50 flex items-center gap-2"
                >
                  {isApplying ? <UpdatingRing /> : 'Apply'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

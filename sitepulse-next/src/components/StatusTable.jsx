"use client";
import React, { useState, useRef, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, ArrowDown, History, ChevronRight, ChevronDown, Ban, RotateCcw } from 'lucide-react';
import { BottleneckIndicator, UpdatingRing, getTemporalStateStyle, StatusSegments } from '@/components/ui/FieldStatusAtoms';
import StatusTrigger from '@/components/ui/StatusTrigger';
import RowActionsMenu from './manage/RowActionsMenu';
import AssigneeCell from './manage/AssigneeCell';
import { isActivityApplicable } from '@/utils/applicability';

/**
 * StatusTable — the desktop data table presenter (isDesktop).
 *
 * Owns: lastClickedIndex (Shift+Click multi-select context).
 *       renderSortIcon (Q1 resolution: JSX stays in presenter, not in hook).
 *       allVisibleSelected / toggleSelectAll (derived from props, no store access).
 *
 * Props:
 *   visible              — { unit, log }[] from useFieldData
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
}) {
  const [lastClickedIndex, setLastClickedIndex] = useState(null);
  const [expandedUnitIds, setExpandedUnitIds] = useState(new Set());

  // Clear expansions when activities change (e.g., track changes)
  React.useEffect(() => {
    setExpandedUnitIds(new Set());
  }, [currentActivities]);

  // Measure the sticky header so an expanded location's row can pin flush
  // *underneath* it (top: headerH), not behind it. Measured (not hardcoded) so
  // it stays correct across font-size / browser-zoom changes.
  const theadRef = useRef(null);
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
    const map = new Map();
    if (rawStatuses) {
      rawStatuses.forEach(log => {
        map.set(`${log.unit_id}_${log.activityName}`, log);
      });
    }
    return map;
  }, [rawStatuses]);

  const isAllExpanded = expandedUnitIds.size === visible.length && visible.length > 0;

  const toggleExpandAll = (e) => {
    e.stopPropagation();
    if (isAllExpanded) {
      setExpandedUnitIds(new Set());
    } else {
      const allIds = new Set(visible.map(r => r.unit.id));
      setExpandedUnitIds(allIds);
    }
  };

  const toggleRowExpanded = (e, unitId) => {
    e.stopPropagation();
    setExpandedUnitIds(prev => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  };

  // Q1 resolution: renderSortIcon lives here, not in the hook (no JSX from hooks)
  const renderSortIcon = (col) => {
    if (sortColumn !== col) return null;
    return sortDirection === 'asc'
      ? <ArrowUp size={14} className="inline-block ml-1" />
      : <ArrowDown size={14} className="inline-block ml-1" />;
  };

  const handleRowClick = (e, unitId, index) => {
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
      <table className="w-full text-left border-collapse text-sm text-slate-800 dark:text-slate-200 relative">
        <thead ref={theadRef} className="sticky top-0 z-20 bg-white dark:bg-slate-900 shadow-sm after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-slate-300 dark:after:border-white/10">
          <tr>
            <th className="px-5 py-3 w-10">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
              />
            </th>
            <th
              onClick={() => handleSort('unit')}
              className="px-5 py-3 font-semibold text-slate-900 dark:text-slate-100 w-1/4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 select-none transition-colors"
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
              className="px-5 py-3 font-semibold text-slate-900 dark:text-slate-100 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 select-none transition-colors"
            >
              Type / Assignee {renderSortIcon('unit_type')}
            </th>
            <th
              onClick={() => handleSort('status')}
              className="px-5 py-3 font-semibold text-slate-900 dark:text-slate-100 min-w-[200px] cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 select-none transition-colors"
            >
              Activity &amp; Status {renderSortIcon('status')}
            </th>
            <th className="px-5 py-3 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
              Planned Start
            </th>
            <th className="px-5 py-3 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
              Planned Completion
            </th>
            <th
              onClick={() => handleSort('updated')}
              className="px-5 py-3 font-semibold text-slate-900 dark:text-slate-100 w-1/4 text-right cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 select-none transition-colors"
            >
              <div className="flex justify-end items-center gap-1">
                Actual Completed {renderSortIcon('updated')}
              </div>
            </th>
            <th className="px-5 py-3 w-10" />
          </tr>
        </thead>
        {visible.map(({ unit, log }, index) => {
            const pending = pendingChanges[unit.id];
            const dLog = pending ? { ...log, temporal_state: pending.state } : log;
            // The location's active/current activity is shown inline in this row (it is skipped
            // in the expanded child list below), so its N/A toggle has to live here too — otherwise
            // the current task is the one activity that can never be marked Not Applicable from
            // the table. Resolve the activity object so onToggleApplicability gets its id.
            const activeActivity = log?.activityName
              ? currentActivities?.find((m) => m.name === log.activityName)
              : null;
            const isExpanded = expandedUnitIds.has(unit.id);
            const isSelected = selectedUnitIds.includes(unit.id);

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
                <td className="px-5 py-3 align-middle text-center">
                  <input
                    type="checkbox"
                    checked={selectedUnitIds.includes(unit.id)}
                    readOnly
                    className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                  />
                </td>
                <td className="px-5 py-3 font-bold text-slate-900 dark:text-slate-100 align-middle">
                  <div className="flex items-center gap-2 relative">
                    <button
                      type="button"
                      onClick={(e) => toggleRowExpanded(e, unit.id)}
                      className="p-0.5 rounded text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                    >
                      {expandedUnitIds.has(unit.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    {unit.unit_number}
                    {levelByUnitId?.[unit.id] && (
                      <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 whitespace-nowrap">· {levelByUnitId[unit.id]}</span>
                    )}
                    <BottleneckIndicator
                      unit={unit}
                      outOfSequence={log?.outOfSequence}
                      onUpdateStatus={handleTimelineUpdate}
                    />
                    {savingUnitId === unit.id && <UpdatingRing />}
                  </div>
                </td>
                <td className="px-5 py-2 align-middle text-slate-600 dark:text-slate-400" onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-col gap-1.5 items-start">
                    <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">
                      {unit.unit_type || 'Unknown'}
                    </span>
                    <AssigneeCell
                      assignedTo={unit.assigned_to}
                      members={members || []}
                      onAssign={(userId) => onAssignUnit?.(unit.id, userId)}
                    />
                  </div>
                </td>
                <td className="px-5 py-2 align-middle">
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
                          aria-label={`Mark ${log.activityName} not applicable for this location`}
                        >
                          <Ban size={14} />
                        </button>
                      ) : null
                    }
                  />
                </td>
                <td className="px-5 py-2 align-middle">
                  {log ? (
                    <input
                      type="date"
                      value={
                        pending?.extraProps?.startDate !== undefined
                          ? pending.extraProps.startDate
                          : log?.planned_start_date || ''
                      }
                      onChange={(e) =>
                        handleLocalUpdate(unit, log || {}, pending?.state || log.temporal_state || 'none', {
                          startDate: e.target.value,
                          endDate: log.planned_end_date,
                        })
                      }
                      disabled={isApplying}
                      className={`bg-transparent border ${
                        pending?.extraProps?.startDate !== undefined
                          ? 'border-amber-400 dark:border-amber-500 text-amber-600 dark:text-amber-400'
                          : 'border-slate-300 dark:border-white/10'
                      } rounded px-2 py-1.5 text-xs font-medium w-[125px] outline-none hover:bg-slate-100 dark:hover:bg-slate-800 focus:ring-2 focus:ring-blue-500/40`}
                    />
                  ) : (
                    <span className="text-slate-400 text-xs italic">—</span>
                  )}
                </td>
                <td className="px-5 py-2 align-middle">
                  {log ? (
                    <input
                      type="date"
                      value={
                        pending?.extraProps?.endDate !== undefined
                          ? pending.extraProps.endDate
                          : log?.planned_end_date || ''
                      }
                      onChange={(e) =>
                        handleLocalUpdate(unit, log || {}, pending?.state || log.temporal_state || 'none', {
                          startDate: log.planned_start_date,
                          endDate: e.target.value,
                        })
                      }
                      disabled={isApplying}
                      className={`bg-transparent border ${
                        pending?.extraProps?.endDate !== undefined
                          ? 'border-amber-400 dark:border-amber-500 text-amber-600 dark:text-amber-400'
                          : 'border-slate-300 dark:border-white/10'
                      } rounded px-2 py-1.5 text-xs font-medium w-[125px] outline-none hover:bg-slate-100 dark:hover:bg-slate-800 focus:ring-2 focus:ring-blue-500/40`}
                    />
                  ) : (
                    <span className="text-slate-400 text-xs italic">—</span>
                  )}
                </td>
                <td className="px-5 py-3 text-xs text-slate-500 dark:text-slate-400 text-right align-middle font-medium">
                  {(pending?.state || log?.temporal_state) === 'completed' ? (
                    <input
                      type="date"
                      value={
                        pending?.extraProps?.loggedDate !== undefined
                          ? pending.extraProps.loggedDate
                          : log?.logged_date || ''
                      }
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        handleLocalUpdate(unit, log || {}, pending?.state || log.temporal_state || 'none', {
                          startDate: log.planned_start_date,
                          endDate: log.planned_end_date,
                          loggedDate: e.target.value,
                        })
                      }
                      disabled={isApplying}
                      className={`bg-transparent border ${
                        pending?.extraProps?.loggedDate !== undefined
                          ? 'border-amber-400 dark:border-amber-500 text-amber-600 dark:text-amber-400'
                          : 'border-slate-300 dark:border-white/10'
                      } rounded px-2 py-1.5 text-xs font-medium w-[125px] outline-none hover:bg-slate-100 dark:hover:bg-slate-800 focus:ring-2 focus:ring-blue-500/40 ${
                        !pending?.extraProps?.loggedDate ? 'text-emerald-600 dark:text-emerald-400' : ''
                      } transition`}
                    />
                  ) : (
                    <span className="text-slate-400 text-xs italic">—</span>
                  )}
                </td>
                <td className="px-5 py-3 align-middle text-right" onClick={(e) => e.stopPropagation()}>
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
              {expandedUnitIds.has(unit.id) && currentActivities?.map(activity => {
                if (activity.name === log?.activityName) return null;

                const notApplicable = applicabilityIndex && !isActivityApplicable(activity, unit, applicabilityIndex);
                if (notApplicable) {
                  return (
                    <tr key={`${unit.id}_${activity.name}`} className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/5 opacity-60">
                      <td className="px-5 py-2"></td>
                      <td className="px-5 py-2 text-sm font-medium text-slate-500 dark:text-slate-400 align-middle pl-10">
                        <div className="flex items-center gap-2 italic">
                          <span className="text-slate-400 font-bold">↳</span>
                          {activity.name}
                        </div>
                      </td>
                      <td className="px-5 py-2"></td>
                      <td className="px-5 py-2 align-middle">
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
                      <td className="px-5 py-2 align-middle"><span className="text-slate-400 text-xs italic">—</span></td>
                      <td className="px-5 py-2 align-middle"><span className="text-slate-400 text-xs italic">—</span></td>
                      <td className="px-5 py-3 text-xs text-right align-middle"><span className="text-slate-400 italic">—</span></td>
                      <td className="px-5 py-3 align-middle text-right"></td>
                    </tr>
                  );
                }

                const childLog = logMap.get(`${unit.id}_${activity.name}`) || {
                  unit_id: unit.id,
                  activityName: activity.name,
                  status_color: activity.color,
                  track: trackingMode,
                  temporal_state: 'none'
                };
                const childPending = pendingTimelineChanges[`${unit.id}_${activity.name}`];
                const dChildLog = childPending ? { ...childLog, temporal_state: childPending.state } : childLog;

                return (
                  <tr key={`${unit.id}_${activity.name}`} className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/5">
                    <td className="px-5 py-2"></td>
                    <td className="px-5 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 align-middle pl-10">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 font-bold">↳</span>
                        {activity.name}
                      </div>
                    </td>
                    <td className="px-5 py-2"></td>
                    <td className="px-5 py-2 align-middle">
                      <div className="flex items-center gap-2">
                        <StatusSegments
                          value={dChildLog.temporal_state || 'none'}
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
                    <td className="px-5 py-2 align-middle">
                      {childLog ? (
                        <input
                          type="date"
                          value={
                            childPending?.extraProps?.startDate !== undefined
                              ? childPending.extraProps.startDate
                              : childLog.planned_start_date || ''
                          }
                          onChange={(e) =>
                            handleTimelineUpdate(unit, childLog, childPending?.state || childLog.temporal_state || 'none', {
                              startDate: e.target.value,
                              endDate: childLog.planned_end_date,
                              activityObj: activity
                            })
                          }
                          disabled={isApplying}
                          className={`bg-transparent border ${
                            childPending?.extraProps?.startDate !== undefined
                              ? 'border-amber-400 dark:border-amber-500 text-amber-600 dark:text-amber-400'
                              : 'border-slate-300 dark:border-white/10'
                          } rounded px-2 py-1.5 text-xs font-medium w-[125px] outline-none hover:bg-slate-100 dark:hover:bg-slate-800 focus:ring-2 focus:ring-blue-500/40`}
                        />
                      ) : (
                        <span className="text-slate-400 text-xs italic">—</span>
                      )}
                    </td>
                    <td className="px-5 py-2 align-middle">
                      {childLog ? (
                        <input
                          type="date"
                          value={
                            childPending?.extraProps?.endDate !== undefined
                              ? childPending.extraProps.endDate
                              : childLog.planned_end_date || ''
                          }
                          onChange={(e) =>
                            handleTimelineUpdate(unit, childLog, childPending?.state || childLog.temporal_state || 'none', {
                              startDate: childLog.planned_start_date,
                              endDate: e.target.value,
                              activityObj: activity
                            })
                          }
                          disabled={isApplying}
                          className={`bg-transparent border ${
                            childPending?.extraProps?.endDate !== undefined
                              ? 'border-amber-400 dark:border-amber-500 text-amber-600 dark:text-amber-400'
                              : 'border-slate-300 dark:border-white/10'
                          } rounded px-2 py-1.5 text-xs font-medium w-[125px] outline-none hover:bg-slate-100 dark:hover:bg-slate-800 focus:ring-2 focus:ring-blue-500/40`}
                        />
                      ) : (
                        <span className="text-slate-400 text-xs italic">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500 dark:text-slate-400 text-right align-middle font-medium">
                      {(childPending?.state || childLog.temporal_state) === 'completed' ? (
                        <input
                          type="date"
                          value={
                            childPending?.extraProps?.loggedDate !== undefined
                              ? childPending.extraProps.loggedDate
                              : childLog.logged_date || ''
                          }
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            handleTimelineUpdate(unit, childLog, childPending?.state || childLog.temporal_state || 'none', {
                              startDate: childLog.planned_start_date,
                              endDate: childLog.planned_end_date,
                              loggedDate: e.target.value,
                              activityObj: activity
                            })
                          }
                          disabled={isApplying}
                          className={`bg-transparent border ${
                            childPending?.extraProps?.loggedDate !== undefined
                              ? 'border-amber-400 dark:border-amber-500 text-amber-600 dark:text-amber-400'
                              : 'border-slate-300 dark:border-white/10'
                          } rounded px-2 py-1.5 text-xs font-medium w-[125px] outline-none hover:bg-slate-100 dark:hover:bg-slate-800 focus:ring-2 focus:ring-blue-500/40 ${
                            !childPending?.extraProps?.loggedDate ? 'text-emerald-600 dark:text-emerald-400' : ''
                          } transition`}
                        />
                      ) : (
                        <span className="text-slate-400 text-xs italic">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 align-middle text-right"></td>
                  </tr>
                );
              })}
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

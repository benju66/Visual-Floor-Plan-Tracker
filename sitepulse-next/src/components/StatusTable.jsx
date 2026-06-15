"use client";
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, ArrowDown, History, ChevronRight, ChevronDown } from 'lucide-react';
import { BottleneckIndicator, UpdatingRing, getTemporalStateStyle } from '@/components/ui/FieldStatusAtoms';
import StatusTrigger from '@/components/ui/StatusTrigger';

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
  currentMilestones,
  pendingTimelineChanges,
  trackingMode,
}) {
  const [lastClickedIndex, setLastClickedIndex] = useState(null);
  const [expandedUnitIds, setExpandedUnitIds] = useState(new Set());

  // Clear expansions when milestones change (e.g., track changes)
  React.useEffect(() => {
    setExpandedUnitIds(new Set());
  }, [currentMilestones]);

  const logMap = React.useMemo(() => {
    const map = new Map();
    if (rawStatuses) {
      rawStatuses.forEach(log => {
        map.set(`${log.unit_id}_${log.milestone}`, log);
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
        <thead className="sticky top-0 z-20 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-sm after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-slate-300 dark:after:border-white/10">
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
              Space Type {renderSortIcon('unit_type')}
            </th>
            <th
              onClick={() => handleSort('status')}
              className="px-5 py-3 font-semibold text-slate-900 dark:text-slate-100 min-w-[200px] cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 select-none transition-colors"
            >
              Milestone &amp; Status {renderSortIcon('status')}
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
        <tbody>
          {visible.map(({ unit, log }, index) => {
            const pending = pendingChanges[unit.id];
            const dLog = pending ? { ...log, temporal_state: pending.state } : log;

            return (
              <React.Fragment key={unit.id}>
              <tr
                onClick={(e) => handleRowClick(e, unit.id, index)}
                className={`border-b border-slate-200 dark:border-white/5 last:border-none hover:bg-slate-50 dark:hover:bg-white/10 transition-colors cursor-pointer ${
                  selectedUnitIds.includes(unit.id) ? 'bg-purple-50 dark:bg-purple-900/10' : ''
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
                    <BottleneckIndicator 
                      unit={unit} 
                      outOfSequence={log?.outOfSequence} 
                      onUpdateStatus={handleTimelineUpdate} 
                    />
                    {savingUnitId === unit.id && <UpdatingRing />}
                  </div>
                </td>
                <td className="px-5 py-2 align-middle text-slate-600 dark:text-slate-400">
                  <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">
                    {unit.unit_type || 'Unknown'}
                  </span>
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
                <td className="px-5 py-3 align-middle text-right">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setHistoryModalUnitId(unit.id); }}
                    className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors cursor-pointer"
                    title="View History"
                  >
                    <History size={16} />
                  </button>
                </td>
              </tr>
              {expandedUnitIds.has(unit.id) && currentMilestones?.map(milestone => {
                if (milestone.name === log?.milestone) return null;
                
                const childLog = logMap.get(`${unit.id}_${milestone.name}`) || {
                  unit_id: unit.id,
                  milestone: milestone.name,
                  status_color: milestone.color,
                  track: trackingMode,
                  temporal_state: 'none'
                };
                const childPending = pendingTimelineChanges[`${unit.id}_${milestone.name}`];
                const dChildLog = childPending ? { ...childLog, temporal_state: childPending.state } : childLog;
                
                return (
                  <tr key={`${unit.id}_${milestone.name}`} className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/5 last:border-none">
                    <td className="px-5 py-2"></td>
                    <td className="px-5 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 align-middle pl-10">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 font-bold">↳</span>
                        {milestone.name}
                      </div>
                    </td>
                    <td className="px-5 py-2"></td>
                    <td className="px-5 py-2 align-middle">
                      <select
                        value={dChildLog.temporal_state || 'none'}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleTimelineUpdate(unit, childLog, e.target.value, { milestoneObj: milestone });
                        }}
                        disabled={savingUnitId === unit.id || isApplying}
                        className={`w-full sm:w-auto rounded-lg border ${
                          childPending?.state && childPending.state !== childLog.temporal_state
                            ? 'ring-2 ring-amber-500/50 shadow-[0_0_8px_rgba(245,158,11,0.4)]'
                            : ''
                        } px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider shadow-sm outline-none focus:ring-2 focus:ring-blue-500/40 cursor-pointer ${getTemporalStateStyle(dChildLog.temporal_state || 'none')}`}
                      >
                        <option value="none">Not Set</option>
                        <option value="planned">Planned</option>
                        <option value="ongoing">Ongoing</option>
                        <option value="completed">Completed</option>
                      </select>
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
                              milestoneObj: milestone
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
                              milestoneObj: milestone
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
                              milestoneObj: milestone
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
              </React.Fragment>
            );
          })}
        </tbody>
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

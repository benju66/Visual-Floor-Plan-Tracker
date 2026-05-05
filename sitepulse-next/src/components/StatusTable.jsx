"use client";
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, ArrowDown, History } from 'lucide-react';
import { BottleneckIndicator, UpdatingRing } from '@/components/ui/FieldStatusAtoms';
import StatusTrigger from '@/components/ui/StatusTrigger';

/**
 * StatusTable — traditional data table presenter (viewStyle === 'table', isDesktop).
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
}) {
  const [lastClickedIndex, setLastClickedIndex] = useState(null);

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
      <div className="w-full overflow-x-auto rounded-xl border border-slate-200/80 dark:border-white/10 bg-white/40 dark:bg-black/15 shadow-sm backdrop-blur-md">
      <table className="w-full text-left border-collapse text-sm text-slate-800 dark:text-slate-200">
        <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-white/10">
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
              Location {renderSortIcon('unit')}
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
              <tr
                key={unit.id}
                onClick={(e) => handleRowClick(e, unit.id, index)}
                className={`border-b border-slate-200/50 dark:border-white/5 last:border-none hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer ${
                  selectedUnitIds.includes(unit.id) ? 'bg-purple-50/40 dark:bg-purple-900/10' : ''
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
                    {unit.unit_number}
                    <BottleneckIndicator outOfSequence={log?.outOfSequence} />
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
                          : 'border-slate-200/80 dark:border-white/10'
                      } rounded px-2 py-1.5 text-xs font-medium w-[125px] outline-none hover:bg-slate-50 dark:hover:bg-slate-800`}
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
                          : 'border-slate-200/80 dark:border-white/10'
                      } rounded px-2 py-1.5 text-xs font-medium w-[125px] outline-none hover:bg-slate-50 dark:hover:bg-slate-800`}
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
                          : 'border-slate-200/80 dark:border-white/10'
                      } rounded px-2 py-1.5 text-xs font-medium w-[125px] outline-none hover:bg-slate-50 dark:hover:bg-slate-800 ${
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

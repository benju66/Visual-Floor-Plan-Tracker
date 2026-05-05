"use client";
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { useMapStore } from '@/store/useMapStore';
import { useUIStore } from '@/store/useUIStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { UpdatingRing } from '@/components/ui/FieldStatusAtoms';
import { useFieldData } from '@/hooks/useFieldData';
import WalkSequenceModal from './WalkSequenceModal';
import MobileSwipeDeck from './MobileSwipeDeck';
import DesktopCardGrid from './DesktopCardGrid';
import StatusTable from './StatusTable';

// Re-export BottleneckIndicator so any existing consumers of the named export
// from this file don't break during the transition period.
export { BottleneckIndicator } from '@/components/ui/FieldStatusAtoms';

export default function FieldStatusTable({
  activeStatuses = [],
  rawStatuses = [],
  savingUnitId,
  onChooseStatus,
  defaultView = 'table',
  onApplyPendingChanges,
}) {
  // --- Zustand store subscriptions (global state — stays in container) ---
  const activeSheetId = useMapStore((s) => s.activeSheetId);
  const selectedUnitIds = useMapStore((s) => s.selectedUnitIds);
  const toggleSelectedUnitId = useMapStore((s) => s.toggleSelectedUnitId);
  const setSelectedUnitIds = useMapStore((s) => s.setSelectedUnitIds);
  const setHistoryModalUnitId = useUIStore((s) => s.setHistoryModalUnitId);
  const statusFilter = useSettingsStore((s) => s.filterMilestone);

  // --- Viewport state ---
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 768);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- Container-level UI state ---
  const [isSequenceModalOpen, setIsSequenceModalOpen] = useState(false);
  const [isMobileControlsOpen, setIsMobileControlsOpen] = useState(false);

  // --- Business logic hook ---
  const {
    units,
    projectUnitTypes,
    currentMilestones,
    visible,
    sortColumn,
    sortDirection,
    handleSort,
    typeFilter,
    setTypeFilter,
    viewStyle,
    setViewStyle,
    pendingChanges,
    setPendingChanges,
    isApplying,
    handleLocalUpdate,
    handleApplyAll,
  } = useFieldData({ activeStatuses, defaultView, onApplyPendingChanges });

  // --- Empty state guard ---
  if (!units || units.length === 0) {
    return (
      <div
        className="p-8 text-center text-slate-600 rounded-2xl border shadow-lg backdrop-blur-md"
        style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
      >
        No locations mapped on this level yet. Switch to Map view to draw locations.
      </div>
    );
  }

  // --- Shared presenter props ---
  const sharedSelectionProps = {
    selectedUnitIds,
    toggleSelectedUnitId,
    setSelectedUnitIds,
    setHistoryModalUnitId,
    onChooseStatus,
  };

  return (
    <div className="w-full h-full flex flex-col pb-2 md:pb-6">
      {/* ── Top control bar ── */}
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-3 mb-4">

        {/* Pending changes alert */}
        <div className="flex-1 w-full md:w-auto">
          {Object.keys(pendingChanges).length > 0 && (
            <div className="flex items-center gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl px-4 py-2 shadow-sm animate-in fade-in zoom-in-95 duration-200">
              <span className="text-sm font-semibold text-amber-800 dark:text-amber-400">
                {Object.keys(pendingChanges).length} pending{' '}
                {Object.keys(pendingChanges).length === 1 ? 'change' : 'changes'}
              </span>
              <button
                onClick={handleApplyAll}
                disabled={isApplying}
                className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold ml-auto transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
              >
                {isApplying ? <UpdatingRing /> : 'Apply Changes'}
              </button>
              <button
                onClick={() => setPendingChanges({})}
                disabled={isApplying}
                className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 text-xs font-semibold px-2 py-1.5 transition-colors"
              >
                Discard
              </button>
            </div>
          )}
        </div>

        {/* Filters & view toggles */}
        <div className="flex flex-col w-full md:w-auto gap-2">
          {viewStyle === 'card' && !isDesktop && (
            <button
              onClick={() => setIsMobileControlsOpen(!isMobileControlsOpen)}
              className="md:hidden flex items-center justify-between w-full p-2.5 bg-white/60 dark:bg-black/20 border border-slate-300/80 dark:border-white/15 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 shadow-sm mb-2"
            >
              Filters &amp; Display Options
              {isMobileControlsOpen ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
            </button>
          )}

          <AnimatePresence initial={false}>
            {(isDesktop || viewStyle === 'table' || isMobileControlsOpen) && (
              <motion.div
                key="controls-drawer"
                initial={!isDesktop ? { height: 0, opacity: 0 } : false}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="flex flex-wrap items-center justify-between w-full gap-3 overflow-hidden md:!overflow-visible"
              >
                {/* Type filter */}
                <div className="flex items-center gap-2 bg-white/60 dark:bg-black/20 border border-slate-300/80 dark:border-white/15 rounded-lg px-2 py-1 shadow-sm flex-1 md:flex-none min-w-[140px]">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1 hidden sm:inline">
                    Filter:
                  </span>
                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="bg-transparent text-xs font-bold text-slate-700 dark:text-slate-200 outline-none cursor-pointer max-w-[160px] sm:max-w-xs truncate"
                  >
                    <option value="All">All Spaces</option>
                    {projectUnitTypes.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <div
                    className="flex items-center justify-center bg-slate-200/80 dark:bg-slate-700/80 text-[10px] font-bold text-slate-600 dark:text-slate-300 rounded-md px-1.5 min-w-[20px] h-5"
                    title={`${visible.length} locations visible`}
                  >
                    {visible.length}
                  </div>
                </div>

                {/* Right controls */}
                <div className="flex flex-wrap items-center gap-2 md:ml-auto">
                  {/* Route sort */}
                  <div className="flex items-center gap-2 pr-2 md:pr-4 border-r border-slate-300/80 dark:border-white/10">
                    <button
                      type="button"
                      onClick={() => {
                        if (sortColumn === 'walk_sequence') {
                          if (sortDirection === 'asc') {
                            handleSort('walk_sequence'); // toggles to desc
                          } else {
                            handleSort('unit'); // reset
                          }
                        } else {
                          handleSort('walk_sequence');
                        }
                      }}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors shadow-sm flex items-center gap-1 ${
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
                      onClick={() => setIsSequenceModalOpen(true)}
                      className="text-xs font-semibold text-slate-500 hover:text-sky-600 dark:hover:text-sky-400 underline decoration-slate-300 dark:decoration-slate-700 underline-offset-4 transition-colors"
                    >
                      Edit Route
                    </button>
                  </div>

                  {/* Table / Card toggles */}
                  <div className="flex rounded-lg border border-slate-300/80 dark:border-white/15 overflow-hidden shadow-sm shrink-0">
                    <button
                      type="button"
                      onClick={() => setViewStyle('table')}
                      className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                        viewStyle === 'table'
                          ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                          : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
                      }`}
                    >
                      Table
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewStyle('card')}
                      className={`px-3 py-1.5 text-xs font-semibold border-l border-slate-300/80 dark:border-white/10 transition-colors ${
                        viewStyle === 'card'
                          ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                          : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
                      }`}
                    >
                      Cards
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── View routing ── */}
      {!isDesktop && (
        <MobileSwipeDeck
          visible={visible}
          pendingChanges={pendingChanges}
          setPendingChanges={setPendingChanges}
          handleLocalUpdate={handleLocalUpdate}
          currentMilestones={currentMilestones}
          rawStatuses={rawStatuses}
          onChooseStatus={onChooseStatus}
          isApplying={isApplying}
          typeFilter={typeFilter}
        />
      )}

      {isDesktop && viewStyle === 'card' && (
        <DesktopCardGrid
          visible={visible}
          pendingChanges={pendingChanges}
          handleLocalUpdate={handleLocalUpdate}
          savingUnitId={savingUnitId}
          isApplying={isApplying}
          {...sharedSelectionProps}
        />
      )}

      {isDesktop && viewStyle === 'table' && (
        <StatusTable
          visible={visible}
          pendingChanges={pendingChanges}
          handleLocalUpdate={handleLocalUpdate}
          savingUnitId={savingUnitId}
          isApplying={isApplying}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          handleSort={handleSort}
          {...sharedSelectionProps}
        />
      )}

      {/* Empty filter state */}
      {statusFilter && visible.length === 0 && (
        <p className="mt-4 text-center text-sm text-slate-500">
          No locations match this milestone filter.
        </p>
      )}

      {isSequenceModalOpen && (
        <WalkSequenceModal
          units={units}
          sheetId={activeSheetId}
          onClose={() => setIsSequenceModalOpen(false)}
        />
      )}
    </div>
  );
}

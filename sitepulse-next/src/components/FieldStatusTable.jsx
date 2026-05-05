"use client";
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, ArrowDown, ChevronDown } from 'lucide-react';
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
  sheets,
  activeSheetId,
  setActiveSheetId,
}) {
  // --- Zustand store subscriptions (global state — stays in container) ---
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
    pendingTimelineChanges,
    pendingCount,
    setPendingChanges,
    isApplying,
    handleLocalUpdate,
    handleTimelineUpdate,
    handleRemovePendingItem,
    handleDiscardAll,
    handleApplyAll,
    trackingMode,
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

        {/* Pending changes moved to FAB */}

        {/* Filters & view toggles */}
        <div className="hidden md:flex flex-col w-full md:w-auto gap-3 flex-1 overflow-hidden">
          
          <div className="flex flex-wrap items-center gap-2 w-full">
            {/* Type Filter Select */}
            <div className="relative inline-flex items-center flex-1 sm:flex-none min-w-[130px]">
              <select
                className="appearance-none w-full border border-slate-300/80 dark:border-white/15 py-1.5 pl-3 pr-8 rounded-lg text-xs font-bold shadow-sm bg-white/60 dark:bg-black/25 cursor-pointer hover:bg-slate-100 dark:hover:bg-white/10 transition-colors text-slate-700 dark:text-slate-200"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="All">All Spaces</option>
                {projectUnitTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <ChevronDown size={14} className="absolute right-2.5 pointer-events-none text-slate-500" />
            </div>

            {/* Visible count */}
            <div
              className="flex items-center justify-center bg-slate-200/80 dark:bg-slate-700/80 text-[10px] font-bold text-slate-600 dark:text-slate-300 rounded-lg px-2.5 h-7 shrink-0 border border-slate-300/80 dark:border-white/15 shadow-sm"
              title={`${visible.length} locations visible`}
            >
              {visible.length}
            </div>

            {/* Right controls - unconditionally rendered, wraps on mobile */}
            <div className="flex items-center gap-2 ml-auto">
              
              {/* Route sort */}
              <button
                type="button"
                onClick={() => {
                  if (sortColumn === 'walk_sequence') {
                    if (sortDirection === 'asc') handleSort('walk_sequence');
                    else handleSort('unit');
                  } else handleSort('walk_sequence');
                }}
                className={`px-3 py-1.5 text-[10px] sm:text-xs font-bold rounded-lg border shadow-sm flex items-center gap-1 transition-colors uppercase tracking-widest sm:normal-case sm:tracking-normal ${
                  sortColumn === 'walk_sequence'
                    ? 'bg-emerald-500 text-white border-emerald-600'
                    : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200 border-slate-300/80 dark:border-white/15 hover:bg-slate-100 dark:hover:bg-white/10'
                }`}
              >
                Route Sort
                {sortColumn === 'walk_sequence' &&
                  (sortDirection === 'asc' ? <ArrowDown size={14} /> : <ArrowUp size={14} />)}
              </button>

              {/* Edit Route */}
              <button
                type="button"
                onClick={() => setIsSequenceModalOpen(true)}
                className="hidden sm:inline-block text-xs font-semibold text-slate-500 hover:text-sky-600 dark:hover:text-sky-400 underline decoration-slate-300 dark:decoration-slate-700 underline-offset-4 transition-colors px-2"
              >
                Edit Route
              </button>
              <button
                type="button"
                onClick={() => setIsSequenceModalOpen(true)}
                className="sm:hidden px-3 py-1.5 text-[10px] font-bold rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/60 dark:bg-black/20 shadow-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 uppercase tracking-widest transition-colors"
              >
                Edit Route
              </button>

              {/* Table / Card toggles (Desktop Only) */}
              <div className="hidden md:flex rounded-lg border border-slate-300/80 dark:border-white/15 overflow-hidden shadow-sm shrink-0 ml-2">
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
          </div>
        </div>
      </div>

      {/* ── View routing ── */}
      {!isDesktop && (
        <MobileSwipeDeck
          visible={visible}
          pendingChanges={pendingChanges}
          pendingTimelineChanges={pendingTimelineChanges}
          setPendingChanges={setPendingChanges}
          handleLocalUpdate={handleLocalUpdate}
          handleTimelineUpdate={handleTimelineUpdate}
          handleRemovePendingItem={handleRemovePendingItem}
          handleDiscardAll={handleDiscardAll}
          handleApplyAll={handleApplyAll}
          pendingCount={pendingCount}
          onChooseStatus={onChooseStatus}
          savingUnitId={savingUnitId}
          currentMilestones={currentMilestones}
          rawStatuses={rawStatuses}
          isApplying={isApplying}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          projectUnitTypes={projectUnitTypes}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          handleSort={handleSort}
          onEditRoute={() => setIsSequenceModalOpen(true)}
          sheets={sheets}
          activeSheetId={activeSheetId}
          setActiveSheetId={setActiveSheetId}
        />
      )}

      {isDesktop && viewStyle === 'card' && (
        <div className="flex-1 min-h-0 overflow-y-auto pb-6">
          <DesktopCardGrid
            visible={visible}
            pendingChanges={pendingChanges}
            handleLocalUpdate={handleLocalUpdate}
            savingUnitId={savingUnitId}
            isApplying={isApplying}
            pendingCount={pendingCount}
            handleDiscardAll={handleDiscardAll}
            handleApplyAll={handleApplyAll}
            handleTimelineUpdate={handleTimelineUpdate}
            {...sharedSelectionProps}
          />
        </div>
      )}

      {isDesktop && viewStyle === 'table' && (
        <div className="flex-1 min-h-0 overflow-y-auto pb-6">
          <StatusTable
            visible={visible}
            pendingChanges={pendingChanges}
            handleLocalUpdate={handleLocalUpdate}
            savingUnitId={savingUnitId}
            isApplying={isApplying}
            pendingCount={pendingCount}
            handleDiscardAll={handleDiscardAll}
            handleApplyAll={handleApplyAll}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            handleSort={handleSort}
            handleTimelineUpdate={handleTimelineUpdate}
            rawStatuses={rawStatuses}
            currentMilestones={currentMilestones}
            pendingTimelineChanges={pendingTimelineChanges}
            trackingMode={trackingMode}
            {...sharedSelectionProps}
          />
        </div>
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

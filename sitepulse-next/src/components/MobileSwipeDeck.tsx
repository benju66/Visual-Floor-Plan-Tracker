"use client";
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Undo2, Redo2, ArrowLeft, ArrowRight, ChevronDown, ArrowDown, ArrowUp, ListFilter } from 'lucide-react';
import { useRouter } from 'next/navigation';
import SwipeCard from '@/components/SwipeCard';
import { motion, AnimatePresence } from 'framer-motion';
import PendingReviewDrawer from './PendingReviewDrawer';
import { UpdatingRing } from '@/components/ui/FieldStatusAtoms';
import SyncIndicator from '@/components/ui/SyncIndicator';
import { useUIStore } from '@/store/useUIStore';
import type { Unit, StatusLog, Milestone, Sheet, PendingChangesMap, PendingChange, TemporalState, StatusLogAugmented } from '@/types/domain';

interface MobileSwipeDeckProps {
  visible: Array<{ unit: Unit; log: StatusLog | undefined | null }>;
  pendingChanges: PendingChangesMap;
  pendingTimelineChanges: Record<string, PendingChange>;
  setPendingChanges: React.Dispatch<React.SetStateAction<PendingChangesMap>>;
  setPendingTimelineChanges: React.Dispatch<React.SetStateAction<Record<string, PendingChange>>>;
  handleLocalUpdate: (unit: Unit, log: StatusLog | null, state: TemporalState, extraProps?: any) => void;
  handleTimelineUpdate: (unit: Unit, log: StatusLog | null, state: TemporalState, extraProps?: any) => void;
  handleRemovePendingItem: (unitId: string, milestoneName?: string | null) => boolean;
  handleDiscardAll: () => void;
  handleApplyAll: () => Promise<{ succeeded: number; failed: number }>;
  pendingCount: number;
  currentMilestones: Milestone[];
  rawStatuses: StatusLog[];
  onChooseStatus?: (unitId: string, milestoneName: string, state: string, track: string) => void;
  savingUnitId?: string | null;
  isApplying: boolean;
  hasRehydrated: boolean;
  typeFilter: string;
  setTypeFilter: (val: string) => void;
  projectUnitTypes: string[];
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
  handleSort: (col: string) => void;
  onEditRoute: () => void;
  sheets: Sheet[];
  activeSheetId: string;
  setActiveSheetId: (id: string) => void;
}

type HistoryEntry = {
  unitId: string;
  previousPendingPayload: PendingChange | undefined;
  previousTimelinePayloads: PendingChange[];
  wasSkippedToBack: boolean;
};

export default function MobileSwipeDeck({
  visible,
  pendingChanges,
  pendingTimelineChanges,
  setPendingChanges,
  setPendingTimelineChanges,
  handleLocalUpdate,
  handleTimelineUpdate,
  handleRemovePendingItem,
  handleDiscardAll,
  handleApplyAll,
  pendingCount,
  currentMilestones,
  rawStatuses,
  onChooseStatus,
  isApplying,
  hasRehydrated,
  typeFilter,
  setTypeFilter,
  projectUnitTypes = [],
  sortColumn,
  sortDirection,
  handleSort,
  onEditRoute,
  sheets,
  activeSheetId,
  setActiveSheetId,
}: MobileSwipeDeckProps) {
  const router = useRouter();
  const [swipedHistory, setSwipedHistory] = useState<HistoryEntry[]>([]);
  const [skippedToBack, setSkippedToBack] = useState<string[]>([]);
  const [cardRedoStack, setCardRedoStack] = useState<HistoryEntry[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [actionDirection, setActionDirection] = useState<'left' | 'right' | 'none'>('none');
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const setToast = useUIStore(s => s.setToast);

  useEffect(() => {
    if (pendingCount === 0) setIsDrawerOpen(false);
  }, [pendingCount]);

  useEffect(() => {
    setSwipedHistory([]);
    setSkippedToBack([]);
    setCardRedoStack([]);
    setIsFiltersOpen(false);
  }, [typeFilter]);

  const collectTimelinePayloads = (unitId: string) => {
    return Object.keys(pendingTimelineChanges)
      .filter(k => k.startsWith(`${unitId}_`))
      .map(k => pendingTimelineChanges[k]);
  };

  const orderedCards = useMemo(() => {
    const swipedIds = swipedHistory.map((h) => h.unitId);
    const visibleCards = visible.filter((r) => !swipedIds.includes(r.unit.id));
    const main = visibleCards.filter((c) => !skippedToBack.includes(c.unit.id));
    const skipped = skippedToBack
      .map((id) => visibleCards.find((c) => c.unit.id === id))
      .filter((c): c is { unit: Unit; log: StatusLog | undefined | null } => Boolean(c));
    return [...main, ...skipped];
  }, [visible, swipedHistory, skippedToBack]);

  const handleLocalUndo = () => {
    if (swipedHistory.length === 0) return;
    const newHist = [...swipedHistory];
    const action = newHist.pop();
    if (!action) return;

    setActionDirection(action.wasSkippedToBack ? 'left' : 'right');
    setToast({ message: 'Action undone', type: 'info' });

    const currentPayload = pendingChanges[action.unitId];
    const currentTimelinePayloads = collectTimelinePayloads(action.unitId);

    setCardRedoStack((prev) => [
      ...prev,
      { 
        unitId: action.unitId, 
        previousPendingPayload: currentPayload, 
        previousTimelinePayloads: currentTimelinePayloads,
        wasSkippedToBack: action.wasSkippedToBack 
      },
    ]);
    setSwipedHistory(newHist);

    if (action.wasSkippedToBack) {
      setSkippedToBack((prev) => prev.filter((id) => id !== action.unitId));
    }

    setPendingChanges((prev) => {
      const next = { ...prev };
      if (action.previousPendingPayload) {
        next[action.unitId] = action.previousPendingPayload;
      } else {
        delete next[action.unitId];
      }
      return next;
    });

    setPendingTimelineChanges((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach(k => {
        if (k.startsWith(`${action.unitId}_`)) delete next[k];
      });
      action.previousTimelinePayloads.forEach(p => {
        const mName = p.extraProps?.milestoneObj?.name || p.log?.milestone;
        next[`${action.unitId}_${mName}`] = p;
      });
      return next;
    });
  };

  const handleLocalRedo = () => {
    if (cardRedoStack.length === 0) return;
    const newRedo = [...cardRedoStack];
    const action = newRedo.pop();
    if (!action) return;

    setActionDirection(action.wasSkippedToBack ? 'left' : 'right');
    setToast({ message: 'Action re-applied', type: 'info' });

    const currentPayload = pendingChanges[action.unitId];
    const currentTimelinePayloads = collectTimelinePayloads(action.unitId);

    setSwipedHistory((prev) => [
      ...prev,
      { 
        unitId: action.unitId, 
        previousPendingPayload: currentPayload,
        previousTimelinePayloads: currentTimelinePayloads,
        wasSkippedToBack: action.wasSkippedToBack 
      },
    ]);

    if (action.wasSkippedToBack) {
      setSkippedToBack((prev) => [...prev, action.unitId]);
    }

    setPendingChanges((prev) => {
      const next = { ...prev };
      if (action.previousPendingPayload) {
        next[action.unitId] = action.previousPendingPayload;
      } else {
        delete next[action.unitId];
      }
      return next;
    });

    setPendingTimelineChanges((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach(k => {
        if (k.startsWith(`${action.unitId}_`)) delete next[k];
      });
      action.previousTimelinePayloads.forEach(p => {
        const mName = p.extraProps?.milestoneObj?.name || p.log?.milestone;
        next[`${action.unitId}_${mName}`] = p;
      });
      return next;
    });
    
    setCardRedoStack(newRedo);
  };

  const handleNextCard = () => {
    const topCard = orderedCards[0];
    if (topCard) {
      setActionDirection('left');
      setSkippedToBack((prev) => {
        const filtered = prev.filter((id) => id !== topCard.unit.id);
        return [...filtered, topCard.unit.id];
      });
    }
  };

  const handlePrevCard = () => {
    setActionDirection('left');
    setSkippedToBack((prev) => {
      const next = [...prev];
      next.pop();
      return next;
    });
  };

  const handleDrawerItemRemove = (unitId: string, milestoneName: string | null) => {
    const hasRemaining = handleRemovePendingItem(unitId, milestoneName);
    if (!hasRemaining) {
      setSwipedHistory((prev) => prev.filter((h) => h.unitId !== unitId));
      setSkippedToBack((prev) => prev.filter((id) => id !== unitId));
    }
    setCardRedoStack([]);
  };

  const handleLocalDiscardAll = () => {
    handleDiscardAll();
    setSwipedHistory([]);
    setSkippedToBack([]);
    setCardRedoStack([]);
  };

  // --- Long Press Logic ---
  const pressTimer = useRef<any>(null);
  const isLongPress = useRef(false);

  const startPress = () => {
    isLongPress.current = false;
    pressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      if (navigator.vibrate) navigator.vibrate(50);
      onEditRoute();
    }, 600);
  };

  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50 dark:bg-black relative">
      <div className="w-full bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 shadow-sm z-50 shrink-0 pt-3 relative">
        <div className="flex items-center justify-between px-4 pb-3">
          <span className="text-sm font-black text-slate-800 dark:text-slate-100 tracking-tight">Review Field Deck</span>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsFiltersOpen(v => !v)}
              className={`p-1.5 rounded-full transition-colors ${
                isFiltersOpen || typeFilter !== 'all' ? 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
              }`}
            >
              <ListFilter size={18} />
            </button>
            <SyncIndicator isApplying={isApplying} hasRehydrated={hasRehydrated} pendingCount={pendingCount} />
          </div>
        </div>

        <AnimatePresence>
          {isFiltersOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="absolute top-full left-0 w-full bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-b border-slate-200/80 dark:border-slate-800/80 shadow-lg overflow-hidden flex flex-col z-50"
            >
              <div className="flex items-center gap-2 px-4 py-3 overflow-x-auto no-scrollbar border-b border-slate-100 dark:border-slate-800/50">
          <button
            onClick={() => setTypeFilter('all')}
            className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-black uppercase tracking-wider transition-colors ${
              typeFilter === 'all'
                ? 'bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 shadow-md'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            All Units
          </button>
          {projectUnitTypes.map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-black uppercase tracking-wider transition-colors ${
                typeFilter === type
                  ? 'bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 shadow-md'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {type}
            </button>
          ))}
        </div>

        <div className="px-4 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-3 w-full">
            <div className="relative flex-1">
              <select
                value={sortColumn}
                onChange={(e) => handleSort(e.target.value)}
                className="w-full appearance-none bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300 outline-none focus:ring-2 focus:ring-sky-500/50"
              >
                <option value="unit_number">Sort by Unit</option>
                <option value="unit_type">Sort by Type</option>
                <option value="walk_sequence">Sort by Route</option>
              </select>
              <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
            
            <button
              onClick={() => handleSort(sortColumn)}
              className="w-10 h-10 flex items-center justify-center bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0"
            >
              {sortDirection === 'asc' ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
            </button>
          </div>
        </div>
        
        {sheets.length > 1 && (
           <div className="px-4 pb-3">
             <div className="relative w-full">
               <select
                 value={activeSheetId}
                 onChange={(e) => setActiveSheetId(e.target.value)}
                 className="w-full appearance-none bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-sky-600 dark:text-sky-400 outline-none focus:ring-2 focus:ring-sky-500/50 truncate pr-10"
               >
                 {sheets.map(s => (
                   <option key={s.id} value={s.id}>Level: {s.sheet_name}</option>
                 ))}
               </select>
               <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-sky-500 pointer-events-none" />
             </div>
           </div>
        )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex-1 relative flex items-center justify-center w-full max-w-sm mx-auto perspective-[1200px] mt-2">
        {orderedCards.length === 0 ? (
          <div className="text-center p-8 bg-slate-100/50 dark:bg-slate-800/30 rounded-3xl border border-slate-200 dark:border-slate-800">
            <h3 className="text-xl font-black text-slate-400 dark:text-slate-500 mb-2">Deck Empty</h3>
            <p className="text-sm font-bold text-slate-400 dark:text-slate-500/70 uppercase tracking-widest">
              You've cleared all units
            </p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout" custom={actionDirection}>
            {orderedCards.map((c, i) => {
            const isTop = i === 0;
            const depth = Math.min(i, 3);
            const { unit, log } = c;

            const unitPending = pendingChanges[unit.id];
            const hasExistingPending = !!unitPending;
            const currentState = unitPending?.state
              || pendingTimelineChanges[`${unit.id}_${log?.milestone}`]?.state
              || log?.temporal_state || 'none';

            let swipeRightLabel = '✓';
            if (!hasExistingPending) {
              if (currentState === 'completed') swipeRightLabel = '→';
              else if (currentState === 'none') swipeRightLabel = 'PLN';
              else if (currentState === 'planned') swipeRightLabel = 'ONG';
            }

            return (
              <SwipeCard
                key={unit.id}
                unit={unit}
                log={
                  (pendingTimelineChanges[`${unit.id}_${log?.milestone}`]
                    ? {
                        ...log,
                        temporal_state: pendingTimelineChanges[`${unit.id}_${log?.milestone}`].state,
                        milestone: pendingTimelineChanges[`${unit.id}_${log?.milestone}`].extraProps?.milestoneObj?.name || log?.milestone,
                        status_color: pendingTimelineChanges[`${unit.id}_${log?.milestone}`].extraProps?.milestoneObj?.color || log?.status_color,
                        outOfSequence: pendingTimelineChanges[`${unit.id}_${log?.milestone}`].extraProps?.outOfSequence ?? (log as any)?.outOfSequence,
                      }
                    : pendingChanges[unit.id]
                    ? {
                        ...log,
                        temporal_state: pendingChanges[unit.id].state,
                        milestone: pendingChanges[unit.id].extraProps?.milestoneObj?.name || log?.milestone,
                        status_color: pendingChanges[unit.id].extraProps?.milestoneObj?.color || log?.status_color,
                        outOfSequence: pendingChanges[unit.id].extraProps?.outOfSequence ?? (log as any)?.outOfSequence,
                      }
                    : log) as StatusLogAugmented | null
                }
                rawStatuses={rawStatuses}
                milestones={currentMilestones}
                isTop={isTop}
                depth={depth}
                pendingChanges={pendingChanges}
                pendingTimelineChanges={pendingTimelineChanges}
                hasPendingUpdate={hasExistingPending}
                swipeRightLabel={swipeRightLabel}
                entryDirection={actionDirection}
                onSwipeLeft={() => {
                  setSwipedHistory((prev) => [
                    ...prev,
                    { unitId: unit.id, previousPendingPayload: pendingChanges[unit.id], previousTimelinePayloads: collectTimelinePayloads(unit.id), wasSkippedToBack: true },
                  ]);
                  setSkippedToBack((prev) => [...prev, unit.id]);
                  setCardRedoStack([]);
                  setActionDirection('none');
                }}
                onSwipeRight={() => {
                  if (!hasExistingPending && currentState !== 'completed') {
                    let nextState: TemporalState = 'planned';
                    if (currentState === 'planned') nextState = 'ongoing';
                    else if (currentState === 'ongoing') nextState = 'completed';
                    handleLocalUpdate(unit, log || null, nextState);
                  }
                  setSwipedHistory((prev) => [
                    ...prev,
                    { unitId: unit.id, previousPendingPayload: pendingChanges[unit.id], previousTimelinePayloads: collectTimelinePayloads(unit.id), wasSkippedToBack: false },
                  ]);
                  setCardRedoStack([]);
                  setActionDirection('none');
                }}
                onChooseStatus={() => onChooseStatus?.(unit.id, log?.milestone || '', log?.temporal_state || '', '')}
                onStageUpdate={handleLocalUpdate}
                onTimelineUpdate={handleTimelineUpdate}
              />
            );
          })}
          </AnimatePresence>
        )}
      </div>

      <div className="flex w-full items-center justify-center gap-4 shrink-0 pb-4 pt-3 bg-white/70 dark:bg-slate-900/70 backdrop-blur-lg border-t border-slate-200/60 dark:border-white/10 z-40 relative rounded-t-[2.5rem]">
        <button
          onClick={handleLocalUndo}
          disabled={swipedHistory.length === 0}
          className="w-10 h-10 flex items-center justify-center bg-white dark:bg-slate-800 rounded-full shadow-lg text-amber-500 disabled:opacity-40 disabled:shadow-none transition-transform active:scale-95"
        >
          <Undo2 size={20} />
        </button>
        <button
          onClick={handlePrevCard}
          disabled={skippedToBack.length === 0}
          className="w-12 h-12 flex items-center justify-center bg-white dark:bg-slate-800 rounded-full shadow-lg text-slate-500 disabled:opacity-40 disabled:shadow-none transition-transform active:scale-95"
        >
          <ArrowLeft size={22} />
        </button>
        <button
          onClick={handleNextCard}
          disabled={orderedCards.length <= 1}
          onPointerDown={startPress}
          onPointerUp={cancelPress}
          onPointerLeave={cancelPress}
          className="w-12 h-12 flex items-center justify-center bg-white dark:bg-slate-800 rounded-full shadow-lg text-slate-500 disabled:opacity-40 disabled:shadow-none transition-transform active:scale-95"
        >
          <ArrowRight size={22} />
        </button>
        <button
          onClick={handleLocalRedo}
          disabled={cardRedoStack.length === 0}
          className="w-10 h-10 flex items-center justify-center bg-white dark:bg-slate-800 rounded-full shadow-lg text-sky-500 disabled:opacity-40 disabled:shadow-none transition-transform active:scale-95"
        >
          <Redo2 size={20} />
        </button>
      </div>

      <AnimatePresence>
        {pendingCount > 0 && !isDrawerOpen && (
          <motion.div
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed top-20 inset-x-0 z-50 flex justify-center pointer-events-none"
          >
            <button
              onClick={() => setIsDrawerOpen(true)}
              className="pointer-events-auto bg-slate-900 dark:bg-slate-800 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 border border-slate-700 dark:border-slate-600 active:scale-95 transition-transform"
            >
              <span className="text-sm font-bold">Review ({pendingCount})</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isDrawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm z-50 pointer-events-auto"
              onPointerDownCapture={(e) => { e.stopPropagation(); setIsDrawerOpen(false); }}
            />
            <PendingReviewDrawer
              pendingChanges={pendingChanges}
              pendingTimelineChanges={pendingTimelineChanges}
              onClose={() => setIsDrawerOpen(false)}
              handleApplyAll={handleApplyAll}
              handleLocalDiscardAll={handleLocalDiscardAll}
              handleDrawerItemRemove={handleDrawerItemRemove}
              handleStageUpdate={handleTimelineUpdate}
              isApplying={isApplying}
              currentMilestones={currentMilestones}
            />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

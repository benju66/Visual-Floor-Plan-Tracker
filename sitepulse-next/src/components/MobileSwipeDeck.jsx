"use client";
import React, { useMemo, useState, useEffect } from 'react';
import { Undo2, Redo2, ArrowLeft, ArrowRight, ChevronDown, ArrowDown, ArrowUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import SwipeCard from '@/components/SwipeCard';
import { motion, AnimatePresence } from 'framer-motion';
import PendingReviewDrawer from './PendingReviewDrawer';
import { UpdatingRing } from '@/components/ui/FieldStatusAtoms';

/**
 * MobileSwipeDeck — Mobile swipe card presenter.
 *
 * Owns all mobile-exclusive state: swipedHistory, skippedToBack, cardRedoStack.
 * Computes orderedCards internally (depends on visible + mobile state).
 *
 * Q2 resolution: resets all three stacks via useEffect when typeFilter changes (Option A).
 * Issue 10 fix: cardRedoStack is also reset on typeFilter change to prevent
 *               stale redo entries for units no longer in the visible set.
 *
 * Step 1 fix: onStageUpdate calls handleLocalUpdate WITHOUT touching swipedHistory.
 *             This means milestone/state changes inside the overlay stage locally
 *             but do NOT auto-advance the card. Only physical swipes advance the deck.
 *
 * Props from container:
 *   visible          — { unit, log }[] from useFieldData
 *   pendingChanges   — object from useFieldData
 *   handleLocalUpdate — fn from useFieldData
 *   currentMilestones — array from useFieldData
 *   rawStatuses      — passed through from page
 *   onChooseStatus   — passed through from page
 *   isApplying       — boolean from useFieldData
 *   setPendingChanges — setState fn from useFieldData (for undo/redo direct state restoration)
 *   typeFilter       — string from useFieldData (triggers internal reset)
 */
export default function MobileSwipeDeck({
  visible,
  pendingChanges,
  pendingTimelineChanges,
  setPendingChanges,
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
  typeFilter,
  setTypeFilter,
  projectUnitTypes = [],
  sortColumn,
  sortDirection,
  handleSort,
  onEditRoute,
}) {
  const router = useRouter();
  const [swipedHistory, setSwipedHistory] = useState([]);
  const [skippedToBack, setSkippedToBack] = useState([]);
  const [cardRedoStack, setCardRedoStack] = useState([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  useEffect(() => {
    if (pendingCount === 0) setIsDrawerOpen(false);
  }, [pendingCount]);

  // Q2 (Option A) + Issue 10: reset all stacks when filter changes
  useEffect(() => {
    setSwipedHistory([]);
    setSkippedToBack([]);
    setCardRedoStack([]);
  }, [typeFilter]);

  // orderedCards: mobile-only derived list; depends on visible + mobile state
  const orderedCards = useMemo(() => {
    const swipedIds = swipedHistory.map((h) => (typeof h === 'string' ? h : h.unitId));
    const visibleCards = visible.filter((r) => !swipedIds.includes(r.unit.id));
    const main = visibleCards.filter((c) => !skippedToBack.includes(c.unit.id));
    const skipped = skippedToBack
      .map((id) => visibleCards.find((c) => c.unit.id === id))
      .filter(Boolean);
    return [...main, ...skipped];
  }, [visible, swipedHistory, skippedToBack]);

  // --- Handlers ---

  const handleLocalUndo = () => {
    if (swipedHistory.length === 0) return;
    const newHist = [...swipedHistory];
    const action = newHist.pop();

    const unitId = typeof action === 'string' ? action : action.unitId;
    const previousPendingPayload = typeof action === 'string' ? undefined : action.previousPendingPayload;
    const wasSkippedToBack = typeof action === 'string' ? skippedToBack.includes(unitId) : action.wasSkippedToBack;

    const currentPayload = pendingChanges[unitId];

    setCardRedoStack((prev) => [
      ...prev,
      { unitId, pendingChangePayload: currentPayload, previousPendingPayload, wasSkippedToBack },
    ]);
    setSwipedHistory(newHist);

    if (wasSkippedToBack) {
      setSkippedToBack((prev) => prev.filter((id) => id !== unitId));
    }

    // Restore previous pending state for this unit
    setPendingChanges((prev) => {
      const next = { ...prev };
      if (previousPendingPayload) {
        next[unitId] = previousPendingPayload;
      } else {
        delete next[unitId];
      }
      return next;
    });
  };

  const handleLocalRedo = () => {
    if (cardRedoStack.length === 0) return;
    const newRedo = [...cardRedoStack];
    const action = newRedo.pop();

    setSwipedHistory((prev) => [
      ...prev,
      { unitId: action.unitId, previousPendingPayload: action.previousPendingPayload, wasSkippedToBack: action.wasSkippedToBack },
    ]);
    if (action.wasSkippedToBack) {
      setSkippedToBack((prev) => [...prev, action.unitId]);
    }
    if (action.pendingChangePayload) {
      setPendingChanges((prev) => ({
        ...prev,
        [action.unitId]: action.pendingChangePayload,
      }));
    }
    setCardRedoStack(newRedo);
  };

  const handleNextCard = () => {
    const topCard = orderedCards[0];
    if (topCard) {
      setSkippedToBack((prev) => {
        const filtered = prev.filter((id) => id !== topCard.unit.id);
        return [...filtered, topCard.unit.id];
      });
    }
  };

  const handlePrevCard = () => {
    setSkippedToBack((prev) => {
      const next = [...prev];
      next.pop();
      return next;
    });
  };

  const handleDrawerItemRemove = (unitId, milestoneName) => {
    const hasRemaining = handleRemovePendingItem(unitId, milestoneName);
    if (!hasRemaining) {
      setSwipedHistory((prev) => prev.filter((h) => {
        const id = typeof h === 'string' ? h : h.unitId;
        return id !== unitId;
      }));
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

  const handleStageUpdateHelper = (stateOrUnit, mLog, state, extraProps, isTimeline = false) => {
    if (isTimeline) {
      handleTimelineUpdate(stateOrUnit, mLog, state, extraProps);
    } else {
      if (typeof stateOrUnit === 'string') {
        // Called as onStageUpdate(state, milestoneObj) inside SwipeCard, but Drawer passes full unit
        // Actually, drawer passes unit, log, state, extraProps, isTimeline
      } else {
        handleLocalUpdate(stateOrUnit, mLog, state, extraProps);
      }
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full gap-2">
      {/* Unified Mobile Header */}
      <div className="sticky top-0 z-40 w-full bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-3 py-2 flex items-center gap-2 shrink-0 shadow-sm">
        
        {/* Back Button */}
        <button
          onClick={() => router.push('/dashboard')}
          className="shrink-0 p-2.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 bg-white/50 dark:bg-black/20 rounded-full transition-colors"
          aria-label="Back to Dashboard"
        >
          <ArrowLeft size={20} />
        </button>

        {/* Type Filter Select */}
        <div className="relative flex items-center flex-1 min-w-0">
          <select
            className="appearance-none w-full flex-1 min-w-0 truncate bg-white/80 dark:bg-black/40 border border-slate-200/80 dark:border-white/10 rounded-full px-4 py-2.5 pr-8 text-[12px] font-bold text-slate-700 dark:text-slate-200 focus:outline-none shadow-sm cursor-pointer"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="All">All Types</option>
            {projectUnitTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <ChevronDown size={16} className="absolute right-3 pointer-events-none text-slate-400" />
        </div>

        {/* Route Controls Container */}
        <button
          onClick={() => {
            if (sortColumn === 'walk_sequence') {
              if (sortDirection === 'asc') handleSort('walk_sequence');
              else handleSort('unit');
            } else handleSort('walk_sequence');
          }}
          className={`shrink-0 px-4 py-2.5 text-[11px] font-bold rounded-full shadow-sm flex items-center gap-1 transition-colors ${
            sortColumn === 'walk_sequence'
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-300/60'
              : 'bg-white/80 dark:bg-black/40 text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10'
          }`}
        >
          Sort Route
          {sortColumn === 'walk_sequence' && (sortDirection === 'asc' ? <ArrowDown size={14} /> : <ArrowUp size={14} />)}
        </button>
      </div>

      {/* Swipe deck */}
      <div className="flex-1 w-full relative flex items-center justify-center overflow-hidden bg-slate-100 dark:bg-slate-950">
        {orderedCards.length === 0 ? (
          <div className="text-slate-400 font-semibold text-lg flex flex-col items-center">
            <div className="text-5xl mb-4">🙌</div>
            All locations verified!
          </div>
        ) : (
          orderedCards.slice(0, 5).reverse().map(({ unit, log }, index, arr) => {
            const isTop = index === arr.length - 1;
            const depth = arr.length - 1 - index;
            return (
              <SwipeCard
                key={unit.id}
                unit={unit}
                log={
                  pendingTimelineChanges[`${unit.id}_${log?.milestone}`]
                    ? {
                        ...log,
                        temporal_state: pendingTimelineChanges[`${unit.id}_${log?.milestone}`].state,
                        milestone: pendingTimelineChanges[`${unit.id}_${log?.milestone}`].extraProps?.milestoneObj?.name || log?.milestone,
                        status_color: pendingTimelineChanges[`${unit.id}_${log?.milestone}`].extraProps?.milestoneObj?.color || log?.status_color,
                        outOfSequence: pendingTimelineChanges[`${unit.id}_${log?.milestone}`].extraProps?.outOfSequence ?? log?.outOfSequence,
                      }
                    : pendingChanges[unit.id]
                    ? {
                        ...log,
                        temporal_state: pendingChanges[unit.id].state,
                        milestone: pendingChanges[unit.id].extraProps?.milestoneObj?.name || log?.milestone,
                        status_color: pendingChanges[unit.id].extraProps?.milestoneObj?.color || log?.status_color,
                        outOfSequence: pendingChanges[unit.id].extraProps?.outOfSequence ?? log?.outOfSequence,
                      }
                    : log
                }
                rawStatuses={rawStatuses}
                milestones={currentMilestones}
                isTop={isTop}
                depth={depth}
                pendingChanges={pendingChanges}
                pendingTimelineChanges={pendingTimelineChanges}
                onSwipeLeft={() => {
                  setSwipedHistory((prev) => [
                    ...prev,
                    { unitId: unit.id, previousPendingPayload: pendingChanges[unit.id], wasSkippedToBack: true },
                  ]);
                  setSkippedToBack((prev) => [...prev, unit.id]);
                  setCardRedoStack([]);
                }}
                onSwipeRight={() => {
                  const unitPending = pendingChanges[unit.id];
                  const pending = pendingTimelineChanges[`${unit.id}_${log?.milestone}`]?.state || unitPending?.state;
                  const current = pending || log?.temporal_state || 'none';
                  let nextState = 'planned';
                  if (current === 'planned') nextState = 'ongoing';
                  else if (current === 'ongoing' || current === 'completed') nextState = 'completed';
                  handleLocalUpdate(unit, log || {}, nextState);
                  setSwipedHistory((prev) => [
                    ...prev,
                    { unitId: unit.id, previousPendingPayload: pendingChanges[unit.id], wasSkippedToBack: false },
                  ]);
                  setCardRedoStack([]);
                }}
                onChooseStatus={onChooseStatus}
                // onStageUpdate: mutates local pending state WITHOUT advancing the card.
                // The card stays on top until the user physically swipes it.
                onStageUpdate={(stateOrUnit, mLog, state, extraProps) => {
                  if (typeof stateOrUnit === 'string') {
                    // Called as onStageUpdate(state, milestoneObj)
                    handleLocalUpdate(unit, log || {}, stateOrUnit, mLog ? { milestoneObj: mLog } : undefined);
                  } else {
                    // Called as onStageUpdate(unit, log, state, extraProps)
                    handleLocalUpdate(stateOrUnit, mLog, state, extraProps);
                  }
                }}
                onTimelineUpdate={handleTimelineUpdate}
              />
            );
          })
        )}
      </div>

      {/* Navigation controls */}
      <div className="flex w-full items-center justify-center gap-4 mt-2 shrink-0 pb-4">
        <button
          onClick={handleLocalUndo}
          disabled={swipedHistory.length === 0}
          className="w-12 h-12 flex items-center justify-center bg-white dark:bg-slate-800 rounded-full shadow-lg text-amber-500 disabled:opacity-40 disabled:shadow-none transition-transform active:scale-95"
        >
          <Undo2 size={22} />
        </button>
        <button
          onClick={handlePrevCard}
          disabled={skippedToBack.length === 0}
          className="w-14 h-14 flex items-center justify-center bg-white dark:bg-slate-800 rounded-full shadow-lg text-slate-500 disabled:opacity-40 disabled:shadow-none transition-transform active:scale-95"
        >
          <ArrowLeft size={24} />
        </button>
        <button
          onClick={handleNextCard}
          disabled={orderedCards.length <= 1}
          className="w-14 h-14 flex items-center justify-center bg-white dark:bg-slate-800 rounded-full shadow-lg text-sky-500 disabled:opacity-40 disabled:shadow-none transition-transform active:scale-95"
        >
          <ArrowRight size={24} />
        </button>
        <button
          onClick={handleLocalRedo}
          disabled={cardRedoStack.length === 0}
          className="w-12 h-12 flex items-center justify-center bg-white dark:bg-slate-800 rounded-full shadow-lg text-amber-500 disabled:opacity-40 disabled:shadow-none transition-transform active:scale-95"
        >
          <Redo2 size={22} />
        </button>
      </div>

      {/* Mobile FAB for Pending Changes */}
      <AnimatePresence>
        {pendingCount > 0 && !isDrawerOpen && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed bottom-28 inset-x-0 z-50 flex justify-center pointer-events-none"
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

      {/* Pending Review Drawer */}
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
              handleStageUpdate={handleStageUpdateHelper}
              isApplying={isApplying}
              currentMilestones={currentMilestones}
            />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

"use client";
import React, { useMemo, useState, useEffect } from 'react';
import { Undo2, Redo2, ArrowLeft, ArrowRight, ChevronDown, ArrowDown, ArrowUp } from 'lucide-react';
import SwipeCard from '@/components/SwipeCard';

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
  setPendingChanges,
  handleLocalUpdate,
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
  const [swipedHistory, setSwipedHistory] = useState([]);
  const [skippedToBack, setSkippedToBack] = useState([]);
  const [cardRedoStack, setCardRedoStack] = useState([]);

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

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full gap-2">
      {/* Mobile Action Bar */}
      <div className="flex items-center justify-between bg-white/60 dark:bg-black/20 rounded-xl border border-slate-200/60 dark:border-white/10 p-1 mb-1 shrink-0">
        
        {/* Type Filter Select (Compact) */}
        <div className="relative flex items-center w-1/3">
          <select
            className="appearance-none w-full bg-transparent border-r border-slate-200/60 dark:border-white/10 py-1.5 pl-3 pr-7 text-[11px] font-bold text-slate-700 dark:text-slate-200 focus:outline-none truncate cursor-pointer"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="All">All Types</option>
            {projectUnitTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <ChevronDown size={14} className="absolute right-2 pointer-events-none text-slate-400" />
        </div>

        {/* Route Sort */}
        <button
          onClick={() => {
            if (sortColumn === 'walk_sequence') {
              if (sortDirection === 'asc') handleSort('walk_sequence');
              else handleSort('unit');
            } else handleSort('walk_sequence');
          }}
          className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-widest flex justify-center items-center gap-1 transition-colors border-r border-slate-200/60 dark:border-white/10 ${
            sortColumn === 'walk_sequence' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          Sort Route
          {sortColumn === 'walk_sequence' && (sortDirection === 'asc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
        </button>

        {/* Edit Route */}
        <button
          onClick={onEditRoute}
          className="flex-1 py-1.5 text-[10px] font-bold uppercase tracking-widest flex justify-center items-center text-slate-500 hover:text-sky-600 dark:hover:text-sky-400 transition-colors"
        >
          Edit Route
        </button>
      </div>

      {/* Swipe deck */}
      <div className="relative flex-1 min-h-0 w-full flex justify-center items-center overflow-hidden bg-slate-100 dark:bg-black/30 rounded-3xl border border-slate-200/50 dark:border-white/5 shadow-inner -mt-2">
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
                  pendingChanges[unit.id]
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
                onSwipeLeft={() => {
                  setSwipedHistory((prev) => [
                    ...prev,
                    { unitId: unit.id, previousPendingPayload: pendingChanges[unit.id], wasSkippedToBack: true },
                  ]);
                  setSkippedToBack((prev) => [...prev, unit.id]);
                  setCardRedoStack([]);
                }}
                onSwipeRight={() => {
                  const pending = pendingChanges[unit.id]?.state;
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
                onStageUpdate={(stateOrUnit, log, state, extraProps) => {
                  // Support two calling conventions:
                  //   onStageUpdate(unit, log, state, extraProps)  — from history overlay row
                  //   onStageUpdate(state, milestoneObj)           — from status badge cycle
                  if (typeof stateOrUnit === 'string') {
                    // Called as onStageUpdate(state, milestoneObj)
                    handleLocalUpdate(unit, log || {}, stateOrUnit, extraProps ? { milestoneObj: extraProps } : undefined);
                  } else {
                    // Called as onStageUpdate(unit, log, state, extraProps)
                    handleLocalUpdate(stateOrUnit, log, state, extraProps);
                  }
                }}
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
    </div>
  );
}

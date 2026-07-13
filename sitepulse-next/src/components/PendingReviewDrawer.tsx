"use client";
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, AlertTriangle, RotateCw } from 'lucide-react';
import { UpdatingRing, PendingStateTag } from '@/components/ui/FieldStatusAtoms';
import { buildPendingItems } from '@/utils/pendingItems';
import { pendingItemState } from '@/utils/syncStatus';
import { useIsOnline } from '@/hooks/useIsOnline';
import type { Unit, StatusLog, PendingChange, TemporalState, Activity } from '@/types/domain';

const getBadgeStyle = (state: TemporalState) => {
  switch (state) {
    case 'planned':
      return {
        wrapper: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-300/60 dark:border-amber-600/40',
        dot: 'bg-amber-500',
      };
    case 'ongoing':
      return {
        wrapper: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-300/60 dark:border-blue-600/40',
        dot: 'bg-blue-500',
      };
    case 'completed':
      return {
        wrapper: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-300/60 dark:border-emerald-600/40',
        dot: 'bg-emerald-500',
      };
    default:
      return {
        wrapper: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700/40',
        dot: 'bg-slate-400',
      };
  }
};

interface PendingReviewDrawerProps {
  pendingChanges: Record<string, PendingChange>;
  pendingTimelineChanges: Record<string, PendingChange>;
  /** Keys (pendingChangeKey) that failed their last Apply (Save Visibility — Phase 2). */
  failedKeys: Set<string>;
  onClose: () => void;
  handleApplyAll: () => Promise<{ succeeded: number; failed: number }>;
  handleLocalDiscardAll: () => void;
  handleDrawerItemRemove: (unitId: string, activityName: string | null) => void;
  /** Retry ONE staged change — reuses the batch write path with a one-item array. */
  handleRetryItem: (change: PendingChange) => Promise<boolean>;
  handleStageUpdate: (unit: Unit, log: StatusLog | null, state: TemporalState, extraProps: any, isTimeline: boolean) => void;
  isApplying: boolean;
  currentActivities: Activity[];
}

export default function PendingReviewDrawer({
  pendingChanges,
  pendingTimelineChanges,
  failedKeys,
  onClose,
  handleApplyAll,
  handleLocalDiscardAll,
  handleDrawerItemRemove,
  handleRetryItem,
  handleStageUpdate,
  isApplying,
  currentActivities,
}: PendingReviewDrawerProps) {
  const [activePickerKey, setActivePickerKey] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<{ succeeded: number; failed: number } | null>(null);
  // Which single row is mid-retry — drives just that row's spinner (isApplying is global).
  const [retryingKey, setRetryingKey] = useState<string | null>(null);
  const isOnline = useIsOnline();

  // One row per slot (primary + timeline deduped, timeline wins) — the SAME shape the
  // desktop popover builds, so both tag waiting/failed identically (Save Visibility — P2).
  const pendingItems = buildPendingItems(pendingChanges, pendingTimelineChanges);

  const handleRetryOne = async (change: PendingChange, key: string) => {
    if (retryingKey) return;
    setRetryingKey(key);
    try {
      await handleRetryItem(change);
    } finally {
      setRetryingKey(null);
    }
  };

  const handleApplyWithFeedback = async () => {
    try {
      const result = await handleApplyAll();
      if (result.failed > 0) {
        setApplyResult(result);
        setTimeout(() => setApplyResult(null), 5000);
      }
    } catch (e) {
      setApplyResult({ succeeded: 0, failed: pendingItems.length });
      setTimeout(() => setApplyResult(null), 5000);
    }
  };

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', stiffness: 350, damping: 30 }}
      className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-white dark:bg-slate-900 shadow-[0_-10px_40px_rgba(0,0,0,0.1)] rounded-t-[2rem] border-t border-slate-200 dark:border-slate-800 max-h-[90vh]"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div>
          <h2 className="text-xl font-black text-slate-800 dark:text-slate-100">Review Changes</h2>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
            {pendingItems.length} {pendingItems.length === 1 ? 'item' : 'items'} pending
          </p>
        </div>
        <button
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {/* List content */}
      <div
        className="flex-1 overflow-y-auto overscroll-contain px-2 py-2"
        onPointerDownCapture={(e) => e.stopPropagation()}
      >
        {pendingItems.map((item) => {
          const rowBadge = getBadgeStyle(item.state);
          const isPickerOpen = activePickerKey === item.key;
          // failed = its key is in failedKeys; waiting = pending & offline (read-only).
          const isFailed = failedKeys.has(item.key);
          const itemState = pendingItemState({ isFailed, isOnline });
          const isRetrying = retryingKey === item.key;

          return (
            <div
              key={item.key}
              className={`mb-2 bg-white dark:bg-slate-900 rounded-2xl border overflow-hidden shadow-sm ${
                isFailed ? 'border-red-300 dark:border-red-700/60' : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="flex items-center px-4 py-3 gap-3">
                {/* Activity Color Swatch */}
                <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: item.activityColor }} />

                {/* Unit Info */}
                <div className="flex flex-col flex-1 min-w-0 gap-0.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Unit {item.unitNumber}
                  </span>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5 truncate">
                    {item.activityName}
                    {item.hasConflict && (
                      <span title="Timeline update overrides main card update">
                        <AlertTriangle size={12} className="text-amber-500" />
                      </span>
                    )}
                  </span>
                  {/* waiting / failed tag — nothing for a plain online-queued item */}
                  <PendingStateTag state={itemState} />
                </div>

                {/* State Badge (Tappable for edit) */}
                <button
                  type="button"
                  onClick={() => setActivePickerKey(isPickerOpen ? null : item.key)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] uppercase tracking-widest font-black transition-colors ${rowBadge.wrapper}`}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${rowBadge.dot}`} />
                  {item.state === 'none' ? 'Clear' : item.state}
                  <ChevronRight size={14} className={`transition-transform ${isPickerOpen ? 'rotate-90' : ''}`} />
                </button>

                {/* Per-item Retry — only for a failed row; re-sends JUST this change. */}
                {isFailed && (
                  <button
                    type="button"
                    onClick={() => handleRetryOne(item.change, item.key)}
                    disabled={isApplying || isRetrying}
                    title="Retry saving this change"
                    aria-label="Retry saving this change"
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-400 disabled:opacity-50 transition-colors shrink-0"
                  >
                    <RotateCw size={15} className={isRetrying ? 'animate-spin' : ''} />
                  </button>
                )}

                {/* Remove Icon */}
                <button
                  type="button"
                  onClick={() => handleDrawerItemRemove(item.unitId, item.isTimeline ? item.activityName : null)}
                  disabled={isRetrying}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 disabled:opacity-50 transition-colors shrink-0"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Inline State Picker */}
              <AnimatePresence>
                {isPickerOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                    className="bg-slate-50 dark:bg-slate-800/50"
                  >
                    <div className="flex flex-col gap-2 px-4 py-3">
                      {(['none', 'planned', 'ongoing', 'completed'] as TemporalState[]).map((s) => {
                        const sb = getBadgeStyle(s);
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => {
                              handleStageUpdate(item.unit, item.log, s, item.isTimeline ? { activityObj: item.activityObj } : {}, item.isTimeline);
                              setActivePickerKey(null);
                            }}
                            className={`w-full min-h-[44px] flex items-center gap-3 px-4 rounded-xl font-black uppercase tracking-wider text-sm transition-all duration-150 active:scale-[0.98] shadow-sm ${sb.wrapper}`}
                          >
                            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${sb.dot}`} />
                            {s === 'none' ? 'Clear Status' : s}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* Footer Actions */}
      <div className="p-6 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0 pb-[max(1.5rem,env(safe-area-inset-bottom))] relative">
        <AnimatePresence>
          {applyResult && applyResult.failed > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="absolute bottom-full left-6 right-6 mb-4 px-4 py-3 bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 rounded-xl text-amber-800 dark:text-amber-200 text-xs font-bold shadow-lg"
            >
              ⚠ {applyResult.succeeded} applied, {applyResult.failed} failed. Please check connection and try again.
            </motion.div>
          )}
        </AnimatePresence>

        <button
          onClick={handleApplyWithFeedback}
          disabled={isApplying || pendingItems.length === 0}
          className="w-full flex items-center justify-center gap-2 min-h-[56px] rounded-2xl bg-amber-500 hover:bg-amber-400 text-amber-950 font-black uppercase tracking-widest text-sm transition-transform active:scale-[0.98] shadow-lg disabled:opacity-50"
        >
          {isApplying ? <UpdatingRing /> : `Apply ${pendingItems.length} Changes`}
        </button>
        <button
          onClick={handleLocalDiscardAll}
          disabled={isApplying || pendingItems.length === 0}
          className="w-full mt-3 min-h-[44px] rounded-xl text-slate-500 dark:text-slate-400 font-bold uppercase tracking-widest text-xs hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
        >
          Discard All
        </button>
      </div>
    </motion.div>
  );
}

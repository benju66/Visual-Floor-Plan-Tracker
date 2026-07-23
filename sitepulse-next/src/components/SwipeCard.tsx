"use client";
import React, { useState, useEffect } from 'react';
import { motion, useMotionValue, useTransform, AnimatePresence, animate } from 'framer-motion';
import { ArrowRight, X, ListTodo, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import type { Unit, StatusLog, Activity, PendingChange, TemporalState, StatusLogAugmented, BottleneckSequence } from '@/types/domain';
import { formatRelativeTime } from '@/utils/formatRelativeTime';
import { lastActivityIso } from '@/utils/staleness';
import { useUIStore } from '@/store/useUIStore';
import { isActivityApplicable } from '@/utils/applicability';
import type { ApplicabilityIndex } from '@/utils/applicability';
import { resolveSwipeGesture } from '@/utils/swipeDeck';

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

interface SwipeCardProps {
  unit: Unit;
  log: StatusLogAugmented | null;
  rawStatuses: StatusLog[];
  activities: Activity[];
  isTop: boolean;
  depth: number;
  pendingChanges: Record<string, PendingChange>;
  pendingTimelineChanges: Record<string, PendingChange>;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  onStageUpdate: (unit: Unit, log: StatusLog | null, state: TemporalState) => void;
  onTimelineUpdate: (unit: Unit, log: StatusLog | null, state: TemporalState, extraProps: any) => void;
  hasPendingUpdate: boolean;
  swipeRightLabel: string;
  entryDirection?: 'left' | 'right' | 'none';
  applicabilityIndex?: ApplicabilityIndex;
  onToggleApplicability?: (unit: Unit, activity: Activity, isApplicable: boolean, currentState?: TemporalState | string | null) => void;
}

const SwipeCard = ({
  unit,
  log,
  rawStatuses,
  activities,
  isTop,
  depth,
  pendingChanges,
  pendingTimelineChanges,
  onSwipeLeft,
  onSwipeRight,
  onStageUpdate,
  onTimelineUpdate,
  hasPendingUpdate,
  swipeRightLabel,
  entryDirection,
  applicabilityIndex,
  onToggleApplicability,
}: SwipeCardProps) => {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const hideCompletedTimeline = useUIStore(s => s.hideCompletedTimeline);
  const setHideCompletedTimeline = useUIStore(s => s.setHideCompletedTimeline);

  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-10, 10]);
  const opacity = useTransform(x, [-200, -100, 0, 100, 200], [0, 1, 1, 1, 0]);

  const backgroundGlow = useTransform(
    x,
    [-150, 0, 150],
    [
      'rgba(148, 163, 184, 0.2)',
      'rgba(255, 255, 255, 0)',
      'rgba(16, 185, 129, 0.2)',
    ]
  );

  const borderGlow = useTransform(
    x,
    [-150, 0, 150],
    [
      'rgba(148, 163, 184, 1)',
      'rgba(203, 213, 225, 0.5)',
      'rgba(16, 185, 129, 1)',
    ]
  );

  const swipeRightOpacity = useTransform(x, [0, 100], [0, 1]);
  const swipeLeftOpacity = useTransform(x, [0, -100], [0, 1]);

  useEffect(() => {
    if (entryDirection === 'left') {
      x.set(-300);
      animate(x, 0, { type: 'spring', stiffness: 300, damping: 25 });
    } else if (entryDirection === 'right') {
      x.set(300);
      animate(x, 0, { type: 'spring', stiffness: 300, damping: 25 });
    }
  }, [entryDirection, x]);

  // Commit on drag distance OR a quick flick (Swipe Deck Excellence P2). The
  // decision lives in the pure, test-pinned resolveSwipeGesture; this handler
  // only fires haptics + the staging callback. Superset of the old ±100px rule.
  const handleDragEnd = (event: any, info: any) => {
    const direction = resolveSwipeGesture(info.offset.x, info.velocity.x);
    if (!direction) return;
    if (typeof window !== 'undefined' && navigator.vibrate) navigator.vibrate(50);
    if (direction === 'right') onSwipeRight();
    else onSwipeLeft();
  };

  const isDragEnabled = isTop && !isHistoryOpen;

  const pendingState = (log?.temporal_state as TemporalState) || 'none';
  const unitRawLogs = rawStatuses?.filter((s) => s.unit_id === unit.id) || [];
  // Age signal parity with the desktop list (P3): the "Updated" line reflects the
  // unit's most recent activity (max client_timestamp), not just its completed date.
  const lastActivity = lastActivityIso(unitRawLogs);

  const handleOverlayStateSelect = (e: React.MouseEvent, state: TemporalState, m: Activity) => {
    e.stopPropagation();
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30);
    onTimelineUpdate(unit, log || null, state, { activityObj: m });
  };

  const timelineChangeCount = Object.keys(pendingTimelineChanges || {}).filter(k => k.startsWith(unit.id + '_')).length;
  
  const hasBottleneck = !!log?.outOfSequence?.length;
  const bottleneckCount = log?.outOfSequence?.length || 0;
  
  // Only activities applicable to this unit count toward the card's progress
  const applicableUnitActivities = applicabilityIndex
    ? activities.filter(m => isActivityApplicable(m, unit, applicabilityIndex))
    : activities;

  const completedCount = applicableUnitActivities.filter(m => {
    const mLog = unitRawLogs.find(l => l.activityName === m.name);
    const ptc = pendingTimelineChanges?.[`${unit.id}_${m.name}`];
    const state = ptc?.state || (log?.activityName === m.name ? pendingState : mLog?.temporal_state || 'none');
    return state === 'completed';
  }).length;

  const outOfSequenceItems = activities.filter(m =>
    log?.outOfSequence?.some(oos => oos.activityName === m.name)
  );

  // Fit-always face (Swipe Deck Excellence P1): the card face no longer scrolls,
  // so the unit label steps its font size down as the name gets longer and clamps
  // to two lines. Long names like "114 Housekeeping" fit without a scroll region,
  // which is what let the phone browser steal diagonal swipes as scrolls.
  const unitLabel = unit.unit_number || '';
  const unitLabelSize =
    unitLabel.length <= 5
      ? 'text-5xl sm:text-6xl'
      : unitLabel.length <= 9
        ? 'text-4xl sm:text-5xl'
        : unitLabel.length <= 15
          ? 'text-2xl sm:text-3xl'
          : 'text-xl sm:text-2xl';

  return (
    <motion.div
      style={{
        x,
        rotate,
        opacity: isTop ? opacity : 1 - depth * 0.1,
        zIndex: 10 - depth,
        scale: isTop ? 1 : 1 - depth * 0.05,
        y: isTop ? 0 : depth * 12,
      }}
      drag={isDragEnabled ? 'x' : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragEnd={handleDragEnd}
      variants={{
        // Swiped cards fly off IN the swipe direction (dir comes from the deck's
        // exitDirection via AnimatePresence custom) on a short, hard-capped tween,
        // and go pointer-inert immediately — so a spent card can never linger on
        // top and eat the next swipe. `layout` is intentionally NOT set: it made
        // the exit ride an uncapped spring, the "ghost" that lingered 1.5–3s
        // (Swipe Deck Excellence P2). Non-directional removals fade in place.
        exit: (dir) => ({
          x: dir === 'left' ? -480 : dir === 'right' ? 480 : 0,
          opacity: 0,
          scale: 0.9,
          pointerEvents: 'none',
          transition: { duration: 0.2, ease: 'easeOut' },
        }),
      }}
      className={`absolute w-[90%] max-w-sm top-0 bottom-4 flex flex-col ${
        isDragEnabled ? 'cursor-grab active:cursor-grabbing' : ''
      } ${isTop ? 'pointer-events-auto' : 'pointer-events-none'}`}
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1 - depth * 0.05, opacity: isTop ? 1 : 1 - depth * 0.1, y: depth * 12 }}
      exit="exit"
      // Snappier, near-critically-damped settle so the next card arrives under the
      // thumb crisply instead of wobbling in (Swipe Deck Excellence P2 — tunable).
      transition={{ type: 'spring', stiffness: 360, damping: 30 }}
    >
      <motion.div
        className={`flex flex-col h-full bg-white dark:bg-slate-900 rounded-[2.5rem] border-[3px] shadow-2xl overflow-hidden relative ${
          isTop && isHistoryOpen
            ? 'border-sky-400/50 dark:border-sky-500/50'
            : hasBottleneck
              ? 'border-red-400/70 dark:border-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.15)]'
              : 'border-slate-200/80 dark:border-white/10'
        }`}
        style={{ borderColor: isTop && !isHistoryOpen && !hasBottleneck ? borderGlow : undefined }}
      >
        {isTop && (
          <motion.div
            className="absolute inset-0 pointer-events-none z-0"
            style={{ backgroundColor: backgroundGlow }}
          />
        )}

        {isTop && !isHistoryOpen && (
          <>
            <motion.div
              style={{ opacity: swipeRightOpacity }}
              className="absolute inset-y-0 right-4 flex items-center justify-center pointer-events-none z-0"
            >
              <div className="p-4 bg-emerald-500 text-white rounded-full font-black text-xl flex items-center justify-center w-[64px] h-[64px]">
                {swipeRightLabel}
              </div>
            </motion.div>
            <motion.div
              style={{ opacity: swipeLeftOpacity }}
              className="absolute inset-y-0 left-4 flex items-center justify-center pointer-events-none z-0"
            >
              <div className="p-4 bg-slate-500 text-white rounded-full">
                <ArrowRight size={32} className="rotate-180" />
              </div>
            </motion.div>
          </>
        )}

        <div className="relative z-10 flex flex-col h-full w-full">
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-2 min-h-0 overflow-hidden">
            <span className="px-3 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 inline-block shadow-sm">
              {unit.unit_type || 'Unknown'} · {completedCount}/{applicableUnitActivities.length}
            </span>

            <div className="flex items-center justify-center gap-2 mb-1 relative w-full">
              <h2 className={`${unitLabelSize} font-black text-slate-900 dark:text-white tracking-tighter leading-tight line-clamp-2 break-words max-w-full`}>
                {unit.unit_number}
              </h2>
            </div>

            <div className="mt-2 mb-3 flex flex-col items-center">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                Current Activity
              </p>
              <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 leading-tight line-clamp-2 break-words max-w-full">
                {log?.activityName || 'Unassigned'}
              </p>
              {lastActivity && (
                <p className="text-[10px] text-slate-400 mt-1">
                  Updated {formatRelativeTime(lastActivity)}
                </p>
              )}
            </div>

            <div className="w-full flex flex-col items-center gap-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                Status
              </p>
              <div className="w-full max-w-[280px] flex gap-1.5" role="radiogroup" aria-label={`Status for ${log?.activityName || 'activity'}`}>
                {[
                  { key: 'none',      label: '×',   ariaLabel: 'Clear status' },
                  { key: 'planned',   label: 'PLN', ariaLabel: 'Planned' },
                  { key: 'ongoing',   label: 'ONG', ariaLabel: 'Ongoing' },
                  { key: 'completed', label: '✓',   ariaLabel: 'Completed' },
                ].map((seg) => {
                  const isActive = pendingState === seg.key;
                  const segStyle = getBadgeStyle(seg.key as TemporalState);
                  return (
                    <button
                      key={seg.key}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      aria-label={seg.ariaLabel}
                      disabled={!isTop}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30);
                        onStageUpdate(unit, log || null, seg.key as TemporalState);
                      }}
                      className={`flex-1 min-h-[48px] rounded-xl text-xs font-black uppercase tracking-wider 
                        transition-all duration-100 active:scale-95 flex items-center justify-center
                        ${isActive
                          ? segStyle.wrapper + ' shadow-sm ring-1 ring-inset ring-white/20'
                          : 'bg-slate-100/80 dark:bg-slate-800/60 text-slate-400 dark:text-slate-500 border border-transparent hover:border-slate-300 dark:hover:border-slate-600'
                        }`}
                    >
                      {seg.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {hasBottleneck && (
            <button
              onClick={() => setIsHistoryOpen(true)}
              disabled={!isTop}
              className="mx-6 mb-2 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-300 text-xs font-bold active:scale-[0.98]"
            >
              <AlertTriangle size={14} />
              {bottleneckCount} ahead of schedule — tap to review
            </button>
          )}

          <div className="flex items-center justify-center px-6 pb-4 pt-3 border-t border-slate-100 dark:border-white/5 shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsHistoryOpen((v) => !v);
              }}
              disabled={!isTop}
              aria-label="View project timeline"
              title="View Project Timeline"
              className={`w-full flex items-center justify-center gap-3 min-h-[48px] rounded-2xl px-6 py-2 font-black uppercase tracking-widest text-[13px] transition-all duration-150 active:scale-[0.98] disabled:opacity-40 shadow-sm ${
                isHistoryOpen
                  ? 'bg-sky-500 text-white shadow-md'
                  : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              <ListTodo size={20} strokeWidth={2.5} />
              Timeline {timelineChangeCount > 0 && <span className="ml-1 px-2 py-0.5 bg-amber-400 text-amber-950 rounded-full text-[11px] font-black">{timelineChangeCount}</span>}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {isHistoryOpen && (
            <motion.div
              key="history-overlay"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="absolute inset-0 z-50 flex flex-col rounded-[2.5rem] overflow-hidden bg-white/97 dark:bg-slate-900/97 backdrop-blur-md"
              onPointerDownCapture={(e: any) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200/70 dark:border-white/8 shrink-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm rounded-t-[2.5rem]">
                <div>
                  <p className="text-lg font-black text-slate-800 dark:text-slate-100 leading-tight">
                    {unit.unit_number} · Timeline
                  </p>
                  {hasBottleneck && (
                    <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mt-0.5">
                      ⚠ {bottleneckCount} out of sequence
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setHideCompletedTimeline(!hideCompletedTimeline);
                    }}
                    aria-label={hideCompletedTimeline ? "Show completed items" : "Hide completed items"}
                    className={`h-10 px-3 flex items-center justify-center gap-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-colors shrink-0 ${
                      hideCompletedTimeline
                        ? 'bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400'
                        : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {hideCompletedTimeline ? (
                      <><EyeOff size={14} /> Hidden</>
                    ) : (
                      <><Eye size={14} /> Showing</>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsHistoryOpen(false);
                    }}
                    aria-label="Close history"
                    className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors active:scale-95 shrink-0"
                  >
                    <X size={18} strokeWidth={2.5} />
                  </button>
                </div>
              </div>

              <div
                className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-200 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-thumb]:rounded-full"
                onPointerDownCapture={(e: any) => e.stopPropagation()}
              >
                {hasBottleneck && (
                  <div className="bg-red-50/80 dark:bg-red-950/20 border-b-2 border-red-200 dark:border-red-800/40 px-4 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-red-500 mb-2">
                      ⚠ Out of Sequence
                    </p>
                    {outOfSequenceItems.map((m) => {
                      const pendingTimeline = pendingTimelineChanges?.[`${unit.id}_${m.name}`];
                      const mLog = unitRawLogs.find((l) => l.activityName === m.name);
                      const isCurrentActivity = log?.activityName === m.name;
                      const state = pendingTimeline 
                        ? pendingTimeline.state
                        : isCurrentActivity
                          ? pendingState
                          : (mLog?.temporal_state as TemporalState) || 'none';

                      return (
                        <div key={m.name} className="mb-2 last:mb-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span
                              className="w-3 h-3 rounded-sm shrink-0"
                              style={{ backgroundColor: m.color || mLog?.status_color || '#94a3b8' }}
                            />
                            <span className="flex-1 truncate text-[13px] font-bold text-slate-700 dark:text-slate-200">
                              {m.name}
                            </span>
                          </div>
                          <div className="flex gap-1.5 pl-5" role="radiogroup" aria-label={`Status for ${m.name}`}>
                            {[
                              { key: 'none',      label: '×',   ariaLabel: 'Clear status' },
                              { key: 'planned',   label: 'PLN', ariaLabel: 'Planned' },
                              { key: 'ongoing',   label: 'ONG', ariaLabel: 'Ongoing' },
                              { key: 'completed', label: '✓',   ariaLabel: 'Completed' },
                            ].map((seg) => {
                              const isActive = state === seg.key;
                              const segStyle = getBadgeStyle(seg.key as TemporalState);
                              return (
                                <button
                                  key={seg.key}
                                  type="button"
                                  role="radio"
                                  aria-checked={isActive}
                                  aria-label={seg.ariaLabel}
                                  onClick={(e) => handleOverlayStateSelect(e, seg.key as TemporalState, m)}
                                  className={`flex-1 min-h-[36px] rounded-lg text-[11px] font-black uppercase tracking-wider 
                                    transition-all duration-100 active:scale-95
                                    ${isActive
                                      ? segStyle.wrapper + ' shadow-sm ring-1 ring-inset ring-white/20'
                                      : 'bg-slate-100/80 dark:bg-slate-800/60 text-slate-400 dark:text-slate-500 border border-transparent hover:border-slate-300 dark:hover:border-slate-600'
                                    }`}
                                >
                                  {seg.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {activities.map((m) => {
                  const notApplicable = applicabilityIndex && !isActivityApplicable(m, unit, applicabilityIndex);
                  if (notApplicable) {
                    return (
                      <div key={m.name} className="border-b border-slate-100 dark:border-white/6 last:border-b-0 px-4 py-2.5 opacity-50">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-sm shrink-0 border border-dashed border-slate-400" />
                          <span className="flex-1 truncate text-[13px] font-bold italic text-slate-400 dark:text-slate-500">
                            {m.name}
                          </span>
                          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 shrink-0">
                            N/A
                          </span>
                          {onToggleApplicability && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onToggleApplicability(unit, m, true); }}
                              className="text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-emerald-500 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 active:scale-95 transition-all shrink-0"
                            >
                              Restore
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  }

                  const pendingTimeline = pendingTimelineChanges?.[`${unit.id}_${m.name}`];
                  const mLog = unitRawLogs.find((l) => l.activityName === m.name);
                  const isCurrentActivity = log?.activityName === m.name;
                  const state = pendingTimeline
                    ? pendingTimeline.state
                    : isCurrentActivity
                      ? pendingState
                      : (mLog?.temporal_state as TemporalState) || 'none';

                  if (hideCompletedTimeline && state === 'completed') return null;

                  return (
                    <div key={m.name} className="border-b border-slate-100 dark:border-white/6 last:border-b-0 px-4 py-2.5">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          className="w-3 h-3 rounded-sm shrink-0"
                          style={{ backgroundColor: m.color || mLog?.status_color || '#94a3b8' }}
                        />
                        <span className="flex-1 truncate text-[13px] font-bold text-slate-700 dark:text-slate-200">
                          {m.name}
                        </span>
                        {isCurrentActivity && (
                          <span className="text-[9px] font-black uppercase tracking-widest text-sky-500 shrink-0">
                            Active
                          </span>
                        )}
                        {onToggleApplicability && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onToggleApplicability(unit, m, false, state); }}
                            aria-label={`Mark ${m.name} not applicable for this location`}
                            className="text-[9px] font-bold uppercase tracking-widest text-slate-300 dark:text-slate-600 hover:text-red-500 px-1.5 py-1 rounded active:scale-95 transition-all shrink-0"
                          >
                            N/A
                          </button>
                        )}
                      </div>

                      <div className="flex gap-1.5 pl-5" role="radiogroup" aria-label={`Status for ${m.name}`}>
                        {[
                          { key: 'none',      label: '×',   ariaLabel: 'Clear status' },
                          { key: 'planned',   label: 'PLN', ariaLabel: 'Planned' },
                          { key: 'ongoing',   label: 'ONG', ariaLabel: 'Ongoing' },
                          { key: 'completed', label: '✓',   ariaLabel: 'Completed' },
                        ].map((seg) => {
                          const isActive = state === seg.key;
                          const segStyle = getBadgeStyle(seg.key as TemporalState);
                          return (
                            <button
                              key={seg.key}
                              type="button"
                              role="radio"
                              aria-checked={isActive}
                              aria-label={seg.ariaLabel}
                              onClick={(e) => handleOverlayStateSelect(e, seg.key as TemporalState, m)}
                              className={`flex-1 min-h-[36px] rounded-lg text-[11px] font-black uppercase tracking-wider 
                                transition-all duration-100 active:scale-95
                                ${isActive
                                  ? segStyle.wrapper + ' shadow-sm ring-1 ring-inset ring-white/20'
                                  : 'bg-slate-100/80 dark:bg-slate-800/60 text-slate-400 dark:text-slate-500 border border-transparent hover:border-slate-300 dark:hover:border-slate-600'
                                }`}
                            >
                              {seg.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
};

export default SwipeCard;

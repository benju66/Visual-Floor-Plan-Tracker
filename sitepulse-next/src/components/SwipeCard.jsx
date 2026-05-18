"use client";
import React, { useState } from 'react';
import { motion, useMotionValue, useTransform, AnimatePresence } from 'framer-motion';
import { Check, ArrowRight, X, ListTodo } from 'lucide-react';
import { BottleneckIndicator } from './ui/FieldStatusAtoms';

/**
 * STATE CYCLE ORDER for the tappable status badge:
 *   none → planned → ongoing → completed → planned → …
 */
const STATE_CYCLE = ['none', 'planned', 'ongoing', 'completed'];

const cycleState = (current) => {
  const idx = STATE_CYCLE.indexOf(current);
  // Skip 'none' when cycling forward (treat it like planned-1)
  if (idx <= 0) return 'planned';
  return STATE_CYCLE[(idx + 1) % STATE_CYCLE.length] || 'planned';
};

const getBadgeStyle = (state) => {
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



/**
 * SwipeCard — Enterprise SaaS swipe card.
 *
 * Props:
 *   unit, log, rawStatuses, milestones — data
 *   isTop, depth                        — deck positioning
 *   pendingChanges                      — full map for per-milestone lookup inside overlay
 *   onSwipeLeft, onSwipeRight           — advance the card (deck nav only)
 *   onChooseStatus                      — open the full QuickStatusModal
 *   onStageUpdate(unit, log, state, extraProps) — stage a local change WITHOUT advancing card
 */
const SwipeCard = ({
  unit,
  log,
  rawStatuses,
  milestones,
  isTop,
  depth,
  pendingChanges,
  pendingTimelineChanges,
  onSwipeLeft,
  onSwipeRight,
  onChooseStatus,
  onStageUpdate,
  onTimelineUpdate,
}) => {
  // Whether the full-card history overlay is open
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

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

  const handleDragEnd = (event, info) => {
    if (info.offset.x > 100) {
      if (typeof window !== 'undefined' && navigator.vibrate) { navigator.vibrate(50); }
      onSwipeRight();
    } else if (info.offset.x < -100) {
      if (typeof window !== 'undefined' && navigator.vibrate) { navigator.vibrate(50); }
      onSwipeLeft();
    }
  };

  // Drag is disabled while the history overlay is open
  const isDragEnabled = isTop && !isHistoryOpen;

  const pendingState = log?.temporal_state || 'none';
  const unitRawLogs = rawStatuses?.filter((s) => s.unit_id === unit.id) || [];

  // --- Status badge tap handler: cycles state locally without advancing ---
  const handleStatusCycle = (e) => {
    e.stopPropagation();
    if (!isTop) return;
    const next = cycleState(pendingState);
    onStageUpdate(unit, log || {}, next);
  };

  // --- Overlay inline state selection: set status directly, stay in overlay ---
  const handleOverlayStateSelect = (e, state, m) => {
    e.stopPropagation();
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30);
    onTimelineUpdate(unit, log || {}, state, { milestoneObj: m });
  };

  const badgeStyle = getBadgeStyle(pendingState);
  
  const timelineChangeCount = Object.keys(pendingTimelineChanges || {}).filter(k => k.startsWith(unit.id + '_')).length;

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
      layout
      className={`absolute w-[90%] max-w-sm h-full flex flex-col ${
        isDragEnabled ? 'cursor-grab active:cursor-grabbing' : ''
      } ${isTop ? 'pointer-events-auto' : 'pointer-events-none'}`}
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1 - depth * 0.05, opacity: isTop ? 1 : 1 - depth * 0.1, y: depth * 12 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
    >
      <motion.div
        className={`flex flex-col h-full bg-white dark:bg-slate-900 rounded-[2rem] border-[3px] shadow-2xl overflow-hidden relative ${
          isTop && isHistoryOpen
            ? 'border-sky-400/50 dark:border-sky-500/50'
            : 'border-slate-200/80 dark:border-white/10'
        }`}
        style={{ borderColor: isTop && !isHistoryOpen ? borderGlow : undefined }}
      >
        {/* Background glow (swipe indicator) */}
        {isTop && (
          <motion.div
            className="absolute inset-0 pointer-events-none z-0"
            style={{ backgroundColor: backgroundGlow }}
          />
        )}

        {/* Swipe direction indicators */}
        {isTop && !isHistoryOpen && (
          <>
            <motion.div
              style={{ opacity: swipeRightOpacity }}
              className="absolute inset-y-0 right-4 flex items-center justify-center pointer-events-none z-0"
            >
              <div className="p-4 bg-emerald-500 text-white rounded-full">
                <Check size={32} />
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

        {/* ── CARD BODY ── */}
        <div className="relative z-10 flex flex-col h-full w-full">

          {/* Main content area */}
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-4 min-h-0 overflow-y-auto no-scrollbar touch-pan-y overscroll-contain">

            {/* Unit type pill */}
            <span className="px-3 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3 inline-block shadow-sm">
              {unit.unit_type || 'Unknown'}
            </span>

            {/* Unit number — dominant visual */}
            <div className="flex items-center justify-center gap-2 mb-1 relative">
              <h2 className="text-6xl sm:text-7xl font-black text-slate-900 dark:text-white tracking-tighter leading-none">
                {unit.unit_number}
              </h2>
              <BottleneckIndicator 
                unit={unit} 
                outOfSequence={log?.outOfSequence} 
                onUpdateStatus={onTimelineUpdate} 
              />
            </div>

            {/* Current milestone */}
            <div className="mt-3 mb-6">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                Current Milestone
              </p>
              <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 leading-tight">
                {log?.milestone || 'Unassigned'}
              </p>
            </div>

            {/* ── Tappable status badge ── */}
            <div className="flex flex-col items-center gap-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Status — tap to cycle
              </p>
              <button
                type="button"
                onClick={handleStatusCycle}
                disabled={!isTop}
                aria-label={`Current status: ${pendingState}. Tap to cycle.`}
                className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-base font-black uppercase tracking-widest transition-all duration-150 active:scale-95 shadow-sm min-h-[48px] min-w-[140px] justify-center select-none ${badgeStyle.wrapper}`}
              >
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${badgeStyle.dot}`} />
                {pendingState === 'none' ? 'Not Set' : pendingState}
              </button>
            </div>
          </div>

          {/* ── Action row ── */}
          <div className="flex items-center justify-center px-6 pb-6 pt-3 border-t border-slate-100 dark:border-white/5 shrink-0">
            {/* Timeline overlay toggle */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsHistoryOpen((v) => !v);
              }}
              disabled={!isTop}
              aria-label="View project timeline"
              title="View Project Timeline"
              className={`w-full flex items-center justify-center gap-3 min-h-[56px] rounded-2xl px-6 py-2 font-black uppercase tracking-widest text-[13px] transition-all duration-150 active:scale-[0.98] disabled:opacity-40 shadow-sm ${
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

        {/* ── FULL-CARD HISTORY OVERLAY ──
            - Renders over the entire card interior (absolute inset-0)
            - z-50 ensures it's above swipe indicators
            - onPointerDownCapture stops pointer events from reaching Framer Motion's
              drag listener, so vertical scrolling doesn't accidentally drag the card
        */}
        <AnimatePresence>
          {isHistoryOpen && (
            <motion.div
              key="history-overlay"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="absolute inset-0 z-50 flex flex-col rounded-[2rem] overflow-hidden bg-white/97 dark:bg-slate-900/97 backdrop-blur-md"
              // KEY FIX: capture pointer events before Framer Motion's drag handler sees them.
              // This prevents any touch/mouse move inside the overlay from triggering horizontal drag.
              onPointerDownCapture={(e) => e.stopPropagation()}
            >
              {/* Sticky overlay header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200/70 dark:border-white/8 shrink-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm rounded-t-[2rem]">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Project Timeline</p>
                  <p className="text-lg font-black text-slate-800 dark:text-slate-100 leading-tight">
                    Unit {unit.unit_number}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsHistoryOpen(false);
                  }}
                  aria-label="Close history"
                  className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors active:scale-95 shrink-0"
                >
                  <X size={18} strokeWidth={2.5} />
                </button>
              </div>

              {/* Scrollable milestone list
                  overscroll-contain prevents pull-to-refresh / parent scroll bleed */}
              <div
                className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-200 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-thumb]:rounded-full"
                // Belt-and-suspenders: also stop propagation on scroll container itself
                onPointerDownCapture={(e) => e.stopPropagation()}
              >
                {milestones.map((m) => {
                  const pendingTimeline = pendingTimelineChanges?.[`${unit.id}_${m.name}`];
                  const mLog = unitRawLogs.find((l) => l.milestone === m.name);
                  // Use the live log state (which reflects pending changes passed as `log` prop)
                  const isCurrentMilestone = log?.milestone === m.name;
                  const state = pendingTimeline 
                    ? pendingTimeline.state
                    : isCurrentMilestone
                      ? pendingState
                      : mLog?.temporal_state || 'none';

                  return (
                    <div key={m.name} className="border-b border-slate-100 dark:border-white/6 last:border-b-0 px-4 py-2.5">
                      {/* Row 1: Milestone name (full width) */}
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          className="w-3 h-3 rounded-sm shrink-0"
                          style={{ backgroundColor: m.color || mLog?.status_color || '#94a3b8' }}
                        />
                        <span className="flex-1 truncate text-[13px] font-bold text-slate-700 dark:text-slate-200">
                          {m.name}
                        </span>
                        {isCurrentMilestone && (
                          <span className="text-[9px] font-black uppercase tracking-widest text-sky-500 shrink-0">
                            Active
                          </span>
                        )}
                      </div>

                      {/* Row 2: Inline segmented status control (full width) */}
                      <div className="flex gap-1.5 pl-5" role="radiogroup" aria-label={`Status for ${m.name}`}>
                        {[
                          { key: 'none',      label: '×',   ariaLabel: 'Clear status' },
                          { key: 'planned',   label: 'PLN', ariaLabel: 'Planned' },
                          { key: 'ongoing',   label: 'ONG', ariaLabel: 'Ongoing' },
                          { key: 'completed', label: '✓',   ariaLabel: 'Completed' },
                        ].map((seg) => {
                          const isActive = state === seg.key;
                          const segStyle = getBadgeStyle(seg.key);
                          return (
                            <button
                              key={seg.key}
                              type="button"
                              role="radio"
                              aria-checked={isActive}
                              aria-label={seg.ariaLabel}
                              onClick={(e) => handleOverlayStateSelect(e, seg.key, m)}
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

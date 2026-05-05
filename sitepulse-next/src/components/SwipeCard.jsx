"use client";
import React, { useState } from 'react';
import { motion, useMotionValue, useTransform, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Check, ArrowRight, X, History, Pencil, ChevronRight } from 'lucide-react';
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

const getBadgeColor = (state) => getBadgeStyle(state).wrapper;

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
  onSwipeLeft,
  onSwipeRight,
  onChooseStatus,
  onStageUpdate,
}) => {
  // Whether the full-card history overlay is open
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  // Milestone selected inside the overlay for inline state picker
  const [overlayActiveMilestone, setOverlayActiveMilestone] = useState(null);

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
      onSwipeRight();
    } else if (info.offset.x < -100) {
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

  // --- Overlay milestone tap → open inline state picker ---
  const handleOverlayMilestoneTap = (e, m) => {
    e.stopPropagation();
    setOverlayActiveMilestone((prev) => (prev?.name === m.name ? null : m));
  };

  // --- Overlay inline state selection: stage update, keep card, stay in overlay ---
  const handleOverlayStateSelect = (e, state, m) => {
    e.stopPropagation();
    onStageUpdate(unit, log || {}, state, { milestoneObj: m });
    setOverlayActiveMilestone(null);
  };

  const badgeStyle = getBadgeStyle(pendingState);

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
      onDragEnd={handleDragEnd}
      layout
      className={`absolute w-[90%] max-w-sm h-full flex flex-col touch-pan-y ${
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
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 pt-8 pb-4 min-h-0">

            {/* Unit type pill */}
            <span className="px-3 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3 inline-block shadow-sm">
              {unit.unit_type || 'Unknown'}
            </span>

            {/* Unit number — dominant visual */}
            <div className="flex items-center justify-center gap-2 mb-1">
              <h2 className="text-7xl font-black text-slate-900 dark:text-white tracking-tighter leading-none">
                {unit.unit_number}
              </h2>
              <BottleneckIndicator outOfSequence={log?.outOfSequence} />
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
          <div className="flex items-center justify-around px-6 pb-6 pt-2 border-t border-slate-100 dark:border-white/5 shrink-0 gap-3">
            {/* Out-of-sequence / Edit Milestone button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (isTop) onChooseStatus?.(unit, () => {});
              }}
              disabled={!isTop}
              aria-label="Edit milestone"
              title="Edit Milestone"
              className="flex flex-col items-center gap-1 min-w-[48px] min-h-[56px] justify-center rounded-2xl px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 active:scale-95 transition-all disabled:opacity-40 shadow-sm"
            >
              <Pencil size={20} strokeWidth={2} />
              <span className="text-[9px] font-bold uppercase tracking-widest">Milestone</span>
            </button>

            {/* Log out-of-sequence warning */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (isTop) onChooseStatus?.(unit, () => {});
              }}
              disabled={!isTop}
              aria-label="Flag out of sequence"
              title="Flag Out of Sequence"
              className="flex flex-col items-center gap-1 min-w-[48px] min-h-[56px] justify-center rounded-2xl px-4 py-2 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-500 dark:text-red-400 active:scale-95 transition-all disabled:opacity-40 shadow-sm"
            >
              <AlertTriangle size={20} strokeWidth={2.5} />
              <span className="text-[9px] font-bold uppercase tracking-widest">Flag</span>
            </button>

            {/* History overlay toggle */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsHistoryOpen((v) => !v);
                setOverlayActiveMilestone(null);
              }}
              disabled={!isTop}
              aria-label="View milestone history"
              title="View Full History"
              className={`flex flex-col items-center gap-1 min-w-[48px] min-h-[56px] justify-center rounded-2xl px-4 py-2 active:scale-95 transition-all disabled:opacity-40 shadow-sm ${
                isHistoryOpen
                  ? 'bg-sky-500 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              <History size={20} strokeWidth={2} />
              <span className="text-[9px] font-bold uppercase tracking-widest">History</span>
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
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Milestone History</p>
                  <p className="text-lg font-black text-slate-800 dark:text-slate-100 leading-tight">
                    Unit {unit.unit_number}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsHistoryOpen(false);
                    setOverlayActiveMilestone(null);
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
                  const mLog = unitRawLogs.find((l) => l.milestone === m.name);
                  // Use the live log state (which reflects pending changes passed as `log` prop)
                  const isCurrentMilestone = log?.milestone === m.name;
                  const state = isCurrentMilestone
                    ? pendingState
                    : mLog?.temporal_state || 'none';

                  const rowBadge = getBadgeStyle(state);
                  const isPickerOpen = overlayActiveMilestone?.name === m.name;

                  return (
                    <div key={m.name} className="border-b border-slate-100 dark:border-white/6 last:border-b-0">
                      {/* Milestone row — min-h-[56px] for thumb-friendly tap target */}
                      <button
                        type="button"
                        onClick={(e) => handleOverlayMilestoneTap(e, m)}
                        className={`w-full flex items-center gap-3 px-5 min-h-[56px] py-3 text-left transition-all duration-150 active:scale-[0.98] ${
                          isPickerOpen
                            ? 'bg-sky-50 dark:bg-sky-900/20'
                            : 'hover:bg-slate-50 dark:hover:bg-white/4 active:bg-slate-100 dark:active:bg-white/8'
                        } ${state === 'none' ? 'opacity-60 hover:opacity-100' : ''}`}
                      >
                        {/* Milestone color swatch */}
                        <span
                          className="w-3 h-3 rounded-sm shrink-0"
                          style={{ backgroundColor: m.color || mLog?.status_color || '#94a3b8' }}
                        />
                        {/* Milestone name */}
                        <span className="flex-1 truncate text-sm font-bold text-slate-700 dark:text-slate-200">
                          {m.name}
                          {isCurrentMilestone && (
                            <span className="ml-2 text-[9px] font-black uppercase tracking-widest text-sky-500">
                              Active
                            </span>
                          )}
                        </span>
                        {/* State badge */}
                        <span className={`text-[10px] uppercase tracking-widest font-black px-2.5 py-1.5 rounded-full shrink-0 ${rowBadge.wrapper}`}>
                          {state === 'none' ? 'Not Set' : state}
                        </span>
                        <ChevronRight
                          size={14}
                          strokeWidth={2.5}
                          className={`shrink-0 text-slate-400 transition-transform duration-200 ${isPickerOpen ? 'rotate-90 text-sky-500' : ''}`}
                        />
                      </button>

                      {/* Inline state picker — expands below the tapped row */}
                      <AnimatePresence>
                        {isPickerOpen && (
                          <motion.div
                            key={`picker-${m.name}`}
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.15, ease: 'easeOut' }}
                            className="overflow-hidden bg-slate-50 dark:bg-slate-800/60"
                          >
                            <div className="flex flex-col gap-2 px-5 py-3">
                              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                                Set status for: <span className="text-slate-600 dark:text-slate-300">{m.name}</span>
                              </p>
                              {['planned', 'ongoing', 'completed'].map((s) => {
                                const sb = getBadgeStyle(s);
                                return (
                                  <button
                                    key={s}
                                    type="button"
                                    onClick={(e) => handleOverlayStateSelect(e, s, m)}
                                    className={`w-full min-h-[48px] flex items-center gap-3 px-4 rounded-xl font-black uppercase tracking-wider text-sm transition-all duration-150 active:scale-[0.98] shadow-sm ${sb.wrapper}`}
                                  >
                                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${sb.dot}`} />
                                    {s}
                                  </button>
                                );
                              })}
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setOverlayActiveMilestone(null); }}
                                className="mt-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest hover:text-slate-600 transition min-h-[44px]"
                              >
                                Cancel
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
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

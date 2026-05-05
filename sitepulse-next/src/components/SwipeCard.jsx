"use client";
import React, { useState } from 'react';
import { motion, useMotionValue, useTransform, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Check, ArrowRight, X, ChevronDown } from 'lucide-react';
import { BottleneckIndicator } from './ui/FieldStatusAtoms';

const SwipeCard = ({ unit, log, rawStatuses, milestones, isTop, depth, onSwipeLeft, onSwipeRight, onChooseStatus, onCommitEscape }) => {
  const [pendingEscapeMilestone, setPendingEscapeMilestone] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-10, 10]);
  const opacity = useTransform(x, [-200, -100, 0, 100, 200], [0, 1, 1, 1, 0]);

  const backgroundGlow = useTransform(
    x,
    [-150, 0, 150],
    [
      "rgba(148, 163, 184, 0.2)",
      "rgba(255, 255, 255, 0)",
      "rgba(16, 185, 129, 0.2)"
    ]
  );

  const borderGlow = useTransform(
    x,
    [-150, 0, 150],
    [
      "rgba(148, 163, 184, 1)",
      "rgba(203, 213, 225, 0.5)",
      "rgba(16, 185, 129, 1)"
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

  const pendingState = log?.temporal_state || 'none';
  const getBadgeColor = (state) => {
    switch (state) {
      case 'planned': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
      case 'ongoing': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      case 'completed': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
      default: return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-400';
    }
  };

  const unitRawLogs = rawStatuses?.filter(s => s.unit_id === unit.id) || [];

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
      drag={isTop && !pendingEscapeMilestone && !isExpanded ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      onDragEnd={handleDragEnd}
      layout
      className={`absolute w-[90%] max-w-sm h-full flex flex-col justify-between touch-pan-y transition-[max-height] duration-300 ease-out ${isExpanded ? "max-h-[85vh]" : "max-h-[500px]"} ${isTop && !pendingEscapeMilestone && !isExpanded ? "cursor-grab active:cursor-grabbing " : ""} ${isTop ? "pointer-events-auto" : "pointer-events-none"}`}
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1 - depth * 0.05, opacity: isTop ? 1 : 1 - depth * 0.1, y: depth * 12 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
    >
      <motion.div
        className={"flex flex-col h-full bg-white dark:bg-slate-900 rounded-[2rem] border-[3px] shadow-2xl overflow-hidden relative " + (isTop && (pendingEscapeMilestone || isExpanded) ? "border-sky-400/50 dark:border-sky-500/50 pointer-events-auto" : "border-slate-200/80 dark:border-white/10")}
        style={{
          borderColor: isTop && !pendingEscapeMilestone ? borderGlow : undefined
        }}
      >
        {isTop && (
          <motion.div
            className="absolute inset-0 pointer-events-none z-0"
            style={{ backgroundColor: backgroundGlow }}
          />
        )}
        {isTop && !pendingEscapeMilestone && (
          <>
            <motion.div style={{ opacity: swipeRightOpacity }} className="absolute inset-y-0 right-4 flex items-center justify-center pointer-events-none z-0">
              <div className="p-4 bg-emerald-500 text-white rounded-full"><Check size={32} /></div>
            </motion.div>
            <motion.div style={{ opacity: swipeLeftOpacity }} className="absolute inset-y-0 left-4 flex items-center justify-center pointer-events-none z-0">
              <div className="p-4 bg-slate-500 text-white rounded-full"><ArrowRight size={32} className="rotate-180" /></div>
            </motion.div>
          </>
        )}
        <div className="p-8 pb-4 flex-1 flex flex-col items-center justify-center text-center relative z-10 w-full min-h-0">
          {pendingEscapeMilestone ? (
            <div className="flex flex-col w-full h-full animate-in fade-in zoom-in-95 duration-200 relative">
              <button
                onClick={(e) => { e.stopPropagation(); setPendingEscapeMilestone(null); }}
                className="absolute -top-4 -right-4 p-2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-full transition-colors pointer-events-auto z-50 shadow-sm"
              >
                <X size={16} strokeWidth={3} />
              </button>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1 mt-2">Set Status For</h3>
              <p className="text-xl font-black text-slate-800 dark:text-slate-100 mb-6 leading-tight">{pendingEscapeMilestone.name}</p>

              <div className="flex flex-col gap-3 w-full flex-1 justify-center">
                <button onClick={() => { onCommitEscape('planned', pendingEscapeMilestone); setPendingEscapeMilestone(null); }} className="w-full py-4 rounded-xl font-black uppercase tracking-wider text-amber-800 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 shadow-sm hover:scale-[1.02] active:scale-95 transition-transform">Planned</button>
                <button onClick={() => { onCommitEscape('ongoing', pendingEscapeMilestone); setPendingEscapeMilestone(null); }} className="w-full py-4 rounded-xl font-black uppercase tracking-wider text-blue-800 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 shadow-sm hover:scale-[1.02] active:scale-95 transition-transform">Ongoing</button>
                <button onClick={() => { onCommitEscape('completed', pendingEscapeMilestone); setPendingEscapeMilestone(null); }} className="w-full py-4 rounded-xl font-black uppercase tracking-wider text-emerald-800 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 shadow-sm hover:scale-[1.02] active:scale-95 transition-transform">Completed</button>
              </div>

              <button onClick={() => setPendingEscapeMilestone(null)} className="mt-6 text-xs font-bold text-slate-400 uppercase tracking-widest hover:text-slate-600 transition">Cancel</button>
            </div>
          ) : (
            <>
              <div className="flex flex-col items-center justify-center mb-2">
                <span className="px-3 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3 inline-block shadow-sm">
                  {unit.unit_type || 'Unknown'}
                </span>
                <div className="flex items-center justify-center gap-2">
                  <h2 className="text-7xl font-black text-slate-900 dark:text-white tracking-tighter">{unit.unit_number}</h2>
                  <BottleneckIndicator outOfSequence={log?.outOfSequence} />
                </div>
              </div>

              <div className="mt-4">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1">Current Milestone</p>
                <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 leading-tight">
                  {log?.milestone || 'Unassigned'}
                </p>
              </div>
              <div className="mt-8 border-t border-slate-100 dark:border-white/5 w-full pt-6">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Status</p>
                <div className="flex items-center justify-center w-full relative h-10">
                  {!pendingEscapeMilestone && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isTop) onChooseStatus?.(unit, (m) => setPendingEscapeMilestone(m));
                      }}
                      title="Log Out of Sequence"
                      className="absolute left-0 w-10 h-10 rounded-full bg-red-100 text-red-500 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-500 hover:text-white dark:hover:bg-red-500 dark:hover:text-white flex items-center justify-center transition-colors active:scale-95 shadow-sm pointer-events-auto cursor-pointer"
                    >
                      <AlertTriangle size={18} strokeWidth={2.5} />
                    </button>
                  )}
                  <span className={`px-4 py-2 rounded-full text-base font-black uppercase tracking-widest ${getBadgeColor(pendingState)} inline-block`}>
                    {pendingState}
                  </span>
                </div>
              </div>

              {/* View Full History Toggle */}
              <button 
                onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }} 
                className="mt-4 flex items-center justify-center gap-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-widest hover:text-slate-600 dark:hover:text-slate-300 transition-colors pointer-events-auto w-full py-2 shrink-0"
              >
                View Full History
                <ChevronDown size={14} className={`transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
              </button>

              {/* Animated Accordion Body */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="w-full flex-1 min-h-0 overflow-hidden pointer-events-auto flex flex-col"
                  >
                     <div className="flex-1 min-h-0 overflow-y-auto mt-1 flex flex-col gap-0 pr-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-200 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-thumb]:rounded-full [mask-image:linear-gradient(to_bottom,black_80%,transparent_100%)] overscroll-contain">
                        {milestones.map(m => {
                           const mLog = unitRawLogs.find(l => l.milestone === m.name);
                           
                           // Check if there is an unapplied local pending change for this specific milestone
                           const isLocallyPending = log?.milestone === m.name;
                           const state = isLocallyPending ? (log?.temporal_state || 'none') : (mLog?.temporal_state || 'none');
                           
                           const badgeColor = getBadgeColor(state);
                           
                           return (
                             <button
                               type="button"
                               key={m.name} 
                               onClick={(e) => { e.stopPropagation(); setPendingEscapeMilestone(m); }}
                               className={`w-full flex items-center gap-2 py-3 min-h-[48px] border-b border-slate-200 dark:border-white/10 last:border-b-0 bg-slate-50/50 dark:bg-black/10 hover:bg-slate-100 dark:hover:bg-black/20 active:scale-[0.98] active:bg-slate-200 dark:active:bg-white/10 transition-all duration-150 cursor-pointer ${state === 'none' ? 'opacity-60 hover:opacity-100' : ''}`}
                             >
                               <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: m.color || mLog?.status_color }} />
                               <span className="truncate text-xs font-bold text-slate-700 dark:text-slate-200 flex-1 text-left">{m.name}</span>
                               <span className={`text-[9px] uppercase tracking-widest font-black px-2 py-1 rounded-full ${badgeColor}`}>
                                 {state === 'none' ? 'Not Started' : state}
                               </span>
                             </button>
                           );
                        })}
                     </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default SwipeCard;

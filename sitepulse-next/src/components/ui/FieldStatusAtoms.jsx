"use client";
import React, { useState } from 'react';
import { X, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const getInvertedBadgeStyle = (state) => {
  switch (state) {
    case 'planned':
      return {
        wrapper: 'bg-amber-900/40 text-amber-300 border border-amber-600/50 dark:bg-amber-100 dark:text-amber-800 dark:border-amber-300/60',
        dot: 'bg-amber-500',
      };
    case 'ongoing':
      return {
        wrapper: 'bg-blue-900/40 text-blue-300 border border-blue-600/50 dark:bg-blue-100 dark:text-blue-800 dark:border-blue-300/60',
        dot: 'bg-blue-500',
      };
    case 'completed':
      return {
        wrapper: 'bg-emerald-900/40 text-emerald-300 border border-emerald-600/50 dark:bg-emerald-100 dark:text-emerald-800 dark:border-emerald-300/60',
        dot: 'bg-emerald-500',
      };
    default:
      return {
        wrapper: 'bg-white/10 text-slate-300 border border-white/20 dark:bg-slate-200 dark:text-slate-600 dark:border-slate-300/80',
        dot: 'bg-slate-400',
      };
  }
};

export function UpdatingRing() {
  return (
    <svg className="h-7 w-7 shrink-0 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-90"
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const BottleneckIndicator = ({ unit, outOfSequence, onUpdateStatus }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedSeqId, setExpandedSeqId] = useState(null);

  if (!outOfSequence || (Array.isArray(outOfSequence) && outOfSequence.length === 0)) return null;

  const isArray = Array.isArray(outOfSequence);

  const handleStateSelect = (e, seq, newState) => {
    e.stopPropagation();
    if (onUpdateStatus && unit) {
      onUpdateStatus(unit, {}, newState, { 
        milestoneObj: { name: seq.milestone, color: seq.status_color } 
      });
    }
    setExpandedSeqId(null);
  };

  return (
    <div
      className="relative flex items-center justify-center p-3 -m-3 z-[100]"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <div
        className="w-2.5 h-2.5 rounded-full bg-red-500 animate-[pulse_2s_ease-in-out_infinite] shadow-[0_0_8px_rgba(239,68,68,0.6)] cursor-pointer ring-2 ring-red-500/20"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
      />

      {isOpen && (
        <>
          {/* Mobile Overlay */}
          <div className="fixed inset-0 z-[100] md:hidden flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/60 dark:bg-black/60 backdrop-blur-sm" onClick={(e) => { e.stopPropagation(); setIsOpen(false); }} />
            <div
              className="w-full max-w-xs bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs rounded-3xl p-6 shadow-2xl relative z-10 pointer-events-auto border border-white/10 dark:border-black/10 animate-in zoom-in-95 fade-in duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white dark:text-slate-500 dark:hover:text-slate-800 bg-white/5 hover:bg-white/10 dark:bg-black/5 dark:hover:bg-black/10 rounded-full transition-colors z-10"
                title="Close"
              >
                <X size={16} strokeWidth={2.5} />
              </button>
              <div className="font-bold text-red-500 dark:text-red-600 mb-3 flex items-center gap-2 uppercase tracking-wider text-[13px] relative z-10 pr-6">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                Sequence Blocked
              </div>
              
              {isArray ? (
                <>
                  <p className="opacity-80 mb-4 text-[13px] leading-tight text-slate-300 dark:text-slate-600 relative z-10">The following operations were logged ahead of schedule:</p>
                  <div className="flex flex-col border-t border-white/10 dark:border-black/5 relative z-10">
                    {outOfSequence.map(seq => {
                      const isExpanded = expandedSeqId === seq.id;
                      const badgeStyle = getInvertedBadgeStyle(seq.temporal_state);
                      return (
                        <div key={seq.id} className="border-b border-white/5 dark:border-black/5 last:border-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); setExpandedSeqId(isExpanded ? null : seq.id); }}
                            className="w-full flex items-center gap-3 py-3 px-1 transition-colors hover:bg-white/5 dark:hover:bg-black/5 rounded-lg active:scale-[0.98]"
                          >
                            <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: seq.status_color }} />
                            <span className="truncate font-bold text-[14px] flex-1 text-left">{seq.milestone}</span>
                            <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full ${badgeStyle.wrapper}`}>
                              {seq.temporal_state}
                            </span>
                            <ChevronRight size={14} className={`shrink-0 transition-transform text-slate-400 ${isExpanded ? 'rotate-90 text-red-400' : ''}`} />
                          </button>
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.15, ease: 'easeOut' }}
                                className="overflow-hidden bg-black/20 dark:bg-black/5 rounded-xl mb-2 mx-1"
                              >
                                <div className="flex flex-col gap-2 py-2 px-1">
                                  {['none', 'planned', 'ongoing', 'completed'].map((s) => {
                                    const sb = getInvertedBadgeStyle(s);
                                    return (
                                      <button
                                        key={s}
                                        type="button"
                                        onClick={(e) => handleStateSelect(e, seq, s)}
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
                </>
              ) : (
                <p className="opacity-80 mb-4 text-[13px] leading-tight text-slate-300 dark:text-slate-600 relative z-10">This location has been manually flagged for review.</p>
              )}
            </div>
          </div>

          {/* Desktop Tooltip */}
          <div
            className="hidden md:block absolute left-full ml-4 top-1/2 -translate-y-1/2 w-80 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs rounded-2xl p-5 shadow-2xl z-[100] pointer-events-auto border border-white/10 dark:border-black/10 animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-1/2 -left-2 -translate-y-1/2 w-4 h-4 bg-slate-900 dark:bg-slate-100 rotate-45 border-l border-b border-white/10 dark:border-black/10" />
            <button
              onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}
              className="absolute top-2 right-2 p-1.5 text-slate-400 hover:text-white dark:text-slate-500 dark:hover:text-slate-800 bg-white/5 hover:bg-white/10 dark:bg-black/5 dark:hover:bg-black/10 rounded-full transition-colors z-10"
              title="Close"
            >
              <X size={14} strokeWidth={2.5} />
            </button>
            <div className="font-bold text-red-500 dark:text-red-600 mb-2 flex items-center gap-1.5 uppercase tracking-wider text-[11px] relative z-10 pr-6">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
              Sequence Blocked
            </div>
            
            {isArray ? (
              <>
                <p className="opacity-80 mb-3 leading-tight text-slate-300 dark:text-slate-600 relative z-10">The following operations were logged ahead of schedule:</p>
                <div className="flex flex-col border-t border-white/10 dark:border-black/5 relative z-10">
                  {outOfSequence.map(seq => {
                    const isExpanded = expandedSeqId === seq.id;
                    const badgeStyle = getInvertedBadgeStyle(seq.temporal_state);
                    return (
                      <div key={seq.id} className="border-b border-white/5 dark:border-black/5 last:border-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); setExpandedSeqId(isExpanded ? null : seq.id); }}
                          className="w-full flex items-center gap-2 py-2.5 px-1 transition-colors hover:bg-white/5 dark:hover:bg-black/5 rounded-lg active:scale-[0.98]"
                        >
                          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: seq.status_color }} />
                          <span className="truncate font-medium text-[13px] flex-1 text-left">{seq.milestone}</span>
                          <span className={`text-[9px] uppercase tracking-widest px-2 py-1 rounded-full ${badgeStyle.wrapper}`}>
                            {seq.temporal_state}
                          </span>
                          <ChevronRight size={14} className={`shrink-0 transition-transform text-slate-400 ${isExpanded ? 'rotate-90 text-red-400' : ''}`} />
                        </button>
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.15, ease: 'easeOut' }}
                              className="overflow-hidden bg-black/20 dark:bg-black/5 rounded-xl mb-2 mx-1"
                            >
                              <div className="flex flex-col gap-1.5 py-1.5 px-1">
                                {['none', 'planned', 'ongoing', 'completed'].map((s) => {
                                  const sb = getInvertedBadgeStyle(s);
                                  return (
                                    <button
                                      key={s}
                                      type="button"
                                      onClick={(e) => handleStateSelect(e, seq, s)}
                                      className={`w-full min-h-[36px] flex items-center gap-2 px-3 rounded-lg font-bold uppercase tracking-wider text-[11px] transition-all duration-150 hover:opacity-80 active:scale-[0.98] ${sb.wrapper}`}
                                    >
                                      <span className={`w-2 h-2 rounded-full shrink-0 ${sb.dot}`} />
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
              </>
            ) : (
              <p className="opacity-80 mb-3 leading-tight text-slate-300 dark:text-slate-600 relative z-10">This location has been manually flagged for review.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
};

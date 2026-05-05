"use client";
import React, { useState } from 'react';
import { X } from 'lucide-react';

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

export const BottleneckIndicator = ({ outOfSequence, onClearFlag }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!outOfSequence || (Array.isArray(outOfSequence) && outOfSequence.length === 0)) return null;

  const isArray = Array.isArray(outOfSequence);

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
                  <div className="flex flex-col gap-3 border-t border-white/10 dark:border-black/5 pt-4 relative z-10">
                    {outOfSequence.map(seq => (
                      <div key={seq.id} className="flex items-center gap-3">
                        <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: seq.status_color }} />
                        <span className="truncate font-bold text-[14px]">{seq.milestone}</span>
                        <span className="text-[11px] font-bold uppercase tracking-widest opacity-60 ml-auto pt-[1px]">{seq.temporal_state}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="opacity-80 mb-4 text-[13px] leading-tight text-slate-300 dark:text-slate-600 relative z-10">This location has been manually flagged for review.</p>
              )}

              {onClearFlag && (
                <div className="mt-5 pt-4 border-t border-white/10 dark:border-black/5 relative z-10">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClearFlag();
                      setIsOpen(false);
                    }}
                    className="w-full flex justify-center items-center py-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-500 dark:text-red-400 font-bold text-xs uppercase tracking-widest transition-colors"
                  >
                    Clear Warning
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Desktop Tooltip */}
          <div
            className="hidden md:block absolute left-full ml-4 top-1/2 -translate-y-1/2 w-72 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs rounded-2xl p-4 shadow-2xl z-[100] pointer-events-auto border border-white/10 dark:border-black/10 animate-in fade-in zoom-in-95 duration-200"
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
                <div className="flex flex-col gap-2 border-t border-white/10 dark:border-black/5 pt-3 relative z-10">
                  {outOfSequence.map(seq => (
                    <div key={seq.id} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: seq.status_color }} />
                      <span className="truncate font-medium text-[13px]">{seq.milestone}</span>
                      <span className="text-[10px] uppercase tracking-widest opacity-50 ml-auto pt-[1px]">{seq.temporal_state}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="opacity-80 mb-3 leading-tight text-slate-300 dark:text-slate-600 relative z-10">This location has been manually flagged for review.</p>
            )}

            {onClearFlag && (
              <div className="mt-4 pt-3 border-t border-white/10 dark:border-black/5 relative z-10">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClearFlag();
                    setIsOpen(false);
                  }}
                  className="w-full flex justify-center items-center py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 dark:text-red-400 font-bold text-[10px] uppercase tracking-widest transition-colors"
                >
                  Clear Warning
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

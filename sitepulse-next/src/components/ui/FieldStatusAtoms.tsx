"use client";
import React, { useState, useRef } from 'react';
import { X, ChevronRight, AlertTriangle, WifiOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Unit, TemporalState } from '@/types/domain';
import { getTemporalStateStyle, getInvertedBadgeStyle } from '@/utils/statusColors';
import { pendingItemLabel, pendingItemTone, type PendingItemState } from '@/utils/syncStatus';

// Chip + inverted-badge styles come from the canonical palette module (UI Polish P2).
// Re-exported so existing consumers keep importing from this file.
export { getTemporalStateStyle };

/** Ordered temporal-state segments shared by the desktop table and the swipe deck. */
export const STATUS_SEGMENTS: ReadonlyArray<{ key: TemporalState | 'none'; label: string; title: string }> = [
  { key: 'none', label: '×', title: 'Clear status' },
  { key: 'planned', label: 'PLN', title: 'Planned' },
  { key: 'ongoing', label: 'ONG', title: 'Ongoing' },
  { key: 'completed', label: '✓', title: 'Completed' },
];

const SEGMENT_ORDER: Array<TemporalState | 'none'> = ['none', 'planned', 'ongoing', 'completed'];

export interface StatusSegmentsProps {
  /** Current temporal state; 'none'/empty shows the × segment active. */
  value: TemporalState | 'none' | null | undefined;
  /** Fired with the chosen state when a segment is activated. */
  onChange: (state: TemporalState | 'none') => void;
  disabled?: boolean;
  /** 'sm' for the dense table, 'lg' for the swipe deck. */
  size?: 'sm' | 'lg';
  /** Amber ring when the control holds an unsaved (pending) edit. */
  pending?: boolean;
  ariaLabel?: string;
}

/**
 * One-click segmented status control — the buttons replacement for the temporal-state
 * <select>. role=radiogroup with roving focus + arrow-key navigation. The active segment
 * is filled via getTemporalStateStyle so it reads as the same colored chip the rest of the
 * field UI uses; inactive segments stay muted. Stops click propagation so it can live inside
 * a clickable (selectable) table row.
 */
export function StatusSegments({
  value,
  onChange,
  disabled = false,
  size = 'sm',
  pending = false,
  ariaLabel,
}: StatusSegmentsProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const current: TemporalState | 'none' = value || 'none';
  const dims =
    size === 'lg'
      ? 'min-h-[44px] min-w-[48px] px-4 text-sm'
      : 'min-h-[30px] min-w-[34px] px-2.5 text-[11px]';

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const idx = Math.max(0, SEGMENT_ORDER.indexOf(current));
    const next =
      e.key === 'ArrowRight'
        ? Math.min(SEGMENT_ORDER.length - 1, idx + 1)
        : Math.max(0, idx - 1);
    if (next === idx) return;
    onChange(SEGMENT_ORDER[next]);
    const btns = groupRef.current?.querySelectorAll('button');
    (btns?.[next] as HTMLButtonElement | undefined)?.focus();
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel || 'Status'}
      onKeyDown={handleKeyDown}
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex shrink-0 overflow-hidden rounded-lg border shadow-sm ${
        pending
          ? 'border-amber-400 dark:border-amber-500 ring-2 ring-amber-500/50'
          : 'border-slate-300 dark:border-white/15'
      }`}
    >
      {STATUS_SEGMENTS.map((seg, i) => {
        const isActive = current === seg.key;
        return (
          <button
            key={seg.key}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={seg.title}
            title={seg.title}
            tabIndex={isActive ? 0 : -1}
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onChange(seg.key);
            }}
            className={`flex items-center justify-center font-bold uppercase tracking-wider transition-all duration-100 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${dims} ${
              i > 0 ? 'border-l border-slate-200 dark:border-white/10' : ''
            } ${
              isActive
                ? getTemporalStateStyle(seg.key)
                : 'bg-transparent text-slate-400 hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-slate-700/50'
            }`}
          >
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Small sync-chrome pill tagging a queued item as failed / waiting (offline) in the
 * pending drill-in (Save Visibility — Phase 2). Shared by the mobile drawer and the
 * desktop FAB popover so both read the SAME tag. amber = waiting, red = failed — LOCAL
 * sync-chrome tones, deliberately NOT the temporal status palette (AGENTS.md §3). A plain
 * `queued` item renders nothing (it's the drawer's implicit "pending" default).
 */
export function PendingStateTag({ state }: { state: PendingItemState }) {
  if (state === 'queued') return null;
  const tone = pendingItemTone(state);
  const cls =
    tone === 'red'
      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border border-red-300/60 dark:border-red-700/50'
      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-300/60 dark:border-amber-700/50';
  const Icon = state === 'failed' ? AlertTriangle : WifiOff;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest whitespace-nowrap ${cls}`}
      title={state === 'failed' ? 'This change failed its last save — Retry to try again' : 'Offline — this change will save when you reconnect'}
    >
      <Icon size={10} className="shrink-0" />
      {pendingItemLabel(state)}
    </span>
  );
}

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

export interface BottleneckSequence {
  id: string;
  activityName: string;
  status_color: string;
  temporal_state: TemporalState;
}

export interface BottleneckIndicatorProps {
  unit: Unit;
  outOfSequence: BottleneckSequence[] | boolean;
  onUpdateStatus?: (unit: Unit, baseLog: any, newState: string, extraProps: Record<string, any>) => void;
}

export const BottleneckIndicator = ({ unit, outOfSequence, onUpdateStatus }: BottleneckIndicatorProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedSeqId, setExpandedSeqId] = useState<string | null>(null);

  if (!outOfSequence || (Array.isArray(outOfSequence) && outOfSequence.length === 0)) return null;

  const isArray = Array.isArray(outOfSequence);

  const handleStateSelect = (e: React.MouseEvent, seq: BottleneckSequence, newState: string) => {
    e.stopPropagation();
    if (onUpdateStatus && unit) {
      onUpdateStatus(unit, {}, newState, { 
        activityObj: { name: seq.activityName, color: seq.status_color } 
      });
    }
    setExpandedSeqId(null);
  };

  return (
    <div
      // No z-index here on purpose: the wrapper must stay below the table's
      // sticky header (z-20) so the always-pulsing dot can't poke through/over
      // it while a row scrolls under. The hover tooltip and mobile popup below
      // keep their own z-[100] to float above sibling rows.
      className="relative flex items-center justify-center p-3 -m-3"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <div
        className="w-2.5 h-2.5 rounded-full bg-red-500 animate-[pulse_2s_ease-in-out_infinite] shadow-[0_0_8px_rgba(239,68,68,0.6)] cursor-pointer ring-2 ring-red-500/20"
        title="Out of sequence — a later step started before an earlier one finished"
        aria-label="Out of sequence — a later step started before an earlier one finished"
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
                  <p className="opacity-80 mb-4 text-[13px] leading-tight text-slate-300 dark:text-slate-600 relative z-10">Out of sequence — a later step started before an earlier one finished:</p>
                  <div className="flex flex-col border-t border-white/10 dark:border-black/5 relative z-10">
                    {(outOfSequence as BottleneckSequence[]).map(seq => {
                      const isExpanded = expandedSeqId === seq.id;
                      const badgeStyle = getInvertedBadgeStyle(seq.temporal_state);
                      return (
                        <div key={seq.id} className="border-b border-white/5 dark:border-black/5 last:border-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); setExpandedSeqId(isExpanded ? null : seq.id); }}
                            className="w-full flex items-center gap-3 py-3 px-1 transition-colors hover:bg-white/5 dark:hover:bg-black/5 rounded-lg active:scale-[0.98]"
                          >
                            <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: seq.status_color }} />
                            <span className="truncate font-bold text-[14px] flex-1 text-left">{seq.activityName}</span>
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
                                  {(['none', 'planned', 'ongoing', 'completed'] as const).map((s) => {
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
                <p className="opacity-80 mb-3 leading-tight text-slate-300 dark:text-slate-600 relative z-10">Out of sequence — a later step started before an earlier one finished:</p>
                <div className="flex flex-col border-t border-white/10 dark:border-black/5 relative z-10">
                  {(outOfSequence as BottleneckSequence[]).map(seq => {
                    const isExpanded = expandedSeqId === seq.id;
                    const badgeStyle = getInvertedBadgeStyle(seq.temporal_state);
                    return (
                      <div key={seq.id} className="border-b border-white/5 dark:border-black/5 last:border-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); setExpandedSeqId(isExpanded ? null : seq.id); }}
                          className="w-full flex items-center gap-2 py-2.5 px-1 transition-colors hover:bg-white/5 dark:hover:bg-black/5 rounded-lg active:scale-[0.98]"
                        >
                          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: seq.status_color }} />
                          <span className="truncate font-medium text-[13px] flex-1 text-left">{seq.activityName}</span>
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
                                {(['none', 'planned', 'ongoing', 'completed'] as const).map((s) => {
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

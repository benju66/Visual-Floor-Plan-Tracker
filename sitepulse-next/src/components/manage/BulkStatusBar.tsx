"use client";
import React, { useState, useRef } from 'react';
import { CheckCheck, X, CalendarDays, ListChecks, UserPlus, UserX, Trash2 } from 'lucide-react';
import type { Activity, TemporalState } from '@/types/domain';
import AnchoredMenu, { MenuItem } from './AnchoredMenu';
import { memberOptions, type MemberLike } from './assignee';

/** Sentinel: apply to each unit's own current (bottleneck) activity. */
export const CURRENT_ACTIVITY = '__CURRENT__';

export interface BulkApplyArgs {
  activityName: string;
  state: TemporalState;
  startDate: string | null;
  endDate: string | null;
  loggedDate: string | null;
}

interface BulkStatusBarProps {
  selectedCount: number;
  matchingCount: number;
  activities: Activity[];
  onApply: (args: BulkApplyArgs) => void;
  onSelectAllMatching: () => void;
  onClear: () => void;
  members?: MemberLike[];
  /** Bulk-assign the selection (online, immediate). null = unassign. */
  onBulkAssign?: (userId: string | null) => void;
  /** Bulk-delete the selection (online, immediate, with confirm upstream). */
  onBulkDelete?: () => void;
}

export default function BulkStatusBar({
  selectedCount,
  matchingCount,
  activities,
  onApply,
  onSelectAllMatching,
  onClear,
  members = [],
  onBulkAssign,
  onBulkDelete,
}: BulkStatusBarProps) {
  const [activityName, setActivityName] = useState('');
  const [state, setState] = useState<TemporalState>('completed');
  const [showDates, setShowDates] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loggedDate, setLoggedDate] = useState('');

  const assignBtnRef = useRef<HTMLButtonElement>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignRect, setAssignRect] = useState<DOMRect | null>(null);
  const hasFieldActions = !!onBulkAssign || !!onBulkDelete;

  if (selectedCount < 1) return null;

  const canApply = activityName !== '';

  const handleApply = () => {
    if (!canApply) return;
    onApply({
      activityName,
      state,
      startDate: startDate || null,
      endDate: endDate || null,
      loggedDate: loggedDate || null,
    });
    setStartDate('');
    setEndDate('');
    setLoggedDate('');
  };

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex flex-col gap-2 p-3 rounded-2xl border shadow-[0_8px_30px_rgb(0,0,0,0.12)] pointer-events-auto animate-in slide-in-from-bottom-8 fade-in duration-200"
      style={{ background: 'var(--glass-bg, rgba(255,255,255,0.92))', borderColor: 'var(--glass-border, rgba(226,232,240,0.8))', backdropFilter: 'blur(16px)' }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 pr-3 border-r border-slate-200 dark:border-slate-700">
          <span className="flex h-6 min-w-6 px-1.5 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-200 text-xs font-bold">
            {selectedCount}
          </span>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">selected</span>
          {matchingCount > selectedCount && (
            <button
              type="button"
              onClick={onSelectAllMatching}
              className="text-[11px] font-bold text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1"
              title="Select every location matching the current filters"
            >
              <ListChecks size={13} /> all {matchingCount}
            </button>
          )}
        </div>

        <select
          value={activityName}
          onChange={(e) => setActivityName(e.target.value)}
          className="bg-white/60 dark:bg-black/25 border border-slate-300/80 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-800 dark:text-slate-100 shadow-sm outline-none focus:ring-2 focus:ring-sky-500/40 min-w-[170px]"
        >
          <option value="" disabled>Choose activity…</option>
          <option value={CURRENT_ACTIVITY}>Current activity (each)</option>
          <optgroup label="Set a specific activity">
            {activities.map((m) => (
              <option key={m.id} value={m.name}>{m.name}</option>
            ))}
          </optgroup>
        </select>

        <select
          value={state}
          onChange={(e) => setState(e.target.value as TemporalState)}
          className="bg-white/60 dark:bg-black/25 border border-slate-300/80 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-800 dark:text-slate-100 shadow-sm outline-none focus:ring-2 focus:ring-sky-500/40"
        >
          <option value="planned">Planned</option>
          <option value="ongoing">Ongoing</option>
          <option value="completed">Completed</option>
        </select>

        <button
          type="button"
          onClick={() => setShowDates((v) => !v)}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border shadow-sm flex items-center gap-1 transition-colors ${
            showDates || startDate || endDate || loggedDate
              ? 'bg-slate-800 text-white border-slate-800 dark:bg-white dark:text-slate-900'
              : 'bg-white/60 dark:bg-black/25 text-slate-600 dark:text-slate-300 border-slate-300/80 dark:border-white/15 hover:bg-slate-100 dark:hover:bg-white/10'
          }`}
          title="Set planned / actual dates"
        >
          <CalendarDays size={14} /> Dates
        </button>

        <button
          type="button"
          onClick={handleApply}
          disabled={!canApply}
          className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-1.5 rounded-lg text-sm font-bold flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50"
        >
          <CheckCheck size={16} /> Update {selectedCount}
        </button>

        <button
          type="button"
          onClick={onClear}
          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors"
          aria-label="Clear selection"
        >
          <X size={18} />
        </button>
      </div>

      {showDates && (
        <div className="flex items-center gap-3 flex-wrap text-xs pt-1 border-t border-slate-200/70 dark:border-slate-700/70">
          <label className="flex items-center gap-1.5 text-slate-500 font-semibold">
            Planned start
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-white/60 dark:bg-black/25 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 outline-none" />
          </label>
          <label className="flex items-center gap-1.5 text-slate-500 font-semibold">
            Planned end
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-white/60 dark:bg-black/25 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 outline-none" />
          </label>
          <label className="flex items-center gap-1.5 text-slate-500 font-semibold">
            Actual completed
            <input type="date" value={loggedDate} onChange={(e) => setLoggedDate(e.target.value)} className="bg-white/60 dark:bg-black/25 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 outline-none" />
          </label>
        </div>
      )}

      {hasFieldActions && (
        <div className="flex items-center gap-2 flex-wrap pt-1.5 border-t border-slate-200/70 dark:border-slate-700/70 text-xs">
          <span className="text-slate-400 font-semibold">Also</span>
          {onBulkAssign && (
            <button
              ref={assignBtnRef}
              type="button"
              onClick={() => { setAssignRect(assignBtnRef.current?.getBoundingClientRect() ?? null); setAssignOpen(true); }}
              className="px-2.5 py-1.5 rounded-lg text-xs font-bold border border-slate-300/80 dark:border-white/15 bg-white/60 dark:bg-black/25 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 shadow-sm flex items-center gap-1 transition-colors"
            >
              <UserPlus size={13} /> Assign
            </button>
          )}
          {onBulkDelete && (
            <button
              type="button"
              onClick={onBulkDelete}
              className="px-2.5 py-1.5 rounded-lg text-xs font-bold border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 shadow-sm flex items-center gap-1 transition-colors"
            >
              <Trash2 size={13} /> Delete {selectedCount}
            </button>
          )}
          <span className="text-[10px] text-slate-400">applied immediately</span>
        </div>
      )}

      {onBulkAssign && (
        <AnchoredMenu open={assignOpen} anchorRect={assignRect} onClose={() => setAssignOpen(false)} width={240}>
          <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Assign {selectedCount} to</div>
          {memberOptions(members).length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No team members yet.</div>}
          {memberOptions(members).map((o) => (
            <MenuItem key={o.id} label={o.label} onClick={() => { setAssignOpen(false); onBulkAssign(o.id); }} />
          ))}
          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
          <MenuItem icon={<UserX size={15} />} label="Unassign" onClick={() => { setAssignOpen(false); onBulkAssign(null); }} />
        </AnchoredMenu>
      )}

      <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center -mb-0.5">
        Status updates stage as pending — review &amp; sync from the “pending” button.
      </p>
    </div>
  );
}

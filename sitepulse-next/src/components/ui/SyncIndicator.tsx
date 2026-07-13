"use client";
import React from 'react';
import { deriveSyncState, syncStateLabel, syncStateTone } from '@/utils/syncStatus';

interface SyncIndicatorProps {
  pendingCount: number;
  isApplying: boolean;
  hasRehydrated: boolean;
  /** Staged changes that failed their last Apply (Save Visibility — Phase 1). */
  failedCount?: number;
}

/**
 * The mobile header's sync dot. Driven entirely by `deriveSyncState`, so it shows the
 * SAME five states as the desktop pending FAB:
 * - Emerald (steady): all changes synced
 * - Amber (pulsing): loading / syncing / changes pending
 * - Red (pulsing): one or more changes FAILED to save — no longer silent (Phase 1)
 * These are sync-chrome tones, not the temporal status palette (AGENTS.md §3).
 */
export default function SyncIndicator({ pendingCount, isApplying, hasRehydrated, failedCount = 0 }: SyncIndicatorProps) {
  const state = deriveSyncState({ hasRehydrated, isApplying, pendingCount, failedCount });
  const tone = syncStateTone(state);
  const label = syncStateLabel(state, { pendingCount, failedCount });

  const dotClass =
    tone === 'red'
      ? 'bg-red-500 animate-pulse'
      : tone === 'amber'
        ? 'bg-amber-500 animate-pulse'
        : tone === 'emerald'
          ? 'bg-emerald-500'
          : 'bg-slate-400';

  return (
    <div
      className="flex items-center gap-1.5 shrink-0"
      title={label}
      aria-label={label}
      role="status"
    >
      <span className={`w-2 h-2 rounded-full transition-colors duration-300 ${dotClass}`} />
      {state === 'error' ? (
        <span className="text-[10px] font-bold text-red-600 dark:text-red-400">
          {failedCount} failed
        </span>
      ) : state === 'syncing' ? (
        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">Syncing…</span>
      ) : pendingCount > 0 ? (
        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">{pendingCount}</span>
      ) : null}
    </div>
  );
}

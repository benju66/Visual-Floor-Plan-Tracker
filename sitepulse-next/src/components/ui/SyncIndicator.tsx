"use client";
import React from 'react';

interface SyncIndicatorProps {
  pendingCount: number;
  isApplying: boolean;
  hasRehydrated: boolean;
}

/**
 * A small status dot shown in the mobile header.
 * - Green (steady): All changes synced
 * - Amber (pulsing): Changes pending or syncing
 */
export default function SyncIndicator({ pendingCount, isApplying, hasRehydrated }: SyncIndicatorProps) {
  const isPending = !hasRehydrated || isApplying || pendingCount > 0;
  const label = !hasRehydrated
    ? 'Loading saved changes…'
    : isApplying
      ? 'Syncing…'
      : pendingCount > 0
        ? `${pendingCount} unsaved`
        : 'All changes synced';

  return (
    <div
      className="flex items-center gap-1.5 shrink-0"
      title={label}
      aria-label={label}
      role="status"
    >
      <span
        className={`w-2 h-2 rounded-full transition-colors duration-300 ${
          isPending
            ? 'bg-amber-500 animate-pulse'
            : 'bg-emerald-500'
        }`}
      />
      {pendingCount > 0 && (
        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
          {isApplying ? 'Syncing…' : `${pendingCount}`}
        </span>
      )}
    </div>
  );
}

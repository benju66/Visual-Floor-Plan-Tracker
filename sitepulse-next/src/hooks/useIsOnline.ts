"use client";
import { useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/react-query';

/**
 * Read-only browser online status (Save Visibility — Phase 2).
 *
 * Subscribes to React Query's `onlineManager` — the SAME online signal the offline
 * mutation queue uses to decide when it can flush — so the drill-in's "waiting (offline)"
 * tag lines up with when a queued change will actually sync.
 *
 * STRICTLY READ-ONLY: it never calls `onlineManager.setOnline`, never registers its own
 * online/offline listeners, and never triggers a retry. The owner chose MANUAL retry, so
 * reconnect auto-retry is deliberately NOT built here (AGENTS.md §2). `useSyncExternalStore`
 * keeps it hydration-safe (assume online on the server / with no `window`).
 */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => onlineManager.subscribe(() => onStoreChange()),
    () => onlineManager.isOnline(),
    () => true,
  );
}

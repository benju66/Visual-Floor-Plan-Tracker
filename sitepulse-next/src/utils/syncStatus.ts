/**
 * Sync-state derivation for the status pending queue (Save Visibility — Phase 1).
 *
 * A single pure function turns the queue's live signals into one of five states, so the
 * desktop pending FAB and the mobile sync dot read the SAME truth (no divergent inline
 * conditionals). The new state this workstream adds is `'error'`: today a failed save
 * silently rejoins the "N pending" count — this makes it a distinct, unmissable state.
 *
 * These are SYNC-CHROME states, not the temporal status palette — their tones live here
 * (amber/emerald + a new red for error), never in `statusColors.ts` (AGENTS.md §3).
 *
 * Framework-free + deterministic (no React, no `Date.now()`), so it is exhaustively unit
 * tested for every branch and the precedence between them.
 */

export type SyncState = 'loading' | 'syncing' | 'pending' | 'error' | 'synced';

/** Sync-chrome tones. NOT the temporal status palette — see `statusColors.ts`. */
export type SyncTone = 'neutral' | 'amber' | 'emerald' | 'red';

export interface SyncStateInput {
  /** False until the IDB rehydrate of the pending queue has settled on mount. */
  hasRehydrated: boolean;
  /** True while an Apply/Retry is in flight. */
  isApplying: boolean;
  /** Distinct staged changes still queued (both primary + timeline slots). */
  pendingCount: number;
  /** Staged changes that failed their last Apply and stayed queued for retry. */
  failedCount: number;
}

/**
 * Precedence (highest wins):
 *   not rehydrated → `loading`
 *   applying       → `syncing`   (masks a prior error until the apply settles)
 *   failedCount>0  → `error`     (a failure beats a plain pending count)
 *   pendingCount>0 → `pending`
 *   else           → `synced`
 */
export function deriveSyncState({ hasRehydrated, isApplying, pendingCount, failedCount }: SyncStateInput): SyncState {
  if (!hasRehydrated) return 'loading';
  if (isApplying) return 'syncing';
  if (failedCount > 0) return 'error';
  if (pendingCount > 0) return 'pending';
  return 'synced';
}

/** The short human string shown beside the dot / on the FAB for each state. */
export function syncStateLabel(state: SyncState, counts: { pendingCount: number; failedCount: number }): string {
  switch (state) {
    case 'loading':
      return 'Loading saved changes…';
    case 'syncing':
      return 'Syncing…';
    case 'error':
      return `${counts.failedCount} failed to save`;
    case 'pending':
      return `${counts.pendingCount} unsaved`;
    case 'synced':
      return 'All changes synced';
  }
}

/**
 * The chrome tone for a state. `error` is the only red; the "working" states
 * (loading/syncing/pending) keep the existing amber; a clean queue is emerald.
 * `neutral` is reserved for future states and is not currently emitted.
 */
export function syncStateTone(state: SyncState): SyncTone {
  switch (state) {
    case 'error':
      return 'red';
    case 'synced':
      return 'emerald';
    case 'loading':
    case 'syncing':
    case 'pending':
      return 'amber';
  }
}

/**
 * Per-item sync state inside the pending drill-in (Save Visibility — Phase 2).
 * - `failed`  — this staged change failed its last Apply and stayed queued for retry.
 * - `waiting` — offline: it can't sync until the connection is back (no failure yet).
 * - `queued`  — online and never failed: simply staged, not applied yet.
 */
export type PendingItemState = 'failed' | 'waiting' | 'queued';

/**
 * Classify ONE staged change for the drawer/popover. Pure so the mobile drawer and the
 * desktop popover tag every row IDENTICALLY (one predicate, no divergent inline
 * conditionals). Precedence: a recorded failure beats offline — if the last attempt
 * failed we say `failed` even while offline, because a retry is what clears it.
 * `isOnline` is read from `navigator.onLine` / React Query's `onlineManager` by the
 * caller (read-only) and passed in — no I/O here.
 */
export function pendingItemState({ isFailed, isOnline }: { isFailed: boolean; isOnline: boolean }): PendingItemState {
  if (isFailed) return 'failed';
  if (!isOnline) return 'waiting';
  return 'queued';
}

/** Sync-chrome tone per item state. Local amber/red — NOT the temporal palette (§3). */
export function pendingItemTone(state: PendingItemState): SyncTone {
  switch (state) {
    case 'failed':
      return 'red';
    case 'waiting':
      return 'amber';
    case 'queued':
      return 'neutral';
  }
}

/** Short human tag for a row. `queued` has no tag — it's the drawer's implicit default. */
export function pendingItemLabel(state: PendingItemState): string {
  switch (state) {
    case 'failed':
      return 'Failed';
    case 'waiting':
      return 'Waiting';
    case 'queued':
      return '';
  }
}

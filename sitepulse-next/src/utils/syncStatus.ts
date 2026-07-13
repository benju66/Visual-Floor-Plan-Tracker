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

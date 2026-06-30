import type { PercentPoint } from '@/types/domain';

/**
 * A tiny pure undo/redo stack over `PercentPoint[][]` snapshots for the
 * NOT-YET-SAVED pending polygon (Drawing Tool Excellence — Phase 3). Framework-free,
 * deterministic, no I/O, no `Date.now()`, JSON-serializable in/out — safe to unit-test
 * in isolation. The component (`FloorplanCanvas`) holds the history in a ref, pushes a
 * snapshot on each committed pending edit (node move, whole-shape move, flip), and on
 * Ctrl+Z / Ctrl+Shift+Z feeds the returned `current` back through `onPendingPolygonMove`.
 *
 * Deliberately ISOLATED from the DB-backed saved-unit `useUndoRedo`: nothing here
 * touches Supabase, `status_logs`, the offline `pendingChanges` buffer, or the IDB
 * mutation queue. The history is in-memory only and lives only as long as the naming
 * session — seeded when the trace opens, cleared when it's saved or cancelled.
 *
 * Model: `snapshots` is the full sequence of states and `cursor` indexes the live one.
 *   - `pushSnapshot` truncates any redo branch (everything after the cursor), appends
 *     the new state, advances the cursor onto it, then caps total length.
 *   - `undo`/`redo` move the cursor one step and return the snapshot now under it.
 */

export interface EditHistory {
  /** The full sequence of pending-polygon states, oldest first. */
  snapshots: PercentPoint[][];
  /** Index into `snapshots` of the currently-live state; -1 only when empty. */
  cursor: number;
}

/**
 * Largest number of snapshots retained; the oldest are dropped past this so a long
 * naming session can't grow the in-memory stack without bound. ~50 distinct edits is
 * far more headroom than a single trace ever needs.
 */
export const EDIT_HISTORY_CAP = 50;

/** Defensive deep copy so stored snapshots can't be mutated by a caller that later
 *  reuses the array, and so every stored value is a plain JSON-serializable object. */
const cloneSnapshot = (snapshot: PercentPoint[]): PercentPoint[] =>
  snapshot.map(p => ({ pctX: p.pctX, pctY: p.pctY }));

/** An empty history (no snapshots, cursor parked before index 0). */
export const emptyEditHistory = (): EditHistory => ({ snapshots: [], cursor: -1 });

/**
 * Seed a fresh history with the polygon's opening state, so the first Ctrl+Z returns
 * to the originally-traced shape rather than to nothing.
 */
export const seedEditHistory = (snapshot: PercentPoint[]): EditHistory => ({
  snapshots: [cloneSnapshot(snapshot)],
  cursor: 0,
});

/**
 * Commit a new state. Any redo branch (states after the cursor) is discarded — a fresh
 * edit forks history — then the snapshot is appended, the cursor advances onto it, and
 * the oldest snapshots are trimmed to honor {@link EDIT_HISTORY_CAP}.
 */
export const pushSnapshot = (history: EditHistory, snapshot: PercentPoint[]): EditHistory => {
  const kept = history.snapshots.slice(0, history.cursor + 1);
  kept.push(cloneSnapshot(snapshot));
  const overflow = kept.length - EDIT_HISTORY_CAP;
  const snapshots = overflow > 0 ? kept.slice(overflow) : kept;
  return { snapshots, cursor: snapshots.length - 1 };
};

/** True when there's an earlier state to step back to. */
export const canUndo = (history: EditHistory): boolean => history.cursor > 0;

/** True when there's a later state to re-apply. */
export const canRedo = (history: EditHistory): boolean =>
  history.cursor >= 0 && history.cursor < history.snapshots.length - 1;

/**
 * Step the cursor back one state. Returns the moved history and the snapshot to apply
 * (`current`). A no-op at the start returns the history unchanged and `current: null`,
 * so the caller can safely skip applying anything.
 */
export const undo = (history: EditHistory): { history: EditHistory; current: PercentPoint[] | null } => {
  if (!canUndo(history)) return { history, current: null };
  const cursor = history.cursor - 1;
  return { history: { snapshots: history.snapshots, cursor }, current: cloneSnapshot(history.snapshots[cursor]) };
};

/**
 * Step the cursor forward one state. Returns the moved history and the snapshot to
 * apply (`current`). A no-op at the end returns the history unchanged and `current: null`.
 */
export const redo = (history: EditHistory): { history: EditHistory; current: PercentPoint[] | null } => {
  if (!canRedo(history)) return { history, current: null };
  const cursor = history.cursor + 1;
  return { history: { snapshots: history.snapshots, cursor }, current: cloneSnapshot(history.snapshots[cursor]) };
};

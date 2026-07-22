/**
 * MobileSwipeDeck's pure decision logic (Frontend Structure W3 — Phase 7),
 * extracted from the component so the mobile crew's primary input surface is
 * pinned by tests. Everything here is pure state-in/state-out: no Date.now()
 * (capturedAt is stamped by useFieldData's handleLocalUpdate at capture time),
 * no store access, no framer-motion — the component keeps all gesture wiring.
 *
 * ⛔ These functions shape the `pendingChanges`/`pendingTimelineChanges` maps
 * that feed the IDB offline queue (AGENTS §2/§6). The maps themselves stay
 * local useState in useFieldData — this module only computes next values.
 * Behavior is characterization-pinned by swipeDeck.test.ts; change a rule here
 * only with a deliberate product decision, never as a refactor side-effect.
 */
import type { PendingChange, PendingChangesMap, TemporalState } from '@/types/domain';

/** One undo/redo snapshot: what the top card's pending state looked like BEFORE
 *  the action, so undo can restore it exactly (deep-snapshot contract). */
export type SwipeHistoryEntry = {
  unitId: string;
  previousPendingPayload: PendingChange | undefined;
  previousTimelinePayloads: PendingChange[];
  wasSkippedToBack: boolean;
};

/** All of a unit's per-activity timeline payloads (keys are `${unitId}_${activityName}`). */
export function collectTimelinePayloads(
  pendingTimelineChanges: Record<string, PendingChange>,
  unitId: string
): PendingChange[] {
  return Object.keys(pendingTimelineChanges)
    .filter(k => k.startsWith(`${unitId}_`))
    .map(k => pendingTimelineChanges[k]);
}

/**
 * The deck order: swiped cards are out entirely; the rest split into the main
 * queue (visible order preserved) followed by the skipped-to-back queue (in
 * skip order). Skipped ids that no longer exist in `visible` are dropped.
 */
export function orderDeck<C extends { unit: { id: string } }>(
  visible: C[],
  swipedHistory: Array<{ unitId: string }>,
  skippedToBack: string[]
): C[] {
  const swipedIds = swipedHistory.map((h) => h.unitId);
  const visibleCards = visible.filter((r) => !swipedIds.includes(r.unit.id));
  const main = visibleCards.filter((c) => !skippedToBack.includes(c.unit.id));
  const skipped = skippedToBack
    .map((id) => visibleCards.find((c) => c.unit.id === id))
    .filter((c): c is C => Boolean(c));
  return [...main, ...skipped];
}

/** Snapshot a unit's current pending state into a history/redo entry. */
export function buildHistoryEntry(
  unitId: string,
  pendingChanges: PendingChangesMap,
  pendingTimelineChanges: Record<string, PendingChange>,
  wasSkippedToBack: boolean
): SwipeHistoryEntry {
  return {
    unitId,
    previousPendingPayload: pendingChanges[unitId],
    previousTimelinePayloads: collectTimelinePayloads(pendingTimelineChanges, unitId),
    wasSkippedToBack,
  };
}

/** Restore (or clear, when the snapshot was empty) a unit's single pending change. */
export function restorePendingPayload(
  map: PendingChangesMap,
  unitId: string,
  payload: PendingChange | undefined
): PendingChangesMap {
  const next = { ...map };
  if (payload) {
    next[unitId] = payload;
  } else {
    delete next[unitId];
  }
  return next;
}

/**
 * Restore a unit's timeline payloads: wipe every `${unitId}_…` key, then re-add
 * each snapshot payload under its activity-name key (the staged activity's name
 * when one was picked, else the log's synthesized name — same rule the capture
 * path uses to key the map).
 */
export function restoreTimelinePayloads(
  map: Record<string, PendingChange>,
  unitId: string,
  payloads: PendingChange[]
): Record<string, PendingChange> {
  const next = { ...map };
  Object.keys(next).forEach(k => {
    if (k.startsWith(`${unitId}_`)) delete next[k];
  });
  payloads.forEach(p => {
    const mName = p.extraProps?.activityObj?.name || p.log?.activityName;
    next[`${unitId}_${mName}`] = p;
  });
  return next;
}

/** Skip the card to the back of the deck (re-skipping moves it to the very end). */
export function skipToBack(skipped: string[], unitId: string): string[] {
  const filtered = skipped.filter((id) => id !== unitId);
  return [...filtered, unitId];
}

/** Bring the most recently skipped card back off the back of the deck. */
export function unskipLast(skipped: string[]): string[] {
  const next = [...skipped];
  next.pop();
  return next;
}

/**
 * The state a card currently shows/acts on: a staged single change wins, then a
 * staged timeline change for the card's bottleneck activity, then the fetched
 * log's state, else 'none'. (Falsy chain on purpose — matches the inline code.)
 */
export function resolveCurrentState(
  pendingEntry: PendingChange | undefined,
  timelineEntry: PendingChange | undefined,
  logState: TemporalState | string | null | undefined
): TemporalState | string {
  return pendingEntry?.state || timelineEntry?.state || logState || 'none';
}

/**
 * The swipe-right progression: none→planned→ongoing→completed. Callers guard
 * with `currentState !== 'completed'` (a completed card's right-swipe is a
 * no-op advance) — for any other/unknown state this returns 'planned', exactly
 * like the inline `let nextState = 'planned'` default it replaced.
 */
export function nextSwipeState(currentState: TemporalState | string): TemporalState {
  if (currentState === 'planned') return 'ongoing';
  if (currentState === 'ongoing') return 'completed';
  return 'planned';
}

/**
 * The label shown under a right-swipe: '✓' whenever a pending change is already
 * staged (the swipe won't restage); otherwise the action it WOULD take —
 * 'PLN'/'ONG' for the next step, '→' for an already-completed card (advance
 * only), '✓' for ongoing (completing).
 */
export function swipeRightLabel(
  hasExistingPending: boolean,
  currentState: TemporalState | string
): string {
  if (!hasExistingPending) {
    if (currentState === 'completed') return '→';
    if (currentState === 'none') return 'PLN';
    if (currentState === 'planned') return 'ONG';
  }
  return '✓';
}

/**
 * Choose-status staging rule: picking an activity on an untouched ('none') card
 * stages it as completed (the field-crew "I picked it because it's done"
 * default); any other current state is kept as-is.
 *
 * NOTE (Swipe Deck Excellence P1, 2026-07-22): this helper is currently
 * UNCONSUMED by production — its only caller was the dead mobile choose-status
 * wiring (SwipeCard rendered no trigger for it), which was deleted this phase.
 * It is retained because it is pinned by swipeDeck.test.ts; flagged for removal
 * whenever that suite is next revised (see the plan's "Open decisions").
 */
export function chooseStatusState(currentState: TemporalState | string): TemporalState {
  return currentState === 'none' ? 'completed' : (currentState as TemporalState);
}

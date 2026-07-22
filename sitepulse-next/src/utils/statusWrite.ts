/**
 * The status-write contract's SHARED mechanics (Frontend Structure W3 — Phase 5),
 * extracted from the four status mutations so the rules live in one tested place
 * instead of four copies. Each helper is pure and behavior-identical to the inline
 * code it replaced — pinned by statusWrite.test.ts AND the hook-level
 * characterization tests (useProjectQueries.test.tsx).
 *
 * Deliberately NOT here (each mutation keeps its own semantics inline):
 * - useClearStatus's explicit-empty "full reset" payload (present-clears by design);
 * - useBulkUpdateStatus's apply-branch `finalLoggedDate` rule (explicit-null for
 *   non-completed states — a different contract from the keep-existing merge);
 * - the omit-preserves/present-clears KEY-shaping (which planned_* keys ride a
 *   write is caller-intent, not shared mechanics).
 *
 * Timestamps are always passed IN (no Date.now()/new Date() inside) — AGENTS §2's
 * capture-time rule stays at the call sites, and the helpers stay testable.
 */

/**
 * Strip the fields that must NEVER ride a status_logs write: the DB-owned `id` /
 * `created_at`, the synthesized display-only `activityName`, and the legacy
 * pre-rename `milestone` key (pendingChanges captured before the milestone→activity
 * rename can replay with it). Returns a copy; never mutates the input.
 */
export function stripStatusWriteFields(log: object): Record<string, unknown> {
  const copy = { ...log } as Record<string, unknown>;
  delete copy.id;
  delete copy.created_at;
  delete copy.activityName;
  delete copy.milestone;
  return copy;
}

/**
 * Capture-time client_timestamp with online fallback (AGENTS §2): a value already
 * present (from PendingChange.capturedAt) is honored untouched; only an absent or
 * empty one is stamped with the caller-supplied now-ISO. Falsy check on purpose —
 * '' must stamp, matching the inline `if (!safeData.client_timestamp)` it replaced.
 */
export function withFallbackClientTimestamp(
  log: Record<string, unknown>,
  nowIso: string
): Record<string, unknown> {
  if (!log.client_timestamp) {
    return { ...log, client_timestamp: nowIso };
  }
  return log;
}

/**
 * The bulk-path completion-date rule: today is stamped ONLY when the row itself
 * records a completion that is missing its date (`logged_date === null` — an
 * intentional strict-null check; undefined/'' do not trigger). Any other state
 * keeps its null — a schedule write must never fabricate progress, and a bulk
 * "mark Planned/Ongoing" must never fabricate a completion date.
 */
export function stampCompletionDate<T extends { logged_date?: unknown; temporal_state?: unknown }>(
  log: T,
  today: string
): T {
  if (log.logged_date === null && log.temporal_state === 'completed') {
    return { ...log, logged_date: today };
  }
  return log;
}

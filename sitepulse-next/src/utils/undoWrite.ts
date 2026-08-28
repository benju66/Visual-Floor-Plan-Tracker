/**
 * Undo/redo's status_logs payload builders (Undo/Redo Data-Integrity — Phase 1).
 *
 * Undo has to send a DIFFERENT payload shape from a normal status edit, and getting
 * that shape wrong is exactly how Ctrl+Z ended up reverting the screen without
 * reverting the data. The two shapes live here, pure and unit-tested, so the hook
 * that calls them holds no correctness load of its own.
 *
 * Mirrors `statusWrite.ts` in every mechanical respect: framework-free, no DB, and
 * **timestamps are passed IN** — never `new Date()` inside — so the tests are
 * deterministic and the "when" stays a call-site decision.
 *
 * Both payloads are fed to the `upsert_status_log` RPC, whose contract is
 * omit-preserves / present-clears (AGENTS §2): a key you LEAVE OUT keeps the stored
 * value; a key sent present-but-empty (`''`) clears it. That is why a reset spells
 * out its empty fields instead of dropping them.
 */

import { stripStatusWriteFields } from './statusWrite';

/**
 * A `status_logs` write payload, in the loose `Record` form the RPC's `log_data`
 * JSON takes (same convention as `statusWrite.ts`). Deliberately not the generated
 * `Insert` row type: the omit-preserves contract makes the SET of keys meaningful,
 * and a fixed row type can't express "this key is absent on purpose".
 */
export type UndoStatusPayload = Record<string, unknown>;

/**
 * The full "Not Started" reset — what undo must write when the slot had NO prior
 * status (the user set a status for the first time, then pressed Ctrl+Z).
 *
 * Every cleared field is sent PRESENT-and-empty, matching `useClearStatus`'s reset
 * (the reference implementation). Two reasons it can't be shorter:
 *  - `status_logs.status_color` is NOT NULL with no default, so a payload without it
 *    is rejected outright (23502) — the original defect: undo wrote four columns,
 *    the database refused, and nobody was told;
 *  - under omit-preserves, dropping the date keys would PRESERVE the dates of the
 *    status being undone — the opposite of a reset. `''` is the RPC's clear
 *    (`NULLIF(...,'') → NULL`).
 *
 * `track` is omitted when the caller has none: an omitted key preserves the stored
 * track, whereas a present-empty one would reset it to the RPC's `'Production'`
 * default. Preserving is the safe reading of "we don't know".
 */
export function buildStatusResetPayload(
  unitId: string,
  activityId: string,
  track: string | null | undefined,
  nowIso: string,
): UndoStatusPayload {
  const payload: UndoStatusPayload = {
    unit_id: unitId,
    activity_id: activityId,
    temporal_state: 'none',
    status_color: '',
    planned_start_date: '',
    planned_end_date: '',
    logged_date: '',
    actual_start_date: '',
    client_timestamp: nowIso,
  };
  if (track) payload.track = track;
  return payload;
}

/**
 * Restore a previously-captured status row (undo back to the old value, or redo
 * forward to the new one).
 *
 * `stripStatusWriteFields` drops the DB-owned `id`/`created_at`, the synthesized
 * display-only `activityName`, and the legacy `milestone` key. Everything else rides
 * the write as captured, so a restore puts the slot back exactly as it was.
 *
 * **The `client_timestamp` is deliberately re-stamped to NOW, not restored.** This is
 * an intentional exception to AGENTS §2's capture-time rule — capture-time governs
 * *field capture*, and an undo is not field capture: it is a new decision made now,
 * and it must WIN the RPC's last-write-wins comparison against the value it is
 * reversing. Restoring the snapshot's own (older) timestamp is what made the undo
 * lose that comparison — the RPC's guard (`EXCLUDED.client_timestamp >
 * status_logs.client_timestamp`) silently rejects it and returns the unchanged row.
 * Do not "fix" this back to preserving the captured timestamp.
 */
export function buildStatusRestorePayload(
  oldLog: object,
  nowIso: string,
): UndoStatusPayload {
  return { ...stripStatusWriteFields(oldLog), client_timestamp: nowIso };
}

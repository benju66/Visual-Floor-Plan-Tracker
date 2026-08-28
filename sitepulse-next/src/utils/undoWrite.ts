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

/**
 * A `status_logs` slot as the undo stack records it — enough to address the row and,
 * for a reset, to satisfy the NOT NULL `track`.
 */
export interface UndoSlotRef {
  unit_id?: string | null;
  activity_id?: string | null;
  track?: string | null;
}

/** The slot key the database enforces: `UNIQUE(unit_id, activity_id)`, never the name. */
function slotKey(slot: UndoSlotRef): string {
  return `${slot.unit_id}_${slot.activity_id}`;
}

/**
 * Give every payload in a batch the SAME key set, filling a missing key with `null`.
 *
 * **Required by PostgREST**, which builds one INSERT from a single column list — a
 * batch mixing reset-shape and restore-shape rows is rejected outright, taking the
 * valid rows down with it. Filling with `null` matches what a listed-but-absent column
 * would do anyway (the conflict-update clears it), so this makes the write explicit
 * rather than changing it.
 */
export function toUniformPayloads(rows: readonly UndoStatusPayload[]): UndoStatusPayload[] {
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
  return rows.map(row =>
    Object.fromEntries(keys.map(k => [k, k in row ? row[k] : null])) as UndoStatusPayload);
}

/**
 * The bulk "Not Started" reset, for a slot the bulk action CREATED (it had no prior
 * row). Same intent as {@link buildStatusResetPayload}, but shaped for the bulk route.
 *
 * ⚠️ **The dates are `null` here, not `''`.** `''` is the clear only INSIDE the
 * `upsert_status_log` RPC, which unwraps it (`NULLIF(x,'')::date`). Bulk writes go
 * through a raw PostgREST upsert with no such unwrapping, so `''` would hit a `date`
 * column and fail the cast — rejecting the whole chunk. `status_color` stays `''`
 * because it is a text column that is NOT NULL.
 */
function buildBulkResetPayload(slot: UndoSlotRef, track: string, nowIso: string): UndoStatusPayload {
  return {
    unit_id: slot.unit_id,
    activity_id: slot.activity_id,
    track,
    temporal_state: 'none',
    status_color: '',
    planned_start_date: null,
    planned_end_date: null,
    logged_date: null,
    actual_start_date: null,
    client_timestamp: nowIso,
  };
}

/**
 * Reverse a BULK status apply: one payload for **every slot the action touched**, not
 * just the ones that had a status before.
 *
 * This is the fix for the workstream's highest-volume defect. The old bulk undo built
 * its write list from the captured `oldLogs` alone, so a location that was Not Started
 * before the apply got a cache entry saying "Not Started" and **no database write** —
 * undo a bulk "mark 50 locations complete" and the screen reverts while the data
 * stands.
 *
 * `slots` is the union of what the action WROTE (`newLogs`, which includes any
 * auto-advanced next-activity slots) and what it captured a before-state for
 * (`oldLogs`); `priorLogs` supplies the before-state. A slot with a prior log is
 * restored; a slot without one is reset — that reset is the missing row.
 *
 * Every row is built on the reset base and then overlaid with the prior snapshot, so
 * the NOT NULL columns (`status_color`, `temporal_state`, `track`) can never come out
 * null, and the batch leaves here key-uniform. Slots that can't be addressed (no
 * `unit_id`/`activity_id`) are dropped — there is no row to write. Order follows
 * `slots`, first occurrence winning, so a caller can predict the batch.
 *
 * @throws if a slot needs a reset and no track can be resolved for it — `track` is NOT
 * NULL, and inventing one would write a location into the wrong scope of work.
 */
export function buildBulkUndoPayloads(
  slots: readonly UndoSlotRef[],
  priorLogs: readonly UndoSlotRef[],
  fallbackTrack: string | null | undefined,
  nowIso: string,
): UndoStatusPayload[] {
  const priorBySlot = new Map(priorLogs
    .filter(l => l.unit_id && l.activity_id)
    .map(l => [slotKey(l), l]));

  const seen = new Set<string>();
  const rows: UndoStatusPayload[] = [];

  for (const slot of slots) {
    if (!slot.unit_id || !slot.activity_id) continue;
    const key = slotKey(slot);
    if (seen.has(key)) continue;
    seen.add(key);

    const prior = priorBySlot.get(key);
    const track = prior?.track ?? slot.track ?? fallbackTrack;
    if (!track) {
      throw new Error(`buildBulkUndoPayloads: no track for slot ${key} — cannot build a NOT NULL track`);
    }
    const base = buildBulkResetPayload(slot, track, nowIso);
    rows.push(prior ? { ...base, ...buildStatusRestorePayload(prior, nowIso) } : base);
  }

  return toUniformPayloads(rows);
}

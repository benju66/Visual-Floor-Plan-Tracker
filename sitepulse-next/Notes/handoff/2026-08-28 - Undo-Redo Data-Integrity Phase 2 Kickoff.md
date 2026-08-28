# Kickoff — Undo/Redo Data-Integrity, Phase 2: bulk + unit-restore status writes

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of Undo/Redo Data-Integrity** (make a BULK undo actually reverse every location, not just the ones that already had a status). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-08-28 - Undo-Redo Data-Integrity Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Undo-Redo-Data-Integrity-Plan.md` (Phase 2)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 2** — do not touch the drawing/geometry undo, and do not start Phase 3's failure surfacing. Start with a failing reproduction test. No SQL, no migration, no RLS change in this workstream at all. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists — in one paragraph

Undo a bulk "mark 50 locations complete" and **the screen reverts while the data stands.** The bulk undo builds its write list from `action.oldLogs` only — the locations that already had a status before the bulk apply. Every location that was Not Started gets a cache entry saying "Not Started" and **no database write at all**. Reproduced: 3 units in, 1 written. This is the highest-volume defect in the workstream, because bulk is precisely where many locations move at once. Phase 1 fixed the single-location case and built the pure payload module this phase extends.

This is a **correctness fix with no feature change.** Undo is invoked exactly as it is today.

## Required reading (in this order)
1. `sitepulse-next/AGENTS.md` — all of it. The binding invariants are in **§2**: bulk status writes stay on `.upsert({ onConflict: 'unit_id,activity_id' })` (single-slot writes use the `upsert_status_log` RPC) and **never** plain `.insert()`; the slot key is `activity_id`, never the activity name; strip the synthesized `activityName`. §6: no `any`, derive types from `database.types.ts`. Note the **Capture-Time Timestamps** bullet now documents undo's deliberate fresh-timestamp exception — Phase 1 added it; honour it here.
2. `sitepulse-next/Notes/plans/Undo-Redo-Data-Integrity-Plan.md` — the plan of record. Phase 2 is your scope; defect 4 is your target.
3. `src/utils/undoWrite.ts` + `undoWrite.test.ts` — **Phase 1's module, which you are extending.** Read the doc comments before adding anything; `buildStatusResetPayload` and `buildStatusRestorePayload` already encode the reset/restore shapes and the fresh-timestamp rule.
4. `src/hooks/useUndoRedo.ts` — `BULK_UPDATE_STATUS` (undo + redo) and the `DELETE_UNIT` status restore. The `UPDATE_STATUS` paths are DONE (Phase 1) — leave them alone.
5. `src/hooks/projectQueries/statuses.ts` → `useBulkUpdateStatus` — the reference for how a bulk chunk is shaped, and the source of the uniform-keys constraint below.

## Scope — build exactly this

**1. `buildBulkUndoPayloads(unitIds, oldLogs, track, activityId, nowIso)` in `src/utils/undoWrite.ts` (+ tests).**
Returns a payload for **every** unit id: restore-shape where an old log exists, reset-shape where it does not. This is the fix for defect 4 and carries the whole correctness load of the phase.

⚠️ **Two traps that make this NOT a copy of the single-slot builders.** Both are real; both are already evidenced in the codebase:
- **Dates must be `null`, not `''`.** `''` only works inside the RPC, which does `NULLIF(x,'')::date`. A raw PostgREST upsert sends `''` straight at a `date` column and the cast fails. Colour stays `''` (it is a text column, and `useBulkUpdateStatus` already sends `b.status_color || ''`).
- **Every row in a chunk needs the SAME key set.** PostgREST bulk writes require it — see the comment at `statuses.ts` ("Keys stay uniform across the chunk … which PostgREST bulk writes require"). Mixing restore-shape rows and reset-shape rows in one array is exactly how that breaks. Emit a uniform key set across the whole batch (every row carries every key), or split into two batches — decide, and pin it with a test.

**2. Fix `BULK_UPDATE_STATUS` undo and redo in `src/hooks/useUndoRedo.ts`.**
- Undo writes one row per unit id via `buildBulkUndoPayloads`, keeping the existing **800-row chunking** and the `.upsert({ onConflict: 'unit_id,activity_id' })` form.
- **Check `{ error }` on every chunk and throw.** User-facing surfacing is Phase 3's job.
- Stamp **fresh** `client_timestamp`s. The raw upsert has no last-write-wins guard of its own, so this is not about winning a comparison — it is about not leaving a stale timestamp *stored* on the row, which would let a genuinely stale queued write win later.
- Redo has the same missing-error-check problem; fix it the same way.

**3. Fix the `DELETE_UNIT` undo's `status_logs` restore** to use `buildStatusRestorePayload` per row instead of the hand-rolled destructure + stale timestamp, error-checked.

**4. The name-keyed cache filter (small, same block).** The bulk cache updater filters by `s.activityName === action.activityName` — the display name, not the `activity_id` slot key (AGENTS §2). Take the ids off `oldLogs`/`newLogs`. Care point: the `'__KEEP_EXISTING__'` branch spans several activities per location, so it is a set-membership test, not a single-id compare.

## Start with a failing test
Before changing the hook, write the reproduction: a bulk action over **3 units where only 1 had a prior status**, then undo. Today exactly 1 row is written; assert 3. Use the Phase 1 harness — `src/hooks/useUndoRedo.test.tsx` already has the recording-stub + `renderHook` + `setUndoStack(...)` recipe, and its stub records both the RPC and the bulk-upsert routes. ⚠️ Vitest **swallows `console.log`** here — assert observed values in one object (`expect({...}).toEqual({...})`) so the diff prints them.

## Settled by a production read-only check (2026-08-28) — do not re-derive
- **`status_logs` has NO DELETE policy and RLS is on.** A client `.delete()` on `status_logs` removes **zero rows and raises no error** (RLS filtering is not an error). This confirms the locked decision: an undo resets a slot, it never deletes the row.
- **`status_logs.unit_id` FKs `units(id)` `ON DELETE CASCADE`** (as do `status_audit_log` and `activity_applicability_overrides`). So the `DELETE_UNIT` **redo**'s `supabase.from('status_logs').delete().eq('unit_id', …)` is a **no-op that does not matter** — the unit delete cascades. It is dead code, not a defect. Consider deleting the line (a "delete" that silently does nothing invites a future reader to trust it); the "FK-safe" comment above it describes work the database already does.
- **`units` INSERT/UPDATE/DELETE are gated to `role in ('owner','admin','pm')`.** For a plain member those writes silently affect zero rows — which is the *deferred* drawing half of undo, not this phase. Not a new data-loss risk (the forward action is gated identically), but worth knowing before anyone hardens that half.

## Out of scope for Phase 2 — do not drift into these
- **Phase 3's failure surfacing** — toasts, undo-stack-on-failure, optimistic-cache rollback. Phase 3 opens with an owner approval gate on the stack behaviour.
- **The `UPDATE_STATUS` paths** — done in Phase 1, on main. Don't re-litigate the fresh-timestamp decision.
- **Drawing/geometry undo** — `UPDATE_GEOMETRY`, `CREATE_UNIT`, and the `units` writes inside `DELETE_UNIT`. Unchecked writes, no confirmed defect, owner-deferred.
- Anything in `useFieldData.ts`, the `pendingChanges` buffer, or the IDB queue.
- **Any SQL.** This workstream changes no schema, no function, no RLS. If you find yourself writing a migration, stop and re-read the plan.

## Approval gates
**None in this phase** — no schema, no RLS, no migration, no push. Just don't commit until the owner says "Approved."

## Exit criteria
- All three green, run with the absolute prefix (bash cwd persists; a stray `cd` triggers a prompt):
  ```
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
  ```
- A test proving a bulk undo across units with **mixed** prior state writes one row per unit.
- `buildBulkUndoPayloads` unit-tested on its own (it carries the correctness load).
- The whole existing suite still passes — baseline after Phase 1 is **1,500 tests**.
- **Lint is NOT a gate** (~1,850 pre-existing problems).
- Close the phase with the **`verify-feature`** skill (Definition of Done → stop). Do not commit or push until the owner says "Approved."

## Useful context you would otherwise have to rediscover
- **Phase 1 shipped 2026-08-28** (merged to `main` as `9de426a`; commit `bbd4595`): the pure module, the RPC routing for single slots, error checks that throw, and a fix for redo-of-Clear-Status which had been writing nothing at all. Suite went 1,484 → 1,500.
- The defects were **runtime-reproduced**, not code-traced. Phase 1's 7 reproduction tests all failed against the old hook before they passed.
- A production data audit found **no detectable damage** (zero timestamp inversions in `status_audit_log`), and the last status write of any kind was **2026-07-22** — the app is not in active field use, so there is time to do this properly. Two of the defects are undetectable by construction: a write that never happened leaves no trace, so "no damage found" is not "no damage occurred".
- The undo stack is in-memory `useState`, capped at 50, and resets on page load. That bounds the blast radius and is deliberate; do not "improve" it here.

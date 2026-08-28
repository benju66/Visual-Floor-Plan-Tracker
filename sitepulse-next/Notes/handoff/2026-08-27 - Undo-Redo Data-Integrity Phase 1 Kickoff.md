# Kickoff — Undo/Redo Data-Integrity, Phase 1: pure payload module + single-slot status undo/redo

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Undo/Redo Data-Integrity** (make single-slot status undo actually write, via a new pure payload module). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-08-27 - Undo-Redo Data-Integrity Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Undo-Redo-Data-Integrity-Plan.md` (Phase 1)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 1** — do not touch the bulk path or the drawing/geometry undo. Start with a failing reproduction test. No SQL, no migration, no RLS change in this workstream at all. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists — in one paragraph

Pressing Ctrl+Z after setting a status on a location **currently does nothing to the database, and says nothing about it.** The undo builds a four-column write that the database rejects outright (a not-null violation on `status_color`), and because the result of every write in that file is thrown away, the failure is invisible: the screen reverts, the data doesn't, and a refresh brings the old status back. This phase fixes the single-location case. Phase 2 fixes the bulk case, Phase 3 makes failures visible.

This is a **correctness fix with no feature change.** Undo is invoked exactly as it is today.

## Required reading (in this order)
1. `sitepulse-next/AGENTS.md` — all of it. The invariants that bind this phase are in **§2**: status writes go through `upsert_status_log` (single) or `.upsert({ onConflict: 'unit_id,activity_id' })` (bulk) and **never** plain `.insert()`; **omit-preserves / present-clears** (a field you leave out is PRESERVED, so a reset must send `''` explicitly); the slot key is `activity_id`, never the activity name; strip the synthesized `activityName` before any write. §6: no `any`, derive types from `database.types.ts`.
2. `sitepulse-next/Notes/plans/Undo-Redo-Data-Integrity-Plan.md` — the plan of record. Read the whole thing, but Phase 1 is your scope.
3. `src/hooks/projectQueries/statuses.ts` → **`useClearStatus`**. This is your reference implementation. Its comment block explains exactly why a reset sends `''` for the colour and all four dates instead of omitting them. Your reset payload should match its shape.
4. `src/utils/statusWrite.ts` — the shared strip/stamp helpers. Use `stripStatusWriteFields`; do not hand-roll the destructure.
5. `src/hooks/useUndoRedo.ts` — the file you are changing. Read it fully before editing; it has five action types and you are only touching the `UPDATE_STATUS` paths.

## Scope — build exactly this

**1. New pure module `src/utils/undoWrite.ts` (+ `undoWrite.test.ts`).**
Framework-free and deterministic. **Timestamps are passed IN** — never call `new Date()` inside these functions (mirrors `statusWrite.ts`, keeps tests deterministic).
- `buildStatusResetPayload(unitId, activityId, track, nowIso)` — the full "Not Started" reset: `temporal_state: 'none'` plus `status_color`, `planned_start_date`, `planned_end_date`, `logged_date`, `actual_start_date` all as `''`, plus a fresh `client_timestamp`. This is the fix for the failing write.
- `buildStatusRestorePayload(oldLog, nowIso)` — strip via `statusWrite.stripStatusWriteFields`, then stamp a **fresh** `client_timestamp` (see the locked decision below).

**2. Fix `UPDATE_STATUS` in `src/hooks/useUndoRedo.ts` — undo AND redo.**
- The no-`oldLog` branch (a status set for the first time) must send `buildStatusResetPayload`, not the current four-column object.
- The `oldLog` branch must send `buildStatusRestorePayload`.
- The `action.secondary` auto-advance branch has the same four-column bug — fix it the same way.
- Route these single-slot writes through the **`upsert_status_log` RPC**, and **check `{ error }` on every call and throw**. User-facing surfacing is Phase 3's job; for now a thrown error is enough to stop it silently succeeding.

## Start with a failing test
Before changing `useUndoRedo.ts`, write tests that fail against today's code:
- Undoing a first-time status currently produces `{ unit_id, track, activity_id, temporal_state }`. Assert the full reset payload instead.
- Restoring a previous status currently carries the **old** `client_timestamp`. Assert a fresh one.

Harness recipe: mock `@/supabaseClient` with a recording stub and drive the real hook via `renderHook` + `setUndoStack(...)`. `src/hooks/useFieldData.test.tsx` and `src/test/renderWithQuery.tsx` show the established mock style. ⚠️ Vitest **swallows `console.log`** here — assert observed values in one object (`expect({...}).toEqual({...})`) so the diff prints them.

## Locked product decisions (do not re-litigate)
- **Undoing a first-time status leaves a clean "Not Started"** — colour and all four dates cleared. NOT a row deletion (RLS forbids client deletes on `status_logs`, and it would break the history timeline).
- **Undo stamps a FRESH `client_timestamp`; it does not restore the original.** An undo is a new decision made *now* and must win the last-write-wins comparison against anything captured earlier. Restoring the old timestamp is what lets a stale value silently bypass the guard. This is a deliberate, documented exception to §2's capture-time rule — capture-time applies to *field capture*, and an undo is not field capture. **Say so in a comment** so the next reader doesn't "fix" it back.

## Out of scope for Phase 1 — do not drift into these
- `BULK_UPDATE_STATUS` (Phase 2) and the `DELETE_UNIT` status-log restore (Phase 2).
- Drawing/geometry undo — `UPDATE_GEOMETRY`, `CREATE_UNIT`, and the `units` writes. The owner scoped this workstream to the status half; those have unchecked writes but no confirmed defect.
- User-facing failure toasts and undo-stack-on-failure behaviour (Phase 3, and Phase 3 opens with an owner approval gate on it).
- Anything in `useFieldData.ts`, the `pendingChanges` buffer, or the IDB queue. Undo and the offline queue are separate systems — stay out.
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
- `undoWrite.ts` unit-tested on its own (it carries the correctness load).
- The whole existing suite still passes — baseline is **1,484 tests**. Nothing in this phase should change any of them.
- **Lint is NOT a gate** (~1,850 pre-existing problems).
- Close the phase with the **`verify-feature`** skill (Definition of Done → stop). Do not commit or push until the owner says "Approved."

## Useful context you would otherwise have to rediscover
- The defects were **runtime-reproduced**, not code-traced. The reproduction drove the real hook with a recording mock; the not-null failure was confirmed by replaying the exact statement against `create temp table … (like public.status_logs including all)` in a rolled-back transaction.
- `status_logs.status_color` is **NOT NULL with no default** — that is precisely why the four-column write fails.
- A production data audit found **no detectable damage** (zero timestamp inversions in `status_audit_log`), and the last status write of any kind was **2026-07-22**, so the app is not in active field use. There is time to do this properly — but it should land before the next burst of field work.
- The undo stack is in-memory `useState`, capped at 50, and resets on page load. That bounds the blast radius and is deliberate; do not "improve" it here.

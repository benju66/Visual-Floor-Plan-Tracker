# Kickoff — Status Sequencing & Auto-Advance Data-Integrity Fix, Phase 4: Undo fully reverses an auto-advance

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 4 of the Status Sequencing & Auto-Advance Data-Integrity Fix** (Undo/Redo must restore BOTH the activity you changed AND any next activity auto-advance teed up — today Ctrl-Z only reverses the primary slot and leaves the auto-advanced slot half-changed). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-10 - Status Sequencing Data Integrity Phase 4 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Status-Sequencing-Data-Integrity-Plan.md` (esp. Phase 4 + "Testing philosophy" + "Open decisions / residual risks" → Undo shape)
> - `sitepulse-next/AGENTS.md` (§2 status-write / `upsert_status_log` / capture-time `client_timestamp` / LWW / offline-queue invariants, §6 no `any` — derive types from `database.types.ts`)
> - `sitepulse-next/src/hooks/useMapActions.ts` — `commitUnitActivity`: the auto-advance side-write (`nextLogData`, the `if (target) { … }` block) and the single-write undo push (`setUndoStack(... { actionType: 'UPDATE_STATUS', unitId, oldLog: oldStatus, newLog } ...)`). This is where the secondary slot's before/after must be captured.
> - `sitepulse-next/src/hooks/useUndoRedo.ts` — the `UndoAction` shape and the `UPDATE_STATUS` case in `triggerUndo` **and** `triggerRedo` (both must restore/redo the secondary slot); compare with the `BULK_UPDATE_STATUS` whole-track snapshot so single + bulk undo stay consistent.
> - `sitepulse-next/src/hooks/useMapActions.test.tsx` — the Phase-1/2/3 harness (seed `activities` cache + `['statuses', sheetId]` cache + `useSettingsStore`; assert on the `upsert_status_log` RPC payloads). Phase 4 also needs to drive `triggerUndo`/`triggerRedo` and assert BOTH slots are written.
>
> Branch off `main`. Build **only Phase 4**. Frontend only, no migration. **Start by writing a FAILING reproduction test, then make it pass.** Preserve every status-write invariant (writes stay on `upsert_status_log`/`.upsert(onConflict:'unit_id,activity_id')`, capture-time `client_timestamp` + LWW, never `.insert()`; offline queue + `pendingChanges` untouched). Depends on Phases 1–3 (all shipped) — the side-write is settled; do not re-open the never-downgrade rule or the `logged_date` preservation. Close with `verify-feature` and STOP — don't commit or push until I say "Approved." This is the LAST app-layer phase; Phase 5 (the ⛔ DB migration backstop) is separate and sign-off-gated.

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
When you complete an activity and the app auto-advances the next one to "planned," pressing **Undo (Ctrl-Z)** only rolls back the activity you completed — the auto-advanced next activity stays "planned." So Undo leaves the schedule **half-changed**: it doesn't fully put things back the way they were. Phase 4 makes one Undo reverse **both** slots (and Redo re-apply both), so nothing is left dangling.

## Root cause (read the real code fresh — do not trust line numbers)
In `commitUnitActivity` (`useMapActions.ts`), the auto-advance side-write is its own `updateStatusMutation.mutateAsync(nextLogData)` inside the `if (target) { … }` block — but the undo entry pushed just below captures **only the primary activity**:
```ts
setUndoStack(prev => [...prev, { actionType: 'UPDATE_STATUS', unitId: unit.id, oldLog: oldStatus, newLog }]);
```
The secondary (teed-up) slot's before/after is never recorded. So the `UPDATE_STATUS` case in `triggerUndo` (`useUndoRedo.ts`) restores only the primary slot; the auto-advanced slot is left at `planned`. `triggerRedo`'s `UPDATE_STATUS` case has the same one-slot limitation.

**A simplifying fact from Phase 1 (use it):** `planAutoAdvance` only ever returns a target whose current state is `'none'` (Not Started). So the auto-advanced slot's **"before" is always "no progress"** — undoing it means restoring it to Not Started (remove the `planned` row / write `temporal_state: 'none'`), never restoring some richer prior state. This is exactly what the existing `UPDATE_STATUS` "no oldLog" branch already does for a first-time status. You do NOT need to snapshot a rich secondary `oldLog`; capturing that the secondary slot **was `none`** (plus its `activity_id`/`track`/`activityName` and the `planned` after-state) is sufficient.

## The fix (shape — resolve the exact representation in-phase)
Two locked product outcomes: **one Undo reverses both slots; one Redo re-applies both.** The plan leaves the *representation* open (`Open decisions → Undo shape`): a **compound single `UPDATE_STATUS` entry** carrying an optional secondary slot, **or** a **paired push** (two entries, popped together). Recommendation: a **compound single entry** — one Ctrl-Z = one user action, and it avoids "undo primary, then a second Ctrl-Z undoes the tee-up" surprises. If you choose paired-push, justify how you keep them atomic (they must undo/redo together, and the 50-entry cap + redo-clear must not split the pair).

Sketch (compound single entry — adapt names to the real code):
- Extend `UndoAction` (`useUndoRedo.ts`) with an optional secondary payload, e.g. `secondary?: { unitId; activity_id; track; activityName; newLog }` (the after = the `planned` `nextLogData`; the before is implicitly `none`).
- In `commitUnitActivity`, when auto-advance fires (`target` non-null), thread the side-write's after-state into that secondary field of the SAME `UPDATE_STATUS` entry. When it doesn't fire, the entry is exactly as today (no secondary) — single-slot undo unchanged.
- `triggerUndo` `UPDATE_STATUS`: after restoring the primary (unchanged), if `secondary` is present, ALSO restore the secondary slot to Not Started — reuse the existing "no oldLog → write `temporal_state:'none'`" path (both the React Query cache patch and the `status_logs.upsert(onConflict:'unit_id,activity_id')` DB write). Never `.insert()`.
- `triggerRedo` `UPDATE_STATUS`: after re-applying the primary, if `secondary` is present, re-write the secondary's `planned` after-state (mirror the primary redo path).

## Required reading (fresh — do not trust line numbers)
- `Status-Sequencing-Data-Integrity-Plan.md` → **Phase 4**, **Testing philosophy**, **Open decisions** (Undo shape; single vs bulk consistency).
- `src/hooks/useMapActions.ts` — `commitUnitActivity`: the `if (target)` auto-advance block (`nextLogData`) and the `UPDATE_STATUS` undo push right after. Note the capture-time `client_timestamp` threading — the secondary write already carries it; don't disturb it.
- `src/hooks/useUndoRedo.ts` — the `UndoAction` interface, the `UPDATE_STATUS` case in BOTH `triggerUndo` and `triggerRedo`, and the `BULK_UPDATE_STATUS` case (its `oldLogs`/`newLogs` whole-track snapshot already recovers auto-advanced slots for bulk — Phase 4 brings the single path to the same consistency; read it so single + bulk behave alike).
- `src/hooks/useMapActions.test.tsx` — Phase-1/2/3 tests show the seeding + RPC-payload assertion pattern. For Phase 4 you'll additionally call `result.current.triggerUndo()` / `triggerRedo()` and assert the exact `status_logs.upsert` rows (undo/redo write via `supabase.from('status_logs').upsert`, not the RPC — the existing `bulkUpsert`/`from().upsert` mock in the harness captures these).

## Scope (build only this)
1. **Write the failing repro test first** (`useMapActions.test.tsx`): complete an activity whose next slot is Not Started with auto-advance ON (primary + auto-advance both fire, per the Phase-1 "still tees up" test), then call `triggerUndo` → assert **both** slots return to prior state (primary → its `oldStatus`; secondary → Not Started / no `planned` row). It should FAIL today (secondary stays `planned`). Then `triggerRedo` → assert both re-apply (primary back, secondary → `planned`).
2. **Apply the fix** (capture the secondary in the undo entry; restore/redo both).
3. **Consistency check with bulk:** confirm (and, if needed, add a test) that single-path undo now matches the `BULK_UPDATE_STATUS` behavior (bulk already restores advanced slots via its snapshot). Reconcile per the plan — don't regress bulk.
4. Do NOT change auto-advance decisioning (Phase 1 `planAutoAdvance`), the bulk never-downgrade rule (Phase 2), the `logged_date`/`actual_start_date` preservation (Phase 3), or the RPC/DB (Phase 5).

## Preserve (do not regress)
- **Write mechanism unchanged:** undo/redo status writes stay `supabase.from('status_logs').upsert(…, { onConflict: 'unit_id,activity_id' })`; single edits stay on `upsert_status_log`. Never `.insert()` for `status_logs`. LWW + capture-time `client_timestamp` intact.
- **Existing undo/redo cases** (`UPDATE_GEOMETRY`, `DELETE_UNIT`, `CREATE_UNIT`, `BULK_UPDATE_STATUS`) unaffected — only `UPDATE_STATUS` gains the optional secondary.
- **The 50-entry undo cap + `setRedoStack([])` on a new action** must still hold; a compound entry counts as one.
- **Offline queue / `pendingChanges` untouched.** Undo/redo are direct cache+DB writes (as today), not staged pending changes.
- **`activityName` is display-only** — strip it before any `status_logs` write (the existing undo/redo paths already do this via destructuring; the secondary must too).
- **No `any` leaks** beyond the file's existing pattern; derive from `database.types.ts`. (The file already uses some `any` in the undo payloads — match the existing local style, don't widen it.)

## Guardrails
- Frontend only; no schema/RLS/backend; no migration (that's Phase 5).
- Vitest globals OFF: import `{ describe, it, expect, vi }` from `'vitest'`.
- `isUndoRedo` already suppresses re-running auto-advance during undo/redo (`commitUnitActivity(..., isUndoRedo=true)` path) — make sure restoring the secondary does NOT itself re-trigger auto-advance.

## Exit criteria (close with `verify-feature`, then STOP)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test` green — the undo repro now passes; redo re-applies both; existing undo/redo + Phase-1/2/3 tests still green.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build` green.
- Confirm in the write-up: one Undo restores both the completed activity and the auto-advanced next slot; one Redo re-applies both; single-path undo is now consistent with bulk; auto-advance/never-downgrade/date-preservation and the offline queue are untouched.
- Present to the owner; do NOT commit or push until the owner says "Approved." Then draft the **Phase 5** kickoff (⛔ DB migration backstop — `upsert_status_log` preserves omitted fields; that phase presents SQL and STOPS for sign-off before applying).

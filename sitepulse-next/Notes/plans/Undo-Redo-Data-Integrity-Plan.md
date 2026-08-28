# Undo/Redo Data-Integrity — make Ctrl+Z actually reverse a status change, or say it couldn't (self-contained build plan)

> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: `Notes/plans/Status-Sequencing-Data-Integrity-Plan.md` — same trust theme, and it built the `upsert_status_log` guarantees this plan makes undo finally honour. Sibling: `Notes/plans/Robustness-Trust-Hardening-Plan.md` ("never lose a save silently").
> Provenance: opened from a code review + runtime reproduction (2026-08-27, ARCH-06). Every defect below was **reproduced against the real hook**, not inferred. File:line references were true at investigation time but **the codebase drifts — re-read the real files.**

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` in full (CRITICAL invariants — esp. §2: status writes stay on `upsert_status_log` (single) / `.upsert(onConflict: 'unit_id,activity_id')` (bulk), **never** plain `.insert()`; omit-preserves/present-clears; capture-time `client_timestamp` + LWW; slot key is `activity_id` never the name; strip the synthesized `activityName`; §6 no `any`, derive types from `database.types.ts`).
2. Re-read the files named in each phase **fresh** — do NOT trust line numbers in this doc; they drift.
3. Build the phases in order. Each phase **starts with a failing reproduction test**, then makes it pass. Verify after each (§ Verification commands). Close each with the `verify-feature` skill and STOP — do not commit/push until the owner says "Approved."
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence plain-English summary; explain jargon in passing; keep it short.

## Goal
When this is done, **pressing Ctrl+Z on a status change either actually reverses it in the database, or tells you it couldn't.** Today it can do neither: undoing a status you'd just set for the first time fails silently at the database, and undoing a bulk apply reverses only the locations that already had a status — the screen reverts, the data doesn't. There is no user-visible feature change; the only thing that changes is that undo stops lying.

## The confirmed defects (all runtime-reproduced 2026-08-27 — not code-traced guesses)

Reproduced by driving the real `useUndoRedo` hook with a recording Supabase mock, plus SQL replay against a copy of the real `status_logs` schema.

1. **Undoing a first-time status fails outright, silently.** `useUndoRedo`'s `UPDATE_STATUS` undo, when `action.oldLog` is null (the slot had never been set), builds exactly:
   `{ unit_id, track, activity_id, temporal_state: 'none' }`
   — four columns. `status_logs.status_color` is **NOT NULL with no default**, so the resulting PostgREST upsert fails with a `23502` not-null violation. Proven by replaying that exact statement against `create temp table … (like public.status_logs including all)` inside a rolled-back transaction; a control run with `status_color` supplied succeeded, proving the statement was otherwise valid and the ON CONFLICT target real. Because the write result is discarded (defect 3), **Ctrl+Z on a fresh location does nothing at all and nobody is told.** The map reverts visually; refresh and the status is back.
2. **The auto-advance side-undo has the same shape, so it fails the same way.** The `action.secondary` branch writes the same four-column payload.
3. **Every write result is discarded.** All 14 `await supabase…` calls in the file ignore `{ error }` — 14 of the 20 unchecked writes in the entire codebase. Reproduced: with every write erroring, `triggerUndo` threw nothing, consumed the undo action, moved it to the redo stack, and left the optimistic cache showing success. The user gets zero signal.
4. **Bulk undo silently reverses almost nothing.** `BULK_UPDATE_STATUS` undo builds `logsToInsert` from `action.oldLogs` only. Units that had **no** prior status get a cache entry saying "Not Started" and **no database write**. Reproduced: 3 units in, 1 written. Undo a bulk "mark 50 locations complete" and the display reverts while the data stands. This is the highest-volume defect — bulk is where many locations move at once.
5. **Undo restores the original `client_timestamp`, bypassing the last-write-wins guard.** The `oldLog`-present path writes `rest` (the old snapshot minus `id`/`created_at`/`activityName`), which carries the OLD timestamp, via a raw `.upsert()` that has no LWW comparison. Reproduced: restored `client_timestamp` came back as the original value.

**Nuance to keep straight:** `useUndoRedo`'s use of `.upsert({ onConflict })` is **not** itself an AGENTS §2 violation — §2 explicitly sanctions that form for bulk writes. The defects are the *payload shape*, the *missing error checks*, the *incomplete bulk revert*, and the *stale timestamp* — not the choice of verb.

## Production data audit (completed 2026-08-27 — read this before planning any remediation)

**Result: no detectable damage. No remediation phase is needed.** Details, so nobody re-derives it:

- **Timestamp inversions in the append-only `status_audit_log`: ZERO.** The audit trigger is `AFTER INSERT OR UPDATE`, and the LWW guard rejects a stale write *before* any row changes — so no trigger fires and no audit row is written. An inversion (a later audit row carrying an earlier `client_timestamp` than its predecessor for the same slot) can therefore only come from a write that bypassed the guard. Restricted to rows with a non-null `activity_id`: **0 inversions**.
  - ⚠️ **A first pass reported 33 inversions. That was a FALSE POSITIVE** — 110 legacy audit rows have a NULL `activity_id`, so the `partition by (unit_id, activity_id)` grouped unrelated activities together and compared their timestamps. Always exclude `activity_id is null` from this analysis.
- **16 rows are `temporal_state='none'` with a non-empty `status_color`**; none carry a completion or actual-start date. Colours are activity colours (`#a0522d`, `#ffe4b5`, `#8b7355`, `#777ac5`), rows date from 2026-05-06 to 2026-06-22 — i.e. they **pre-date the July data-integrity work** and are not attributable to undo. Cosmetic at worst.
- **The last status write of ANY kind was 2026-07-22**; zero writes since. The app is not in active field use right now, so the exposure window is currently closed — but this fix should land **before** the next burst of field work.
- **Two of the defects are undetectable by construction.** A failed undo (defect 1) and a skipped bulk revert (defect 4) write nothing, and an absent write leaves no trace anywhere. So *"no damage found"* is **not** *"no damage occurred"*. It is genuinely unknowable how many statuses a user believes they reverted that were never reverted.
- **Mitigating factor:** the undo stack is in-memory `useState`, capped at 50, and resets on every page load — so the blast radius of any single session is bounded and cannot accumulate across days.

**Re-run the audit after Phase 3 ships** (queries in § Audit queries below) to confirm the fix introduced no inversions.

## Locked product decisions (from the owner, 2026-08-27)
- **Fix the status half of undo properly; leave the drawing half alone.** Drawing undo (geometry / create / delete unit) has the same unchecked-write pattern but **no confirmed defect** — hardening it is explicitly deferred, not forgotten (see Out of scope).
- **Undoing a first-time status leaves a clean "Not Started"** — colour and all four dates cleared, exactly like the existing Clear Status action. NOT a row deletion (the client is forbidden from deleting `status_logs` by RLS, and a deletion would break the history timeline's continuity).
- **Undo stamps a FRESH `client_timestamp`, it does not restore the original.** An undo is a new decision made *now* and must win the last-write-wins comparison against anything captured earlier. Restoring the old timestamp is precisely what makes defect 5 possible. This is a deliberate, documented exception to the capture-time rule in AGENTS §2 — capture-time applies to *field capture*, and an undo is not field capture.

## Out of scope / deferred
- **Drawing/geometry undo hardening** (`UPDATE_GEOMETRY`, `CREATE_UNIT`, and the `units` writes inside `DELETE_UNIT`) — unchecked writes, no confirmed defect. Owner chose to scope this workstream to the status half. Worth a follow-up; do NOT expand into it mid-phase.
- **Making the undo stack survive a page refresh.** It is in-memory by design today and that bounds the blast radius. Changing it is a feature, not a fix.
- **The non-transactional level-delete cascade** (DATA-01 remaining half) — separate workstream.
- **Any UI/UX change to how undo is invoked.** Ctrl+Z and the toolbar buttons stay exactly as they are.
- **`progressAnalytics` / `statusColors` / `mapDisplayStatuses`** — untouched, per AGENTS §3.

## Data model
**No schema change. No migration. No RLS change.** This is entirely a caller-side fix.

- Reads: `status_logs` current-state rows; `activities` for the display name.
- Writes: `status_logs` **only**, through `upsert_status_log` (single-slot) or `.upsert({ onConflict: 'unit_id,activity_id' })` (bulk) — the two forms AGENTS §2 sanctions. Slot key stays `UNIQUE(unit_id, activity_id)`.
- **The full-reset payload** (the shape `useClearStatus` already sends, and the shape defect 1 is missing):
  `{ unit_id, activity_id, track, temporal_state: 'none', status_color: '', planned_start_date: '', planned_end_date: '', logged_date: '', actual_start_date: '', client_timestamp: <fresh ISO> }`
  Under omit-preserves/present-clears, `''` is the **present-but-empty clear**. Omitting these keys would PRESERVE the stored values — the opposite of a reset.
- `status_audit_log` is trigger-managed and append-only; nothing here writes to it directly.

## Build-on inventory (read these fresh before using)
REUSE — do not fork:
- `src/hooks/projectQueries/statuses.ts` — **`useClearStatus` is the reference implementation** for the reset payload and its `''`-clears reasoning. Read its comment block before writing any reset.
- `src/utils/statusWrite.ts` — the shared strip/stamp mechanics (`stripStatusWriteFields` drops `id`/`created_at`/`activityName`/legacy `milestone`; `withFallbackClientTimestamp`). **Use these; do not re-inline the stripping.**
- `src/utils/pendingChangeKey.ts` — canonical slot key, if a keyed lookup is needed.
- `src/hooks/useMapActions.ts` — where undo actions are pushed onto the stack. Read to understand what each `UndoAction` carries; **do not change the push sites in this workstream** unless a phase says so.
- The toast mechanism already used by `useProjectActions` (`showToast`) — for Phase 3 failure surfacing.

DO NOT fork: `progressAnalytics`, `bottleneck`, `statusColors`, `autoAdvance.planAutoAdvance`.

## Pure logic to extract + unit-test
New: **`src/utils/undoWrite.ts`** (+ `undoWrite.test.ts`). Framework-free, deterministic, timestamps passed IN (never `Date.now()` inside — keeps tests deterministic, mirrors `statusWrite.ts`).

- `buildStatusResetPayload(unitId, activityId, track, nowIso)` — the full "Not Started" reset. The single fix for defects 1 and 2.
- `buildStatusRestorePayload(oldLog, nowIso)` — strip via `statusWrite.stripStatusWriteFields`, then stamp a FRESH `client_timestamp` (locked decision 3).
- `buildBulkUndoPayloads(unitIds, oldLogs, track, activityId, nowIso)` — returns a payload for **every** unit id, using the restore shape where an old log exists and the reset shape where it does not. **This is the fix for defect 4** and is the highest-value pure function in the plan: it is where the missing rows come from.

Test these exhaustively — they carry the whole correctness load, and they are testable without React or a database.

## Sub-phasing (ship + verify each)

### Phase 1 — Pure payload module + single-slot status undo/redo
- **Scope:** Create `src/utils/undoWrite.ts` + tests. Fix `UPDATE_STATUS` undo **and** redo, including the `action.secondary` auto-advance branch, in `src/hooks/useUndoRedo.ts`: route single-slot writes through the `upsert_status_log` RPC, send the full reset payload for the no-`oldLog` case, stamp a fresh `client_timestamp`, and check `{ error }` on every call (throw for now — Phase 3 owns user-facing surfacing).
- **Start with failing tests:** a first-time-status undo currently emits a 4-column payload; assert the full 10-key reset instead. A restore currently carries the old timestamp; assert a fresh one.
- **Approval gates:** none (no schema, no RLS, no migration, no push).
- **Exit criteria:** typecheck + test + build green · `undoWrite.ts` unit-tested · close with `verify-feature` and STOP.

### Phase 2 — Bulk + unit-restore status writes
- **Scope:** Fix `BULK_UPDATE_STATUS` undo and redo to write a payload for **every** affected unit (defect 4) via `buildBulkUndoPayloads`, keeping the existing 800-row chunking and `.upsert({ onConflict })` form. Fix the `DELETE_UNIT` undo's `status_logs` restore to use `buildStatusRestorePayload`. Error-check every chunk and propagate.
- **Start with a failing test:** the reproduction that showed 3 units in → 1 written.
- **Approval gates:** none.
- **Exit criteria:** as Phase 1, plus a test proving a bulk undo across units with mixed prior state writes one row per unit.

### Phase 3 — Failure surfacing + stack integrity + re-audit
- **Scope:** A failed undo must no longer look like a success. Surface the failure with the existing toast mechanism, and decide + implement stack behaviour (recommended: on failure, put the action **back** on the undo stack and do not push to redo, so the user can retry — mirrors the pending-queue retry semantics in `useFieldData`). Roll back or invalidate the optimistic cache update so the screen re-syncs with the database.
- **Approval gates:** ⛔ **Owner sign-off on the stack-on-failure behaviour** before implementing — it changes what Ctrl+Z feels like when offline.
- **Exit criteria:** as above, plus a live `dev:3010` click-through (undo online, and undo with the network throttled to failing) · **re-run the § Audit queries** and confirm still zero inversions.

## Hard guardrails (AGENTS.md — do not violate)
- Status writes stay on `upsert_status_log` (single) / `.upsert({ onConflict: 'unit_id,activity_id' })` (bulk). **Never** plain `.insert()` for `status_logs`.
- Keep the RPC `SECURITY INVOKER`, same grants, `anon` never granted, LWW guard + `ON CONFLICT` intact. **This workstream changes no SQL at all.**
- Slot key is `activity_id`, never the activity name. Strip the synthesized `activityName` (and legacy `milestone`) before every write — via `statusWrite.stripStatusWriteFields`, not a hand-rolled destructure.
- A reset must send its cleared fields **present-and-empty** (`''`), never omit them — omission preserves.
- Do not touch `pendingChanges`, `isSyncingRef`, the per-item IDB checkpoint, or anything in `useFieldData.ts`. Undo and the offline queue are separate systems; this workstream stays out of the queue.
- Do not fork `progressAnalytics`; do not recolor `mapDisplayStatuses`.
- No `any` (§6); derive types from `database.types.ts` / `domain.ts`.

## Audit queries (re-run after Phase 3)
```sql
-- 1. Timestamp inversions — MUST stay 0. Excluding NULL activity_id is load-bearing:
--    110 legacy rows have one, and including them produces a false positive of 33.
with ordered as (
  select unit_id, activity_id, changed_at, client_timestamp,
         lag(client_timestamp) over w as prev_ct
  from public.status_audit_log
  where client_timestamp is not null and activity_id is not null
  window w as (partition by unit_id, activity_id order by changed_at)
)
select count(*) as inversions from ordered where prev_ct is not null and client_timestamp < prev_ct;

-- 2. Inconsistent "Not Started" rows — baseline at 2026-08-27 was 16, all pre-July, all
--    colour-only (no dates). A rise after the fix means a reset is not clearing properly.
select count(*) filter (where temporal_state='none' and coalesce(status_color,'') <> '') as none_with_colour,
       count(*) filter (where temporal_state='none' and logged_date is not null)          as none_with_completion_date
from public.status_logs;
```

## Verification commands (the exit-criteria gate)
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
- **Lint is NOT a gate** (~1850 pre-existing problems). Verify with typecheck + test + build.
- **No E2E framework** — a live click-through via `npm run dev:3010` (from `sitepulse-next/`, port 3010) is the only UI verification. ⚠️ `dev:3010` runs against the **production** database — never test a write path against a real project's rows.
- Vitest globals are OFF: import `{ describe, it, expect, vi }` from `'vitest'`.

## Open decisions
- **Stack behaviour when an undo fails** (Phase 3): re-push to the undo stack for retry, or consume it and rely on the toast? Recommended: re-push, mirroring the per-item retry semantics the pending queue already uses. ⛔ Owner decides at the top of Phase 3.
- **Whether to harden the drawing half afterwards** — deferred out of this workstream; revisit once Phase 3 ships and the pattern is proven.

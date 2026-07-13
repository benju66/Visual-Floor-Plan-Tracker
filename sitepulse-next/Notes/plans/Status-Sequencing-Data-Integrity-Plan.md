# Status Sequencing & Auto-Advance Data-Integrity Fix — stop one edit from silently rewriting another activity's saved state (self-contained build plan)

> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: none. Sibling: `Notes/plans/Robustness-Trust-Hardening-Plan.md` ("never lose a save silently") — same trust theme, different mechanism.
> Provenance: opened from a code-trace investigation (2026-07-10). Every file:line below was true at investigation time but **the codebase drifts — re-read the real files; do not trust these line numbers.**

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` in full (CRITICAL invariants — esp. §2: status writes stay on `upsert_status_log` / `.upsert(onConflict: unit_id,activity_id)` with **capture-time `client_timestamp`** + LWW, never `.insert()`; `pendingChanges` local `useState`→IDB; per-item IDB checkpoint + `isSyncingRef`; §3 Container/Presenter + `progressAnalytics` non-fork; §6 no `any`, derive types from `database.types.ts`).
2. Re-read the files named in each phase **fresh** — do NOT trust line numbers in this doc; they drift.
3. Build the phases in order. Each phase **starts with a FAILING reproduction test**, then makes it pass (§ Testing philosophy). Verify after each (§ Verification commands). Close each with the `verify-feature` skill and STOP — do not commit/push until the owner says "Approved."
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence plain-English summary; explain jargon in passing; keep it short.

## Goal
When this is done, **setting one activity's status can never silently damage another activity's saved data.** Specifically: completing an earlier activity no longer resets an already-completed later activity back to "upcoming" (or erases its completion/actual-start dates); editing a planned date on a completed activity no longer resets its completion date to today; the bulk "Apply to selected → Completed" no longer wipes finished later activities across many locations; and Undo fully reverses an auto-advance. A later, sign-off-gated phase hardens the database function so this whole class of "a partial save wipes a field" can't reappear from any future code.

This is a **correctness / data-integrity** workstream. There is **no user-visible feature change** and **no change to what the List/Map render** — the only behavior that changes is that the app stops overwriting data it shouldn't. Auto-advance stays **on by default** for the Production track; we fix what it does, not whether it runs.

## The bug family (all code-traced 2026-07-10; high confidence, not yet runtime-reproduced — Phase 1 reproduces first)
1. **Core — auto-advance downgrades an already-completed later activity.** `commitUnitActivity`'s auto-advance "tee up the next activity as planned" side-write (`src/hooks/useMapActions.ts` ~619-629) writes `temporal_state: 'planned'` to the next-in-sequence activity **without reading its current state**. Complete a later activity early, then complete an earlier one → the later one is reset to `planned`. Because the write goes through the `upsert_status_log` RPC (which **rewrites every column from its payload**) and the payload omits `logged_date`/`actual_start_date`, it **also nulls the clobbered activity's completion + actual-start dates**. The `hasSequenceGaps` guard (`~607`) only checks PRIOR activities and is skipped for the first activity (`currentIndex === 0`). Auto-advance is **ON by default** for Production (`src/store/useSettingsStore.ts` ~123).
2. **Undo can't recover it.** The single-write undo entry stores only the primary activity's old/new log (`useMapActions.ts` ~638); the auto-advance side-write is never captured, so Ctrl-Z (`src/hooks/useUndoRedo.ts` ~77-98) leaves the clobbered activity broken. (Bulk undo happens to recover via a whole-track snapshot — an inconsistency to reconcile.)
3. **Separate date-corruption path (fires even with auto-advance OFF).** Editing a **planned** start/end date on an already-completed activity resets its completion date (`logged_date`) to **today**, because that edit carries no `loggedDate` and `useMapActions.ts` ~578 re-stamps today whenever `state === 'completed'` and `loggedDate` is absent. The same function carefully preserves `actual_start_date` (~583-585) but gives `logged_date` no such protection. Reaches the RPC via `page.tsx` `onApplyPendingChanges` (~620) + `useFieldData.ts` `handleLocalUpdate` (~137-157).
4. **Bulk path is worse.** `handleApplyBulkStatus` (`useMapActions.ts` ~709-747) runs auto-advance with **no gap guard at all** and clobbers finished later activities across many locations at once.
5. **App-wide exposure.** Every status entry point funnels through `commitUnitActivity` — desktop List apply, map/canvas commits (`page.tsx` ~547, ~753), quick status/activity modals, mobile swipe deck — so this reaches every way a user sets a status.

**Lower-severity smells (fold in where noted):** (a) the auto-advance side-write carries no capture-time `client_timestamp`, so it's stamped sync-time "now" and always wins LWW; (b) in all-levels editing, the teed-up next activity reads planned dates from the **active** sheet even when the unit is on another (`useMapActions.ts` ~617); (c) concurrent-Apply race — with Phase-1 bounded concurrency, a staged completion (auto-advances B) plus a direct staged edit to B can interleave.

## Locked product decisions (from the owner, 2026-07-10)
- **Never touch a next activity that already has progress.** Auto-advance sets the next activity to `planned` **only if its current state is `none` (Not Started)**. If the next slot is already `planned`/`ongoing`/`completed`, auto-advance does **nothing** to it (it does NOT skip ahead to a later not-started slot — the simplest, most predictable "it never un-does my work" rule).
- **Code fixes first, DB safety-net later.** Ship the app-layer correctness fixes (Phases 1–4, no schema change). Then a **separate, sign-off-gated phase** (Phase 5) hardens `upsert_status_log` so an omitted field is preserved instead of wiped — defense in depth for all current + future callers.
- **Keep auto-advance ON by default** for Production; fix its behavior, don't disable it.

## Out of scope / deferred
- **No feature/UX change, no change to what any view renders** — this is purely "stop overwriting data." No `progressAnalytics`/`bottleneck`/`scheduleBaseline` changes; no `statusColors` changes.
- **The List View Performance workstream** (`list-view-performance-phase4` branch) is unrelated — do NOT touch it; branch this workstream off `main`.
- **Redesigning auto-advance into a multi-step "advance N" feature** — out of scope; we only fix the single next-slot rule.
- **The clear-status path** (`clearStatusMutation`) is a separate mutation and is not in scope beyond confirming Phase 5's RPC change doesn't break it.

## Data model
**No schema change in Phases 1–4.** Reads/writes unchanged:
- Reads: `activities` (sequence_order, track, applies_to), `status_logs` current-state rows, activity overrides (applicability).
- Writes: **only** through `upsert_status_log` (single) / `.upsert(onConflict: 'unit_id,activity_id')` (bulk), capture-time `client_timestamp` + LWW — unchanged. Slot key stays `UNIQUE(unit_id, activity_id)`.
- **Phase 5 only:** one `CREATE OR REPLACE FUNCTION upsert_status_log` migration (SECURITY INVOKER, same grants, same LWW guard) that distinguishes an **absent** JSON key (→ preserve existing column) from an **empty string** (→ explicit clear). ⛔ approval gate.

**Key architectural fact that drives the fixes:** the `upsert_status_log` RPC's `NULLIF(log_data->>'field','')::date` makes an **absent OR empty** field resolve to NULL, and the `DO UPDATE SET field = EXCLUDED.field` then writes that NULL — so **any caller that omits a field wipes it**. The `.upsert()` bulk path, by contrast, only touches the columns present in its payload (safe). Until Phase 5, the fix is caller-side: pass the values you want to preserve.

## Build-on inventory (read these fresh before using)
REUSE — do not fork:
- `src/hooks/useMapActions.ts` — `commitUnitActivity` (single write + auto-advance), `handleApplyBulkStatus` (bulk write + auto-advance), the undo-stack pushes. **Home of Phases 1, 2, 4.**
- `src/utils/applicability.ts` — `buildApplicabilityIndex`, `nextApplicableIndex`, `hasSequenceGaps`. **Reuse these in the new pure helper; do not reimplement.**
- `src/hooks/useUndoRedo.ts` — `UndoAction` shape + `triggerUndo`/`triggerRedo` restore logic. **Phase 4.**
- `src/hooks/useFieldData.ts` — `handleLocalUpdate`/`handleTimelineUpdate` build `PendingChange.extraProps`. **Phase 3 (why `loggedDate` is absent on a planned-date edit).**
- `src/app/project/[projectId]/page.tsx` — `onApplyPendingChanges` (~618-620) threads `extraProps` + `capturedAt` into `commitUnitActivity`; `onCommitStatus` (map, ~753). Read to see the full call shape; don't move logic here.
- `src/utils/scheduleReconcile.ts` `buildImportWrites` (~278-321) — the **reference "safe partial write" pattern**: reads `prior`, preserves `temporal_state`/`logged_date`/`status_color`, skips slots with own dates. Mirror this discipline; don't fork it.
- `src/store/useSettingsStore.ts` — `auto_advance_tracks` (default `{ Production: true }`).
- `supabase/migrations/20260711_status_logs_actual_start.sql` — the current `upsert_status_log` body (Phase 5 edits a copy of this via a NEW dated migration; never edit an applied migration in place). Use the `create-migration` skill.

## Pure logic to extract + unit-test (the correctness core)
Put the auto-advance DECISION in a framework-free, deterministic function so both the single and bulk paths share one tested rule, and so the never-downgrade guarantee is pinned by unit tests (not buried in a hook):
- `src/utils/autoAdvance.ts` — e.g. `planAutoAdvance({ orderedTrackActivities, unit, completedIndex, applicabilityIndex, stateOf }) → { activityId, activityName, color, track } | null`. **Never calls `Date.now()`; state is passed in via `stateOf`.** Rule, in order: (1) `completedIndex < 0` → null; (2) keep the existing defensive "don't advance over PRIOR gaps" check (reuse `hasSequenceGaps`, skipped when `completedIndex === 0` as today — that's correct, there are no priors); (3) `next = nextApplicableIndex(...)`; if none → null; (4) **if `stateOf(next) !== 'none'` → null (NEVER downgrade — the owner's locked rule)**; (5) else → return the target activity. Co-locate `autoAdvance.test.ts`: next is none → advances; next already completed → null (no write); next ongoing/planned → null; prior gap → null; completing the first activity when the second is already done → null (the reported repro); N/A slots skipped.

## Testing philosophy (first-class in every phase)
**Every phase opens by writing a FAILING test that reproduces the bug, then makes it pass.** This is what converts the current "high-confidence code trace" into proof, and leaves a permanent regression guard. Two layers per phase:
- **Pure unit tests** (`src/utils/autoAdvance.test.ts`) for the decision logic — deterministic, no mocks.
- **Hook integration tests** in `src/hooks/useMapActions.test.tsx` (existing harness — it already renders `useMapActions` with a seeded React Query cache and asserts on the `upsert_status_log` RPC payloads; the existing auto-advance test only proves failure-isolation, not what gets written — extend it). Assert the exact RPC/`.upsert` **payloads**: that the side-write does NOT fire (or does not carry a downgraded `temporal_state`) when the next slot has progress, and that no date field is nulled. For Phase 4, assert the undo restores BOTH slots. Vitest globals are OFF — import `{ describe, it, expect, vi }` from `'vitest'`.

## Sub-phasing (ship + verify each — each starts with a failing repro test)

### Phase 1 — Core: auto-advance never downgrades (single-write path) + pure decision helper
- **Plain-English:** When you complete an activity, the app will no longer overwrite a later activity that's already done or in progress — it only tees up the next one if it hasn't been started. This is the headline fix.
- **Scope:**
  - Add the pure `src/utils/autoAdvance.ts` (`planAutoAdvance`) + `autoAdvance.test.ts` (§ Pure logic) — the never-downgrade rule, reusing `applicability.ts` helpers.
  - Rewire `commitUnitActivity`'s auto-advance block (`useMapActions.ts`) to call `planAutoAdvance`; when it returns null, **skip the side-write entirely**. When it returns a target (only ever a `none` slot), the side-write is genuinely new, so writing `planned` + the sheet-schedule dates is correct. While here, fold the two smells: (a) stamp the side-write with the **capture-time `client_timestamp`** carried by the primary edit (don't leave it sync-time); (b) read the next activity's planned dates from **the unit's own sheet** schedule, not the active sheet (cross-sheet all-levels correctness).
  - Failing repro tests first (hook-level, in `useMapActions.test.tsx`): complete-first-when-second-already-completed → second untouched + dates intact; then the pure tests.
- **Approval gates:** none (frontend). Touches `commitUnitActivity` (offline-queue-adjacent) but does NOT change the queue mechanics, LWW, capture-time stamping, or the primary write — call that out in the verify write-up.
- **Exit criteria:** typecheck + test + build green · `autoAdvance.test.ts` green · the reproduction test now passes · normal advance (next is Not Started → planned) still works · live `dev:3010` sanity if reachable · `verify-feature` → STOP.

### Phase 2 — Bulk path: same never-downgrade rule (`handleApplyBulkStatus`)
- **Plain-English:** The "Apply to selected → Completed" button gets the same protection — bulk-completing an activity won't wipe finished later activities across the selected locations.
- **Scope:**
  - Failing repro test first: bulk-complete an activity across several units where some already have the next activity completed → those next slots stay completed (dates intact).
  - Rewire the bulk auto-advance (`useMapActions.ts` ~709-747) to run `planAutoAdvance` **per unit** (state read per unit) and only tee up units whose next slot is `none`. Reuse the same pure helper — do not duplicate the rule.
  - Document + add a test for the **concurrent-Apply race** residual: a staged completion (auto-advances B) plus a direct staged edit to B; assert the never-downgrade rule makes the outcome safe regardless of order (or note precisely why a follow-up is needed).
- **Approval gates:** none (frontend).
- **Exit criteria:** typecheck + test + build green · bulk repro test passes · single-unit path (Phase 1) unaffected · `verify-feature` → STOP.

### Phase 3 — Editing a planned date on a completed activity keeps its completion date
- **Plain-English:** Fixing a typo in a planned date on an already-finished activity will no longer silently change its completion date to today. (This one happens even with auto-advance off.)
- **Scope:**
  - Failing repro test first: on a `completed` slot with a real `logged_date`, apply an edit that changes only `planned_start_date` (no `loggedDate`) → `logged_date` is preserved (not today).
  - Fix `useMapActions.ts` ~578: preserve `oldStatus.logged_date` when `extraProps.loggedDate` is absent (mirror the existing `actual_start_date` preservation at ~583-585). Keep "stamp today" ONLY for a genuinely-new completion (state becomes `completed` AND there is no prior `logged_date`). Decide in-phase whether the cleanest home is the commit fallback (recommended, one spot, protects all callers) or the edit handlers.
- **Approval gates:** none (frontend). Independent of auto-advance — could be done before Phase 1 if preferred.
- **Exit criteria:** typecheck + test + build green · repro test passes · a genuinely-new completion still defaults `logged_date` to today when none supplied · `verify-feature` → STOP.

### Phase 4 — Undo fully reverses an auto-advance
- **Plain-English:** Undo (Ctrl-Z) will now restore BOTH the activity you changed and any next activity the app auto-updated — so nothing is left half-changed.
- **Scope:**
  - Failing repro test first: complete an activity that auto-advances the next one, then undo → both slots return to their prior stored state.
  - Extend the single-write undo entry (`useMapActions.ts` ~638) to capture the side-write's before/after (e.g. a compound `UPDATE_STATUS` carrying a secondary slot, or a paired push), and update `useUndoRedo.ts` `triggerUndo`/`triggerRedo` (`UndoAction` shape ~8-22, `UPDATE_STATUS` case ~77-98/~182-197) to restore/redo both. Reconcile with the bulk undo's whole-track snapshot so single and bulk behave consistently.
- **Approval gates:** none (frontend). Depends on Phase 1 (the side-write is settled first).
- **Exit criteria:** typecheck + test + build green · undo repro test passes · redo re-applies both · existing undo/redo cases unaffected · `verify-feature` → STOP.

### Phase 5 — ⛔ DB safety-net: `upsert_status_log` preserves omitted fields (migration)
- **Plain-English:** A database-level backstop so that, forever after, a save that leaves a field out **keeps** the existing value instead of wiping it — protecting against any future code that forgets to pass a field. Requires a schema change, so it needs your explicit sign-off.
- **Scope:**
  - A NEW dated migration (`create-migration` skill) that `CREATE OR REPLACE`s `upsert_status_log`: for each nullable field, distinguish **key absent** (`log_data ? 'field'` false → `COALESCE(new, status_logs.field)` i.e. preserve) from **key present but empty string** (explicit clear → NULL). Keep SECURITY INVOKER, search_path, grants, the LWW guard, and `ON CONFLICT (unit_id, activity_id)` **exactly** as today (copy the current body; change only the SET expressions).
  - **Verify no caller relies on "absent = clear."** The primary write passes explicit values (incl. explicit `''` where it clears); the clear-status path uses `clearStatusMutation` separately. Confirm by reading the callers; document the finding in the phase.
  - Tests: SQL isn't unit-testable in Vitest, so add a caller-contract test/assertion where feasible and rely on a careful review + the migration's idempotency. **Present the full SQL and STOP for approval before applying; never touch production data without the owner's go-ahead.**
- **Approval gates:** ⛔ **DB migration / DDL** — show exact SQL via `create-migration` and STOP. ⛔ RLS/grants must not change (SECURITY INVOKER; anon never granted).
- **Exit criteria:** typecheck + test + build green · SQL presented + owner-approved before apply · migration idempotent + applied to prod only after approval · a manual re-test of the Phase 1–3 scenarios still green with the RPC change · `verify-feature` → STOP. **This closes the workstream.**

## Verification commands (the exit-criteria gate)
Run npm with an absolute prefix (bash cwd persists; a stray `cd` prompts):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck   # tsc --noEmit (primary gate)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test         # vitest (target one file: ... run test -- src/utils/autoAdvance.test.ts)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build        # next build (after editing live components)
```
- **Lint is NOT a gate** (~1850 pre-existing problems) — verify with typecheck + test + build.
- **No E2E** — a live click-through via `npm run dev:3010` (from `sitepulse-next/`, port 3010) is the UI verification, but the core proof for this workstream is the hook/pure tests (they assert the exact write payloads, which a click-through can't easily show).
- Vitest globals are OFF: import `{ describe, it, expect, vi }` from `'vitest'`; co-locate `foo.test.ts` next to `foo.ts`.

## Hard guardrails (AGENTS.md — do not violate)
- **Status writes stay on `upsert_status_log` / `.upsert(onConflict: 'unit_id,activity_id')`** with **capture-time `client_timestamp`** + LWW. Never `.insert()`. The fixes change WHAT is (or isn't) written, never the write mechanism.
- **`pendingChanges`/`pendingTimelineChanges` stay local `useState`→IDB**; keep the per-item IDB checkpoint + `isSyncingRef`; don't touch the Apply loop's queue mechanics.
- **Never fork `progressAnalytics`/`scheduleBaseline`/`bottleneck`; never hardcode a temporal-state color** (`statusColors.ts`). This workstream doesn't touch display math at all.
- **Derive types from `database.types.ts`; no `any`;** everything through the React Query cache stays JSON-serializable.
- **Phase 5 only:** RPC stays SECURITY INVOKER, same grants (anon never granted), same LWW guard, same slot key — change only the field-preservation expressions.

## Open decisions / residual risks
- **Concurrent-Apply race (Phase 2):** the never-downgrade rule reads the next slot's state at side-write time, which under bounded-concurrency Apply could be momentarily stale. Phase 2 adds a test and decides whether a stronger ordering guard is warranted or whether never-downgrade is sufficient in practice (likely sufficient, since the worst case is "auto-advance skips when it might have teed up" — safe, not destructive).
- **Undo shape (Phase 4):** compound single entry vs. paired push — resolve in-phase; keep single and bulk undo consistent.
- **Phase 3 placement:** independent of auto-advance; may be pulled before Phase 1 for a quick, isolated win if the owner prefers.

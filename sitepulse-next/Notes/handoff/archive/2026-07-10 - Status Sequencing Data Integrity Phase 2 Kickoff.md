# Kickoff — Status Sequencing & Auto-Advance Data-Integrity Fix, Phase 2: bulk path never downgrades (`handleApplyBulkStatus`) — reuse the Phase-1 pure helper

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of the Status Sequencing & Auto-Advance Data-Integrity Fix** (give the bulk "Apply to selected → Completed" button the same never-downgrade protection Phase 1 gave single edits). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-10 - Status Sequencing Data Integrity Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Status-Sequencing-Data-Integrity-Plan.md` (esp. Phase 2 + "Pure logic to extract" + "Testing philosophy" + "Locked product decisions" + "Open decisions / residual risks")
> - `sitepulse-next/AGENTS.md` (§2 status-write / offline-queue / bulk `.upsert(onConflict)` invariants, §6 no `any`)
> - `sitepulse-next/src/utils/autoAdvance.ts` — the Phase-1 pure helper `planAutoAdvance` you will REUSE per-unit (do not fork it).
>
> Branch off `main`. Build **only Phase 2**. Frontend only, no migration. **Start by writing a FAILING reproduction test, then make it pass.** Preserve every status-write invariant (bulk stays `.upsert(onConflict:'unit_id,activity_id')`, LWW, IDB queue untouched). Close with `verify-feature` and STOP — don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
Phase 1 fixed single edits. The **bulk** path has the same bug with no guard at all: `handleApplyBulkStatus`'s auto-advance tees up the next activity for every selected location **without reading that location's next-slot state and with no sequence-gap check** — so bulk-completing an activity can downgrade a later activity that some of those locations already finished. This phase makes bulk auto-advance run the **same per-unit never-downgrade rule** Phase 1 already proved.

## What's different about the bulk path (read before coding)
- The bulk writes go through **`bulkUpdateStatusMutation` (`useBulkUpdateStatus` → `.upsert(onConflict:'unit_id,activity_id')`)**, NOT the single `upsert_status_log` RPC. Per the plan's Data-model note, `.upsert()` **only touches the columns in its payload**, so the bulk auto-advance write does NOT null `logged_date`/`actual_start_date` (they're absent from the payload) — but it **does** overwrite `temporal_state` (completed → planned) and `status_color`. So the damage here is a **state/color downgrade**, still real data loss, just not the date-nulling seen in Phase 1.
- The current bulk auto-advance (in `handleApplyBulkStatus`) groups units by `nextApplicableIndex` and writes `temporal_state:'planned'` per group with **no `hasSequenceGaps` guard and no next-slot state read** — worse than the single path, which at least had the gap guard.

## The owner's locked rule (same as Phase 1 — do not reinterpret)
- Auto-advance tees up a unit's next activity to `planned` **only if that unit's next slot is currently `none` (Not Started)**. If it's already `planned`/`ongoing`/`completed`, do nothing to it (do NOT skip ahead). Applied **per unit** — each selected location decides independently.

## Required reading (fresh — do not trust line numbers)
- `Status-Sequencing-Data-Integrity-Plan.md` → **Phase 2**, **Pure logic to extract**, **Testing philosophy**, **Open decisions / residual risks** (the concurrent-Apply race).
- `src/utils/autoAdvance.ts` — `planAutoAdvance({ orderedTrackActivities, unit, completedIndex, applicabilityIndex, stateOf }) → target | null`. **REUSE this per unit** — the never-downgrade + prior-gap + walk-past-N/A logic already lives here. `stateOf` is index-keyed and takes the unit's per-slot state; you supply it per unit.
- `src/utils/autoAdvance.test.ts` — the pure cases already covered (so you know what the helper guarantees and don't re-test it; add only bulk-specific coverage).
- `src/hooks/useMapActions.ts` — `handleApplyBulkStatus` (the bulk write + the auto-advance grouping block that builds `targetGroups` and calls `bulkUpdateStatusMutation` per next-index group; also builds `advancedLogs`/`newLogs` for the bulk undo snapshot). This is what you rewire. Note how Phase 1 already rewired the SINGLE path (`commitUnitActivity`) — mirror that shape.
- `src/hooks/useMapActions.test.tsx` — the existing hook harness (seeded React Query cache; asserts on RPC/`.upsert` payloads). The Phase-1 repro tests show the seeding pattern (activities cache + `['statuses', sheetId]` cache + `useSettingsStore` auto_advance). **Extend it** with the bulk repro; the bulk mutation calls `supabase.from('status_logs').upsert(...)`, so assert on that call, not the RPC — confirm exactly which supabase method the test's mock intercepts before asserting.
- `src/hooks/useProjectQueries.ts` — `useBulkUpdateStatus` (how the bulk `.upsert` payload is shaped + which columns it carries; confirms dates are NOT in the auto-advance payload).

## Scope (build only this)
1. **Write the failing repro test first** (in `useMapActions.test.tsx`): select several units, some of which already have the NEXT activity `completed`; bulk-complete the current activity; assert the already-completed next slots are **not** included in the auto-advance `.upsert` (i.e. the advanced group excludes them), while genuinely-Not-Started units still advance. Assert the exact bulk payload(s).
2. **Rewire the bulk auto-advance** in `handleApplyBulkStatus` to call `planAutoAdvance` **per unit** — build each unit's `stateOf` from the statuses cache (matched by canonical `activity_id`, like Phase 1) and only add a unit to a `targetGroups[nextIndex]` bucket when the helper returns a target. Keep the group-by-next-index batching (one `.upsert` per distinct next activity) for efficiency, but the membership of each group is now gated by `planAutoAdvance`. **Reuse the helper — do not duplicate the rule.**
3. **Keep the bulk undo snapshot correct:** `advancedLogs`/`newLogs` must reflect only the units that actually advanced (so bulk undo still restores the right slots). Verify against the existing bulk-undo path.
4. **Document + test the concurrent-Apply race residual** (plan's Open decisions): a staged single completion that auto-advances B plus a bulk edit touching B — assert the never-downgrade rule keeps the outcome safe regardless of order, or note precisely why a stronger guard is deferred (the worst case is "auto-advance skips when it might have teed up" — safe, not destructive).
5. Do NOT change the single path (Phase 1, done), the planned-date `logged_date` fix (Phase 3), or undo internals beyond keeping the bulk snapshot honest (Phase 4).

## Preserve (do not regress)
- **Bulk write mechanism unchanged:** still `.upsert(onConflict:'unit_id,activity_id')` via `useBulkUpdateStatus`; LWW; never `.insert()`. You change WHICH units get teed up, not how the write works.
- **Single path (Phase 1) untouched** and still green.
- **Offline queue / `pendingChanges` untouched;** bulk is its own online-first path — don't entangle it with the IDB Apply loop.
- **Auto-advance stays ON by default;** normal bulk advance (units whose next slot is `none` → `planned`) must still work.

## Guardrails
- Frontend only; no schema/RLS/backend; no migration (that's Phase 5).
- Derive types from `database.types.ts`; no `any`; JSON-serializable through the cache.
- Vitest globals OFF: import `{ describe, it, expect, vi }` from `'vitest'`.
- The plan's "never fork `progressAnalytics`/`scheduleBaseline`; never hardcode a temporal-state color" rules still hold — this phase touches none of that display math.

## Exit criteria (close with `verify-feature`, then STOP)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test` green — the bulk reproduction test now passes; the concurrent-race test/note is in; existing tests (incl. Phase-1's `autoAdvance.test.ts` + single-path repros) still green.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build` green.
- Confirm in the write-up: bulk-completing an activity no longer downgrades an already-completed later activity across selected locations; normal bulk advance still tees up Not-Started next slots; single path + offline queue untouched; bulk undo still restores correctly.
- Present to the owner; do NOT commit or push until the owner says "Approved." Then draft the Phase 3 kickoff (post-approval handoff ritual).

# Kickoff — Status Sequencing & Auto-Advance Data-Integrity Fix, Phase 1: auto-advance never downgrades (single-write path) + pure decision helper

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of the Status Sequencing & Auto-Advance Data-Integrity Fix** (stop auto-advance from overwriting a later activity that's already done or in progress — the headline data-loss fix). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-10 - Status Sequencing Data Integrity Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Status-Sequencing-Data-Integrity-Plan.md` (esp. Phase 1 + "Pure logic to extract" + "Testing philosophy" + "Locked product decisions")
> - `sitepulse-next/AGENTS.md` (§2 status-write / offline-queue invariants, §3 Container/Presenter, §6 no `any`)
>
> Branch off `main` (NOT the list-view-performance branch — unrelated). Build **only Phase 1**. Frontend only, no migration. **Start by writing a FAILING reproduction test, then make it pass.** Preserve the status-write invariants (upsert_status_log only, capture-time client_timestamp, LWW, IDB queue untouched). Close with `verify-feature` and STOP — don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
When you complete an activity, the app auto-marks the **next** activity "planned/upcoming." The bug: it does this even when that next activity is **already completed or in progress**, resetting it to "upcoming" and erasing its completion + actual-start dates — and Undo can't get it back. This phase makes auto-advance **only ever tee up a next activity that hasn't been started**, and leave anything with progress exactly as-is. It's the highest-severity fix in the workstream and the foundation the other phases build on (they reuse the pure decision helper you extract here).

## The owner's locked rule for this phase (do not reinterpret)
- Auto-advance sets the next activity to `planned` **only if its current state is `none` (Not Started)**. If the next slot is already `planned` / `ongoing` / `completed`, auto-advance **does nothing to it** — it does NOT skip ahead to a later not-started slot. Simplest, most predictable: "it never un-does my work."

## Required reading (fresh — do not trust line numbers)
- `Status-Sequencing-Data-Integrity-Plan.md` → **Phase 1**, **Pure logic to extract**, **Testing philosophy**, **Build-on inventory**, **Hard guardrails**.
- `src/hooks/useMapActions.ts` — `commitUnitActivity`: the primary write (`newLogData`), then the auto-advance block (reads `auto_advance_tracks`, builds `nextLogData` with a hardcoded `temporal_state: 'planned'` and NO read of the next slot's state; the `hasSequenceGaps` guard only checks PRIOR activities). This block is what you rewire. Note the primary write already **preserves `actual_start_date`** by passing the stored value — mirror that discipline.
- `src/utils/applicability.ts` — `buildApplicabilityIndex`, `nextApplicableIndex`, `hasSequenceGaps`. **Reuse these in the new pure helper; do not reimplement.**
- `src/hooks/useMapActions.test.tsx` — the existing hook harness. It already renders `useMapActions` with a seeded React Query cache and asserts on `upsert_status_log` RPC payloads; the one existing auto-advance test only proves failure-isolation, not what gets written. **Extend it** with the reproduction test.
- `src/app/project/[projectId]/page.tsx` — `onApplyPendingChanges` (~618-620) and `onCommitStatus` (~753) show the full `commitUnitActivity` call shape (state + extraProps + `client_timestamp: capturedAt`). Read for context; don't move logic here.
- `src/store/useSettingsStore.ts` — `auto_advance_tracks` default `{ Production: true }` (so the repro must enable it, as the existing test does).
- `supabase/migrations/20260711_status_logs_actual_start.sql` — the `upsert_status_log` body. **Read it to understand WHY dates get nulled:** `NULLIF(log_data->>'field','')::date` makes an absent/empty field NULL, and `DO UPDATE SET field = EXCLUDED.field` writes that NULL — so omitting a field wipes it. (The DB-level fix for this is Phase 5, gated; Phase 1 fixes it caller-side by simply not making the bad write.)

## Scope (build only this)
1. **Write the failing reproduction test first** (in `useMapActions.test.tsx`): enable auto-advance for Production, seed activities A(seq1)→B(seq2), seed B as `completed` with a real `logged_date`/`actual_start_date`, then `commitUnitActivity` to complete A. Assert the CURRENT (buggy) behavior is what you expect to change — i.e. write the assertion for the DESIRED behavior (no side-write to B, or at least B's `temporal_state`/dates unchanged) so it fails now and passes after the fix.
2. **Extract the pure decision helper** `src/utils/autoAdvance.ts` (`planAutoAdvance`) + `autoAdvance.test.ts` per the plan's "Pure logic to extract" (never-downgrade rule; reuse `applicability.ts`; no `Date.now()` — pass state in via a `stateOf` lookup).
3. **Rewire `commitUnitActivity`'s auto-advance block** to use `planAutoAdvance`; when it returns null, skip the side-write entirely. When it returns a target (only ever a `none` slot), the `planned` write is genuinely new and fine. While here, fold two smells: (a) stamp the side-write with the **capture-time `client_timestamp`** the primary edit carried (not sync-time); (b) read the next activity's planned dates from **the unit's own sheet** schedule, not the active sheet (cross-sheet all-levels correctness).
4. Do NOT change the bulk path (Phase 2), the planned-date `logged_date` fix (Phase 3), or undo (Phase 4).

## Preserve (do not regress)
- **Status-write mechanism unchanged:** still `upsert_status_log`, capture-time `client_timestamp`, LWW, no `.insert()`. You're changing WHETHER/what the side-write writes, not how writes work.
- **Offline queue untouched:** `pendingChanges` local→IDB, per-item checkpoint, `isSyncingRef` — don't touch the Apply loop.
- **Primary write untouched:** only the auto-advance side-write changes; the user's staged edit still saves exactly as before.
- **Auto-advance stays ON by default;** normal advance (next slot is `none` → `planned`) must still work.

## Guardrails
- Frontend only; no schema/RLS/backend; no migration (that's Phase 5).
- Derive types from `database.types.ts`; no `any`; JSON-serializable through the cache.
- Vitest globals OFF: import `{ describe, it, expect, vi }` from `'vitest'`; co-locate `autoAdvance.test.ts`.

## Exit criteria (close with `verify-feature`, then STOP)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test` green — new `autoAdvance.test.ts` green; the reproduction test in `useMapActions.test.tsx` now passes; existing tests still green.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build` green.
- Confirm in the write-up: completing an earlier activity no longer downgrades/date-nulls an already-completed later one; normal advance still tees up a Not-Started next activity; the primary write + offline queue are untouched.
- Present to the owner; do NOT commit or push until the owner says "Approved." Then draft the Phase 2 kickoff (post-approval handoff ritual).

# Kickoff — Save Visibility, Phase 3: wiring / RTL regression tests (the backstop)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3 of Save Visibility** — the automated **regression backstop**: a handful of fast tests that lock in "a failed status save stays queued AND is shown as failed, and a retry clears it," so this protection can't silently regress. Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-13 - Save Visibility Phase 3 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Save-Visibility-Plan.md` (esp. Phase 3, Hard guardrails, Verification commands)
> - `sitepulse-next/AGENTS.md` (§9 Vitest globals OFF + `renderWithQuery` + Supabase-mock recipe, NO `msw`; §2 offline queue invariants the tests must assert, not change)
>
> Phases 1 (commit `2ec5ae2`) and 2 (commit `bbe70af`) shipped: `useFieldData` owns `failedKeys` + `failedCount` + `handleRetryItem`; `src/utils/syncStatus.ts` (`deriveSyncState`/`pendingItemState`), `src/utils/pendingChangeKey.ts`, and `src/utils/pendingItems.ts` are the pure helpers; `SyncIndicator` + the desktop FAB + the drill-in (drawer/popover) render the states. **This phase adds ONLY tests — do not change product code** (if a test can't be written without a code change, stop and flag it). First AUDIT what P1/P2 already cover and add only the missing backstops — don't duplicate. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
Phases 1–2 made a failed save loud and drillable. Phase 3 is insurance: a small set of fast automated tests so a future refactor can't quietly bring back the old silent-failure behavior (a failed save rejoining the plain "N pending" count with no red flag). No new behavior, no UI — just guardrail tests.

## First: audit what already exists (don't duplicate)
P1/P2 already added real tests — READ them before writing anything, and only fill genuine gaps:
- `src/hooks/useFieldData.test.tsx` — already covers: `handleApplyAll` feeds the seam one-call-per-change; a failed apply keeps the item in `pendingChanges`; the per-item checkpoint drains monotonically; `handleRetryItem` success (drops the item + clears the flag), still-failing retry (stays + flagged), and precise removal (retrying one activity doesn't drop a sibling).
- `src/utils/syncStatus.test.ts` — `deriveSyncState` every branch + precedence; `pendingItemState`/tone/label.
- `src/utils/pendingChangeKey.test.ts`, `src/utils/pendingItems.test.ts` — key + row-building.
- `src/components/PendingReviewDrawer.test.tsx` — a failed row shows the "Failed" tag + a Retry that re-sends that one change.

## Scope (add only what's missing)
Using `renderWithQuery` (`src/test/renderWithQuery.tsx`) + the chainable `vi.mock('@/supabaseClient')` recipe (canonical examples: `useFieldData.test.tsx`, `useSnappingVectors.test.tsx`). **No `msw`** (deliberately not installed, AGENTS §9).
1. **Core regression (the load-bearing one):** a failed Apply keeps the item in `pendingChanges` AND surfaces it — assert `failedCount > 0` and `deriveSyncState({...}) === 'error'` from the hook's live values. (The existing failure test asserts the item stays queued but does NOT assert `failedCount`/the derived `'error'` state — close that gap.)
2. **Retry clears it:** after that failure, a subsequent SUCCESSFUL `handleApplyAll` (or `handleRetryItem`) drives `failedCount → 0`, empties the queue, and `deriveSyncState → 'synced'`.
3. **Mixed batch:** some changes succeed (leave the queue) and some fail (stay + counted in `failedCount`) in one Apply — assert the survivors are exactly the failed slots.
4. **`SyncIndicator` render matrix:** a light render assertion that it shows each of loading / syncing / pending / error / synced (drive via props → `deriveSyncState`). Assert the red "N failed" copy for `error`.
5. **Prove they're real guards:** each new test MUST fail if you revert the P1 failed-tracking (temporarily delete the `setFailedKeys(nextFailedKeys)` in `handleApplyAll` and confirm red, then restore). Note this in the PR description / closeout, don't leave the revert in.

## Preserve / guardrails (AGENTS.md — do not violate)
- **Tests only.** Do NOT touch the Apply loop, `pendingChanges` locality, `isSyncingRef`, the checkpoint, `upsert_status_log`/LWW, RLS, or any presenter behavior. If a test seems to need a product change, STOP and flag it (usually it means the test is reaching for the wrong seam).
- **Vitest globals OFF** — import `{ describe, it, expect, vi }` from `'vitest'`; co-locate `foo.test.ts(x)` beside the unit; keep test files type-clean (they're in `npm run typecheck`).
- **No `msw`.** Mock the data layer with the chainable Supabase stub; mock `idb-keyval` for the buffer's IDB (see `useFieldData.test.tsx`).
- **Lint is not a gate** — verify with typecheck + test + build.
- Derive types from `database.types.ts`; no `any`; use safe primitives with the `domain.ts` guards (they throw on null elements).

## Exit criteria (close with `verify-feature` → STOP)
- `npm --prefix ".../sitepulse-next" run typecheck` / `run test` / `run build` all green.
- Total test count is UP and green; the new tests demonstrably FAIL when the P1 failed-tracking is reverted (proof they're real guards), then pass once restored.
- No product-code diff (git shows only `*.test.ts(x)` changes, +/- any tiny test-only helper).
- Do not commit/push until the owner says "Approved." No approval gates this phase (no migration / queue-mechanic / RLS change). This is the LAST phase — closing it completes the Save Visibility workstream.

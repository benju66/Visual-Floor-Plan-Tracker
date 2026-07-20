# Kickoff — Frontend Structure (W3), Phase 2: safety-net characterization tests (before the split)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of Frontend Structure (W3)** — the safety-net characterization tests that must land BEFORE the `useProjectQueries.ts` split (P3–P5). Add `src/hooks/useProjectActions.test.tsx` (activity CRUD + the untested `handleDeleteSheet` cascade) and extend `src/hooks/useProjectQueries.test.tsx` to cover the query/mutation hooks in the domains about to move that aren't yet pinned. These tests assert **today's** behavior so the split runs under a green regression net. Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-20 - Frontend Structure Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Frontend-Structure-Plan.md` (Phase 2 + "Build-on inventory" + "Testing")
> - `sitepulse-next/AGENTS.md` (§2 the sync-engine invariants these tests pin, §9 the test harness)
>
> Branch off `main`, PR through CI. Build **only Phase 2**. This is a **tests-only** phase — ZERO product diff (no `src/` non-test file changes; if a test can't be written without a product change, STOP and flag). Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
Phases 3–5 will physically move ~1,555 lines of data-layer code out of one giant file (`useProjectQueries.ts`) into small domain files. Moving code is where "it still compiles but quietly behaves differently" bugs hide. Before we touch it, we write tests that **lock in exactly how it behaves today** — which DB calls it makes and which caches it refreshes — so if the split changes any of that, a test goes red instead of a user's map silently going stale. The single most valuable target is `useProjectActions.ts`, which has **no test at all today** and contains `handleDeleteSheet` — a 7-step cascade whose paginated delete fixed a real production bug (a big level used to leave orphaned rows behind and fail to delete).

## Where the workstream stands
W3 scope = "Core data-layer" (owner, 2026-07-20). **P1 (queryKeys sweep) SHIPPED to main 2026-07-20** (#21, squash `91efdd0`; CI green, live smoke owner-verified). Every cache key now flows through the `src/types/queryKeys.ts` factory — so these tests should assert invalidation against the `queryKeys.*` builders, never re-hand-written literals. This is Phase 2 of 6 (+1 optional). **Re-baseline off current `main`.**

## Scope — do exactly this
1. **New `src/hooks/useProjectActions.test.tsx`** — characterize `useProjectActions(project, sheets, projectId)`. Render the hook via `renderWithQuery` (AGENTS §9) and drive each returned handler, asserting BOTH the Supabase calls and the exact invalidation keys (use the factory: `queryKeys.activities(id)`, `queryKeys.statusesAll()`, `queryKeys.activityDependencies(id)`, `queryKeys.sheets(id)`). Cover at minimum:
   - **`handleAddActivity`** — inserts into `activities` with the next `sequence_order` for that track (reads the cached `queryKeys.activities(project.id)` list to compute `maxOrder + 1`, `dictionary_id ?? null`), then invalidates `queryKeys.activities(project.id)`. Assert the computed `sequence_order`. Also assert the empty/whitespace-name early-return (no insert).
   - **`handleUpdateActivity`** — delegates to the `useUpdateActivity` mutation (name+color update, and the `status_logs.status_color` sync by `activity_id`). A failure surfaces via `showToast`, not a throw.
   - **`handleDeleteActivity`** — deletes the `activities` row, then invalidates all three: `queryKeys.activities(...)`, `queryKeys.statusesAll()`, `queryKeys.activityDependencies(...)`. (Pins the FK-cascade refresh contract.)
   - **`handleDeleteSheet` cascade (the highest-value test)** — pin the ORDER and the 1000-row-cap fix: storage cleanup is best-effort/non-fatal (a `deleteSheetStorageService` reject must NOT abort the delete), then the **paginated** `fetchAllIn('units','sheet_id',[sheetId],'id')` read → **chunked** `status_logs` delete by `unit_id` (chunk size 200; feed >200 unit ids and assert multiple `.in(...)` calls) → single `units` delete by `sheet_id` → `sheets` delete → `queryKeys.sheets(...)` invalidation → **active-sheet reassignment** (if the deleted sheet was active, `setActiveSheetId` moves to the first surviving sheet, else `''`). Assert a `status_logs` delete error **throws into the catch** (surfaces as the failure toast) rather than pretending success.
2. **Extend `src/hooks/useProjectQueries.test.tsx`** — add coverage for the query/mutation hooks in the domains about to move (P3 Contacts/History/Sheets; P4 Units/Activities/Applicability; P5 Statuses) that aren't already pinned, so the split runs green. Prioritize: the optimistic-cache + `onSettled` invalidation of the status mutations (`useUpdateStatus`/`useClearStatus`/`useBulkUpdateStatus`/`useBulkInsertStatusLogs` — assert they hit `queryKeys.statusesBySheet(sheetId)` + `queryKeys.allProjectStatusesAll()`), and the unit mutations' `queryKeys.units(sheetId)` + `queryKeys.allProjectUnitsAll()` invalidations. Don't re-test what's already covered — grep the existing test first.
3. Mock the data layer with the existing chainable `vi.mock('@/supabaseClient')` recipe (doc-comment in `src/test/renderWithQuery.tsx`; canonical examples `useProjectQueries.test.tsx`, `useMapActions.test.tsx`, `useSnappingVectors.test.tsx`). Stub the Zustand stores (`useMapStore`/`useUIStore`/`useSettingsStore`) and the `@/services/api` functions as needed. **Do NOT add `msw`.**

## Guardrails
- **Tests-only. ZERO product diff.** No change to any non-test file under `src/`. If a hook is untestable without a refactor, STOP and FLAG it (don't "improve" the hook to make it testable — that's a P3+ decision).
- **Characterize TODAY's behavior — do not assert what it *should* do.** If a handler does something surprising (e.g. the tile-cleanup block, or a swallowed `sheet_vectors` delete error), pin it AS-IS and note it as a flag in the phase report; the split must preserve it. These tests are the regression net, not a correctness audit.
- Assert invalidation keys via the **`queryKeys.*` builders** (post-P1), never re-written array literals — a literal in a test would dodge the very drift-protection P1 added.
- Vitest globals OFF — import `{ describe, it, expect, vi }` from `'vitest'`; co-locate the test; keep it type-clean (test files are in `npm run typecheck`).
- No `@ts-nocheck`/`@ts-ignore`/new `any`. Mock types come from the stubs, not `as any` shortcuts.

## Exit criteria (Definition of Done)
- New `useProjectActions.test.tsx` green (covers the 3 activity handlers + the `handleDeleteSheet` cascade incl. the paginated/chunked delete and active-sheet reassignment) + extended `useProjectQueries.test.tsx` green.
- Full suite green (`npm run test`) + `typecheck` green. (`build` unaffected — tests-only — but run it if any import graph changed.)
- The new tests assert **today's** behavior and would FAIL if the P3–P5 split changed a DB call or an invalidation key (spot-check by mentally moving a hook — the test should still bind to the same observable contract).
- Close with the **verify-feature** skill — **SKIP the live dev:3010 click-through** (tests-only phase, no runtime surface to drive). Present the diff summary + any behavior flags you had to pin, then **STOP — no merge until the owner says "Approved."** After approval + merge, draft the Phase 3 kickoff (split wave 1: shared module + Contacts + History + Sheets, barrel-preserving) per [[post-approval-handoff-ritual]].

## Notes carried from P1 (useful here)
- `useProjectActions.ts` imports `fetchAllIn`, `useUpdateActivity`, `useReorderSheets` from the god-file — the barrel-preserving split (P3+) keeps those import paths working, but P2 tests should mock `@/hooks/useProjectQueries` at the module boundary (or stub supabase under it) so they don't break when those symbols move.
- Post-P1, `handleDeleteActivity` invalidates `queryKeys.statusesAll()` (was inline `['statuses']`) and `handleDeleteSheet`/add/rename/attach use `queryKeys.sheets(...)`/`queryKeys.snappingVectors(...)`. Assert against those exact builders.
- The `handleDeleteSheet` tile-cleanup block (`tiles/<sheetId>/...`) targets the removed OpenSeadragon path (`tile_manifest_url` is vestigial per AGENTS §5) — it's dead-ish but still runs; pin it as-is, flag if you want it removed (that's a separate cleanup, not P2).

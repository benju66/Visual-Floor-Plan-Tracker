# Kickoff — Codebase Health & Refactor, Slice 0 / Phase 0.1: Test harness + dev guards

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Slice 0 / Phase 0.1 of Codebase Health & Refactor** (reusable integration-test
> harness + dev wiring guard + dev-on-prod-DB banner). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-03 - Codebase Health Slice 0 Phase 0.1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Codebase-Health-Refactor-Master-Plan.md` (Slice 0, Phase 0.1)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 0.1**. This is test/dev-tooling only — do NOT touch the
> offline queue, `status_logs` writes, `pendingChanges`, RLS, or any DB schema. Don't commit or
> push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English goal
Lay the foundation that makes the whole refactor safe: a small, reusable way to test React
components/hooks that talk to the database (without a real database), plus two cheap safety
nets — a **dev-only alarm** when an interactive action fires with nothing wired to save it, and
a **"you're pointed at the real production database" banner** so no one edits live data while
developing. Nothing users see in production changes.

## Why this phase exists
This is the first phase of the master plan (`Codebase-Health-Refactor-Master-Plan.md`). The app's
integration layer is almost untested (only 1 of ~40 hooks, 6 of 88 components) and its biggest
files are about to be typed (Slice 1) and decomposed (Slice 2). Every later phase leans on the
harness built here. It also absorbs the safety pieces of the older
`Notes/plans/Robustness-Trust-Hardening-Plan.md` (Phases 1 and 4).

## Required reading (fresh — do not trust line numbers)
- `sitepulse-next/AGENTS.md` — esp. §2 (state/sync invariants this must only READ, not change),
  §6 (TS/IDB serialization guardrails), §9 (testing conventions — **Vitest globals are OFF**).
- `Notes/plans/Codebase-Health-Refactor-Master-Plan.md` — the whole plan; Phase 0.1 scope.
- `Notes/plans/Robustness-Trust-Hardening-Plan.md` — the source spec for `wiringGuard` (its
  Phase 1) and `devDbGuard` (its Phase 4); reuse its exact function contracts.
- `vitest.config.ts`, `vitest.setup.ts` — the existing harness (jsdom, `@/*` alias, globals OFF,
  `@testing-library/jest-dom/vitest`). Installed: `vitest`, `@testing-library/react`,
  `@testing-library/user-event`, `jsdom`. **NOT installed: `msw`** (do not add it — mock
  `@/supabaseClient` directly), **`@playwright/test`** (not this phase).
- `src/hooks/useSnappingVectors.test.tsx` — the ONE existing hook test; copy its `vi.mock` style.
- `src/components/FloorplanCanvas.tsx` — locate the interactive write-callback call sites
  (`onUpdateUnitPolygon` for node move / whole-drag / arrow-nudge / flip / rotate; plus
  `onPolygonComplete`, `onInstantStamp`) — you will WRAP these with the guard, not restructure.
- `src/supabaseClient` (find its real path/name) — what the harness mocks.

## Scope — build exactly this
1. **`renderWithQuery(ui)` test helper** — wraps children in a fresh `QueryClient` +
   `QueryClientProvider` (retries off, no cache bleed between tests). Put it where tests can import
   it (e.g. `src/test/renderWithQuery.tsx` or alongside setup — match repo convention). Add a
   short **Supabase-mock recipe** doc comment showing the `vi.mock('@/supabaseClient')` pattern
   from `useSnappingVectors.test.tsx`.
2. **`src/utils/wiringGuard.ts` + `wiringGuard.test.ts`** — `warnIfUnwired(cb, actionName): boolean`:
   dev-only, returns `false` + `console.error`s a loud `[wiring]` message when `cb == null`;
   returns `true` otherwise; **silent no-op returning `true` in production**. Test with a spied
   console + `vi.stubEnv('NODE_ENV', …)`.
3. **Wire the guard** at the FloorplanCanvas write-callback call sites — wrap the existing calls
   only (do NOT make props blanket-required; several are legitimately optional per surface). No
   file restructuring — decomposition is Slice 2.
4. **`src/utils/devDbGuard.ts` + `devDbGuard.test.ts`** — `isLocalDevOnProdDb({ nodeEnv,
   supabaseUrl, prodRef }): boolean` (pass env IN; no global reads inside). Render a small
   persistent **dev-only** banner when true; it must **never render in a production build**.
5. **Document the harness** in AGENTS.md §9 so future phases add tests the same way.

## Hard guardrails (AGENTS.md — do not violate)
- **READ-only w.r.t. the sync engine:** do NOT change the offline mutation queue, `pendingChanges`
  (local `useState`), `upsert_status_log`/upsert-only writes, or `client_timestamp`.
- **No DB / RLS / auth / schema changes.** No migration in this phase.
- **No class instances in Query/IDB state** (`RBush`/`Map`/`Set`); guards work on plain values.
- **No `any`, no `@ts-nocheck` on merge**; new files are `.ts`/`.tsx`; tests import
  `{ describe, it, expect, vi }` from `'vitest'` and are co-located.
- **Touch `FloorplanCanvas.tsx` minimally** — wrap calls, don't refactor.

## Exit criteria (Definition of Done → then STOP)
- `typecheck` + `test` + `build` all green (absolute-prefix commands below).
- `wiringGuard` + `devDbGuard` unit-tested: warn/true in dev, silent/absent in prod.
- `renderWithQuery` helper importable and used by at least one smoke test to prove it works.
- Live `dev:3010`: a normal trace/name/move does **not** trigger a `[wiring]` warning (everything
  is wired); the prod-DB banner shows when pointed at prod and is absent in a production build.
- Close with the `verify-feature` skill. **Do not commit or push until the owner says "Approved."**

## Verification commands
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
Target one test: `... run test -- src/utils/wiringGuard.test.ts`. Lint is NOT a gate. UI/banner
verified via `npm run dev:3010` (port 3010, not 3000).

## Next after this
Phase 0.2 (hook contract tests for the data-layer spine) — draft its kickoff after 0.1 is
Approved, per the post-approval handoff ritual.

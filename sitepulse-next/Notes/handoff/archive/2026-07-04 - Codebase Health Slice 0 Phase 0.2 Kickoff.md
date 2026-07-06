# Kickoff — Codebase Health & Refactor, Slice 0 / Phase 0.2: Hook contract tests (the data-layer spine)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Slice 0 / Phase 0.2 of Codebase Health & Refactor** (contract tests for the
> data-layer spine, built on the Phase 0.1 harness). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-04 - Codebase Health Slice 0 Phase 0.2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Codebase-Health-Refactor-Master-Plan.md` (Slice 0, Phase 0.2)
> - `sitepulse-next/AGENTS.md` (esp. §2 state/sync invariants — these are what the tests PIN)
>
> Branch off `main`. Build **only Phase 0.2** — new tests only, no behavior change. This is
> test-layer only: do NOT touch the offline queue, `status_logs`/`upsert_status_log` writes,
> `pendingChanges`, RLS, auth, or any DB schema. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English goal
The app's data hooks — the code that reads from and writes to the database — are almost
untested (1 of ~40). This phase writes fast, database-free tests that lock in the **contract**
of the four most load-bearing hooks: what shape they return to the UI, and — for writes —
exactly which database call they make with what payload. These become a tripwire so the
upcoming type-migration (Slice 1) and file-decomposition (Slice 2) can't silently change how
the app talks to the database. **No user-visible change.**

## Why this phase exists
Second phase of the master plan (`Codebase-Health-Refactor-Master-Plan.md`, Slice 0). Phase 0.1
built the harness (`renderWithQuery` + the Supabase-mock recipe); this phase is its first real
payoff — pinning the AGENTS.md §2 sync invariants as executable tests. Phases 0.3/0.4 (wiring +
FloorplanCanvas characterization) and all of Slices 1–2 lean on these.

## Required reading (fresh — do not trust line numbers; they drift)
- `sitepulse-next/AGENTS.md` §2 (the invariants to pin) + §6 (JSONB narrowing) + §9 (**the
  Phase 0.1 harness you'll use** — `renderWithQuery`, the `vi.mock('@/supabaseClient')` recipe;
  Vitest globals are OFF; **no `msw`**).
- `src/test/renderWithQuery.tsx` — the harness (has the Supabase-mock recipe as a doc-comment).
- `src/hooks/useSnappingVectors.test.tsx` — the canonical hook-test + Supabase-mock example.
- The four spine hooks (read them fresh to name real mutations/return values):
  - `src/hooks/useProjectQueries.ts` — esp. `useUpdateStatus` (single write → `upsert_status_log`
    RPC, `log_data.activity_id`, capture-time `client_timestamp`), `useBulkUpdateStatus` /
    `useBulkInsertStatusLogs` (bulk `.upsert({ onConflict: 'unit_id,activity_id' })` — **never
    `.insert()`**), and a read hook (`useUnits` or `useStatuses`) for the narrowed-shape contract.
  - `src/hooks/useMapActions.ts` — `commitUnitActivity` (passes `client_timestamp` through) and
    `handlePolygonComplete` (sets the returned `pendingPolygonPoints`).
  - `src/hooks/useWorkbenchActions.ts` — `useCreateWorkbenchLabel`, `useUpdateWorkbenchLabel`,
    `useUpdateWorkbenchGeometry`, `useUpdateWorkbenchOpeningEdges`.
  - `src/hooks/useFieldData.ts` — stages `pendingChanges` locally and feeds `handleApplyAll`
    (→ `onApplyPendingChanges`) in order.

## Scope — build exactly this
Contract tests (assert the **contract, not the implementation**) for the four spine hooks, using
`renderWithQuery` + a mocked `@/supabaseClient`:
1. **`useProjectQueries`** — a read hook returns the narrowed shapes callers expect (JSONB
   narrowed at the boundary, e.g. `polygon_coordinates`); `useUpdateStatus` fires the
   `upsert_status_log` RPC with `activity_id` (not a name) and a capture-time `client_timestamp`;
   the bulk path uses `.upsert({ onConflict: 'unit_id,activity_id' })`. **Never `.insert()`.**
2. **`useMapActions`** — `handlePolygonComplete` sets `pendingPolygonPoints` (the value the
   2026-06-29 bug dropped); `commitUnitActivity` threads `client_timestamp` through to the mutation.
3. **`useWorkbenchActions`** — each write mutation fires the right Supabase call with the right
   payload (geometry save carries the new points; label create/update maps the fields).
4. **`useFieldData`** — stages `pendingChanges` in local `useState` and feeds `handleApplyAll`
   in order via `onApplyPendingChanges` (does NOT write directly).

## Hard guardrails (AGENTS.md — do not violate)
- **Test-layer only.** READ/assert the sync engine's behavior; do NOT change the offline mutation
  queue, `pendingChanges` (stays local `useState`), the `upsert_status_log`/upsert-only path, or
  `client_timestamp` capture timing.
- **No DB / RLS / auth / schema changes. No migration.**
- **No class instances in Query/IDB state** (`RBush`/`Map`/`Set`); mock with plain values (stub
  `RBush` as `{ search: () => items } as never` if a hook touches it).
- **No `any`, no `@ts-nocheck`**; tests import `{ describe, it, expect, vi }` from `'vitest'`,
  co-located as `<hook>.test.tsx`. Keep them type-clean (they're in `typecheck`).
- **Do NOT fork** `progressAnalytics` / bottleneck math; tests exercise the real hooks.

## Exit criteria (Definition of Done → then STOP)
- `typecheck` + `test` + `build` all green (absolute-prefix commands below).
- Each of the four spine hooks has at least one contract test.
- **Reverting a §2 invariant makes a test fail** — prove it: temporarily swap the status write
  from `upsert` → `.insert()` (or drop `client_timestamp`) and confirm a test goes red, then
  revert. Note this in the DoD report.
- Close with the `verify-feature` skill. **Do not commit or push until the owner says "Approved."**

## Verification commands
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
Target one file: `... run test -- src/hooks/useMapActions.test.tsx`. Lint is NOT a gate. No live
browser check needed (pure test-layer); a `dev:3010` smoke is optional.

## Next after this
Phase 0.3 (wiring / regression tests — pin the two 2026-06-29 polygon bugs + draw→name→save
seams). Draft its kickoff after 0.2 is Approved, per the post-approval handoff ritual.

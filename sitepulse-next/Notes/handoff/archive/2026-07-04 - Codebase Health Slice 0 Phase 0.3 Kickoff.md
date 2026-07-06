# Kickoff — Codebase Health & Refactor, Slice 0 / Phase 0.3: Wiring / regression tests (pin the known bugs + save seams)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Slice 0 / Phase 0.3 of Codebase Health & Refactor** (wiring / regression tests
> that pin the two 2026-06-29 polygon bugs + the draw→name→save seams, built on the Phase 0.1
> harness and the Phase 0.2 hook contract tests). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-04 - Codebase Health Slice 0 Phase 0.3 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Codebase-Health-Refactor-Master-Plan.md` (Slice 0, Phase 0.3)
> - `sitepulse-next/AGENTS.md` (esp. §2 state/sync invariants + §3 canvas engine)
>
> **Branch off `feat/codebase-health-phase-0-2`** (NOT `main`) — 0.3 stacks on the 0.1 harness +
> 0.2 contract tests, and neither is merged to main yet (see § Branching below). Build **only
> Phase 0.3** — new tests only, no behavior change. Test-layer only: do NOT touch the offline
> queue, `status_logs`/`upsert_status_log` writes, `pendingChanges`, RLS, auth, geometry-persist
> callbacks, or any DB schema. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English goal
Two save bugs shipped and were fixed on 2026-06-29: (1) on the **project map**, a freshly-traced
room's points were dropped, so the naming popover opened with nothing to save; (2) in the
**workbench**, dragging a polygon node was visual-only — it "snapped back to a square" on the next
refresh because the save handler wasn't wired. This phase writes tests that FAIL if either fix is
ever undone, plus tests covering the full "draw → name → save" path on both surfaces — so a future
refactor can't silently reopen these holes. **No user-visible change.**

## Why this phase exists
Third phase of Slice 0 (`Codebase-Health-Refactor-Master-Plan.md`) — the absorbed Robustness plan
**P3** content. Phase 0.1 built the harness; Phase 0.2 pinned the four spine hooks' data-layer
*contracts*. This phase pins the **component wiring** one altitude up: that the components actually
pass defined handlers down and that a simulated user gesture reaches the right write. It's the last
regression-net phase before **Phase 0.4** (FloorplanCanvas characterization — the Slice 2 gate).

## Required reading (fresh — do not trust line numbers; they drift)
- `sitepulse-next/AGENTS.md` §2 (sync invariants) + §3 (canvas engine — the single geometry-persist
  callback `onUpdateUnitPolygon`; the map's draw→popover flow).
- `src/test/renderWithQuery.tsx` — the Phase 0.1 harness (Supabase-mock recipe doc-comment; no `msw`).
- **The Phase 0.2 contract tests you build ON (do not duplicate them):**
  `src/hooks/useMapActions.test.tsx`, `useWorkbenchActions.test.tsx`, `useProjectQueries.test.tsx`,
  `useFieldData.test.tsx`. 0.2 already asserts, at the HOOK level, that `handlePolygonComplete`
  sets `pendingPolygonPoints` and that `useUpdateWorkbenchGeometry` writes the new points. 0.3 is
  the WIRING/SEAM altitude — see § Avoid double-coverage.
- **The two bugs' real code (read fresh):**
  - Map bug: `src/hooks/useMapActions.ts` — `handlePolygonComplete` sets `pendingPolygonPoints`, and
    the hook's RETURN object exposes both `pendingPolygonPoints` **and** `setPendingPolygonPoints`.
    Consumed by `src/components/UnitNamingPopover.jsx` (a `.jsx` straggler) wired through
    `src/app/project/[projectId]/page.jsx` → `saveNewUnitFromPopover` → `useCreateUnit`.
  - Workbench bug: `src/components/workbench/WorkbenchTracer.tsx` — it passes
    `onUpdateUnitPolygon={handleUpdateUnitPolygon}` down into `<FloorplanCanvas>`, and
    `handleUpdateUnitPolygon` calls `useUpdateWorkbenchGeometry(sheetId)`. The bug was a
    **missing/undefined** `onUpdateUnitPolygon`, so node drags never persisted.
  - `src/components/FloorplanCanvas.tsx` — the shared canvas that RECEIVES `onUpdateUnitPolygon` /
    `onPolygonComplete` (each call site is already wrapped in `warnIfUnwired` from Phase 0.1).

## Scope — build exactly this
Wiring / regression tests using `renderWithQuery` + a mocked `@/supabaseClient` (mirror the 0.2
mocking style — mock peripheral query hooks; stub `recordTraceEvent`). jsdom has **no real canvas**,
so these assert **handler wiring + args, not pixel output** (note that in each file; pixel-level is
Phase 0.5's optional Playwright job). Because `FloorplanCanvas` is Konva-heavy, the clean approach is
to **`vi.mock('@/components/FloorplanCanvas')` with a stub that captures the props it's handed** (or
exposes a button that invokes a captured callback), then assert against those props — you are testing
the PARENT's wiring, not Konva.

1. **Map regression — the dropped-points bug.** Pin that `useMapActions`'s return object exposes BOTH
   `pendingPolygonPoints` and `setPendingPolygonPoints` (a consumer destructures both; dropping the
   setter from the return is the regression), and that after `handlePolygonComplete(pts)` a consumer
   reading the returned `pendingPolygonPoints` sees `pts` (so the popover has something to save).
2. **Workbench regression — the unwired node-move bug.** Render `WorkbenchTracer` with `FloorplanCanvas`
   mocked to capture props; assert the `onUpdateUnitPolygon` prop it passes is a **defined function**
   (not `undefined`), and that invoking it with new points calls `useUpdateWorkbenchGeometry`'s mutation
   with those points (mock `@/hooks/useWorkbenchActions` or the Supabase `units.update` to observe).
3. **Draw→name→save seams (both surfaces).** Map: `handlePolygonComplete` → popover holds the name →
   `saveNewUnitFromPopover` → `useCreateUnit` insert carries the traced points + name. Workbench:
   the trace → `WorkbenchLabelPopover` → `useCreateWorkbenchLabel` insert carries points + name + pick.
   Assert the seam end-to-end at the wiring level (the write fires with the drawn geometry).

## Avoid double-coverage with Phase 0.2 (important)
0.2 already tests the HOOKS in isolation (`handlePolygonComplete` sets the store value;
`useUpdateWorkbenchGeometry` upserts the points). Do NOT restate those. 0.3's distinct value is the
**wiring**: the hook's *return surface* still carries the value+setter a component destructures, the
*component* still passes a defined handler into the canvas, and a *simulated gesture* travels the full
seam to the write. If a 0.3 test would be identical to a 0.2 test, you're at the wrong altitude.

## Hard guardrails (AGENTS.md — do not violate)
- **Test-layer only.** READ/assert wiring + sync behavior; change NOTHING in product code — not the
  geometry-persist callbacks, the offline queue, `pendingChanges` (stays local `useState`), the
  `upsert_status_log`/upsert-only path, or `client_timestamp` capture timing.
- **No DB / RLS / auth / schema changes. No migration.**
- **No class instances in Query/IDB state** (`RBush`/`Map`/`Set`); stub with plain values.
- **No `any`, no `@ts-nocheck`**; import `{ describe, it, expect, vi }` from `'vitest'`; co-locate as
  `<component>.test.tsx`. Keep them type-clean (they're in `typecheck`) — prefer `as unknown as T`
  for partial fixtures over `any`, and give `vi.fn` mocks an explicit arg signature so `.mock.calls`
  stays well-typed (the 0.2 files show the pattern).
- **Do NOT fork** `progressAnalytics` / geometry math; exercise the real code.

## Exit criteria (Definition of Done → then STOP)
- `typecheck` + `test` + `build` all green (absolute-prefix commands below).
- Each of the two 2026-06-29 bugs has a regression test, and the draw→name→save seam is covered on
  BOTH surfaces.
- **Reverting either fix makes a test fail** — prove it: temporarily (a) drop
  `setPendingPolygonPoints` from `useMapActions`'s return (or make `handlePolygonComplete` a no-op),
  and (b) pass `onUpdateUnitPolygon={undefined}` in `WorkbenchTracer` — confirm a test goes red for
  each, then revert. Note both in the DoD report.
- Close with the `verify-feature` skill. **Do not commit or push until the owner says "Approved."**

## Branching (read this — it's a stack, not off main)
The Phase 0.1 harness (`src/test/renderWithQuery.tsx`) and the Phase 0.2 contract tests are on
branches `feat/codebase-health-phase-0-1` (809a45f) and `feat/codebase-health-phase-0-2` (589f96b,
stacked on 0.1) — **neither is merged to `main` yet.** Branching off `main` would leave 0.3 unable to
import the harness. So **branch off `feat/codebase-health-phase-0-2`**. When 0.1 → 0.2 → 0.3 merge in
order (or squash-land together), everything rebases clean.

## Verification commands
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
Target one file: `... run test -- src/components/workbench/WorkbenchTracer.test.tsx`. Lint is NOT a
gate. No live browser check needed (pure test-layer); a `dev:3010` smoke is optional.

## Next after this
Phase 0.4 (FloorplanCanvas characterization "golden master" — the gate that must be green before
Slice 2 touches the canvas). Draft its kickoff after 0.3 is Approved, per the post-approval handoff
ritual.

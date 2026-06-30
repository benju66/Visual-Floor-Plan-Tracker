# Robustness & Trust Hardening — never lose a save silently, always show it saved (self-contained build plan)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: none — this is a cross-cutting hardening workstream, born from the
> 2026-06-29 polygon audit (two silent-failure bugs: the project-map pending polygon
> vanishing during naming, and workbench geometry edits never persisting).

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) first.
2. Re-read the files named in each phase **fresh** — do not trust line numbers; they drift.
3. Build the phases in order. Verify after each slice (§ verification commands).
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2
   sentence plain-English summary; explain jargon in passing; keep it short.
5. Do NOT commit or push until the owner says "Approved" (close each phase with the
   `verify-feature` skill: Definition of Done → stop).

## Goal
When this workstream is done, the app **cannot silently lose a save**, and the user
**always sees whether their work saved**. Concretely:
- Every interactive write (trace a location, name it, move/flip/rotate a shape) that
  *fires* but isn't wired to a save path screams in development instead of doing
  nothing (so a regression like the two we just fixed can't ship unnoticed).
- The user sees a clear **saving… / saved ✓ / failed → retry** signal on the map and
  in the labeling workbench — the same trust signal the field list already has.
- A small, automated **wiring-test** safety net guards the hook→component→canvas
  seams that the unit tests don't cover (and pins the two bugs we fixed as
  regression tests).
- Local development visibly warns when it is pointed at the **production database**,
  so no one accidentally edits real data while testing.

## Out of scope / deferred
- **A real staging/branch database (original hardening item #4).** Owner opted not to
  stand up new infra now. Phase 4 ships only a *free, in-repo* dev-mode guard. The
  documented upgrade path (a second free Supabase project, or Supabase Branching)
  becomes necessary only if/when full browser E2E that performs real writes is
  adopted — see Phase 3 "Why no DB is needed."
- **Full browser E2E (Playwright).** Owner chose lightweight RTL wiring tests. A
  Playwright smoke layer may be added in a later, separate pass; do not add the
  dependency here.
- **Decomposing the ~2,100-line `FloorplanCanvas` + finishing the JS→TS migration
  (item #5).** Explicitly a SEPARATE ongoing-hygiene track; this plan must not start
  it (touch these files only as strictly needed for a phase).
- **Changing the offline mutation queue, `status_logs` writes, RLS, or auth.** This
  workstream only READS write/queue state to display it; it never alters the queue,
  the `upsert_status_log` path, or security posture.

## Locked product decisions (from the owner, 2026-06-29)
- **Tests = lightweight RTL "wiring" tests**, not browser E2E. Rationale: the bugs
  were missing wires / a hook not returning a value — RTL + a mocked Supabase client
  catches those cheaply, runs inside the existing `npm run test` gate, and needs no
  new dependency or running browser. (`@testing-library/*`, `vitest`, `jsdom` are
  already installed; `@playwright/test` is not.)
- **No new database infra now.** Slim the prod-data protection to a free dev-mode
  guard (Phase 4); defer a staging DB.
- **The big-file refactor is a separate track**, not part of this plan.

## Data model
**No schema changes. No migrations. No DDL.** This workstream is presentation- and
test-layer only. It READS:
- React Query mutation state (`isPending` / `isError` / `isSuccess`) of the existing
  write hooks (`useCreateWorkbenchLabel`, `useUpdateWorkbenchLabel`,
  `useUpdateWorkbenchGeometry`, `useUpdateWorkbenchOpeningEdges`; the map's
  `useMapActions` mutations) to derive a save-status signal.
- The field list's existing offline-queue signals (`pendingCount`, `isApplying`,
  `hasRehydrated`) — already surfaced via `SyncIndicator`.
It WRITES nothing new to the database and must not touch the `status_logs`
UNIQUE(unit_id, track, milestone) path or the IDB mutation queue's behavior.

## Build-on inventory (read these fresh before using)
REUSE — do not fork:
- `src/components/ui/SyncIndicator.tsx` — the existing save-status dot (pending /
  syncing / synced). Phase 2 generalizes this pattern; do not duplicate its look.
- `src/components/canvas/MappedUnit.tsx` — every saved-shape edit ends here; the
  drag/anchor handlers call the canvas's write callbacks.
- `src/components/FloorplanCanvas.tsx` — the SHARED canvas (live map + workbench).
  Single geometry-persist callback: `onUpdateUnitPolygon` (used by node move, whole-
  polygon drag, arrow-nudge, flip, rotate). Also `onPolygonComplete`,
  `onPendingPolygonMove`, `onInstantStamp`. **Touch minimally — refactor is out of scope.**
- `src/hooks/useMapActions.ts` — the live-map write/handlers + the project-map
  mutations. (This is where the pending-polygon return-value bug lived.)
- `src/hooks/useWorkbenchActions.ts` — the workbench write mutations (create/update
  label, update geometry, update opening edges). The geometry mutation
  (`useUpdateWorkbenchGeometry`) is the just-added node-move persistence.
- `src/components/workbench/WorkbenchTracer.tsx` — wires the workbench canvas. (This
  is where `onUpdateUnitPolygon` was missing.)
- `src/store/useMapStore.ts` / `useWorkbenchStore.ts` — pending-polygon + tool state.
- `vitest.config.ts` / `vitest.setup.ts` — test env (jsdom, `@/*` alias, globals OFF).
NOT to fork: `progressAnalytics`, the bottleneck math, the established Query hooks,
the `mixAlpha`/geometry utils.

## Pure logic to extract + unit-test
Framework-free, deterministic functions in `src/utils/` (+ co-located `.test.ts`),
where the load-bearing correctness lives:
- **`saveStatus.ts` — `deriveSaveStatus(states) → 'idle'|'saving'|'saved'|'error'`**
  (Phase 2). Pure mapping from a set of React Query mutation flags
  (`{ isPending, isError }[]`) + a recent-success flag to one status enum. No React,
  no `Date.now()` inside — pass any "recently saved" timestamp/age IN.
- **`wiringGuard.ts` — `warnIfUnwired(cb, actionName) → boolean`** (Phase 1). Pure,
  dev-only: returns `false` and `console.error`s a loud `[wiring]` message when an
  interactive write fires with `cb == null`; returns `true` otherwise. Test with a
  spied console and `vi.stubEnv('NODE_ENV', …)`; must be a no-op (silent, returns
  `true`) in production.
- **`devDbGuard.ts` — `isLocalDevOnProdDb(env) → boolean`** (Phase 4). Pure: given
  `{ nodeEnv, supabaseUrl, prodRef }`, returns whether a non-production build is
  pointed at the production project ref. Pass env IN; no global reads inside.

## Sub-phasing (ship + verify each)

### Phase 1 — Kill silent no-op writes (dev-time wiring guard)
- **Plain-English:** make it impossible for an action to *look* like it worked while
  silently doing nothing — the exact failure behind both bugs. In development, any
  write action that fires without a save path now shouts in the console (and is unit-
  tested); production is unaffected.
- **Scope:**
  - Add `src/utils/wiringGuard.ts` + `wiringGuard.test.ts` (`warnIfUnwired`).
  - At each interactive write-callback call site in `FloorplanCanvas.tsx` (the
    `onUpdateUnitPolygon` invocations: node move, whole-polygon drag, arrow-nudge,
    flip, rotate; plus `onPolygonComplete`, `onInstantStamp`), guard the call so a
    fired-but-unwired action triggers `warnIfUnwired(...)`. Keep edits surgical —
    wrap the existing calls, do not restructure the file (refactor is out of scope).
  - Do NOT make the props blanket-`required` in TypeScript: several are legitimately
    optional per surface (e.g. the map omits `onCaptureBox`; the workbench omits
    `onInstantStamp`). The dev-runtime guard is the right tool because it fires only
    when the *action actually happens* without a handler.
- **Approval gates:** none (no migration, no queue/RLS change). Standard: don't
  commit/push until "Approved".
- **Exit criteria:** typecheck + test + build green · `wiringGuard` unit-tested
  (warns in dev, silent in prod) · manual sanity: in `dev:3010`, confirm normal
  edits do NOT warn (everything is wired after the recent fix) · close with
  `verify-feature`.

### Phase 2 — Visible save/error feedback on the map + workbench
- **Plain-English:** the user always sees whether their work saved — a small
  "saving… / saved ✓ / failed → retry" signal — on the map and in the labeling
  workbench, mirroring what the field list already shows.
- **Scope:**
  - Add `src/utils/saveStatus.ts` + test (`deriveSaveStatus`).
  - Add a small `SaveStatusBadge` (generalize the `SyncIndicator` visual language —
    a dot + short label; reuse its classes/animation, don't restyle from scratch).
  - **Workbench:** drive the badge from the workbench write mutations' React Query
    state (`createLabel` / `updateLabel` / `updateGeometry` / `updateOpeningEdges`
    `isPending`/`isError`). The workbench already renders a `saveError` banner — keep
    it, and standardize a transient failure affordance with a retry.
  - **Map:** surface the same badge for the geometry/naming writes (read the map
    mutations' state; do NOT recolor or write anything — read-only).
  - The badge READS state only. It must not touch the IDB mutation queue, change
    `pendingChanges`, or alter any write path (AGENTS.md §2).
- **Approval gates:** none. Standard commit/push gate.
- **Exit criteria:** typecheck + test + build green · `deriveSaveStatus` unit-tested
  (idle/saving/saved/error transitions) · `dev:3010` click-through: trace+name a
  location and move a node on BOTH surfaces and SEE the saving→saved signal; force a
  failure (e.g. offline) and see failed→retry · close with `verify-feature`.
- **Open decision (resolve in-phase, recommend then proceed):** badge placement —
  a single status pill in the canvas toolbar/header (Recommended: one consistent
  spot, low clutter) vs. an inline cue on the naming popover. Recommend the toolbar
  pill app-wide; confirm with the owner via a screenshot during the phase.

### Phase 3 — Wiring-test safety net (the regression backstop)
- **Plain-English:** a handful of fast automated tests that would have caught both
  bugs — they check the wiring between the data hooks, the components, and the canvas
  that the current unit tests don't.
- **Why no DB is needed:** these tests **mock the Supabase client** (`vi.mock`),
  render with a `QueryClientProvider`, and assert the *contract* — "the hook returns
  the pending points," "saving fires the mutation with the polygon," "the workbench
  passes a geometry-save callback." No real database is touched, so no staging DB is
  required (this is why Phase 4 can stay a free guard).
- **Scope:**
  - Establish the integration-test pattern: a `renderWithQuery` helper + a Supabase
    mock recipe (mirror the existing mock conventions in `vitest.setup.ts` / current
    tests; mock `@/supabaseClient`).
  - Regression tests pinning the two fixed bugs:
    1. `useMapActions` **returns** `pendingPolygonPoints` + `setPendingPolygonPoints`
       (the value that was dropped), and `handlePolygonComplete` sets them.
    2. `WorkbenchTracer` passes a defined `onUpdateUnitPolygon`, and a simulated node
       move calls `useUpdateWorkbenchGeometry` with the new points.
  - Seam coverage for the core save paths: draw→name→save calls the create mutation
    with the traced polygon; save-name maps the popover fields to the mutation.
  - Document the pattern (extend AGENTS.md §9 testing notes / a short test README) so
    future write paths add a wiring test.
- **Approval gates:** none. Standard commit/push gate.
- **Exit criteria:** typecheck + test + build green · the new tests FAIL if you
  revert either fix (prove they're real regression guards) · `npm run test` total
  count goes up and stays green · close with `verify-feature`.

### Phase 4 — Dev-mode "you're on PRODUCTION data" guard (free, no new infra)
- **Plain-English:** when the app runs locally for development but is pointed at your
  real production database, show an unmissable warning so no one edits real data
  while testing. No new database, no cost.
- **Scope:**
  - Add `src/utils/devDbGuard.ts` + test (`isLocalDevOnProdDb`).
  - Render a small persistent dev-only banner (e.g. top strip) when the guard is true
    — never renders in a production build. Keep it cheap and obvious.
  - Document in the plan/README the upgrade path (a second free Supabase project, or
    Supabase Branching) for when real-write browser E2E is later adopted, and note
    that the Phase 3 tests deliberately need none of it.
- **Approval gates:** none (no schema/auth change; reads env only). Standard
  commit/push gate.
- **Exit criteria:** typecheck + test + build green · `isLocalDevOnProdDb`
  unit-tested · `dev:3010` shows the banner against the prod DB and a production
  build does not render it · close with `verify-feature`.

## Hard guardrails (AGENTS.md — do not violate)
- **Do not change the offline mutation queue** or `pendingChanges` (stays local
  `useState` in `useFieldData.ts`); this workstream only READS queue/mutation state.
- **Never revert `status_logs` writes to `.insert()`**; do not touch the
  `upsert_status_log` path at all.
- **Do not recolor `mapDisplayStatuses`** or write to `status_logs.status_color`
  (no Lag-Mode-style copies); the save badge is read-only chrome.
- **No new class instances in React Query cache / IDB** (no `RBush`/`Map`/`Set`);
  the save-status derivation works on plain flags only.
- **Derive any types from `database.types.ts`**; do not hand-write table shapes. (No
  new tables here anyway.)
- **Vitest globals are OFF** — import `{ describe, it, expect, vi }` from `'vitest'`;
  co-locate `foo.test.ts`; keep test files type-clean (they're in `typecheck`).
- **Lint is NOT a gate** (~1850 pre-existing issues) — verify with typecheck + test +
  build.
- **Touch `FloorplanCanvas.tsx` minimally** — decomposition is a separate track.

## Verification commands (the exit-criteria gate)
Run npm with an absolute prefix (Bash cwd persists; a stray `cd` prompts):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
Target one test file: `... run test -- src/utils/wiringGuard.test.ts`. UI/canvas
changes are verified by a live click-through via `npm run dev:3010` (port 3010).

## Open decisions
- **Phase 2 badge placement** (toolbar pill vs inline) — resolved in-phase; recommend
  toolbar pill, confirm via screenshot.
- **When to revisit a real staging DB / browser E2E** — only if/when write-performing
  E2E is wanted; until then the mocked wiring tests + dev guard cover the risk.

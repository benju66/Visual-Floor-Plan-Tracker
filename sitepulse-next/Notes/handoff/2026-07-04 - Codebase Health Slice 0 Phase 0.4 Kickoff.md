# Kickoff — Codebase Health & Refactor, Slice 0 / Phase 0.4: FloorplanCanvas characterization ("golden master")

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Slice 0 / Phase 0.4 of Codebase Health & Refactor** (FloorplanCanvas characterization
> "golden master" — the tripwire that must be green before Slice 2 decomposes the canvas). Read these
> in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-04 - Codebase Health Slice 0 Phase 0.4 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Codebase-Health-Refactor-Master-Plan.md` (Slice 0, Phase 0.4)
> - `sitepulse-next/AGENTS.md` (esp. §3 canvas engine + §2 sync invariants)
>
> **Branch off `main`** (Slice 0 P0.1–0.3 landed on main 2026-07-04; you only need the `renderWithQuery`
> harness, which is on main — see § Branching). Create `feat/codebase-health-phase-0-4`. Build **only
> Phase 0.4** — new tests only, no behavior change. Test-layer only: do NOT
> touch the offline queue, `status_logs`/`upsert_status_log` writes, `pendingChanges`, RLS, auth, the
> geometry-persist callbacks, or any DB schema. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English goal
`FloorplanCanvas.tsx` is the biggest, most central file (2,704 lines) and Slice 2 is going to break it
into smaller pieces. Before anyone touches it, we want a **safety tripwire**: a set of tests that record
*exactly what the canvas does today* for every gesture that saves geometry — move a node, drag the whole
room, nudge with the arrow keys, flip, rotate, insert/delete a vertex, finish a trace, stamp. The tests
don't judge whether today's behavior is "right"; they just freeze it, so if the decomposition ever
changes what a gesture saves, a test goes red. **No user-visible change — new tests only.** This phase
is the **gate**: Slice 2 can't start on the canvas until it's green.

## Why this phase exists
Fourth phase of Slice 0. 0.1 built the harness + wiring guard; 0.2 pinned the spine hooks' data
contracts; 0.3 pinned the two known polygon bugs + the draw→name→save seams at the component-wiring
altitude. 0.4 goes deeper into the canvas itself: it characterizes **which write callback fires, and
with what arguments**, for each interactive gesture — the "golden master" the master plan names as the
prerequisite for Slice 2 (`FloorplanCanvas` → `useProjectQueries` → `SettingsMenu` decomposition).

## The contract to pin (read fresh — line numbers drift)
Every geometry-saving gesture routes through one of **four** callback props, each call site already
wrapped in `warnIfUnwired(cb, '<tag>')` from Phase 0.1. The `<tag>` is your gesture checklist — grep
`warnIfUnwired` in `FloorplanCanvas.tsx` to find them all fresh. As of this writing they are:

| Callback | Gesture (`warnIfUnwired` tag) | Args passed |
|---|---|---|
| `onUpdateUnitPolygon(unitId, points)` | `:node-move` · `:polygon-drag` · `:arrow-nudge` · `:flip` · `:rotate` · `:add-node` · `:delete-node` · `:insert-vertex` | saved unit id + the transformed polygon |
| `onPolygonComplete(points, openingEdges?)` | `:finish` · `:draw-enter` · `:box` | the finished draft polygon (+ in-draw opening tags) |
| `onInstantStamp(unitId, points)` | `:stamp` | source unit id + translated stamp polygon |
| `onPendingPolygonMove(points)` | pending-edit commits via `handlePendingPolygonEdit` | the edited (unsaved) draft polygon |

For each, characterize the **current** output: given a known selected unit + a simulated gesture,
`onUpdateUnitPolygon` fires **once** with `(thatUnitId, <these exact points>)`. Snapshot the transform
math as it is today (e.g. flip mirrors about the polygon's mid-x/mid-y; rotate is aspect-corrected 90°
about the centroid; polygon-drag adds the drag delta to every point; node-move replaces one vertex;
delete-node splices one out but never below 3; a corrupt/non-finite result is **not** saved). These are
tripwires, not correctness claims — assert what the code does now.

## The hard part — decide the mechanism FIRST (jsdom has no canvas)
The gesture handlers (`handleAnchorDragEnd`, `handlePolygonDragEnd`, `handleFlipPolygon`,
`handleRotatePolygon`, `handleAnchorClick`, the arrow-nudge key handler, `handleInsert/DeletePendingVertex`,
the draw-close handler) are **internal**, driven by Konva events / `layout` / refs — and jsdom has no
real canvas, so RTL can't fire real Konva events. Solving *how to drive them* is the first task, before
writing any assertion. Recommended approach, in order of preference:

1. **Mock `react-konva` to host-element stubs (recommended).** `vi.mock('react-konva')` so `Stage`,
   `Layer`, `Group`, `Line`, `Circle`, `Rect`, `Text`, etc. render as plain forwarding stubs that pass
   their Konva event props (`onDragEnd`, `onClick`, `onDragMove`, …) straight through. Then render
   `FloorplanCanvas` with the Phase 0.1 harness, seed a selected unit (via `useMapStore` + a mocked
   `useUnits`), and invoke the forwarded handler with a **minimal synthetic Konva event**
   (`{ target: { x: () => …, y: () => …, cancelBubble: false } }`) to trigger a drag/click gesture.
   Capture the `onUpdateUnitPolygon` / `onPolygonComplete` / `onInstantStamp` props (mock them as
   `vi.fn()`s or via a props-capture like the 0.3 `WorkbenchTracer` test) and assert the args. Flip /
   rotate / arrow-nudge are reachable through their toolbar/menu/keyboard triggers once the tree renders.
   Also stub `Konva` itself if a module-load reference forces it. This keeps the test **tests-only** — no
   product code moves.
2. **Fallback if a gesture can't be reached even with mocked konva:** note it explicitly in the test file
   and defer that one gesture's *visual* proof to the optional Phase 0.5 Playwright smoke — do **not**
   silently drop it, and do **not** extract/move product math to make it testable (that's Slice 2 work,
   not 0.4; 0.4 must stay behavior-preserving/tests-only).

⚠️ **Open decision to raise with the owner AT THE GATE (use `AskUserQuestion` if it comes up):** if the
mocked-konva harness proves it can't reach a couple of gestures cleanly, do we (a) accept partial
characterization + lean on Phase 0.5 for those (recommended default), or (b) green-light a *minimal*
pure-transform extraction now (crosses into Slice 2, changes product code)? Recommend (a) unless the
gap is large.

## Scope — build exactly this
- One characterization test file, co-located: `src/components/FloorplanCanvas.test.tsx` (co-locate;
  `<component>.test.tsx`). Use `renderWithQuery` + the mocked-konva harness. Mock the data layer with
  the Phase 0.1 Supabase-mock recipe / mock the peripheral hooks (mirror the 0.2 + 0.3 style: mock
  `useUnits`, `useSnappingVectors`, `useSheetText`, etc.; stub `recordTraceEvent`).
- A test per write gesture in the table (one `describe` per callback, one `it` per tag). Assert the
  callback fires **once** with the right `(unitId, points)` / `(points, openingEdges)` shape, and that
  the guard cases hold today (non-finite polygon → no save; delete-node floor of 3).
- Note at the top of the file: jsdom has no real canvas, so these assert **handler wiring + transform
  args, not pixel output** (that gap is Phase 0.5's optional Playwright job).

## Avoid double-coverage with 0.2 / 0.3
0.3 already proved `WorkbenchTracer` passes a **defined** `onUpdateUnitPolygon` and that firing it calls
the geometry mutation; 0.2 proved the mutation writes the points. 0.4's distinct value is **inside the
canvas**: that a *simulated gesture on the Konva tree* produces the right callback + the right transformed
points. Don't restate "the mutation writes points" — pin the **transform + which-callback-fires** contract.

## Hard guardrails (AGENTS.md — do not violate)
- **Test-layer only.** Change NOTHING in product code — not the geometry-persist callbacks, the transform
  math, the offline queue, `pendingChanges`, `upsert_status_log`, or `client_timestamp` timing. If a
  gesture seems untestable without moving code, that's the Phase 0.5 / Slice 2 boundary — stop and flag it.
- **No DB / RLS / auth / schema changes. No migration.**
- **No class instances in Query/IDB state** (`RBush`/`Map`/`Set`) — stub `vectorTree`/snapping as plain
  values (`{ search: () => [] } as never`), never a real `RBush`.
- **No `any`, no `@ts-nocheck`.** Import `{ describe, it, expect, vi }` from `'vitest'`. Type synthetic
  Konva events with a narrow local interface; prefer `as unknown as T` over `any`. `vi.fn` callback mocks
  get an explicit arg signature so `.mock.calls` stays typed (the 0.2/0.3 files show the pattern).
- **Do NOT fork** `progressAnalytics` / geometry math (`getCentroid`, `getSnappedCoordinate`,
  `isFinitePolygon`, `mixAlpha`); exercise the real functions.

## Exit criteria (Definition of Done → then STOP)
- `typecheck` + `test` + `build` all green (absolute-prefix commands below).
- **Every** FloorplanCanvas write gesture in the table has a characterization test (or an explicit,
  owner-acknowledged deferral to Phase 0.5 for a gesture the mocked-konva harness can't reach).
- Prove the tripwire bites: temporarily perturb one transform (e.g. make `handleFlipPolygon` a no-op, or
  flip the rotate direction) and confirm a test goes red, then revert. Note it in the DoD report.
- Close with the `verify-feature` skill. **Do not commit or push until the owner says "Approved."**
- **This phase is the GATE for starting Slice 2** — record that in the DoD report.

## Branching (off main now)
Slice 0 P0.1–0.3 (harness + wiring guard + spine contracts + polygon-bug regression tests) **landed on
`main` 2026-07-04** — the old `feat/codebase-health-phase-0-1/0-2/0-3` stack is merged and can be deleted.
So **branch a fresh `feat/codebase-health-phase-0-4` off `main`**. Per the owner's resequencing, by the
time you run this the **Stamp Fast Markup** plan and **Slice 1 (type the spine)** will also be on main —
that's expected and fine; 0.4 only depends on the Phase 0.1 harness (`src/test/renderWithQuery.tsx`) and
the current `FloorplanCanvas.tsx`.

## Verification commands
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
Target one file: `... run test -- src/components/FloorplanCanvas.test.tsx`. **Lint is NOT a gate.** No
live browser check is required (pure test-layer); a `dev:3010` smoke is optional. ⚠️ a `next build`
corrupts a running `dev:3010` server — restart via `scripts/restart-dev.ps1`.

## Next after this
Per the owner's 2026-07-04 resequencing, 0.4 runs **after** Stamp Fast Markup + Slice 1 (type the spine),
and with 0.4 green the **gate opens for Slice 2 — decomposing `FloorplanCanvas.tsx`** (the golden master
is the tripwire that guards that refactor). Phase 0.5 remains OPTIONAL + ⛔ owner-gated Playwright smoke
(3 flows) — do **not** add Playwright unprompted. Draft the Slice 2 canvas kickoff (via `/plan-phases`)
after 0.4 is Approved, per the post-approval handoff ritual.

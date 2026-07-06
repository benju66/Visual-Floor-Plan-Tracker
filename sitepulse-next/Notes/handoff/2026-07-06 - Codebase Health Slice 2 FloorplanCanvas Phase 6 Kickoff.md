# Kickoff — Codebase Health Slice 2 / FloorplanCanvas Decomposition, Phase 6: extract the stamp tool → `useStampTool`

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 6 of the FloorplanCanvas Decomposition** (Codebase Health Slice 2, target 1) —
> extract the stamp tool (armed drawer stamps + selected-room stamping, the rotate/flip transform,
> the name-each-stamp routing) into a new `src/hooks/useStampTool.ts` hook. **Behavior-preserving;
> a pure move, no user-visible change.** Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-06 - Codebase Health Slice 2 FloorplanCanvas Phase 6 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/FloorplanCanvas-Decomposition-Plan.md` (Phase 6 + the guardrails)
> - `sitepulse-next/AGENTS.md` (esp. §3 canvas engine, §6 TypeScript)
>
> Branch `feat/codebase-health-slice2-phase-6` off `main` (the slice-2 chain through Phase 5 is
> merged — Phase 5 landed 815d3e6). Build **only Phase 6**. Keep `FloorplanCanvas`'s behavior +
> public prop surface byte-identical; the golden-master test (`src/components/FloorplanCanvas.test.tsx`)
> must stay green (its `:stamp` test pins the onInstantStamp call). Don't commit or push until I
> say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English goal
The stamp tool drops a copy of a room shape wherever you click — either the currently selected room
or a shape "armed" from the stamp drawer — with an optional rotate/flip applied first and an opt-in
"name each stamp" flow that routes through the naming popover instead of dropping instantly. Today
that wiring sits inside `FloorplanCanvas.tsx`. This phase lifts it into its own hook file. Nothing
the user sees changes — same click-to-stamp, same R/H/V rotate/flip, same drawer, same naming flow.

## Why this phase exists / where it sits
Sixth phase of **Slice 2, target 1**. Phases 1–5 are DONE + merged (`canvasLayout.ts`,
`useCanvasViewport`, `useCanvasSnapping`, `useGeometryGestures`, `useTraceTool`); the file is at
~2,063 lines. Second of the three tool extractions (trace → **stamp** → measure). Follow
`useTraceTool.ts` as the template — it established the two seams this phase reuses: tool-branch
handlers with their gates inside, and the window keydown effect (already BELOW the tool-hook calls)
consuming hook returns directly.

## The exact scope — build only this
Move the stamp tool into a NEW `src/hooks/useStampTool.ts`. **Re-read the real file first — line
numbers WILL have drifted.** What moves (names verified post-Phase-5):

- **Store wiring (~196–202, ~213):** the `useMapStore` reads `stampTransform` / `rotateStamp` /
  `flipStamp` / `resetStampTransform` / `armedStamp` / `clearArmedStamp`, and the `nameEachStamp`
  derived flag (~213). The hook can subscribe to `useMapStore` itself (it's global Zustand); the
  component consumers below then read the hook's returns.
- **Stamping input:** the TWO `stamp` branches of `handleStageClick` (~957–995) — armed-drawer
  source and selected-room source; both snap the anchor via the Phase-3 hook's `snapPoint`, build
  via `buildStampPolygon`, guard with `isFinitePolygon`, and route to `onStampWithNaming` (opt-in)
  or `onInstantStampShape`/`onInstantStamp`. ⚠️ **Routing lesson from Phase 5:** the else-if CHAIN
  in `handleStageClick` must keep its fallthrough — when stamp mode has nothing armed/selected the
  chain currently falls through to the final else (`setIsLegendSelected(false)` on empty-canvas
  click). Keep the branch conditions in the component's chain (or prove the fallthrough unchanged)
  and call the hook's handler(s) inside them.
- **Leave-stamp reset:** the `if (toolMode !== 'stamp') { resetStampTransform(); clearArmedStamp(); }`
  line of the tool-change reset effect (~530) — move it into the hook as its own `[toolMode]`
  effect, exactly like Phase 5 moved the leave-draw draft reset.
- **Keyboard R/H/V (~823–825) STAYS** in the window keydown effect (Phase 8's job) — it can call
  the hook's returned `rotateStamp`/`flipStamp` directly (the effect already sits below the tool
  hooks since Phase 5); keep its dep array byte-identical.
- **Consumer wiring stays mounted in the component, fed from hook returns:** `StampPreview`
  (~1909, needs `armedStamp` points + `stampTransform` + `snapPoint`/`aspect`), `ContextActionDock`
  (~1464–1467: `stampTransform`, `onRotateStamp`, `onFlipStamp`, `hasArmedStamp`), and
  `StampDrawer` (~1481, unchanged — it talks to the store itself).

**The 3 callback prop signatures + wiring-guard labels stay identical:** `onInstantStamp` (guard
`onInstantStamp:stamp`), `onInstantStampShape` (guard `onInstantStamp:armed` — yes, that label
says InstantStamp; preserve it verbatim), `onStampWithNaming` (guards `onStampWithNaming:armed` /
`onStampWithNaming:unit`). The golden master's `:stamp` test pins the selected-room path's args
(`buildStampPolygon` output). Derive the exact hook surface from what the component actually uses;
don't invent extras. **Reuse `buildStampPolygon`/`isFinitePolygon` — never fork** (AGENTS §3).

## Hard guardrails (AGENTS.md — do not violate)
- **Behavior-preserving.** Same stamp drop, same transform, same naming flow. Any visible
  difference = STOP, bug.
- **Public surface frozen.** `FloorplanCanvasProps` + `useImperativeHandle` byte-identical.
- **Golden master is sacred.** `src/components/FloorplanCanvas.test.tsx` stays green, untouched.
- **Reuse, never fork** — `buildStampPolygon`, `snapPoint`, `isFinitePolygon` are called, not
  re-implemented.
- **No `any`, no `@ts-nocheck`.** No DB / RLS / auth / schema / offline-queue changes.

## Exit criteria (Definition of Done → then STOP)
- `typecheck` + `test` + `build` all green; **golden master green (esp. `:stamp`)**.
- `dev:3010` click-through (desktop only): stamp a selected room, arm a drawer stamp + drop it,
  R / Shift+R / H / V before dropping (keys AND dock buttons), the "name each stamp" toggle flow,
  and leaving stamp mode resets transform + disarms. ⚠️ Instant stamps CREATE real units and the
  dev server points at the PROD database — verify on a Sandbox project with scratch stamps and
  DELETE them after (create→verify→delete), or use the name-each-stamp popover and CANCEL. Never
  touch real rooms.
- Close with the `verify-feature` skill. **Do not commit or push until the owner says "Approved."**
- On approval, per the post-approval handoff ritual: draft the **Phase 7 (`useMeasureTools`)**
  kickoff + paste its launch prompt.

## Verification commands
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
**Lint is NOT a gate.** ⚠️ a `next build` corrupts a running `dev:3010` server → restart via
`scripts/restart-dev.ps1`.

## Next after this
Phase 7 — extract scale-calibration + measure (`useMeasureTools`). Then keyboard → recolor →
render split (see the plan-of-record). Line-count trajectory so far: 2,749 → 2,710 (P1) →
2,369 (P2) → 2,336 (P3) → 2,156 (P4) → 2,063 (P5).

# Kickoff — Codebase Health Slice 2 / FloorplanCanvas Decomposition, Phase 2: extract the viewport/camera engine → `useCanvasViewport`

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of the FloorplanCanvas Decomposition** (Codebase Health Slice 2, target 1) —
> extract the viewport/camera engine (zoom, pan, smooth wheel, animate, fit, mini-map) into a new
> `src/hooks/useCanvasViewport.ts` hook. **Behavior-preserving; a pure move, no user-visible change.**
> Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-06 - Codebase Health Slice 2 FloorplanCanvas Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/FloorplanCanvas-Decomposition-Plan.md` (Phase 2 + the guardrails)
> - `sitepulse-next/AGENTS.md` (esp. §3 canvas engine, §6 TypeScript)
>
> Branch `feat/codebase-health-slice2-phase-2` off `feat/codebase-health-slice2-phase-1` (or off `main`
> if the owner confirms the slice-2 chain has merged). Build **only Phase 2**. Keep `FloorplanCanvas`'s
> behavior + public prop surface byte-identical; the golden-master test
> (`src/components/FloorplanCanvas.test.tsx`) must stay green. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English goal
The canvas owns the "camera": where you're panned, how far you're zoomed, the smooth mouse-wheel glide,
the double-click zoom, fit-to-view, and the mini-map. Today all of that state and handling sits inside
the giant `FloorplanCanvas.tsx`. This phase lifts the whole camera into its own hook file so the next
zoom/pan feature touches one small file. Nothing the user sees or feels changes — same wheel feel, same
glide, same mini-map.

## Why this phase exists / where it sits
Second phase of **Slice 2, target 1** (`FloorplanCanvas.tsx`). Phase 1 (pure layout/culling math →
`src/utils/canvasLayout.ts`, commit e4f9274) is DONE + Approved; the extraction pattern is established.
The golden master (Phase 0.4, 15 gesture tests) is the safety net — it must stay green untouched.
This is the first *hook* extraction (Phase 1 was pure functions), so it also resolves the plan's
open decision on hook layout: **flat `src/hooks/useCanvasViewport.ts`** (matches the existing flat
`src/hooks/`).

## The exact scope — build only this
Move the camera engine into a NEW `src/hooks/useCanvasViewport.ts`. **Re-read the real file first —
line numbers WILL have drifted.** What moves (names verified against the current file):

- **State + live mirror:** `stageScale`/`stagePosition` `useState` (~621–622), `liveViewportRef` +
  `viewportSync` (`createViewportSync`, ~630–648).
- **Wheel path:** `handleWheel` (~1137), `cancelSmoothWheel` (~998), `stepSmoothWheel` (~1009), and the
  `wheelTargetScaleRef`/`wheelAnchorRef`/`wheelRafRef`/`wheelLastFrameRef` refs (~372–376) + their
  cleanup effect (~987). The `MIN_SCALE`/`MAX_SCALE`/`WHEEL_SMOOTH_TAU` module constants move with it
  IF nothing else uses them (verify).
- **Programmatic camera:** `animateViewport` (~1052), `handleZoom` (~1238), `resetView` (~1713),
  `zoomToFit` (~1718), `zoomToLevel` (~1755).
- **Mini-map:** `miniMapRecenter` / `miniMapPanTo` / `miniMapPanEnd` / `miniMapResize` (~1110–1134).

The hook takes `stageRef` + `layout` + `dimensions` (+ whatever settings it reads, e.g.
`mapSettings.smoothWheelZoom`) and returns
`{ stageScale, stagePosition, setStagePosition?, handleWheel, animateViewport, handleZoom, resetView, zoomToFit, zoomToLevel, miniMapRecenter, miniMapPanTo, miniMapPanEnd, miniMapResize, liveViewportRef }` —
whatever the component actually consumes; derive the exact surface from usage, don't invent extras.
The `useImperativeHandle` (`exportFullImage`, `zoomToFit`) **stays in the component**, calling the
hook's `zoomToFit`. **REUSE `src/utils/viewport.ts`** (`classifyWheelIntent`, `clampStagePosition`,
`createViewportSync`, `dampToward`) — extend `viewport.test.ts` ONLY if genuinely-new pure math falls
out of the move. Nothing else moves this phase (keyboard shortcuts, drag-pan on the Stage, snapping —
all stay put; the keydown effect keeps calling the hook's returned handlers).

## Hard guardrails (AGENTS.md + memory — do not violate)
- **Behavior-preserving.** Same wheel feel, same glide time-constant, same clamped pan bounds. If
  anything feels different on-screen, STOP — bug.
- **Mouse-wheel must always ZOOM, never scroll-pan** (owner decision, memory: users-are-mouse-wheel-primary).
- **Public surface frozen.** `FloorplanCanvasProps` + `useImperativeHandle` byte-identical.
- **Golden master is sacred.** `src/components/FloorplanCanvas.test.tsx` stays green, untouched.
- **Preserve the ref-sync pattern verbatim** — `liveViewportRef`/`viewportSync` feed Konva's synchronous
  drag/wheel paths; do not "clean it up" into state.
- **No `any`, no `@ts-nocheck`.** Fully type the hook (Konva types for the stage ref).
- No DB / RLS / auth / schema / offline-queue changes (none are near this).

## Exit criteria (Definition of Done → then STOP)
- `typecheck` + `test` + `build` all green (absolute-prefix commands below); golden master green.
- `dev:3010` click-through (desktop only): mouse-wheel zoom + smooth glide, double-click zoom, drag-pan,
  Reset view, fit-to-view (`f`), zoom-level picker, mini-map drag/recenter/resize — all feel identical.
- Close with the `verify-feature` skill. **Do not commit or push until the owner says "Approved."**
- On approval, per the post-approval handoff ritual: draft the **Phase 3 (`useCanvasSnapping`)** kickoff +
  paste its launch prompt.

## Verification commands
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
**Lint is NOT a gate.** ⚠️ a `next build` corrupts a running `dev:3010` server → restart via
`scripts/restart-dev.ps1`.

## Branching
The slice-2 chain is stacked: `main` ← `feat/codebase-health-phase-0-4` (golden master, 648a496) ←
`feat/codebase-health-slice2-phase-1` (Phase 1, e4f9274). **Branch `feat/codebase-health-slice2-phase-2`
off `feat/codebase-health-slice2-phase-1`** — or off `main` if the owner confirms the chain has merged.
Confirm merge state with the owner at session start.

## Next after this
Phase 3 — extract snapping (`useCanvasSnapping`: the RBush vector-tree build, `snapPoint`,
`effectiveSnapping`, `aspect`). ⚠️ its AGENTS §5 rule: RBush stays in hook state, NEVER in Query/IDB.
Then gestures (★ the golden-master phase) → trace/box → stamp → measure → keyboard → recolor →
render split (see the plan-of-record).

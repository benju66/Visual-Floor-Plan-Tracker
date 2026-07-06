# Kickoff — Codebase Health Slice 2 / FloorplanCanvas Decomposition, Phase 5: extract the trace + box tool → `useTraceTool`

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 5 of the FloorplanCanvas Decomposition** (Codebase Health Slice 2, target 1) —
> extract the click-trace + box-draw tool (draft points, opening tags, finish paths) into a new
> `src/hooks/useTraceTool.ts` hook. **Behavior-preserving; a pure move, no user-visible change.**
> Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-06 - Codebase Health Slice 2 FloorplanCanvas Phase 5 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/FloorplanCanvas-Decomposition-Plan.md` (Phase 5 + the guardrails)
> - `sitepulse-next/AGENTS.md` (esp. §3 canvas engine, §6 TypeScript)
>
> Branch `feat/codebase-health-slice2-phase-5` off `main` (the slice-2 chain through Phase 4 is merged —
> main == c299a6e). Build **only Phase 5**. Keep `FloorplanCanvas`'s behavior + public prop surface
> byte-identical; the golden-master test (`src/components/FloorplanCanvas.test.tsx`) must stay green.
> Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English goal
The canvas's drawing tool — click around a room to trace it, or drag a quick box — keeps an in-progress
"draft" polygon (plus any opening tags placed while tracing on the workbench) and hands the finished shape
to the parent to save. Today that draft state and click handling sit inside `FloorplanCanvas.tsx`. This
phase lifts the whole trace/box tool into its own hook file. Nothing the user sees changes — same clicks,
same snapping, same Finish/Enter, same box-drag.

## Why this phase exists / where it sits
Fifth phase of **Slice 2, target 1**. Phases 1–4 are DONE + merged to main (`canvasLayout.ts`,
`useCanvasViewport`, `useCanvasSnapping`, `useGeometryGestures`); the file is at ~2,156 lines. This is the
first of the three tool extractions (trace → stamp → measure); the hook pattern is well established —
follow `useGeometryGestures.ts` as the template. The golden master directly guards this phase's seams:
its `:finish`, `:draw-enter`, and `:box` tests pin the `onPolygonComplete` calls.

## The exact scope — build only this
Move the trace/box tool into a NEW `src/hooks/useTraceTool.ts`. **Re-read the real file first — line
numbers WILL have drifted.** What moves (names verified post-Phase-4):

- **Draft state + refs:** `draftPoints` / `draftOpeningEdges` state (~339, ~377) and their sync refs
  (`draftPointsRef` etc., ~340–379) — preserve the ref-sync pattern verbatim.
- **Tracing input:** the `draw` branch of `handleStageClick` (~1610s) — placing snapped vertices (via the
  Phase-3 hook's `snapPoint`), Shift-ortho, the opening-tag mark on placement.
- **Finish paths:** `finishDrawing` (~1107) and the draw-Enter handling — the window keydown effect
  STAYS in the component this phase (it's Phase 8's job); it calls the hook's returned `finishDrawing`,
  exactly as it calls Phase 2/4 hook returns today.
- **Box tool:** the box-drag `onPointerDown`/`onPointerUp` handlers (~1358, ~1422) that rubber-band a
  rectangle and complete it as a 4-point polygon.
- **Opening hold-key effect:** the workbench hold-D/C/H/P-to-tag-next-edge keydown/keyup effect
  (`openingCaptureEnabled` / `activeOpeningType`).

The hook consumes what it needs (`snapPoint`/`effectiveSnapping` from `useCanvasSnapping`, `layout`,
`toolMode`, the `onPolygonComplete` callback + its wiring-guard) and returns
`{ draftPoints, draftOpeningEdges, finishDrawing, <the stage/box handlers>, ... }` — derive the exact
surface from what the component actually uses; don't invent extras. `DraftPolygon` stays a child
component, fed from the hook's state. **`onPolygonComplete(points, openingEdges?)` args stay identical**
— the golden master's `:finish` / `:draw-enter` / `:box` tests are the tripwire.

## Hard guardrails (AGENTS.md — do not violate)
- **Behavior-preserving.** Same trace feel, same snapping, same opening tags, same box. Any visible
  difference = STOP, bug.
- **Public surface frozen.** `FloorplanCanvasProps` + `useImperativeHandle` byte-identical.
- **Golden master is sacred.** `src/components/FloorplanCanvas.test.tsx` stays green, untouched.
- **Preserve the ref-sync pattern verbatim** — the keydown handler and Konva paths read the draft refs.
- **Reuse, never fork** — `getSnappedCoordinate`, `openingEdges` helpers, `polygonValidity` are called,
  not re-implemented.
- **No `any`, no `@ts-nocheck`.** No DB / RLS / auth / schema / offline-queue changes.

## Exit criteria (Definition of Done → then STOP)
- `typecheck` + `test` + `build` all green; **golden master green (esp. `:finish` / `:draw-enter` / `:box`)**.
- `dev:3010` click-through (desktop only): click-trace a room → Finish button AND Enter, Shift-ortho,
  box-drag a room, and on the workbench: opening hold-key tagging during a trace — all identical.
- Close with the `verify-feature` skill. **Do not commit or push until the owner says "Approved."**
- On approval, per the post-approval handoff ritual: draft the **Phase 6 (`useStampTool`)** kickoff +
  paste its launch prompt.

## Verification commands
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
**Lint is NOT a gate.** ⚠️ a `next build` corrupts a running `dev:3010` server → restart via
`scripts/restart-dev.ps1`.

## Next after this
Phase 6 — extract the stamp tool (`useStampTool`). Then measure/calibrate → keyboard → recolor →
render split (see the plan-of-record). Line-count trajectory so far: 2,749 → 2,710 (P1) → 2,369 (P2) →
2,336 (P3) → 2,156 (P4).

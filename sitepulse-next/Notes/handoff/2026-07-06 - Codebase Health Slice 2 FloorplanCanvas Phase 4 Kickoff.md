# Kickoff — Codebase Health Slice 2 / FloorplanCanvas Decomposition, Phase 4: extract geometry-edit gestures → `useGeometryGestures` ★ the golden-master phase

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 4 of the FloorplanCanvas Decomposition** (Codebase Health Slice 2, target 1) —
> extract the geometry-edit gestures (flip, rotate, whole-polygon drag, node drag/click, add/insert/
> delete vertex, the pending-edit history wiring, arrow-nudge) into a new
> `src/hooks/useGeometryGestures.ts` hook. **Behavior-preserving; a pure move, no user-visible
> change. ★ This is the phase the Phase 0.4 golden master exists for — treat ANY red in
> `src/components/FloorplanCanvas.test.tsx` as a real regression, never a test to edit.**
> Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-06 - Codebase Health Slice 2 FloorplanCanvas Phase 4 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/FloorplanCanvas-Decomposition-Plan.md` (Phase 4 + the guardrails)
> - `sitepulse-next/AGENTS.md` (esp. §3 canvas engine + ref-sync pattern, §6 TypeScript)
>
> Branch `feat/codebase-health-slice2-phase-4` off `feat/codebase-health-slice2-phase-3`
> (Phase 3 approved + committed 6bf0402 — stacked; branch off `main` instead if the phase-3 chain
> has been merged by the time you start). Build **only Phase 4**. Keep `FloorplanCanvas`'s behavior
> + public prop surface byte-identical; golden master stays green, untouched. Don't commit or push
> until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English goal
Everything you do to an already-drawn (or just-drawn) room shape — dragging a corner, dragging the
whole room, nudging with arrow keys, flipping, rotating, adding/removing corners, undoing a
pending edit — lives inside the giant `FloorplanCanvas.tsx` today. This phase lifts those gesture
handlers into their own hook file. Nothing the user sees or feels changes — same drags, same saves,
same undo. This is the riskiest phase of the decomposition (it touches the code that WRITES room
shapes), which is exactly why the golden-master test suite was built first: it pins which callback
fires with what transformed points for every one of these gestures.

## Why this phase exists / where it sits
Fourth phase of **Slice 2, target 1** (`FloorplanCanvas.tsx`). Phases 1–3 (`canvasLayout.ts`
e4f9274, `useCanvasViewport` 87399e3, `useCanvasSnapping` 6bf0402) are DONE + Approved; the
extraction pattern and flat `src/hooks/` layout are settled. Gestures come now because they consume
the already-extracted pieces (`snapPoint`/`vectorTree`/`aspect` from `useCanvasSnapping`, layout
from Phase 1) — dependency order avoids churn.

## The exact scope — build only this
Move the geometry-edit gesture handlers into a NEW `src/hooks/useGeometryGestures.ts`.
**Re-read the real file first — line numbers WILL have drifted.** What moves (anchors verified
2026-07-06, post-Phase-3):

- **Transform gestures:** `handleFlip` (~1228), `handleRotatePolygon` (~1247) — both route pending
  vs saved targets; REUSE `flipPolygon`/`rotatePolygon` from `stampTransform` (never fork, §3).
- **Drag gestures:** `handlePolygonDragEnd` (~1264, whole-shape drag), `handleAnchorDragEnd`
  (~1289, node drag — note it calls `getSnappedCoordinate` with the hook's `vectorTree`/`aspect`
  and honors `effectiveSnapping`), `handleAnchorClick` (~1322, delete-node tool; floor-of-3 guard).
- **Vertex add/insert/delete:** the `add_node` branch of `handlePolygonClick` (~1167 — ONLY that
  branch if the rest of the click handler is select-tool territory; derive the seam from usage),
  `handleInsertPendingVertex` (~1341), `handleDeletePendingVertex` (~1356),
  `handleInsertSavedVertex` (~1371).
- **Pending-edit history:** `handlePendingPolygonEdit` (~502) + the `editHistoryRef` seed wiring
  (~490–494) + the undo/redo application (`undoEditHistory`/`redoEditHistory` reads inside the
  keydown effect, ~655–662). The big keyboard EFFECT itself stays (Phase 8) — it should read the
  hook's returns/refs; derive that seam from usage.
- **Arrow-nudge:** the nudge math inside the keydown effect (~623–645) — the plan moves "the
  arrow-nudge invocation"; a clean seam is the hook exposing a `nudgeSelected(dx,dy)`-style
  callback the keyboard effect calls via ref. Derive from usage, don't invent extras.

**The 4 write-callback prop signatures stay identical:** `onUpdateUnitPolygon` /
`onPolygonComplete` / `onInstantStamp` / `onPendingPolygonMove`. Preserve every ref and its sync
effect **verbatim** (`onUpdateUnitPolygonRef`, `unitsRef`, `selectedUnitIdsRef`,
`pendingPolygonPointsRef`, `layoutRef`) — the ref-sync pattern feeds the window keydown handler +
Konva's synchronous `dragBoundFunc` and is load-bearing (§3). Keep the `warnIfUnwired` wrappers on
every write-callback call site exactly as-is. The Stage's own drag (pan) handlers write through
`viewportSync`/`liveViewportRef` (the Phase 2 seam) — they are PAN, not geometry; leave them in the
component unless the extraction naturally proves otherwise. Nothing else moves this phase
(trace/box tool, stamp, measure, keyboard effect — all stay put).

## Hard guardrails (AGENTS.md + memory — do not violate)
- ★ **Golden master is sacred and is THE tripwire for this phase.**
  `src/components/FloorplanCanvas.test.tsx` (15 gestures + the non-finite→no-save and delete
  floor-of-3 guards) stays green, untouched. A red test = a real regression in your move.
- **Behavior-preserving.** Same drags, same commits, same undo. Geometry-persist semantics are
  frozen: flip mirrors about bbox mid-x/mid-y, rotate is aspect-corrected 90° about the centroid,
  non-finite → no save, delete floor-of-3.
- **Public surface frozen.** `FloorplanCanvasProps` + `useImperativeHandle` byte-identical.
- **Never fork** `geometry.ts` / `stampTransform.ts` / `editHistory.ts` / `polygonValidity.ts`
  math — the hook CALLS them (§3).
- **No `any`, no `@ts-nocheck`** in the new hook (§6).
- No DB / RLS / auth / schema / offline-queue changes (none are near this).

## Exit criteria (Definition of Done → then STOP)
- `typecheck` + `test` + `build` all green; **golden master 15/15 green, file untouched.**
- `dev:3010` click-through (desktop only): node move / whole-drag / arrow-nudge / flip / rotate /
  add-node / delete-node / insert-vertex persist correctly, plus pending-polygon edit + Ctrl+Z.
  ⚠️ **dev points at the PROD database — never gesture-edit real rooms** (no-live-write-probes
  rule). Use the **Sandbox Project** (Sandbox 2 has NO sheets), create a scratch room, do every
  gesture on it, delete it when done. Playwright recipe: resize viewport to ~1720×980 (a small
  window collapses the canvas), `page.bringToFront()` INSIDE the same run_code block (occluded
  Chrome throttles rAF), probe via `window.Konva.stages` transforms — not screenshots (flaky).
- Close with the `verify-feature` skill. **Do not commit or push until the owner says "Approved."**
- On approval, per the post-approval handoff ritual: draft the **Phase 5 (`useTraceTool`)**
  kickoff + paste its launch prompt.

## Verification commands
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
**Lint is NOT a gate.** ⚠️ a `next build` corrupts a running `dev:3010` server → restart via
`scripts/restart-dev.ps1`.

## Branching
Phase 3 was approved + committed on `feat/codebase-health-slice2-phase-3` (code 6bf0402 + a Notes
commit), **not yet merged to main**. Stack `feat/codebase-health-slice2-phase-4` on top of that
branch; if the owner has merged the phase-3 chain to main by the time you start, branch off `main`
instead.

## Next after this
Phase 5 — extract the trace + box tool (`useTraceTool`): draft points/opening-edge state, the
`draw` branch of `handleStageClick`, `finishDrawing`, box drag, draw-Enter. Then stamp → measure →
keyboard → recolor → render split (see the plan-of-record).

# Kickoff — Drawing Tool Excellence, Phase 1: Interaction-state hardening

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Drawing Tool Excellence** (interaction-state hardening: make the pending/naming phase its own state so draw-mode gestures can't act over a not-yet-saved polygon). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-30 - Drawing Tool Excellence Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Drawing-Tool-Excellence-Plan.md` (Phase 1)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 1**. No migration. Keep edits to `FloorplanCanvas.tsx` **surgical** (a derived guard + wrapped call sites — decomposition is a separate track). Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English summary
When you finish tracing a room, a naming box opens — but under the hood the drawing
tool is still fully switched on. So if you drag a corner a long way, or click/press-
drag on the canvas, the app can mistake it for "start a new rectangle" and silently
replace your traced room. This phase makes the "naming a fresh room" moment its own
state, so those drawing gestures are switched off while you adjust and name it. It's
the structural fix for a whole class of bugs (the node-collapse-to-rectangle report,
and the earlier "polygon vanishes during naming" report). Nothing else about
drawing changes.

## Why this phase exists / what's true right now
- **The pending phase rides on `'draw'` tool mode.** `handlePolygonComplete`
  (`useMapActions.ts`) sets `pendingPolygonPoints` and opens the naming popover but
  does **not** change `toolMode` — so the Stage's draw gestures stay live over the
  editable pending polygon.
- **The box-draw shortcut is the culprit.** In `FloorplanCanvas.tsx`, the Stage
  `onPointerDown` arms a box (`setBoxOrigin`) and `onPointerUp` completes it by
  calling `onPolygonComplete([4 corner points])` — which **replaces**
  `pendingPolygonPoints` with a bounding rectangle. A press-drag (including a
  far corner drag, whose pointerdown bubbles to the Stage) past the
  `dx,dy > 0.005` threshold triggers it. Reproduced + verified on `dev:3010`
  2026-06-30 (buggy: pending polygon teleports to the drag spot; guarded: stays).
- **A one-off guard already exists — generalize it.** The 2026-06-30 fix added
  `&& !pendingPolygonPoints` to both the box **arm** (`onPointerDown`) and box
  **complete** (`onPointerUp`) conditions. It may already be present in
  `FloorplanCanvas.tsx` on `main`/your working tree. **Do not stop there** — fold it
  into a single derived gate and extend it to the other draw-only gesture (below).
- **The add-vertex click path is NOT yet guarded.** `handleStageClick`'s
  `toolMode === 'draw'` branch does `setDraftPoints([...])` regardless of a pending
  polygon — so clicking the canvas while naming starts a *second* draft on top of
  the first (observed as stray draft dots during testing). Guard this too.
- **Saved-unit editing is the reference for "right."** `handleAnchorDragEnd`
  (saved-unit node move) snaps and persists via `onUpdateUnitPolygon`; the DB-backed
  undo (`useUndoRedo`) is deliberately disabled in `'draw'` mode. This phase does
  not change saved-unit editing — later phases make pending editing *match* it.

## Required reading (in order)
1. `sitepulse-next/AGENTS.md` — esp. §3 (Canvas engine; native-event isolation;
   keep `FloorplanCanvas` lean) and §6 (TypeScript/JSONB/IDB guardrails).
2. `sitepulse-next/Notes/plans/Drawing-Tool-Excellence-Plan.md` — whole thing, then
   **Phase 1** + "Build-on inventory" + "Hard guardrails" + "Cross-plan sequencing".
3. The current source, read FRESH (line numbers drift):
   - `src/components/FloorplanCanvas.tsx` — the Stage `onPointerDown` (box arm),
     `onPointerUp` (box complete → `onPolygonComplete`), `handleStageClick`
     (`toolMode === 'draw'` add-vertex branch), the `useEffect` keyed on `toolMode`
     that resets `boxOrigin`/draft state, and where `pendingPolygonPoints` arrives
     as a prop.
   - `src/components/canvas/PendingPolygon.tsx` — what's live during naming (anchor
     drag, whole-shape drag) — must KEEP working.
   - `src/hooks/useMapActions.ts` — `handlePolygonComplete`, `saveNewUnitFromPopover`,
     `cancelUnitNaming` (both null out `pendingPolygonPoints`).
   - `src/store/useMapStore.ts` — `ToolMode` union + `pendingPolygonPoints`.
4. Sibling context (skim): `Notes/plans/Robustness-Trust-Hardening-Plan.md`
   ("touch `FloorplanCanvas` minimally"; same polygon-audit lineage).

## Scope (build ONLY this)
1. Introduce a single derived **`isEditingPending` (= `!!pendingPolygonPoints`)**
   gate in `FloorplanCanvas` and use it to make **every draw-only gesture inert**
   while a pending polygon is open:
   - box-draw **arm** (`onPointerDown`) and **complete** (`onPointerUp`) — fold the
     existing `!pendingPolygonPoints` checks into the shared gate;
   - the **add-vertex click** (`handleStageClick`, `toolMode === 'draw'` →
     `setDraftPoints([...])`) — block starting a second draft while naming.
   Keep node drag, whole-shape drag, flip/rotate, and naming fully live.
2. Confirm the **node-drag ↔ box-complete race** (intermittent "collapses to a 3-pt
   triangle") is closed by the shared gate; add a focused guard/note if any path
   still arms a box during a pending node drag.
3. Make **cancel/Esc** coherent for the pending phase (extend the existing
   `toolMode`-reset effect / key handling so leaving the phase clears `boxOrigin`
   and any transient draft; Esc cancels naming predictably).
4. **Decision (recommend, then proceed):** derived `isEditingPending` guard
   **(Recommended — surgical; honors "touch `FloorplanCanvas` minimally")** vs. a
   dedicated `ToolMode 'edit_pending'`. Prefer the guard; if you add a mode, clean
   it up like the others. Document the choice.
5. **No new pure util required** this phase (Phases 2–4 add `polygonValidity.ts` /
   `editHistory.ts`). No component restructure. No migration.

## Approval gates
- **No hard ⛔ gate** (no migration, no RLS/auth, no queue change).
- Standard rule: **do not commit or push until the owner says "Approved."**

## Exit criteria (Definition of Done)
- `typecheck` (primary gate) + `test` + `build` green:
  ```
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
  ```
- **Live `dev:3010` click-through (this is the real proof):** trace a room, then
  while naming it — (a) drag a corner a long distance → the polygon keeps its shape
  (does NOT become a rectangle/triangle); (b) press-drag on empty canvas → nothing
  happens (no box, no second draft starts). With **no** pending polygon open, the
  normal box-draw, multi-click trace, and whole-shape-drag flows all still work.
  - The canvas resists scripted gestures; verify by hand. You can read state back in
    the console via `window.Konva.stages[0]` (overlay layer = `getLayers()[2]`;
    pending anchors are `Circle`s with `stroke === '#8b5cf6'`).
- Close the phase with the **`verify-feature`** skill (Definition of Done → STOP).
  Then draft the Phase 2 kickoff per the post-approval ritual.

## Guardrails specific to this phase
- **Surgical edits only** to `FloorplanCanvas.tsx` — a derived guard + wrapped call
  sites. Decomposition/JS→TS is a SEPARATE track (Robustness plan).
- **Do not break** the working flows: box-draw with no pending polygon, multi-click
  tracing, whole-shape drag, node drag, flip/rotate, naming save/cancel.
- **Pending geometry stays local/ephemeral** — no `status_logs`, no
  `pendingChanges` buffer, no IDB queue. Saved-unit persistence stays on
  `onUpdateUnitPolygon`.
- **Vitest globals OFF** — if you add/adjust any test, import
  `{ describe, it, expect, vi }` from `'vitest'`; keep test files type-clean.
- **Lint is NOT a gate** — verify with typecheck + test + build.

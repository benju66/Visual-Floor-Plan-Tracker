# Kickoff — Drawing Tool Excellence, Phase 4 (FINAL, OPTIONAL): Vertex insert/delete on the pending polygon

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 4 of Drawing Tool Excellence** (the final, optional phase: while naming a freshly-traced room you can **add a corner** by clicking an edge's midpoint "+", and **delete a corner** directly — the same edits you can already make on a saved room, and both undoable). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-30 - Drawing Tool Excellence Phase 4 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Drawing-Tool-Excellence-Plan.md` (**Phase 4** + "Pure logic to extract" + "Build-on inventory" + "Hard guardrails")
> - `sitepulse-next/AGENTS.md`
>
> Work on a fresh **`feat/drawing-tool-excellence-phase-4`** branch cut off `main` (which carries merged Phase 1 `isEditingPending` gate — PR #9, Phase 2 pending snapping + self-intersection warning — PR #10, and Phase 3 pending-edit undo/redo — PR #11). Build **only Phase 4**: render an edge-**midpoint "+"** affordance on `PendingPolygon` that inserts a vertex via the `distToSegment`/nearest-edge pattern, and a **delete-a-pending-vertex** affordance guarded so the polygon never drops below 3 points — **both writing back through `handlePendingPolygonEdit`** (the Phase 3 history wrapper) so they're undoable. Reuse `distToSegment`; mirror `handleAddNodeToPolygon` / `handleAnchorClick`. No migration. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English summary
Right now, while you're naming a freshly-traced room you can nudge corners, drag
the whole shape, flip it, and undo — but you **can't add or remove a corner** until
after you save (you'd have to save, then use the saved-room add-node / delete-node
tools). This phase brings those two edits to the not-yet-saved room: click the small
**"+"** that sits on the middle of an edge to drop a new corner there, and remove a
corner directly. Both flow through the Phase 3 undo history, so a mis-insert or a
mis-delete is one Ctrl+Z away. **This is the last, optional phase of the plan — it's
droppable if time-constrained; the trace/edit tool is already pro-grade without it.**

## Why this phase exists / what's true right now
- **Saved units already have add/delete-node; pending ones don't.** The saved-unit
  edits live in `FloorplanCanvas.tsx`:
  - **Add node** — the `toolMode === 'add_node'` branch of `handleStageClick`
    (currently ~line 1284): it converts the pointer to percent-space, loops the
    polygon's edges calling `distToSegment({pctX,pctY}, p1, p2)` to find the nearest
    edge `bestIdx`, `splice(bestIdx + 1, 0, newPt)`, then writes via
    `onUpdateUnitPolygon`. **Mirror this** for the pending polygon's midpoint "+".
  - **Delete node** — `handleAnchorClick` (currently ~line 1448): requires
    `toolMode === 'delete_node'`, **guards `polygon_coordinates.length <= 3`**
    (never drop below a triangle), `splice(index, 1)`, writes via
    `onUpdateUnitPolygon`. **Mirror the `<= 3` guard** for pending vertex delete.
- **Phase 3 gave you the one seam to write through.** `handlePendingPolygonEdit`
  (in `FloorplanCanvas`, added in Phase 3) wraps `onPendingPolygonMove`: it pushes a
  snapshot onto the local in-memory history, then applies the new points. **Every
  Phase 4 insert/delete MUST write back through `handlePendingPolygonEdit`** (NOT the
  raw `onPendingPolygonMove`) so the edit lands in the undo stack and Ctrl+Z works on
  it. This is the whole reason Phase 4 comes after Phase 3.
- **The pending phase has no `add_node`/`delete_node` tool mode — and must not get
  one.** Saved-unit add/delete is keyed on `toolMode`; the pending polygon is edited
  in-place while `toolMode` is still `'draw'` (it rides the draw phase, gated by
  `isEditingPending`). Phase 4 affordances are therefore **always-on while a pending
  polygon is open** (no mode switch) — a midpoint "+" you click and a per-anchor
  delete control. Do **not** add a `ToolMode` (Plan "Hard guardrails": prefer the
  derived `isEditingPending` gate; decomposition is a separate track).
- **`PendingPolygon.tsx` is where the affordances render.** It already draws the
  Line + per-vertex `Circle` anchors (with Phase 2 snapping in `dragBoundFunc` and the
  amber self-intersection tint). Add: (a) a small "+" glyph at each edge midpoint, and
  (b) a delete affordance per anchor. Match the visual language of
  `DraftPolygon.tsx`/`PendingPolygon.tsx` (radii `/ stageScale`, the violet `#8b5cf6`
  / amber `#f59e0b` palette, `perfectDrawEnabled={false}`, `listening` where right).
- **`distToSegment` already exists in `geometry.ts`** (unit-tested) — reuse it for the
  nearest-edge math if you compute insertion server-side of the click; for a midpoint
  "+" you may not even need it (the "+" already names its edge `i`, so you insert at
  `i + 1` directly). Don't fork geometry.

## Required reading (in order)
1. `sitepulse-next/AGENTS.md` — esp. §2/§3 (pending geometry is local/ephemeral —
   never route it through `status_logs`, the `pendingChanges` buffer, or the IDB
   queue; keep `FloorplanCanvas` lean; Konva native-event isolation for any new
   clickable affordance), §6 (TS/JSONB/IDB guardrails), §9 (Vitest globals OFF).
2. `sitepulse-next/Notes/plans/Drawing-Tool-Excellence-Plan.md` — **Phase 4**, plus
   "Pure logic to extract" (Phase 4 needs no new pure util beyond a thin splice helper
   if useful — `distToSegment` is enough), "Build-on inventory", "Hard guardrails".
3. The current source, read FRESH (line numbers drift):
   - `src/components/canvas/PendingPolygon.tsx` — where the "+" and delete affordances
     render; the existing anchor `Circle`s + whole-shape `Line` to match.
   - `src/components/canvas/DraftPolygon.tsx` — the visual language to mirror
     (the in-progress "+" / midpoint cue style, snap ring).
   - `src/components/FloorplanCanvas.tsx` — `handleStageClick`'s `add_node` branch and
     `handleAnchorClick` (the saved-unit pattern to mirror), `handlePendingPolygonEdit`
     (the Phase 3 wrapper — write inserts/deletes through THIS), and how
     `<PendingPolygon>` is wired (props to thread the new callbacks through).
   - `src/utils/geometry.ts` — `distToSegment` (reuse), `isFinitePolygon` (guard the
     result like `handleAnchorDragEnd` does before applying).
   - `src/utils/editHistory.ts` — the Phase 3 stack the new edits must be undoable
     through (you shouldn't need to touch it; just confirm the wrapper records them).

## Scope (build ONLY this)
1. **Edge-midpoint "+" insert** on the pending polygon:
   - Render a small "+" affordance at the midpoint of each pending edge (including the
     closing edge), in `PendingPolygon.tsx`, matching the canvas visual language.
   - Clicking it inserts a vertex at that edge (`splice(i + 1, 0, midpoint)` — or the
     `distToSegment` nearest-edge pattern if you insert at the click point) and writes
     back through **`handlePendingPolygonEdit`** so it's one undoable step. Guard the
     result with `isFinitePolygon` before applying (mirror `handleAnchorDragEnd`).
2. **Delete a pending vertex**:
   - A per-anchor delete affordance (decide style below) that removes that vertex and
     writes back through **`handlePendingPolygonEdit`**, **guarded so the polygon never
     drops below 3 points** (mirror `handleAnchorClick`'s `<= 3` guard).
3. **Do not change** saved-unit add/delete-node, the `onUpdateUnitPolygon` write path,
   the DB-backed `useUndoRedo`, the Phase 1 gate, the Phase 2 snapping/validity, or the
   Phase 3 history module. No new tool mode. No migration.

## In-phase decisions (recommend, then proceed)
- **Delete-vertex affordance style** — recommend **Alt/Option-click an anchor** (no
  extra glyph clutter on a small shape; mirrors the lightweight feel of the existing
  anchors) **or** a tiny inline "×" that appears on anchor hover. Pick one, keep it
  obvious, document why. (Plan "Open decisions" leaves this low-stakes/in-phase.)
- **Insert point** — recommend inserting **at the edge midpoint the "+" marks**
  (predictable, no pointer-math), rather than at the raw click point. Either is fine;
  midpoint is simpler and reads cleaner.
- **Hit area / native isolation** — give the "+" a comfortable click target at small
  `stageScale`; ensure clicks don't bubble into a box-arm or stage pan (set
  `cancelBubble`/`e.evt.stopPropagation()` as the existing anchor handlers do).

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
- If you extract a splice/insert helper as a pure util, co-locate a `*.test.ts` for it
  (insert-at-edge keeps the ring valid; delete-blocked-at-3). Otherwise no new test is
  strictly required (the edits are thin and flow through tested seams).
- **Live `dev:3010` click-through (the real proof):** trace a room, then while naming
  it — click an edge "+" to insert a corner (the new corner appears, shape stays
  valid); delete a corner (allowed down to a triangle, **blocked at 3 points**); **both
  are undoable** with Ctrl+Z (Phase 3) and re-applied with Ctrl+Shift+Z; the
  **saved-unit add-node / delete-node tools still work unchanged** on a saved unit.
  - The canvas resists scripted gestures; verify by hand.
- Close the phase with the **`verify-feature`** skill (Definition of Done → STOP).
  This is the **final phase of the Drawing Tool Excellence plan** — on approval, note
  the workstream complete (no further kickoff to draft).

## Guardrails specific to this phase
- **Write every insert/delete through `handlePendingPolygonEdit`** (the Phase 3
  wrapper) — never the raw `onPendingPolygonMove` — or the edit won't be undoable.
- **Never drop below 3 points** on delete (mirror `handleAnchorClick`'s `<= 3` guard);
  **guard inserts with `isFinitePolygon`** before applying.
- **No new `ToolMode`** — affordances are always-on while `isEditingPending`. Reuse
  `distToSegment`; don't fork geometry or the saved-unit add/delete path.
- **Touch `FloorplanCanvas.tsx` minimally** — thread two callbacks + wire props; the
  affordance rendering lives in `PendingPolygon.tsx`. Decomposition stays separate.
- **Pending geometry stays local + ephemeral** — no `status_logs`, no `pendingChanges`
  buffer, nothing into the IDB mutation queue.
- **Konva native isolation** — stop the "+" click from bubbling to box-arm / pan
  (AGENTS.md §3). **Vitest globals OFF**; **lint is NOT a gate** — verify with
  typecheck + test + build.

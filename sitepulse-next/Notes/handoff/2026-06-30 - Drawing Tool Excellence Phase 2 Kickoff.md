# Kickoff — Drawing Tool Excellence, Phase 2: Snapping + validity for pending edits

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of Drawing Tool Excellence** (snapping + validity for pending edits: make corner-dragging a not-yet-saved room snap to walls exactly like a saved one, and flag a self-overlapping "bow-tie" shape with a non-blocking warning). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-30 - Drawing Tool Excellence Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Drawing-Tool-Excellence-Plan.md` (Phase 2 + "Pure logic to extract" + "Hard guardrails")
> - `sitepulse-next/AGENTS.md`
>
> Work on the existing **`feat/drawing-tool-excellence-phase-2`** branch (already cut off `main`, which carries the merged Phase 1 `isEditingPending` gate — PR #9, merge `7be519f`). Build **only Phase 2**: (1) make pending node drags reuse the SAME `getSnappedCoordinate` call saved-unit editing uses, and (2) add `src/utils/polygonValidity.ts` (+ test) and surface a non-blocking self-intersection warning. No migration. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English summary
When you nudge a corner of a room you're still naming, it should grab the wall lines
the same way it did while you first traced it — today it doesn't snap at all, so a
not-yet-saved room is harder to adjust precisely than a saved one. This phase closes
that gap. It also watches for the case where you drag a corner *across* the shape and
make it overlap itself (a "bow-tie"), which silently produces a wrong square-footage —
we'll show a small warning so you can fix it, but we won't block your save or rewrite
your shape.

## Why this phase exists / what's true right now
- **Pending node drags don't snap.** In `src/components/canvas/PendingPolygon.tsx` the
  per-anchor `Circle` has a `dragBoundFunc` that only does the Shift **axis-lock**; it
  does **not** call `getSnappedCoordinate`. Its `onDragEnd` reads the raw node position
  and calls `onPendingPolygonMove(newPoints)` with no snap. So a freshly-traced room you're
  naming can't snap to walls while you adjust it — inconsistent with saved-unit editing.
- **Saved-unit editing is the reference (mirror it).** In `MappedUnit.tsx` the anchor
  `Circle`'s `dragBoundFunc` snaps **in real time** during the drag
  (`getSnappedCoordinate(pctX, pctY, vectorTree, aspect, layout.drawW, stageScale,
  snappingStrength || 15)`), so the released `node.x()/y()` is already the snapped point;
  `onDragEnd` then persists that exact point (Phase-1-era `overridePct` path through
  `handleAnchorDragEnd`). `MappedUnit` also renders a **snap-ring** Circle when
  `activeDragNode.isSnapped`. Pending editing should feel byte-identical.
- **PendingPolygon lacks the snap inputs.** It currently receives `settings, stageScale,
  layout, isShiftDown, toPixels, …` but **not** `vectorTree`, `aspect`, `enableSnapping`,
  or `snappingStrength`. `FloorplanCanvas` already has all four in scope and already
  passes them to `MappedUnit` (`vectorTree`, `aspect`, `enableSnapping={effectiveSnapping}`,
  `snappingStrength={mapSettings?.snappingStrength || 15}`). **Thread the same four into
  `PendingPolygon`** — use `effectiveSnapping` (not raw `enableSnapping`) so the magnifier
  still suspends snapping, exactly like `MappedUnit`.
- **Match the saved-unit call signature exactly — no grid-aware, no interior.**
  `handleAnchorDragEnd` (saved units) calls the **7-arg** `getSnappedCoordinate` (no
  `gridAwareSnapping`, no `interior` hint — those two extra args are only used on the
  fresh-trace cursor path in `onMouseMove`). Pending node-drag snapping must use the same
  7-arg form so pending editing and saved editing behave identically.
- **`isFinitePolygon` already exists** (added in Phase 1, `src/utils/geometry.ts`) and is
  the source of truth for NaN/off-canvas rejection. **Do not fork or duplicate it** — the
  new validity util composes it.
- **Self-intersection is a WARNING, never a block or rewrite** (owner decision). Saving a
  bow-tie is still allowed; we only surface a cue. Never silently "repair" the user's geometry.

## Required reading (in order)
1. `sitepulse-next/AGENTS.md` — esp. §3 (Canvas engine; native-event isolation; keep
   `FloorplanCanvas` lean), §6 (TypeScript/JSONB/IDB guardrails), §9 (Vitest: globals OFF —
   import `{ describe, it, expect, vi }` from `'vitest'`; co-locate `*.test.ts`).
2. `sitepulse-next/Notes/plans/Drawing-Tool-Excellence-Plan.md` — **Phase 2**, plus
   "Pure logic to extract + unit-test", "Build-on inventory", "Hard guardrails", and the
   "Open decisions" note on cue style.
3. The current source, read FRESH (line numbers drift):
   - `src/components/canvas/PendingPolygon.tsx` — the anchor `Circle` `dragBoundFunc` /
     `onDragMove` / `onDragEnd`, and the whole-shape `Line` drag. Where snapping attaches.
   - `src/components/canvas/MappedUnit.tsx` — the saved-unit anchor `dragBoundFunc` snap +
     the `activeDragNode.isSnapped` snap-ring Circle. The pattern to mirror.
   - `src/components/FloorplanCanvas.tsx` — where `<PendingPolygon … />` is rendered (thread
     the four snap props here); `handleAnchorDragEnd` (the 7-arg `getSnappedCoordinate`
     reference); how `activeDragNode` carries `{ unitId:'PENDING', index, pctX, pctY }`
     (extend with `isSnapped` if you add the ring).
   - `src/utils/geometry.ts` — `isFinitePolygon` (compose, don't fork), `distToSegment` /
     `distToSegmentSquared` (handy for segment-intersection math if useful).
   - `src/components/canvas/DraftPolygon.tsx` — the existing snap-ring visual language to
     match if you render a ring on the pending anchor.

## Scope (build ONLY this)
1. **Snap pending node drags** like saved-unit node drags:
   - Thread `vectorTree`, `aspect`, `enableSnapping` (= `effectiveSnapping`), and
     `snappingStrength` from `FloorplanCanvas` into `PendingPolygon` (add to
     `PendingPolygonProps`).
   - In the pending anchor `Circle`'s `dragBoundFunc`, after the existing Shift axis-lock,
     apply the **same 7-arg `getSnappedCoordinate`** call `MappedUnit` uses, so the node
     locks to walls in real time and the released point is already snapped. Honor
     snapping on/off (`effectiveSnapping`) and the strength setting.
   - Optional polish (recommended): set `isSnapped` on the `activeDragNode` payload during
     `onDragMove` and render the snap-ring Circle for the pending polygon, mirroring
     `MappedUnit` + `DraftPolygon`'s visual language.
2. **Add `src/utils/polygonValidity.ts` (+ `polygonValidity.test.ts`)**:
   - `isSelfIntersecting(points: PercentPoint[]) → boolean` — true if any two **non-adjacent**
     edges of the **closed** polygon cross (classic segment–segment intersection; O(n²) is
     fine for the small n). Treat the closing edge (last→first) as a real edge; ignore the
     shared endpoint of adjacent edges. **No `Date.now()`, no I/O, JSON-serializable in/out.**
   - `polygonIsSimpleAndFinite(points) → boolean` — composes `isFinitePolygon` (keep it the
     source of truth for NaN/off-canvas) with `!isSelfIntersecting`. Used for the warning,
     **never** to block a save.
   - Tests pin: convex quad → not self-intersecting; bow-tie quad → self-intersecting;
     triangle → never; collinear/degenerate edge cases; the **closing edge participates**.
3. **Surface a non-blocking self-intersection warning** when the pending (or just-edited)
   polygon `isSelfIntersecting` — recommended cue (resolve in-phase): a **light tint on the
   pending shape + a short note near the naming popover**. It must appear when the shape
   becomes a bow-tie and **clear when the user fixes it**. Saving stays allowed.
4. **Do not change** saved-unit editing, the `onUpdateUnitPolygon` write path, the DB-backed
   `useUndoRedo`, or the Phase 1 `isEditingPending` gate. No new tool mode. No migration.

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
- `polygonValidity.test.ts` pins the convex / bow-tie / triangle / closing-edge / degenerate
  cases.
- **Live `dev:3010` click-through (the real proof):** trace a room, then while naming it —
  (a) drag a corner near a wall → it **snaps** just like a saved unit (and, if you added the
  ring, shows the snap ring); (b) drag a corner across the shape into a bow-tie → the
  **warning appears**, and **clears** when you drag it back to a simple shape; saving a
  bow-tie is still allowed. Saved-unit node-drag snapping is unchanged.
  - The canvas resists scripted gestures; verify by hand. Read state back via
    `window.Konva.stages[0]` (overlay layer `getLayers()[2]`; pending anchors are `Circle`s
    with `stroke === '#8b5cf6'`).
- Close the phase with the **`verify-feature`** skill (Definition of Done → STOP). Then draft
  the Phase 3 kickoff (pending-edit undo) per the post-approval ritual.

## Guardrails specific to this phase
- **Reuse, don't fork:** `getSnappedCoordinate` (same 7-arg call as `handleAnchorDragEnd`),
  `isFinitePolygon`, the `DraftPolygon`/`MappedUnit` snap-ring visual. Don't reinvent geometry.
- **Touch `FloorplanCanvas.tsx` minimally** — only thread the four snap props into
  `<PendingPolygon>` (and the optional `isSnapped` plumbing). Decomposition stays a separate
  track.
- **Pending geometry stays local/ephemeral** — snapping + validity operate on
  `pendingPolygonPoints` via `onPendingPolygonMove`; **no** `status_logs`, no `pendingChanges`
  buffer, no IDB queue. Saved-unit persistence stays on `onUpdateUnitPolygon`.
- **Self-intersection = warning only** — never block the save, never auto-rewrite the shape.
- **Pure util discipline** (`polygonValidity.ts`): framework-free, deterministic, no
  `Date.now()`, JSON-serializable values only (§5/§6).
- **Vitest globals OFF** — import `{ describe, it, expect, vi }` from `'vitest'`; keep test
  files type-clean (they're in `typecheck`).
- **Lint is NOT a gate** — verify with typecheck + test + build.

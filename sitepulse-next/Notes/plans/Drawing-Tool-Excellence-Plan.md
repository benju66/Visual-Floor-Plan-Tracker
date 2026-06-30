# Drawing Tool Excellence — harden the polygon trace/edit interaction and raise it to pro-grade (self-contained build plan)

> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Sibling specs (context, not required reading):
> `Notes/plans/Scale-Measure-Production-Rates-Plan.md` (owns the **live-measurement**
> readout — item 5 — as its own phase; this plan deliberately does NOT),
> `Notes/plans/Robustness-Trust-Hardening-Plan.md` (same 2026-06-29 polygon-audit
> lineage; shares the "never silently lose a trace" theme and the "touch
> `FloorplanCanvas` minimally / decomposition is a separate track" rule).

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) first — especially §3
   (Map & Canvas Engine: native-event isolation, keep `FloorplanCanvas` lean), §6
   (TypeScript / JSONB-narrowing / IDB-serialization guardrails), and §9 (Vitest:
   globals OFF — import `{ describe, it, expect, vi }` from `'vitest'`; co-locate
   `*.test.ts`).
2. Re-read the files named in each phase **fresh** — do not trust line numbers
   here; they drift.
3. Build the sub-phases **in order**. Phase 1 (interaction state) is the structural
   backbone every later phase relies on — and it should land **before** the Scale
   plan adds its `'calibrate'` / `'measure'` tool modes (see "Cross-plan sequencing").
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2
   sentence plain-English summary; explain jargon in passing; keep it short.
5. Close each phase with the **`verify-feature`** skill (Definition of Done →
   STOP). Do not commit/push until the owner says "Approved."

## Goal
When this is done, tracing and adjusting a location feels like a professional
vector tool. While you're naming a freshly-traced room you can confidently nudge
its corners, drag the whole shape, undo a mis-move, and insert/remove a corner —
and **none** of those gestures can be misread as "start a new box" and silently
replace your trace (the bug class behind the node-collapse and the
vanishing-during-naming reports). Corner edits snap to walls the same way the
first trace did, and a self-overlapping ("bow-tie") shape is flagged before it
corrupts the room's square-footage.

> The **live edge-length / area readout while drawing** (originally "item 5") is
> intentionally **owned by the Scale plan** (it needs that plan's scale +
> `measure.ts`); it is NOT in this plan. See "Out of scope" + "Cross-plan sequencing".

## Out of scope / deferred
- **Live measurement readout while drawing/editing (toggleable).** Folded into
  `Scale-Measure-Production-Rates-Plan.md` as its own phase — it depends on that
  plan's `scale_units_per_px` + `measure.ts` and is meaningless before areas are
  computed correctly. Owner decision (2026-06-30).
- **Decomposing `FloorplanCanvas.tsx`** / the JS→TS migration. Same separate
  ongoing-hygiene track the Robustness plan names. This plan keeps edits to
  `FloorplanCanvas` **surgical** — a derived guard + a few wrapped call sites, not
  a restructure.
- **Touch / iPad parity for trace/edit.** Tracing is desktop-mouse-primary by
  decision (memory `nav-enhancement-desktop-only`); pointer-event parity is a
  later additive pass, not part of this plan.
- **Offline-durable pending edits.** The pending polygon is ephemeral local state
  until first save anyway; the pending-edit undo (Phase 3) is in-memory only and
  does not enter the IDB mutation queue.
- **Changing how SAVED units are edited** beyond making pending edits *match* them
  (snapping, validity). The saved-unit add-node/delete-node tools, the DB-backed
  undo stack, and the `onUpdateUnitPolygon` write path are reused, not reworked.
- **Auto-repairing self-intersections.** Phase 2 **warns** (non-blocking); it does
  not silently rewrite a user's geometry.

## Locked product decisions (from the owner, 2026-06-30)
- **Build the drawing-tool hardening FIRST**, before the Scale plan's new canvas
  tools — so `'calibrate'`/`'measure'` build on a solid interaction base.
- **Live measurement lives in the Scale plan**, not here (and must be toggleable
  off when it ships there).
- **Item 4 (insert/delete a corner during naming) is included** as the final,
  optional phase — droppable if time-constrained.
- Self-intersection handling is a **warning**, not a hard block (don't trap the
  user mid-edit).

## Cross-plan sequencing (read before scheduling work)
- **Phase 1 of THIS plan should land before Scale plan Phase 2** (adds
  `ToolMode 'calibrate'`) **and Scale plan Phase 4** (adds `ToolMode 'measure'`).
  Reason: those phases add two more canvas tools; doing them on top of today's
  implicit "the pending phase rides on `'draw'` mode" handling re-opens the exact
  gesture-overlap bug class. Phase 1 establishes the pending-edit guard the new
  modes should respect.
- When the Scale plan's live-measurement phase is built, it consumes this plan's
  cleaned-up draw/edit state; no code dependency the other way.

## Data model
**No schema changes. No migrations. No DDL.** Everything here is canvas-
interaction + pure-geometry + local UI state.
- Reads/writes the existing **`pendingPolygonPoints`** local state in
  `useMapStore` (`PercentPoint[] | null`) via `setPendingPolygonPoints` /
  `onPendingPolygonMove`. This is ephemeral pre-save geometry — **not** a DB row,
  **not** the offline `pendingChanges` buffer, **not** `status_logs`.
- Saved-unit geometry continues to persist via the existing single callback
  `onUpdateUnitPolygon` → `useMapActions.handleUpdateUnitPolygon` (which already
  pushes an `UPDATE_GEOMETRY` undo action). This plan does not change that path.
- `units.polygon_coordinates` JSONB stays narrowed at the query boundary with
  `isPercentPointArray` (§6); no `Json` into props.

## Build-on inventory (read these fresh before using)
REUSE — do not reinvent or fork:
- `src/components/FloorplanCanvas.tsx` — the shared canvas (live map + workbench).
  The load-bearing seams for Phase 1: the Stage `onPointerDown` (box-draw **arm**)
  and `onPointerUp` (box-draw **complete** → `onPolygonComplete([4 rect pts])`);
  `handleStageClick` (the `toolMode === 'draw'` branch that `setDraftPoints([...])`
  — adds a vertex); the `useEffect` keyed on `toolMode` that resets `boxOrigin` /
  draft state; `handleAnchorDragEnd` (saved-unit node move — **already snaps** via
  `getSnappedCoordinate`); `handleAddNodeToPolygon` / `handleAnchorClick`
  (saved-unit add/delete node, the pattern Phase 4 mirrors for pending). The
  box-draw `!pendingPolygonPoints` guard added on 2026-06-30 is the **seed** of
  Phase 1 — generalize it, don't leave it as a one-off.
- `src/components/canvas/PendingPolygon.tsx` — the pending polygon + its per-anchor
  drag (`onDragEnd` → `onPendingPolygonMove`, which currently does **NOT** snap)
  and whole-shape drag. The Phase 2 snapping + Phase 3 undo + Phase 4 affordances
  all attach here.
- `src/components/canvas/DraftPolygon.tsx` — the in-progress draw preview (cursor
  ghost, snap ring, confirmed draft). Reference for matching the visual language of
  any new affordance (e.g. the Phase 4 midpoint "+").
- `src/hooks/useMapActions.ts` — `handlePolygonComplete` (sets
  `pendingPolygonPoints` + opens naming), `saveNewUnitFromPopover` /
  `cancelUnitNaming` (both clear `pendingPolygonPoints` to `null`),
  `handleUpdateUnitPolygon` (saved-unit persist + undo push). The pending-edit
  undo (Phase 3) lives alongside these, isolated from the DB undo stack.
- `src/hooks/useUndoRedo.ts` — the **saved-unit** DB-backed undo/redo. It is
  explicitly disabled while `toolMode === 'draw'` and only operates on persisted
  rows. **Do not** route pending-edit undo through it — Phase 3 adds a separate,
  local, in-memory history for the not-yet-saved polygon.
- `src/store/useMapStore.ts` — `ToolMode` union + `pendingPolygonPoints` /
  `setPendingPolygonPoints`. Phase 1 decides (recommend: derived guard, NOT a new
  mode) whether to add an `'edit_pending'` `ToolMode`.
- `src/utils/geometry.ts` — `getSnappedCoordinate` (reuse for Phase 2 pending
  snapping — same call `handleAnchorDragEnd` makes), `getCentroid`, `distToSegment`
  (reuse for Phase 4 nearest-edge insert), `isFinitePolygon` (Phase 2 extends the
  validity story but does NOT replace it). Don't fork geometry.

Do **NOT** fork: `getSnappedCoordinate`, `useUndoRedo`'s saved-unit path, the
`onUpdateUnitPolygon` write path, `progressAnalytics`, the established Query hooks.

## Pure logic to extract + unit-test
Framework-free, deterministic, no I/O, **never call `Date.now()` inside**. This is
where load-bearing correctness lives — test it hard.

- **`src/utils/polygonValidity.ts`** (NEW, Phase 2):
  - `isSelfIntersecting(points: PercentPoint[]) → boolean` — true if any two
    **non-adjacent** edges of the closed polygon cross (classic segment-segment
    intersection; O(n²) is fine for the small n here). Treat the closing edge
    (last→first) as a real edge; ignore shared endpoints of adjacent edges.
  - Optional `polygonIsSimpleAndFinite(points) → boolean` — composes
    `isFinitePolygon` (from `geometry.ts`, keep it the source of truth for
    NaN/off-canvas) with `!isSelfIntersecting`. Used for the warning, never to
    block a save.
  - Test: a convex quad → not self-intersecting; a bow-tie quad → self-
    intersecting; a triangle → never self-intersecting; collinear/degenerate edge
    cases; the closing edge participates.
- **`src/utils/editHistory.ts`** (NEW, Phase 3) — a tiny pure undo/redo stack over
  `PercentPoint[][]` snapshots (NOT React, NOT DB):
  - `pushSnapshot(history, snapshot) → history'` (caps length, clears redo).
  - `undo(history) → { history', current }` / `redo(history) → { history', current }`.
  - `canUndo(history)` / `canRedo(history)`. Pure value-in/value-out; the component
    holds the history in local state and feeds `current` back to
    `setPendingPolygonPoints`. Test push/undo/redo/cap/redo-cleared-on-new-edit.
- Phase 4 reuses `distToSegment` (already in `geometry.ts`) for nearest-edge
  insertion — no new pure util required beyond a thin splice helper if useful.

## Sub-phasing (ship + verify each)

> No migrations anywhere in this plan. Each phase is one fresh session.

### Phase 1 — Interaction-state hardening (the structural backbone)
- **Plain-English:** while you're naming a freshly-traced room, the canvas should
  treat you as *editing that room* — not as still mid-draw. Today the draw tool
  stays fully live underneath the naming popover, so a corner drag or stray click
  can be misread as "draw a new box" and replace your trace. This phase makes the
  pending-edit phase its own state so that can't happen.
- **Scope:**
  - Generalize the 2026-06-30 box-draw `!pendingPolygonPoints` guard into a single
    derived **`isEditingPending` (= `!!pendingPolygonPoints`)** gate, and apply it
    consistently in `FloorplanCanvas` so **every** draw-only gesture is inert while
    a pending polygon is open: box-draw **arm** (`onPointerDown`) + **complete**
    (`onPointerUp`) [already guarded — fold into the shared gate], and the
    **add-vertex click** (`handleStageClick`'s `toolMode === 'draw'` →
    `setDraftPoints([...])` branch) so you can't start a second draft on top of the
    one being named. Node drag, whole-shape drag, flip/rotate, and naming stay
    fully live.
  - Confirm the related **node-drag ↔ box-complete race** (the intermittent
    "collapses to a 3-pt triangle" variant) is closed by the shared gate; add a
    focused note/guard if any path still arms a box during a pending node drag.
  - Make **cancel/Esc** semantics coherent for the pending phase (extend the
    existing `toolMode`-reset effect / key handling so leaving the phase clears
    `boxOrigin` and any transient draft, and Esc cancels naming predictably).
  - **In-phase decision (recommend, then proceed):** derived `isEditingPending`
    guard **(Recommended — surgical, honors the "touch `FloorplanCanvas` minimally"
    rule)** vs. a dedicated `ToolMode 'edit_pending'`. A new mode is more invasive
    and overlaps the deferred decomposition track; prefer the derived guard and
    document why.
- **Approval gates:** none (no migration/RLS/queue change). Standard: don't
  commit/push until "Approved."
- **Exit criteria:** typecheck + test + build green · **reproduce the fix in
  `dev:3010`**: trace a room, then while naming it drag a corner a long way **and**
  press-drag on empty canvas — the polygon keeps its shape (does NOT become a
  rectangle), and no second draft starts · the prior box-draw, trace, and
  whole-shape-drag flows still work with no pending polygon open · close with
  `verify-feature`.

### Phase 2 — Snapping + validity for pending edits
- **Plain-English:** make corner-dragging a not-yet-saved room behave exactly like
  editing a saved one — it snaps to walls — and flag a room that's been dragged
  into a self-overlapping "bow-tie" shape before it produces a wrong square-footage.
- **Scope:**
  - In `PendingPolygon.tsx`, run the moved anchor through the **same**
    `getSnappedCoordinate` call `handleAnchorDragEnd` uses for saved units (respect
    the snapping on/off + strength settings; reuse the existing snap ring visual
    from `DraftPolygon` if practical). Today pending node drags don't snap at all —
    this closes that inconsistency.
  - Add `src/utils/polygonValidity.ts` (+ test) and surface a **non-blocking
    warning** when the pending (or just-edited) polygon `isSelfIntersecting` — a
    small inline cue near the naming popover / a tint on the shape — so the user
    can fix it; saving is still allowed (owner decision).
- **Approval gates:** none. Standard commit/push gate.
- **Exit criteria:** typecheck + test + build green · `polygonValidity.test.ts`
  pins convex/bow-tie/triangle/closing-edge cases · `dev:3010`: drag a pending
  corner near a wall → it snaps like a saved unit; drag a corner across the shape →
  the bow-tie warning appears and clears when fixed · close with `verify-feature`.

### Phase 3 — Undo/redo for pending edits (before first save)
- **Plain-English:** one Ctrl+Z while naming a fresh room undoes the last corner
  move (or whole-shape move) — today there's no undo until after you've saved.
- **Scope:**
  - Add `src/utils/editHistory.ts` (+ test). Maintain a local, in-memory history of
    `pendingPolygonPoints` snapshots in the map surface; push a snapshot on each
    pending edit (node move, whole-shape move, flip), and bind **Ctrl+Z /
    Ctrl+Shift+Z** to `undo`/`redo` **only while a pending polygon is open**.
  - Keep it **fully isolated** from `useUndoRedo` (which is DB-backed, saved-unit
    only, and disabled in draw mode) — no DB writes, nothing enters the IDB queue.
    Clear the history when the pending polygon is saved or cancelled.
- **Approval gates:** none. Standard commit/push gate.
- **Exit criteria:** typecheck + test + build green · `editHistory.test.ts` covers
  push/undo/redo/cap + redo-cleared-on-new-edit · `dev:3010`: move a pending corner,
  Ctrl+Z restores it, Ctrl+Shift+Z re-applies; saving/cancelling clears history;
  the saved-unit DB undo still behaves as before · close with `verify-feature`.

### Phase 4 — Vertex affordances on the pending polygon (final, optional)
- **Plain-English:** while naming a fresh room you can add a corner by clicking an
  edge's midpoint "+" and remove a corner directly — the same edits you can already
  make on a saved room.
- **Scope:**
  - Render an edge-**midpoint "+"** affordance on the pending polygon (match the
    `DraftPolygon`/`PendingPolygon` visual language); clicking it inserts a vertex
    at that edge using the `distToSegment`/nearest-edge pattern from
    `handleAddNodeToPolygon`, writing back via `onPendingPolygonMove`.
  - Allow **deleting** a pending vertex (e.g. a small control or alt-click on an
    anchor), guarded so the polygon never drops below 3 points (mirror
    `handleAnchorClick`'s `<= 3` guard). All edits flow through the Phase 3 history
    so they're undoable.
- **Approval gates:** none. Standard commit/push gate. (Droppable phase.)
- **Exit criteria:** typecheck + test + build green · `dev:3010`: insert a corner
  via an edge "+", delete a corner (blocked at 3), both undoable; no regression to
  saved-unit add/delete-node · close with `verify-feature`.

## Hard guardrails (AGENTS.md — do not violate)
- **Touch `FloorplanCanvas.tsx` minimally** — a derived guard + wrapped call sites,
  not a restructure. Decomposition is a SEPARATE track (Robustness plan §out-of-
  scope). Prefer the derived `isEditingPending` gate over a new `ToolMode`.
- **No new tool mode unless justified** — if Phase 1 does add `'edit_pending'`,
  clean it up like the others (extend the `toolMode`-reset effect + cancel keys;
  don't leak draft state).
- **Pending geometry is local + ephemeral** — never route pending-edit undo or
  pending edits through `status_logs`, the `upsert_status_log` RPC, the offline
  `pendingChanges` buffer, or the IDB mutation queue. Saved-unit persistence stays
  on the existing `onUpdateUnitPolygon` path.
- **Pure fns** (`polygonValidity.ts`, `editHistory.ts`): no `Date.now()` inside;
  JSON-serializable values only; no class instances into React Query cache / IDB
  (§5/§6).
- **Types:** narrow `polygon_coordinates` with `isPercentPointArray` at the query
  boundary; no `Json` into props (§6). `database.types.ts` is hand-maintained — but
  this plan adds no columns/tables.
- **Self-intersection = warning, never a forced rewrite** of the user's geometry.
- **Vitest globals OFF** — import `{ describe, it, expect, vi }` from `'vitest'`;
  co-locate `*.test.ts`; keep test files type-clean (they're in `typecheck`).
- **Lint is NOT a gate** (~1850 pre-existing problems) — verify with typecheck +
  test + build.

## Verification commands (exit-criteria gate)
Run npm with an absolute prefix (Bash cwd persists; a stray `cd` prompts):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck   # tsc --noEmit (primary gate)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test         # vitest (one file: ... run test -- src/utils/polygonValidity.test.ts)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build         # next build (after editing live components)
```
- **No E2E** — UI/canvas verified via `npm run dev:3010` (from `sitepulse-next/`,
  port 3010, not 3000). The canvas resists scripted gestures; verify by hand, and
  (where useful) read state back from `window.Konva.stages[0]` in the console.

## Open decisions
- **Phase 1: derived guard vs. `ToolMode 'edit_pending'`** — recommend the derived
  `isEditingPending` guard (surgical); resolve at the start of Phase 1.
- **Phase 2: self-intersection cue style** — inline popover note vs. shape tint;
  low stakes, decide in-phase (recommend a shape tint + short popover note).
- **Phase 4: delete-vertex affordance** — alt-click an anchor vs. a small inline
  control; low stakes, decide in-phase.

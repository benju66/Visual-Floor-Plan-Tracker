# Kickoff — Drawing Tool Excellence, Phase 3: Undo/redo for pending edits (before first save)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3 of Drawing Tool Excellence** (undo/redo for a not-yet-saved room while you're naming it: Ctrl+Z undoes the last corner move / whole-shape move / flip, Ctrl+Shift+Z re-applies it — today there's no undo until after the room is saved). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-30 - Drawing Tool Excellence Phase 3 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Drawing-Tool-Excellence-Plan.md` (Phase 3 + "Pure logic to extract" + "Build-on inventory" + "Hard guardrails")
> - `sitepulse-next/AGENTS.md`
>
> Work on a fresh **`feat/drawing-tool-excellence-phase-3`** branch cut off `main` (which carries the merged Phase 1 `isEditingPending` gate — PR #9 — and the merged Phase 2 pending snapping + self-intersection warning — PR #10, merge `7e7a08a`). Build **only Phase 3**: (1) add `src/utils/editHistory.ts` (+ test) — a tiny pure undo/redo stack over `PercentPoint[][]` snapshots, and (2) hold a local, in-memory history of the pending polygon in `FloorplanCanvas`, push a snapshot on each pending edit, and bind Ctrl+Z / Ctrl+Shift+Z to undo/redo **only while a pending polygon is open**. No migration. Keep it fully isolated from the DB-backed `useUndoRedo`. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English summary
While you're naming a freshly-traced room, you can nudge corners, drag the whole
shape, and flip it — but there's no way to take back a mis-move until after you
save (and only then via the saved-unit undo). This phase gives the not-yet-saved
room its own undo: **Ctrl+Z** steps back through your pending edits, **Ctrl+Shift+Z**
re-applies them. It's a small in-memory history that lives only as long as the
naming session — when you save or cancel, it's gone. It never touches the
database or the offline save queue.

## Why this phase exists / what's true right now
- **No undo for pending edits.** Every pending mutation funnels through the single
  `onPendingPolygonMove` callback — the node `onDragEnd` and the whole-shape
  `onDragEnd` in `src/components/canvas/PendingPolygon.tsx`, and the **pending
  branch of `handleFlip`** in `FloorplanCanvas.tsx` (it early-returns through
  `onPendingPolygonMove` when `pendingPolygonPoints` is set). There is currently
  **no history** behind that callback, so a corner you dragged wrong is gone.
- **`onPendingPolygonMove` is the one interception point.** Because all three edit
  paths go through it, wrapping it in `FloorplanCanvas` (push the *previous*
  pending points onto an undo stack, then call the prop with the new points) gives
  a complete, single-seam history with no per-gesture plumbing.
- **The pending state is owned by the parent; `FloorplanCanvas` is the shared
  surface.** `pendingPolygonPoints` + `onPendingPolygonMove` arrive as **props**.
  The live map owns them via `useMapActions`/`useMapStore` (`page.jsx`); the
  workbench owns them via `useWorkbenchActions`/`useWorkbenchStore`
  (`WorkbenchTracer.tsx`). Implement the history **inside `FloorplanCanvas`** so
  **one** implementation covers both consumers — don't fork it into each parent.
- **The keydown handler already owns a Ctrl/Cmd+Z branch.** In `FloorplanCanvas`'s
  window `handleKeyDown` (registered with `capture: true`), `(metaKey||ctrlKey) +
  'z'` currently undoes the last **draft vertex** while `toolMode === 'draw'` and
  draft points exist. Add a **pending-edit** undo/redo branch in that same handler,
  gated on `isEditingPendingRef.current`, taking priority when a pending polygon is
  open. There is **no Ctrl+Shift+Z (redo) binding here yet** — add it.
- **`isEditingPending` already exists** (Phase 1, `= !!pendingPolygonPoints`, with a
  fresh `isEditingPendingRef`). Reuse it as the gate; do **not** add a new ToolMode.
- **`useUndoRedo` is a different animal — stay isolated.** It is **DB-backed,
  saved-unit only, and disabled in draw mode**, wired in the parent (not here). The
  pending-edit history must be **separate, local, in-memory** — no DB writes,
  nothing enters the IDB mutation queue, and it must not route through
  `useUndoRedo`, `status_logs`, or the offline `pendingChanges` buffer.
- **Save/cancel must clear the history.** `saveNewUnitFromPopover` and
  `cancelUnitNaming` (live map) — and the workbench equivalents — both set
  `pendingPolygonPoints` back to `null`. Clear the history when the pending polygon
  goes away (e.g. a `useEffect` keyed on `isEditingPending` going false), so a new
  trace starts with a clean stack.

## Required reading (in order)
1. `sitepulse-next/AGENTS.md` — esp. §2/§3 (pending geometry is local/ephemeral;
   never route it through `status_logs`, the `pendingChanges` buffer, or the IDB
   queue; keep `FloorplanCanvas` lean), §6 (TS/JSONB/IDB-serialization guardrails),
   §9 (Vitest: globals OFF — import `{ describe, it, expect, vi }` from `'vitest'`;
   co-locate `*.test.ts`).
2. `sitepulse-next/Notes/plans/Drawing-Tool-Excellence-Plan.md` — **Phase 3**, plus
   "Pure logic to extract + unit-test" (the `editHistory.ts` shape), "Build-on
   inventory", and "Hard guardrails".
3. The current source, read FRESH (line numbers drift):
   - `src/components/canvas/PendingPolygon.tsx` — the node `onDragEnd` + whole-shape
     `onDragEnd` that call `onPendingPolygonMove` (post-Phase-2: anchors snap, the
     shape tints amber when self-intersecting). The edits Phase 3 records.
   - `src/components/FloorplanCanvas.tsx` — where `onPendingPolygonMove` is received
     and passed to `<PendingPolygon>`; the **pending branch of `handleFlip`**; the
     `handleKeyDown` Ctrl+Z branch + `isEditingPending`/`isEditingPendingRef`; the
     `pendingSelfIntersects` memo (Phase 2 — leave intact).
   - `src/hooks/useMapActions.ts` — `handlePolygonComplete` (opens the pending
     polygon), `saveNewUnitFromPopover` / `cancelUnitNaming` (clear it to `null`).
   - `src/hooks/useUndoRedo.ts` — the saved-unit DB undo to stay **isolated** from.
   - `src/store/useMapStore.ts` — `pendingPolygonPoints` / `setPendingPolygonPoints`.
   - `src/utils/geometry.ts` — `isFinitePolygon` (reuse if you guard snapshots) and
     `src/utils/polygonValidity.ts` (Phase 2 — exists; don't duplicate). An existing
     pure-util test (e.g. `src/utils/pendingChangesStore.test.ts` or
     `src/utils/polygonValidity.test.ts`) for the Vitest house style.

## Scope (build ONLY this)
1. **Add `src/utils/editHistory.ts` (+ `editHistory.test.ts`)** — a tiny pure
   undo/redo stack over `PercentPoint[][]` snapshots (NOT React, NOT DB):
   - `pushSnapshot(history, snapshot) → history'` — appends, **caps length** (pick a
     cap, ~50), and **clears the redo branch**.
   - `undo(history) → { history, current }` / `redo(history) → { history, current }`
     — move the cursor, return the new history + the snapshot to apply.
   - `canUndo(history)` / `canRedo(history)`.
   - Pure value-in/value-out; no `Date.now()`, no I/O, JSON-serializable. Decide the
     `EditHistory` shape (e.g. `{ snapshots: PercentPoint[][]; cursor: number }`).
   - Tests pin: push grows; undo then redo round-trips; **cap** drops the oldest;
     **a new push after an undo clears the redo branch**; undo/redo at the ends are
     safe no-ops; `canUndo`/`canRedo` boundaries.
2. **Wire the history into `FloorplanCanvas`** (the shared surface):
   - Hold the history in local component state/ref. **Seed** it with the initial
     pending polygon when a trace opens (so the first Ctrl+Z returns to the original
     traced shape).
   - Wrap `onPendingPolygonMove`: on each pending edit push the **previous** points,
     then call the prop with the new points (so undo restores the pre-edit shape).
   - In `handleKeyDown`, add a branch gated on `isEditingPendingRef.current`:
     **Ctrl/Cmd+Z** → `undo` and feed `current` back via `onPendingPolygonMove`;
     **Ctrl/Cmd+Shift+Z** → `redo` likewise. `preventDefault` +
     `stopImmediatePropagation` so it doesn't also trip the draft-vertex undo or the
     parent's saved-unit `useUndoRedo`. Skip when a text input is focused.
   - **Clear** the history when `isEditingPending` goes false (save/cancel).
3. **Do not change** saved-unit editing, the `onUpdateUnitPolygon` write path, the
   DB-backed `useUndoRedo`, the Phase 1 `isEditingPending` gate, or the Phase 2
   snapping/validity. No new tool mode. No migration.

## In-phase decisions (recommend, then proceed)
- **Where the history lives** — recommend **`FloorplanCanvas` local state**
  (covers both consumers with one implementation; honors "touch `FloorplanCanvas`
  minimally" — a wrapped call site + a keydown branch, not a restructure). Avoid a
  new Zustand slice or threading it through both parents.
- **Apply-back during a live drag** — push on edit *commit* (`onDragEnd`/flip),
  not on every `onDragMove` frame, so one gesture = one undo step.

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
- `editHistory.test.ts` pins push / undo / redo / **cap** / **redo-cleared-on-new-edit**
  / boundary no-ops.
- **Live `dev:3010` click-through (the real proof):** trace a room, then while
  naming it — move a corner, **Ctrl+Z** restores it, **Ctrl+Shift+Z** re-applies;
  a whole-shape drag and a flip are each undoable as one step; saving or cancelling
  clears the history (a fresh trace starts with nothing to undo); the **saved-unit
  DB undo still behaves as before** (Ctrl+Z on a selected saved unit is unaffected).
  - The canvas resists scripted gestures; verify by hand.
- Close the phase with the **`verify-feature`** skill (Definition of Done → STOP).
  Then draft the **Phase 4 kickoff** (optional final phase — vertex insert/delete
  affordances on the pending polygon) per the post-approval ritual.

## Guardrails specific to this phase
- **Reuse, don't fork:** the existing `onPendingPolygonMove` seam, `isEditingPending`
  gate, and the `handleKeyDown` Ctrl+Z branch. Don't reinvent a parallel edit path.
- **Stay isolated from `useUndoRedo`** — pending-edit undo is separate, local,
  in-memory. No DB writes; nothing enters the IDB mutation queue; no `status_logs`,
  no `pendingChanges` buffer.
- **Touch `FloorplanCanvas.tsx` minimally** — a wrapped call site + a keydown branch
  + a clear-on-exit effect. Decomposition stays a separate track.
- **Pure util discipline** (`editHistory.ts`): framework-free, deterministic, no
  `Date.now()`, JSON-serializable values only (§5/§6).
- **Vitest globals OFF** — import `{ describe, it, expect, vi }` from `'vitest'`;
  keep test files type-clean (they're in `typecheck`).
- **Lint is NOT a gate** — verify with typecheck + test + build.

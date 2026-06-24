# Kickoff — Look-Ahead UI Convergence, Phase 6b: long-press menus + pointer row-reorder

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 6b of Look-Ahead UI Convergence** (the second / final *interaction* phase):
> make the two remaining mouse-only affordances work by finger — (1) replace the right-click
> (`onContextMenu`) cell **and** row menus with a **long-press** on touch while keeping right-click
> on desktop, and (2) replace the HTML5 `draggable` row reorder (which doesn't fire on touch) with a
> **pointer-based** reorder driven by the existing grip handle + `dropTarget` store state — for both
> mouse and finger. Reuse the pure `classifyPointerGesture` (`lib/gesture.ts`, already returns
> `'longpress'`) and the existing store actions (`openCellMenu`/`openRowMenu`, `setDragging`/
> `setDropTarget`/`moveRow`/`groupDrop`/`clearDrag`). **Desktop mouse + keyboard behaviour stays
> byte-identical.** Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-24 - Lookahead UI Convergence Phase 6b Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Lookahead-UI-Convergence-Plan.md` (§"Phase 6b" + §"Open decisions")
> - `sitepulse-next/AGENTS.md`
>
> Branch off `feat/lookahead-ui-convergence-phase-6a` (commit `e4d36bf`) so you inherit the whole
> Pointer-Event interaction model from 6a. Build **only Phase 6b**. The saved plan document must stay
> byte-identical (`projectBlob` unchanged) and don't disturb the autosave seam in
> `LookaheadWorkspace.tsx`. Don't commit or push until I say "Approved."

---

## Context for the session

This is the **seventh** phase (the last of two interaction phases) of converging the absorbed
Look-Ahead view (`src/lookahead/**`) onto SitePulse's design system. **Phases 1–6a are done** (all on
stacked branches, none merged to `main`):
- **Phases 1–5** — visual foundation, one-header glass chrome, chrome→Tailwind, settings/modals→
  Tailwind, responsive iPad layout (pure look + layout, no interaction change).
- **Phase 6a** (`e4d36bf`): **Pointer-Event migration** — the grid's document-level + per-cell mouse
  handlers became `pointerdown`/`pointermove`/`pointerup` (+`pointercancel`), with `setPointerCapture`
  for finger/pen, `data-rowid`/`data-di` + `elementFromPoint` hit-testing, `touch-action: none` on
  cells, and a pure, unit-tested `classifyPointerGesture`. **Tap cycles, finger drag-fills, finger
  marquee-selects, finger column-resizes** — and desktop stayed byte-identical.

6a deliberately left **two** affordances mouse-only because they need their own designs (this phase):
1. **Menus** open on `onContextMenu` (right-click) — touch has no right-click.
2. **Row reorder** uses native HTML5 `draggable` (`onDragStart`/`onRowDragOver`/`onRowDrop` + group
   variants) — HTML5 drag-and-drop does **not** fire on touch.

### Required reading (in full, before editing)
1. `sitepulse-next/AGENTS.md` — esp. §0 (plain English to the owner), §2 (autosave seam /
   `projectBlob` isolation), §3 (native-isolation / `addEventListener` + `overscroll-contain`),
   §6 (TS — type Pointer Events properly, no `any`).
2. `sitepulse-next/Notes/plans/Lookahead-UI-Convergence-Plan.md` — §"Phase 6b", §"Open decisions"
   (the row-reorder affordance recommendation).
3. The real files fresh (line numbers drift): `src/lookahead/components/LookAhead.tsx` (the whole 6a
   pointer model), `src/lookahead/lib/gesture.ts` (the classifier — `'longpress'` already defined +
   tested), `src/lookahead/store/useStore.ts` (`openCellMenu`/`openRowMenu`/`closeCellMenu`/
   `closeRowMenu`, `setDragging`/`setDropTarget`/`clearDrag`/`moveRow`/`groupDrop`, `dropTarget`,
   `draggingRowId`), `src/lookahead/components/Menus.tsx` (how the cell + row menus render),
   and `LookaheadWorkspace.tsx` (autosave seam — **do not disturb**).

## The two builds (read the real files fresh)

### 1. Long-press → menus (touch), right-click → menus (desktop, unchanged)
- **Mechanism:** on `pointerdown` (cell drag start in `cellDown`, and the row grip — see #2), arm a
  **long-press timer** (`setTimeout`, `LA_LONGPRESS_MS` = 500ms, already a constant in 6a). On
  `pointermove` past the slop threshold → it became a drag → **clear the timer** (movement wins, per
  `classifyPointerGesture`). On `pointerup` before it fires → **clear the timer** (it was a tap). If
  the timer **fires** (finger still within slop after 500ms) → open the menu at the touch point and
  cancel the pending drag (`dragRef = null`) so the finger-up doesn't also cycle.
  - **Cell long-press** → `openCellMenu(rowId, di, clientX, clientY)` (same store action
    `onContextMenu` uses today).
  - **Row long-press** → `openRowMenu(rowId, clientX, clientY)` — most naturally armed from the row
    **grip** (the `GripVertical` span), so a long-press on the grip opens the row menu on touch.
  - **Desktop:** leave `onContextMenu={cellContext}` exactly as-is (right-click still opens the cell
    menu); the `…` (MoreHorizontal) button still opens the row menu by click. Long-press is **touch
    only** — only arm/fire the timer for `pointerType !== "mouse"` (a mouse uses right-click / the `…`
    button), so desktop is byte-identical.
- **`pointerType` gate** keeps the model unforked: one pointer pipeline, the long-press timer simply
  isn't armed for a mouse.
- **Suppress the synthetic context menu on touch** if the browser would emit one after a long-press
  (call `preventDefault` on the `contextmenu` event for touch, or guard `cellContext` so a touch-
  driven contextmenu doesn't double-open). Verify no double menu on a real device.

### 2. Pointer-based row reorder (replaces HTML5 `draggable`, works on mouse + finger)
- **Remove** the HTML5 DnD path: `draggable`, `onDragStart`, `onRowDragOver`, `onRowDrop`,
  `onGroupDragOver`, `onGroupDrop`, `onDragEnd`. Replace with a **pointer drag** started from the
  **grip** (`GripVertical`): `onPointerDown` on the grip → `setDragging(rowId)` + `setPointerCapture`;
  document `pointermove` → hit-test the row under the finger (`elementFromPoint` + a row `data-*`
  attr, mirroring 6a's cell hit-test) and compute above/below from the pointer's Y vs the row's mid-
  line → `setDropTarget({ rowId, pos })` (or `{ groupId }` over a group header); `pointerup` →
  `moveRow(src, target, pos==="below"?1:0)` or `groupDrop(gid, src)`, then `clearDrag()`.
- **Reuse the existing store state** — `draggingRowId`, `dropTarget`, `moveRow`, `groupDrop`,
  `clearDrag` are all already there; the drop-edge highlight (`edgeTop`/`edgeBot` + group highlight)
  already renders from `dropTarget`, so the visual feedback is free once you set it via pointer.
- Add **`data-rowid` (and a group marker) to the row `<tr>`** (or a stable child) so the reorder hit-
  test is cheap + robust, the same pattern 6a added to cells.
- **Grip is grab-only:** keep `touch-action: none` on the grip so a finger drag there reorders
  instead of scrolling (the rest of the task column still scrolls — don't regress Phase-5 scroll).
- **Mouse parity:** the grip drag must feel the same on desktop as the old HTML5 drag (drop above/
  below, drop into an empty group). Verify a mouse reorder explicitly.

## Open decisions (resolve with the owner at kickoff)
- **Long-press timing** — 6a set `LA_LONGPRESS_MS = 500` (iOS/Android default). Confirm 500ms feels
  right for opening a menu, or tune.
- **Row-reorder affordance on touch** — the plan recommends the **explicit grip handle** (already
  present) rather than long-press-anywhere-then-drag, specifically to avoid colliding with the new
  long-press-opens-menu. Confirm grip-only.
- **What long-press targets** — cell long-press → cell menu is clear. For the row menu, confirm it's
  the **grip** long-press (vs the whole task cell), so it doesn't fight the cell long-press.

## Hard guardrails for this phase
- **`projectBlob` stays `{ project, areas, areaOrder, currentAreaId }`.** No data-model change; don't
  disturb the autosave seam in `LookaheadWorkspace.tsx`.
- **Desktop parity is the acceptance bar.** Right-click cell menu, the `…` row menu, **mouse** row
  reorder (drop above/below + into a group), all keyboard nav, cycle/marquee/fill/resize must behave
  exactly as in 6a. Verify desktop explicitly.
- **One pointer pipeline, no fork.** Gate long-press on `pointerType !== "mouse"`; don't add parallel
  `touchstart`/`touchmove` handlers.
- **Touch only the lookahead module.** Do **NOT** edit `TopHeader.tsx` or any other view.
- **Keep the print path intact** (`no-print`, the 11×17 `@page`/print rules in `lookahead.css`).
- **TypeScript (§6):** no `any`; type Pointer Events properly; any new pure helper is unit-tested
  (Vitest globals OFF — import from `'vitest'`).
- **Lint is not a gate** — verify with typecheck + test + build.

## Exit criteria (Definition of Done → then STOP)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test` green
  (don't regress the 394 existing; add tests for any new pure logic).
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build` green.
- Live `npm run dev:3010`, open a project → Look-Ahead, in light and dark:
  - **Touch (DevTools touch emulation + a real iPad if available):** long-press a cell opens the cell
    menu; long-press the row grip opens the row menu; a quick finger drag on a cell still marquees
    (long-press didn't steal it); drag the grip reorders the row (above/below + into a group).
  - **Desktop mouse (≥1280px):** right-click still opens the cell menu, the `…` button still opens
    the row menu, mouse grip-drag reorders rows, and **all** 6a behaviour (cycle / marquee / fill /
    resize / keyboard / double-click edit) is unchanged — spot-check each.
  - No spurious autosave / `projectBlob` unchanged; no double context menus on touch; no console
    errors from the module.
- Close the phase with the **`verify-feature`** skill (its Definition of Done / merge gate).
- **Do not commit or push until the owner says "Approved."**

## Notes / gotchas
- **Browser verification quirk:** a dev server is usually already on `:3010`; CDP screenshots + real
  trusted clicks are flaky on this heavy page — probe layout/state + dispatch **synthetic pointer
  events** via JS (as 6a did), and use DevTools touch emulation + a real iPad for the gesture paths.
- **Long-press vs marquee collision** is the crux: the long-press timer and the 6a drag-start share
  one `pointerdown`. Movement past slop must cancel the long-press (drag wins); the long-press firing
  must cancel the pending drag (so finger-up doesn't cycle). `classifyPointerGesture` already encodes
  that precedence — lean on it.
- **This is the LAST interaction phase.** After 6b, the Look-Ahead view is fully finger-capable;
  what remains is whatever cross-phase polish/merge the owner wants (the convergence stack 1–6b is
  still unmerged to `main`).
- **Branch off `feat/lookahead-ui-convergence-phase-6a` (`e4d36bf`); do not commit or push until the
  owner says "Approved."**

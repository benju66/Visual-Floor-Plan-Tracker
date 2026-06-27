# Kickoff — Look-Ahead UI Convergence, Phase 6a: Pointer-Event migration + touch tap / drag-fill / marquee

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 6a of Look-Ahead UI Convergence** (the first *interaction* phase): migrate the
> grid's mouse-only model in `LookAhead.tsx` to **Pointer Events** so finger gestures match mouse
> gestures — **tap a cell → cycle status, finger-drag the fill handle → fill, finger-drag → marquee
> select** — while **desktop mouse/keyboard behavior stays byte-identical**. Extract a pure,
> unit-tested `classifyPointerGesture` (`lib/gesture.ts`). This is the **riskiest phase** — verify
> desktop parity explicitly. Long-press menus + touch row-reorder are **Phase 6b** (do not start
> them). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-24 - Lookahead UI Convergence Phase 6a Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Lookahead-UI-Convergence-Plan.md` (Phase 6a + Open decisions + "Pure logic to extract")
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main` (a fresh branch). **If Phases 1–5 haven't been merged to `main` yet, branch off
> `feat/lookahead-ui-convergence-phase-5` (commit `91f6585`) instead** so you inherit the slate
> palette / blue accent / app fonts / theme bridge (Phase 1), the one-header + glass chrome (Phase 2),
> the inline→Tailwind chrome reskin (Phase 3), the settings drawer & roll modal reskin (Phase 4), and
> the responsive iPad layout (Phase 5). Build **only Phase 6a**. The saved plan document must stay
> byte-identical (`projectBlob` unchanged) and don't disturb the autosave seam in `LookaheadWorkspace.tsx`.
> Don't commit or push until I say "Approved."

---

## Context for the session

This is the **sixth** phase (the first of two interaction phases) of converging an absorbed view
(`src/lookahead/**`) onto SitePulse's design system. **Phases 1–5 are done** (all on stacked
branches, none merged to `main`):
- **Phase 1** (`3da93e0`): slate palette, blue accent, Outfit/Roboto Mono fonts, theme bridge.
- **Phase 2** (`eccd0b4`): one app header — thin glass context strip + glass `Toolbar`.
- **Phase 3** (`995f2c2`): chrome inline→Tailwind; `rectSelection` extracted to `lib/selection.ts`.
- **Phase 4** (`8ad6809`): settings drawer + roll modal inline→Tailwind.
- **Phase 5** (`91f6585`): **responsive/iPad layout** — render-only week-window clamp
  (`effectiveWeeks` in `lib/view.ts`), capped sticky columns on narrow, `overscroll-contain` +
  momentum, `lg`/`xl` graceful-wrap + tap targets. **Pure CSS/layout — no interaction change.**

Phases 1–5 were **look + layout**: the view now matches the app and fits an iPad, **but it is still
mouse-only** — every gesture (cycle a cell, drag-to-fill, marquee-select) is wired to **mouse
events**, which **do not fire on touch**. Phase 6a is where the grid finally **works by finger**.
This is the locked owner decision: **full touch parity via a Pointer-Event rework**, not a
touch-events bolt-on.

### Why Pointer Events (the strategy)
`PointerEvent` unifies mouse + touch + pen into one event stream. Migrating the existing mouse
handlers to `pointerdown`/`pointermove`/`pointerup` means **desktop keeps working through the exact
same code path** (a mouse is just `pointerType: "mouse"`), while a finger now drives the same logic.
The alternative — adding parallel `touchstart`/`touchmove` handlers — would fork the interaction
model and rot. Don't do that.

### The interaction model TODAY (read `LookAhead.tsx` fresh — line numbers drift)
The whole model lives in `src/lookahead/components/LookAhead.tsx`:
- **One document-level effect** (attached once on mount) adds `mouseup` (`onUp`), `mousemove`
  (`onMove`), and `keydown` (`onKey`). `onUp` resolves three things off refs: a **fill** commit
  (`fillRef`), a **column-resize** end (`resizeRef`), or a **click-vs-drag** decision (`dragRef`:
  if `!moved && wasFocused && detail===1` → `cycleCell`). `onMove` tracks **column resize** only.
  **`onKey` is keyboard — leave it entirely alone** (desktop-only; no touch equivalent in 6a).
- **Per-cell handlers:** `cellDown` (`onMouseDown`) starts a drag/selection/shift-extend and sets
  `dragRef`; `cellEnter` (`onMouseEnter`) grows the marquee/fill rectangle while a button is held;
  `fillDown` (`onMouseDown` on the 7×7 fill-handle `<span>`) arms `fillRef`; `cellContext`
  (`onContextMenu`) opens the cell menu; double-click (`onDoubleClick`) starts text edit.
- **Column resize:** `onResizeStart` (`onMouseDown` on the corner `<span>` handle) arms `resizeRef`;
  tracked in the document `onMove`, committed in `onUp` (`persistTaskColW`).
- **Row reorder:** native HTML5 `draggable` (`onDragStart`/`onRowDragOver`/`onRowDrop` +
  group variants). **This is Phase 6b — do NOT touch it in 6a** (HTML5 DnD doesn't fire on touch,
  but its replacement is 6b's job).
- Refs: `dragRef` (start row/di, `moved`, `wasFocused`, `detail`), `fillRef` (origin + status),
  `resizeRef` (startX/startW). `rowOrderRef` / `visColsRef` mirror the current render order.

### The load-bearing touch problem (design note — solve it here)
With **mouse**, marquee/fill drag relies on `onMouseEnter` firing on each cell the cursor passes
over while the button is held. With **touch + `setPointerCapture`**, *all* `pointermove` events are
delivered to the **origin** element — `pointerenter` does **not** fire on the cells under the moving
finger. So the drag-select/fill loop must **hit-test the finger position itself**:
- On `pointermove` during a drag, call `document.elementFromPoint(e.clientX, e.clientY)`, find the
  enclosing cell, and read its **row id + day index** to extend the rectangle (reuse the extracted
  `rectSelection` from `lib/selection.ts`).
- To make that hit-test cheap and robust, add **`data-rowid` / `data-di` attributes** to each grid
  `<td>` (and read them back), rather than re-deriving from DOM structure.
- Use `setPointerCapture(e.pointerId)` on `pointerdown` so the drag keeps tracking even if the finger
  leaves the origin cell, and release it on `pointerup`.

### What "tap vs drag" means (the pure classifier)
Extract `src/lookahead/lib/gesture.ts` — `classifyPointerGesture({ downAt, upAt, dx, dy, longPressMs,
moveThresholdPx })` → `'tap' | 'drag' | 'longpress'` (PURE; pass timestamps **in**, never call
`Date.now()` inside; co-located `gesture.test.ts`, Vitest globals OFF). 6a consumes **tap** (→ cycle
status) and **drag** (→ marquee/fill, past `moveThresholdPx`, e.g. ~6px). Define `'longpress'` now
(the boundary math is cheap to test) but **wire it in 6b** — 6a does not open menus on long-press.

### Tap targets / `touch-action`
- Add `touch-action: none` to grid **cells** so a finger drag that starts on a cell does
  **fill/marquee** instead of scrolling. **Do NOT** put `touch-action: none` on `#la-scroll` itself —
  that would kill the Phase-5 finger-scroll. (See Open decisions: how the user scrolls the grid on
  touch once cells capture drags is a real UX call — confirm with the owner.)
- **Enlarge the fill-handle hit area for fingers** (the 7×7 `<span>` is mouse-precise) — e.g. a
  larger transparent hit box / responsive sizing behind a touch breakpoint, without moving the
  visible 7×7 dot. (Phase 5 deliberately left this for 6a.)

### What to convert / touch (read the real files fresh)
1. **`src/lookahead/components/LookAhead.tsx`** — migrate the document `mouseup`/`mousemove` → pointer
   equivalents; per-cell `onMouseDown`/`onMouseEnter` → `onPointerDown` + pointer-move hit-testing;
   `fillDown` + `onResizeStart` → pointer; add `setPointerCapture`, `data-rowid`/`data-di`, the
   gesture classifier, and the enlarged fill-handle hit area. **Leave `onKey`, the HTML5 row-reorder,
   `onContextMenu`, and double-click-to-edit exactly as they are.**
2. **`src/lookahead/lib/gesture.ts`** (new) + **`gesture.test.ts`** — the pure tap/drag/longpress classifier.
3. **`src/lookahead/components/lookahead.css`** — only if `touch-action`/hit-area is genuinely cleaner
   as a namespaced `.la-*` rule than a Tailwind class (prefer Tailwind). **Keep the 11×17 print block
   + `.la-*` hover rules intact.**
4. Reuse `src/lookahead/lib/selection.ts` (`rectSelection`) — don't fork the rectangle math.

### Required reading (in full, before editing)
1. `sitepulse-next/AGENTS.md` — esp. §0 (plain English to the owner), §2 (autosave seam / `projectBlob`),
   §3 (native-isolation / `addEventListener` + `overscroll-contain` pattern), §6 (TS — type Pointer
   Events properly, no `any`).
2. `sitepulse-next/Notes/plans/Lookahead-UI-Convergence-Plan.md` — §"Phase 6a", §"Pure logic to
   extract + unit-test", §"Open decisions".
3. The real files above + `LookaheadWorkspace.tsx` (autosave seam — **don't disturb**) and
   `TopHeader.tsx` (`hidden md:flex` toggle — **read only; do not edit**).

### Scope (Phase 6a only)
1. Pointer-event migration of the document-level + per-cell mouse handlers (mouse path unchanged).
2. `classifyPointerGesture` extracted, typed, unit-tested.
3. Touch: **tap cycles**, **finger drag-fills** (from the handle), **finger marquee selects** (via
   `pointermove` + `elementFromPoint` hit-test); `touch-action: none` on cells; enlarged fill handle.
4. Column-resize works by finger (pointer-driven `resizeRef`).
5. Confirm **desktop mouse + keyboard behavior is byte-identical** to Phase 5.

### Open decisions (resolve with the owner at kickoff)
- **Grid scroll vs drag on touch.** If cells are `touch-action: none`, a finger drag on a cell =
  marquee/fill, so **how does the user scroll the dense grid?** Options: (a) scroll via the sticky
  task column / header / margins (which keep default `touch-action`) + momentum; (b) require a brief
  hold before a drag becomes a marquee (so a quick drag scrolls); (c) two-finger pan. **Recommend
  (a)** for 6a (simplest, keeps the Phase-5 scroll) and revisit if it feels cramped. Confirm.
- **Move threshold + long-press timing** for `classifyPointerGesture` (e.g. `moveThresholdPx ≈ 6`,
  `longPressMs ≈ 450`). Confirm the numbers (longpress is defined now, used in 6b).
- **Fill-handle finger target size** — how big a transparent hit box around the 7×7 dot.

### Hard guardrails for this phase
- **`projectBlob` stays `{ project, areas, areaOrder, currentAreaId }`.** No data-model change; don't
  disturb the autosave seam in `LookaheadWorkspace.tsx`. (Status cycling/fill already write through
  the existing store mutations — keep using them; don't add new persisted fields.)
- **Desktop parity is the acceptance bar.** Mouse cycle/marquee/fill/resize, right-click menus,
  double-click edit, all keyboard nav, and the HTML5 row reorder must behave **exactly** as in Phase
  5. Verify desktop explicitly (this is the riskiest phase).
- **No Phase-6b work.** Do NOT convert `onContextMenu` to long-press, and do NOT replace the HTML5
  `draggable` row reorder — both are 6b.
- **Touch only the lookahead module.** Do **NOT** edit `TopHeader.tsx` or any other view.
- **Keep the print path intact** (`no-print`, the 11×17 `@page`/print rules in `lookahead.css`).
- **TypeScript (§6):** no `any`; type `PointerEvent`/`React.PointerEvent` properly; the gesture helper
  is pure + typed + unit-tested (Vitest globals OFF — import from `'vitest'`).
- **Lint is not a gate** — verify with typecheck + test + build.

### Exit criteria (Definition of Done → then STOP)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test` green
  (add `gesture.test.ts`; don't regress the 386 existing).
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build` green.
- Live `npm run dev:3010`, open a project → Look-Ahead view, in light and dark:
  - **Touch (DevTools touch emulation + a real iPad if available):** a tap cycles a cell's status; a
    finger drag from the fill handle fills the rectangle; a finger drag marquee-selects; status keys
    still apply to the selection; column resize works by finger.
  - **Desktop mouse (≥1280px):** click-to-cycle, shift-click + drag marquee, fill-handle drag,
    right-click menus, double-click edit, column resize, and keyboard nav are **all unchanged** vs
    Phase 5 — spot-check each.
  - No spurious autosave / `projectBlob` unchanged shape; no console errors from the module (the
    Next.js `react-server-dom` "negative time stamp" dev exception is framework noise, not ours).
- Close the phase with the **`verify-feature`** skill (its Definition of Done / merge gate).
- **Do not commit or push until the owner says "Approved."**

### Notes / gotchas
- **Browser verification quirk:** a dev server is usually already on `:3010`; CDP screenshots time
  out on this page and the automation window won't shrink below ~1404px — probe layout/computed
  styles + dispatch synthetic pointer events via JS, and use DevTools touch emulation for the gesture
  paths (as Phases 3–5 did for their probes).
- **`elementFromPoint` + `data-rowid`/`data-di`** is the crux — without it, touch marquee/fill can't
  know which cell the finger is over (pointer capture routes all moves to the origin). Get this right
  first; the rest follows.
- **Don't regress Phase 5's finger-scroll.** `touch-action: none` belongs on **cells**, never on
  `#la-scroll`.
- **This is the first of two interaction phases.** Phase 6b (long-press cell/row menus + pointer-based
  row reorder replacing HTML5 `draggable`) is the remaining touch work — do **not** pull it forward.
- **Branch off `main` (or `feat/lookahead-ui-convergence-phase-5` `91f6585` if 1–5 aren't merged);
  do not commit or push until the owner says "Approved."**

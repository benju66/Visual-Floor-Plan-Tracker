# Kickoff — Look-Ahead UI Convergence, Phase 5: Responsive layout (iPad fit, no new gestures)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 5 of Look-Ahead UI Convergence** (make the view **fit and read well on an iPad /
> tablet viewport** — header strip + week toolbar wrap gracefully, sticky task/sub columns size for
> narrow, the week window adapts to portrait, tap targets enlarge, grid scrolling gets momentum +
> overscroll-containment). **Pure CSS/layout responsiveness — NO interaction/gesture changes** (the
> mouse/pointer model stays exactly as today; touch gestures are Phase 6). Read these in full, then
> follow them:
> - `sitepulse-next/Notes/handoff/2026-06-24 - Lookahead UI Convergence Phase 5 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Lookahead-UI-Convergence-Plan.md` (Phase 5 + Open decisions)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main` (a fresh branch). **If Phases 1–4 haven't been merged to `main` yet, branch off
> `feat/lookahead-ui-convergence-phase-4` (commit `8ad6809`) instead** so you inherit the slate
> palette / blue accent / app fonts / theme bridge (Phase 1), the one-header + glass chrome (Phase 2),
> and the full inline→Tailwind reskin of the chrome (Phase 3) + settings drawer & roll modal (Phase 4).
> Build **only Phase 5**. The saved plan document must stay byte-identical (`projectBlob` unchanged) —
> in particular the responsive week-window must **not** write `view.numWeeks` — and don't disturb the
> autosave seam in `LookaheadWorkspace.tsx`. Don't commit or push until I say "Approved."

---

## Context for the session

This is the **fifth** phase of converging an absorbed view (`src/lookahead/**`) onto SitePulse's
design system. **Phases 1–4 are done** (all on stacked branches, none merged to `main`):
- **Phase 1** (`3da93e0`): slate palette, blue accent (`#2563eb`), Outfit / Roboto Mono fonts, the
  theme bridge (the view follows the app's `[data-theme]`), in-drawer Light/Dark toggle removed.
- **Phase 2** (`eccd0b4`): one app header — `Header.tsx` collapsed to a thin glass context strip; the
  strip + week `Toolbar` got `.glass-panel rounded-xl` outer containers.
- **Phase 3** (`995f2c2`): the chrome's inner controls (`Header`, `Toolbar`, `ActionBars`, `Menus`,
  `AreaSwitcher`) converted inline→Tailwind; `rectSelection` extracted to a tested `lib/selection.ts`.
- **Phase 4** (`8ad6809`): `SettingsDrawer.tsx` + `RollModal.tsx` converted inline→Tailwind; the last
  `tokens.ts` helpers (`seg`/`switchTrack`/`switchKnob`) trimmed. The inline→Tailwind reskin is now
  **complete** — the only intentional inline styles left are the data-driven grid cells/tints.

Phases 1–4 were all **look** (theme + reskin), zero or near-zero behavior change. **Phase 5 is the
first *layout* phase**: it deliberately *changes how the view lays out at tablet widths* so it's
usable on an iPad in the field — but it still does **not** touch the interaction model. Today the grid
is a desktop-width island; after Phase 5 the chrome wraps, the grid fits an iPad, and finger-scroll
feels native. Real touch *gestures* (tap-to-cycle, drag-fill, marquee, long-press menus, row reorder)
are **Phase 6** — do not start them here.

### The target form factor
- **iPad / tablet + desktop only.** The Look-Ahead toggle in `TopHeader.tsx` is `hidden md:flex`, so
  the view is only reachable at **≥768px** (iPad portrait = 768, landscape = 1024). A true phone
  (<640px) layout is explicitly out of scope (the dense grid isn't a phone form factor).
- Verify with DevTools device emulation at **768×1024 (portrait)** and **1024×768 (landscape)**, and
  on a real iPad if available.

### What "responsive" means here (the Phase-5 approach)
- **Chrome (Header strip + Toolbar):** both already use `flex flex-wrap … gap-… px-… py-…` with
  `mx-[18px]` insets, so they *wrap* — Phase 5 makes them wrap **gracefully**: tighten the outer inset
  and inter-control gaps at tablet widths so a wrapped second row doesn't look broken; keep the
  legend/hint text from forcing awkward wraps (it can truncate/hide on narrow). Use Tailwind
  responsive prefixes (`md:`/`lg:`) and the same token/odd-px split the prior phases used.
- **Grid (`LookAhead.tsx`):** the grid is a `tableLayout: "fixed"` `<table>` inside `#la-scroll`
  (a `flex-1 overflow-auto` box with `margin: 14px 18px 18px`, border, radius 10px). It has a sticky
  `thead` and **sticky, resizable task column (`taskW`) + sticky 110px sub column**, with 46px/day
  cells. For iPad:
  - **Size the sticky columns for narrow:** the resizable `taskW` default can eat most of a 768px
    viewport — clamp/shrink it (and/or the 110px sub column) on small screens so day cells stay
    visible. Keep `taskW` user-resizable; just cap the *default/effective* width responsively.
  - **Adapt the week window to viewport (NON-persisted):** show fewer weeks on portrait. **This must
    be a render-time clamp** — derive an *effective* week count from the viewport and feed it to
    `visCols`/`weeksHdr` rendering, **without writing `view.numWeeks`** (it lives in `projectBlob`).
    The Settings "Weeks shown" value and the saved doc stay exactly as the user set them; rotating
    back to landscape restores the full window. (See Open decisions for portrait default.)
  - **Momentum + containment scrolling:** add `overscroll-contain` (and rely on native momentum;
    `-webkit-overflow-scrolling: touch` is default) to `#la-scroll` so dragging the grid doesn't
    scroll/bounce the whole page. (AGENTS §3 already uses the `overscroll-contain` pattern.)
- **Tap targets:** enlarge the *chrome* controls for fingers at tablet widths (the 34px/`w-8` icon
  buttons, segmented control, nav arrows) — e.g. a responsive min-height — **without changing the
  desktop layout** (gate the larger sizing behind a breakpoint, or `@media (pointer: coarse)`).
  **Do NOT** enlarge the grid fill-handle hit area — that's Phase 6a.

### What to convert / touch (read the real files fresh — line numbers drift)
1. **`src/lookahead/components/Header.tsx`** — the glass context strip. Responsive insets/gaps; let
   the project-meta block + saving label wrap or truncate cleanly; keep all controls reachable.
2. **`src/lookahead/components/Toolbar.tsx`** — the week toolbar. Responsive insets/gaps; the legend
   swatches + keyboard-hint text should wrap/hide gracefully on narrow (the hint is desktop guidance).
3. **`src/lookahead/components/LookAhead.tsx`** — the grid: responsive sticky-column sizing, the
   **non-persisted** effective-week-count clamp, and `overscroll-contain` on `#la-scroll`. **Keep the
   data-driven cell styles inline.** Do not change any mouse handler / the resize handle behavior.
4. **`src/lookahead/components/lookahead.css`** — only if a responsive rule is genuinely cleaner as
   namespaced CSS than a Tailwind class (prefer Tailwind per AGENTS §4). **Keep the 11×17 print block
   and `.la-*` hover rules intact.**
5. Possibly **`src/lookahead/lib/view.ts`** if the effective-week-count helper belongs there (pure,
   testable: pass viewport in, return clamped weeks — never read `window` inside the pure fn).

### Required reading (in full, before editing)
1. `sitepulse-next/AGENTS.md` — esp. §0 (plain English to the owner), §2 (don't touch the autosave
   seam / `projectBlob`), §3 (overscroll-contain / native-isolation pattern), §4 (Tailwind), §6 (TS).
2. `sitepulse-next/Notes/plans/Lookahead-UI-Convergence-Plan.md` — §"Phase 5" + §"Open decisions".
3. The real files above + `src/app/project/[projectId]/page.jsx` (mount) and `TopHeader.tsx` (the
   `hidden md:flex` toggle breakpoint — **read only; do not edit `TopHeader`**).

### Scope (Phase 5 only)
1. Header strip + Toolbar wrap gracefully at tablet widths (responsive insets/gaps; hint/legend wrap
   or hide on narrow).
2. Sticky task/sub columns sized for narrow; day cells stay visible on iPad portrait.
3. Effective week window adapts to viewport **without persisting** to `view.numWeeks`.
4. Enlarged chrome tap targets (not the grid handles); momentum + `overscroll-contain` grid scrolling.
5. Confirm the view renders correctly at iPad portrait + landscape breakpoints.

### Open decisions (resolve with the owner at kickoff)
- **Portrait default week count.** On portrait (~768px), default to a **1-week** window, or keep the
  full saved window and rely on horizontal scroll? **Recommend 1-week default on portrait, full window
  on landscape** (per the plan). Confirm with the owner before building, and confirm the clamp is
  render-only (never written to the blob).
- **Tap-target trigger.** Enlarge controls by **width breakpoint** (`max-md`/`md:`) or by
  **`@media (pointer: coarse)`** (touch devices regardless of width)? Recommend the **breakpoint**
  approach for Phase 5 (pure layout); pointer-type detection is more natural in the Phase-6 pointer work.

### Hard guardrails for this phase
- **`projectBlob` stays `{ project, areas, areaOrder, currentAreaId }`.** The responsive week-window
  is **render-time only** — it must NOT write `view.numWeeks` or any other saved field, and must not
  trip the autosave change-detector. Don't disturb the autosave seam in `LookaheadWorkspace.tsx`.
- **No interaction/gesture changes.** Mouse `mousedown`/`mousemove`/`mouseup`, the HTML5 `draggable`
  row reorder, the column-resize handle, cell cycling, marquee, and menus all behave **exactly** as
  today. No Pointer Events, no `touch-action`, no long-press, no enlarged fill-handle (all Phase 6).
- **Touch only the lookahead module.** Do **NOT** edit `TopHeader.tsx` or any other view (in
  particular, do not change the lookahead toggle's `md:` breakpoint — that's an approval-gated shared
  change; if you think it's needed, STOP and ask).
- **Keep the print path intact** (`no-print`, the 11×17 `@page`/print rules in `lookahead.css`).
- **TypeScript (§6):** no `any`; any extracted helper is pure + typed + unit-tested (Vitest globals OFF).
- **Lint is not a gate** — verify with typecheck + test + build.

### Exit criteria (Definition of Done → then STOP)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test` green
  (add a test only if you extract a pure helper, e.g. the effective-week clamp; otherwise don't
  regress the 382 existing).
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build` green.
- Live `npm run dev:3010`, open a project → Look-Ahead view, in **light and dark**, at **iPad portrait
  (768×1024)** and **landscape (1024×768)** via DevTools emulation (+ a real iPad if available):
  - Header strip + week Toolbar wrap cleanly (no overflow/clipping; all controls reachable).
  - Sticky task/sub columns fit; day cells visible without the task column swallowing the viewport.
  - Portrait shows the agreed shorter window; landscape shows the full saved window; the **Settings
    "Weeks shown" value is unchanged** after rotating and the saved plan does not autosave from the
    rotation (verify no spurious save / `projectBlob` unchanged).
  - Grid finger-scroll has momentum and does not scroll-chain the page.
  - **Desktop (≥1280px) layout is unchanged** vs Phase 4 — confirm the chrome + grid still read as
    they did (spot-check; this phase must not regress desktop).
  - No console errors from the module (the Next.js `react-server-dom` "negative time stamp" dev
    exception is framework noise, not ours).
- Close the phase with the **`verify-feature`** skill (its Definition of Done / merge gate).
- **Do not commit or push until the owner says "Approved."**

### Notes / gotchas
- **Browser verification quirk:** a dev server is usually already on `:3010`; CDP screenshots time out
  on this page — probe layout/computed styles via JS instead (as Phases 3–4 did).
- **The week-window clamp is the load-bearing subtlety.** Keep it a *view-time* transform: the saved
  `numWeeks` and the Settings control are the user's intent; the responsive clamp only narrows what's
  *rendered*. Putting it in the blob would corrupt the saved plan on rotation.
- **This is the last layout phase.** Phase 6 (a: Pointer-Event migration + tap/drag-fill/marquee; b:
  long-press menus + touch row reorder) is the interaction rework — do **not** pull any of it forward.
- **Branch off `main` (or `feat/lookahead-ui-convergence-phase-4` `8ad6809` if 1–4 aren't merged);
  do not commit or push until the owner says "Approved."**

# Kickoff — Look-Ahead UI Convergence, Phase 2: One header + glass chrome

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of Look-Ahead UI Convergence** (collapse the Look-Ahead view's own full
> second header into a thin context strip, and give that strip + the week Toolbar the app's
> frosted-glass `.glass-panel` treatment so they read as sub-toolbars *under* SitePulse's one real
> header — structural/visual only, no interaction or touch changes).
> Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-24 - Lookahead UI Convergence Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Lookahead-UI-Convergence-Plan.md` (Phase 2)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main` (a fresh branch). **If Phase 1 (`feat/lookahead-ui-convergence-phase-1`,
> commit `3da93e0`) hasn't been merged to `main` yet, branch off that branch instead** so you
> inherit the slate palette / blue accent / app fonts / theme bridge. Build **only Phase 2**.
> The saved plan document must stay byte-identical (`projectBlob` unchanged) and don't disturb the
> autosave seam in `LookaheadWorkspace.tsx`. Don't commit or push until I say "Approved."

---

## Context for the session

This is the **second** phase of converging an absorbed view (`src/lookahead/**`) onto SitePulse's
design system. **Phase 1 is done** (commit `3da93e0`): the view now uses SitePulse's slate palette,
blue accent (`#2563eb`), Outfit / Roboto Mono fonts, and a **theme bridge** that mirrors the app's
`[data-theme]` into the Look-Ahead store. So colors/fonts already match — **Phase 2 is about
structure**: today the view paints a *whole second app header* below SitePulse's real `TopHeader`,
so you see two stacked headers. Phase 2 collapses that into one thin context strip and dresses the
chrome in the app's frosted glass. **No interaction, responsive, or touch work** — those are later.

### The "two headers" problem (what Phase 2 fixes)
- SitePulse's **real** app header is `src/components/TopHeader.tsx` (the brand + the 5-view toggle,
  including the Look-Ahead toggle). It is **always on screen** in the project route. **Do not edit it.**
- The absorbed view *also* renders its own full header, `src/lookahead/components/Header.tsx`
  (brand dot + a duplicate "Short Interval Plan" title + window subtitle + project meta +
  `AreaSwitcher` + saving indicator + undo/redo + Settings + Print). It mounts at
  `LookAhead.tsx` (`<Header />` immediately followed by `<Toolbar />`). Result: two title bars.

### Required reading (in full, before editing)
1. `sitepulse-next/AGENTS.md` — esp. §0 (lead with plain English to the owner), §2 (state/persistence
   isolation), §4 (Tailwind — new/reskinned chrome should be Tailwind), §6 (TS guardrails: no `any`).
2. `sitepulse-next/Notes/plans/Lookahead-UI-Convergence-Plan.md` — the whole plan; you build Phase 2.
3. Then **re-read the real files fresh** (line numbers drift):
   - `src/lookahead/components/Header.tsx` — the full second header to collapse (all inline-styled).
   - `src/lookahead/components/Toolbar.tsx` — the week-navigation bar (the second container to glass).
   - `src/lookahead/components/AreaSwitcher.tsx` — kept in the strip; don't break it.
   - `src/lookahead/components/LookAhead.tsx` — the mount: `<Header />` then `<Toolbar />` near the
     shell's top; the `shellStyle`/`scrollStyle` wrappers around them.
   - The target chrome: `src/app/globals.css` — the **`.glass-panel`** class (`var(--glass-bg)` +
     `var(--glass-border)` + `var(--glass-shadow)` + `backdrop-filter: blur(24px)`); look at how
     SitePulse's own toolbars/docks use it for the look to match.
   - `src/components/TopHeader.tsx` — **read only, for reference** (so the strip reads as a child of
     it). Do not modify.

### Scope (Phase 2 only)
1. **Collapse `Header.tsx` → a thin context strip.** Drop the **brand dot** (`brandDotStyle`) and the
   **duplicate "Short Interval Plan" title** (`titleStyle`) — SitePulse's TopHeader already names the
   app/view. **Keep:** the window subtitle, the project meta (job name · number · Supt.), the
   `AreaSwitcher`, the saving indicator, undo/redo, Settings, and Print/Export. The result is one low,
   quiet row of context + controls, not a second masthead.
   - The `showBack` "← Projects" button is already suppressed while `embedded` (TopHeader owns nav) —
     leave that logic alone.
2. **Glass chrome.** Give the collapsed strip **and** the `Toolbar` container the app's
   `.glass-panel` + `rounded-xl` look so they read as floating sub-toolbars beneath the TopHeader.
   Because the containers currently set `background`/`borderBottom` inline (which would override the
   glass class), drop those specific inline props on the two outer containers and apply
   `className="glass-panel rounded-xl …"` instead. Add the small spacing/padding needed for them to
   float as panels rather than sit flush edge-to-edge.
3. **Tailwind for the container chrome you touch** (AGENTS.md §4). You do **not** have to convert the
   entire inline-styled internals of `Header`/`Toolbar` to Tailwind here — that full inline→Tailwind
   reskin is **Phase 3**. Phase 2 = collapse structure + glass the outer containers.

### Hard guardrails for this phase
- **`projectBlob` must stay `{ project, areas, areaOrder, currentAreaId }`** and the **autosave seam**
  in `LookaheadWorkspace.tsx` (the `lastSavedRef` change-detector + debounce + flush, and the separate
  theme-bridge effect added in Phase 1) must stay untouched. Phase 2 is presentation only.
- **Touch only the lookahead module.** **Do NOT edit `TopHeader.tsx`** or any other view. If you find a
  genuine need to move Look-Ahead controls *into* `TopHeader` (a shared, cross-view component), **STOP
  and ask the owner** — that's an approval-gated change, not a default.
- **Keep the print path intact.** `Header` is `className="no-print"`; Print still calls
  `window.print()`. Don't regress the 11×17 print rules in `lookahead.css`.
- **No interaction / layout-responsive / touch changes** — those are Phases 5–6. (Minor padding/margins
  needed purely to make the glass panels float is fine; don't reflow for tablet/phone here.)
- TypeScript: no `any`; keep it typecheck-clean.

### Exit criteria (Definition of Done → then STOP)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build` green.
  (No new unit tests in Phase 2 — `selection.ts` extraction is Phase 3.)
- Live `npm run dev:3010` (from `sitepulse-next/`), open a project → Look-Ahead view:
  - **Only one app-level header is visible** (SitePulse's TopHeader). The Look-Ahead view's old
    masthead is gone — what's left is a thin context strip + the week toolbar.
  - The strip + week toolbar read as **frosted-glass, rounded sub-toolbars** consistent with the
    rest of the app, in both light and dark mode.
  - **Undo/redo, Settings (drawer opens), Print/Export, AreaSwitcher, and the saving indicator all
    still work.** Open an existing saved plan → unchanged; make an edit → it still autosaves (no
    console errors, no spurious saves).
- Close the phase with the **`verify-feature`** skill (its Definition of Done / merge gate).
- **Do not commit or push until the owner says "Approved."**

### Notes / gotchas
- **Don't reintroduce a brand identity.** The whole point is *fewer* chrome layers — resist re-adding a
  title or logo "to balance the layout." The TopHeader is the identity.
- **Inline `background`/`borderBottom` will fight `.glass-panel`.** Inline styles win over class rules,
  so the glass won't show until you remove those specific inline props from the outer container nodes.
- **Light + dark both matter.** `.glass-panel` uses `var(--glass-bg)` which differs per theme; verify
  both via the app's dark-mode toggle (the Phase 1 theme bridge makes the view follow it).
- **Phase 3 is the cleanup partner:** it converts the now-collapsed `Header`/`Toolbar`/`ActionBars`/
  `Menus`/`AreaSwitcher` internals from inline `CSSProperties` to Tailwind and extracts
  `rectSelection` → `lib/selection.ts` (+ test). Don't pull that forward; keep Phase 2 small.
- **Branch off `main`; do not commit or push until the owner says "Approved."**

# Kickoff — Look-Ahead UI Convergence, Phase 3: Reskin chrome to Tailwind + extract selection

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3 of Look-Ahead UI Convergence** (convert the Look-Ahead chrome's remaining
> inline `CSSProperties` to Tailwind utilities + app tokens, and extract the inline
> `rectSelection` marquee math from `LookAhead.tsx` into `lib/selection.ts` with a unit test —
> **visual/structural parity only, no behavior, interaction, or touch changes**).
> Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-24 - Lookahead UI Convergence Phase 3 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Lookahead-UI-Convergence-Plan.md` (Phase 3)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main` (a fresh branch). **If Phases 1 & 2 haven't been merged to `main` yet, branch
> off `feat/lookahead-ui-convergence-phase-2` (commit `eccd0b4`) instead** so you inherit the slate
> palette / blue accent / app fonts / theme bridge (Phase 1) and the one-header + glass chrome
> (Phase 2). Build **only Phase 3**. The saved plan document must stay byte-identical (`projectBlob`
> unchanged) and don't disturb the autosave seam in `LookaheadWorkspace.tsx`. Don't commit or push
> until I say "Approved."

---

## Context for the session

This is the **third** phase of converging an absorbed view (`src/lookahead/**`) onto SitePulse's
design system. **Phases 1 & 2 are done:**
- **Phase 1** (`3da93e0`): slate palette, blue accent (`#2563eb`), Outfit / Roboto Mono fonts, and a
  **theme bridge** so the view follows the app's `[data-theme]`.
- **Phase 2** (`eccd0b4`): collapsed the Look-Ahead view's second masthead into a **thin context
  strip**, and gave that strip + the week `Toolbar`'s **outer containers** the app's `.glass-panel
  rounded-xl` look (one header, frosted sub-toolbars).

So the view already looks right. **Phase 3 is a code-quality / detangle pass, not a visual change**:
the chrome's *inner* controls are still styled with inline `CSSProperties` objects (the buttons,
dropdowns, menus, segmented bits). Per AGENTS.md §4, new/reskinned chrome should be **Tailwind**.
Phase 3 converts those inner styles to Tailwind utilities + app tokens, and — as part of detangling
`LookAhead.tsx` — extracts the load-bearing `rectSelection` marquee math into a pure, unit-tested
`lib/selection.ts`. **Nothing the user can see or do should change.**

### What's already Tailwind vs. what's still inline (read before editing — line numbers drift)
- **Already converted (Phase 2 — leave the outer container chrome alone):** the `<div>` that wraps
  `Header.tsx` and the `<div>` that wraps `Toolbar.tsx` are now
  `className="no-print glass-panel rounded-xl mx-[18px] mt-… flex flex-wrap items-center
  justify-between gap-4 px-4 py-2"`. **Don't undo the glass / `no-print` / inset.** Phase 3 reskins
  what's *inside* these containers.
- **Still inline `CSSProperties` (Phase 3 converts these):**
  - `Header.tsx` — `subStyle`, `metaDividerStyle`, `metaStyle`, `metaStrongStyle`, `metaDotStyle`,
    `ghostBtnStyle`, `primaryBtnStyle`, `undoBtnStyle`/`redoBtnStyle`, `backBtnStyle`, `savingStyle`.
  - `Toolbar.tsx` — `navWrapStyle`, `navArrowStyle`, `weekBoxStyle`, `weekKickerStyle`,
    `weekLabelStyle`, `rollBtnStyle`, `dupBtnStyle`, `jumpSelectStyle`, `thisWeekBtnStyle`,
    `savedPillStyle`/`savedDotStyle`, `delWeek*Style`, `legendGroupStyle`, `hintStyle`. Also uses
    `swatch()` from `tokens.ts` for the status legend.
  - `ActionBars.tsx` — the floating selection bar (`barStyle`, `barCountStyle`, `barSepStyle`,
    `barBtn()`); dark `t.barBg` bar with white text, `position: fixed`, `no-print`.
  - `Menus.tsx` — the row + cell context menus (`backdropStyle`, `itemStyle`, `sepStyle`, the inline
    popover container styles); `la-menu-item` / `la-menu-delete` hover classes (from `lookahead.css`).
  - `AreaSwitcher.tsx` — `triggerStyle`, `dropStyle`, `kicker`, `item`, `sep`, `nameCellStyle`, and
    the create/rename **dialog** styles.

### Required reading (in full, before editing)
1. `sitepulse-next/AGENTS.md` — esp. §0 (plain English to the owner), §4 (Tailwind for new/reskinned
   chrome; data-driven cell styling legitimately stays computed/inline), §6 (TS: **no `any`**; test
   files are typecheck-clean, Vitest globals OFF), §9 (testing conventions + mocking recipes).
2. `sitepulse-next/Notes/plans/Lookahead-UI-Convergence-Plan.md` — the whole plan; §"Phase 3" and
   §"Pure logic to extract + unit-test" (the `selection.ts` spec).
3. Then **re-read the real files fresh** (line numbers drift):
   - `src/lookahead/components/{Header,Toolbar,ActionBars,Menus,AreaSwitcher}.tsx` — the inline chrome.
   - `src/lookahead/components/LookAhead.tsx` — the inline `rectSelection(rowOrder, visCols, a, b)`
     (~top of file) to extract; note it's called from the keydown shift-arrow handler **and** the
     shift-click `cellDown` handler. The grid-cell computed styles in this file **stay inline**.
   - `src/lookahead/lib/tokens.ts` — `getTokens`/`getAccent` (app-var-wired neutrals + status/flag
     palettes) and the inline-style helpers (`seg`, `swatch`, `switchTrack`, `switchKnob`).
   - `src/lookahead/lib/types.ts` — `Status` etc. (for `selection.ts` typing).
   - `src/lookahead/isProjectBlob.test.ts` — the existing co-located test (Vitest globals OFF;
     `import { describe, it, expect } from "vitest"`) — match this style for `selection.test.ts`.

### Scope (Phase 3 only)
1. **Reskin inner chrome to Tailwind** in `Header`, `Toolbar`, `ActionBars`, `Menus`, `AreaSwitcher`:
   convert the inline `CSSProperties` for **layout, spacing, typography, borders, radius** to Tailwind
   utilities and the app tokens already in use. **Keep the data-driven, palette-computed bits inline**
   (same principle as the grid cells): status colors (`t.st.start/ongoing/done` `.bg`/`.color`), flag
   tints, accent fills (`ac.main`/`ac.fg`), and **dynamic positions** (the menus' `left/top` from
   `menu.x/menu.y`, the action bar's fixed centering). Where a value comes from a token/prop at
   runtime, keep it in `style={{…}}`; where it's a fixed design constant, move it to a class. Don't
   force arbitrary-value walls — a fixed `12.5px`/`7px` etc. that has no clean Tailwind step can stay
   inline if converting it would just become `text-[12.5px]` noise; use judgment, lean Tailwind.
2. **Extract `rectSelection` → `src/lookahead/lib/selection.ts`** (pure, deterministic, no
   `Date.now()`), export it, and import it back into `LookAhead.tsx` (replace the local function).
   Add **`src/lookahead/lib/selection.test.ts`** (Vitest, globals OFF) covering: a single cell, a full
   inclusive rectangle in both drag directions, row/col order respected via the passed `rowOrder` /
   `visCols`, and **`null` when either endpoint is off-screen** (not in `rowOrder`/`visCols`).
   - *Optional, only if clean:* the near-duplicate inline rect-building loops in `cellEnter` and
     `fillDown` can share a small core helper — but keep them **behavior-identical**; don't refactor
     the interaction model (that's Phase 6).

### Hard guardrails for this phase
- **`projectBlob` stays `{ project, areas, areaOrder, currentAreaId }`** and the **autosave seam** in
  `LookaheadWorkspace.tsx` stays untouched. Phase 3 is presentation + a pure-function extraction only.
- **No behavior / interaction / responsive / touch changes.** Pointer-event migration, long-press,
  touch reorder, and iPad layout are Phases 5–6. The marquee/drag/fill/menu behavior must work
  **exactly** as it does today after the reskin + extraction.
- **Touch only the lookahead module.** **Do NOT edit `TopHeader.tsx`** or any other view.
- **Keep the print path intact:** every chrome container keeps `className="no-print"` (now alongside
  its Tailwind classes); don't regress the 11×17 rules in `lookahead.css`. The `la-cell` /
  `la-menu-item` / `la-menu-delete` hover classes live in `lookahead.css` — keep using them.
- **TypeScript (§6):** no `any`; type `selection.ts` properly (reuse the `{ rowId: string; di: number }`
  shape and `Record<string, true>` return). The new test file must be typecheck-clean.

### Exit criteria (Definition of Done → then STOP)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test` green
  (incl. the new `src/lookahead/lib/selection.test.ts`).
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build` green.
- Live `npm run dev:3010` (from `sitepulse-next/`), open a project → Look-Ahead view:
  - The view looks **identical to Phase 2** in both light and dark mode — the strip, week toolbar,
    selection action bar, row/cell context menus, and the area switcher dropdown/dialog are visually
    unchanged after the inline→Tailwind swap.
  - **Everything still works:** click-to-cycle, **marquee drag-select + shift-click rectangle**
    (the extracted `rectSelection`), drag-to-fill, right-click cell/row menus, the bottom action bar
    (Start / In progress / Done / Clear / flags), undo/redo, Settings drawer, Print, AreaSwitcher
    (switch / new / rename / duplicate / delete), and the saving indicator. No console errors.
  - Open an existing saved plan → unchanged; an edit still autosaves (no spurious saves).
- Close the phase with the **`verify-feature`** skill (its Definition of Done / merge gate).
- **Do not commit or push until the owner says "Approved."**

### Notes / gotchas
- **This phase shouldn't change a single pixel.** If something *looks* different after converting a
  style, you mismapped a value — Tailwind's default scale doesn't always equal the inline px. Verify
  side-by-side against Phase 2 (e.g. `gap-2` = 8px, `px-3` = 12px; a `6px`/`7px`/`12.5px` constant has
  no exact step — keep it inline rather than rounding the look).
- **Inline still wins over classes.** If you leave a `style={{ background, color }}` for a palette
  value, don't *also* set a Tailwind `bg-*`/`text-*` for the same property — the inline wins and the
  class is dead weight. Split cleanly: dynamic → `style`, fixed → `className`.
- **Don't pull Phase 4 forward.** `SettingsDrawer.tsx` + `RollModal.tsx` (and the accent-picker
  decision) are **Phase 4**. The `seg`/`switchTrack`/`switchKnob` helpers in `tokens.ts` are used by
  those Phase-4 components — leave helpers that only Phase 4 consumes alone; convert only what the
  Phase-3 components use (`swatch` for the Toolbar legend).
- **`selection.ts` is load-bearing for touch too** (Phase 6 reuses it for finger marquee), which is
  why it's extracted + tested now. Pass everything in as args; never read store/`Date.now()` inside.
- **Branch off `main` (or `feat/lookahead-ui-convergence-phase-2` if 1 & 2 aren't merged);
  do not commit or push until the owner says "Approved."**

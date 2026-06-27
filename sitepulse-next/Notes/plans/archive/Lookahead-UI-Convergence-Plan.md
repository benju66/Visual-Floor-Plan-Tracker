# Look-Ahead UI Convergence + Full Touch/iPad Parity (self-contained build plan)

> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then **re-read the actual current files before editing** — the
> codebase moves faster than this doc, so do not trust line numbers here.
> Parent: `Notes/plans/Lookahead-Absorption-Plan.md` (the absorption that brought this view in
> as a 5th view, "blob verbatim", and explicitly **deferred Mobile + UI convergence**). This
> plan is that deferred work.

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) in full first — esp. §0 (how to talk to
   the owner), §2 (state/persistence isolation), §4 (Tailwind), §6 (TS/IDB guardrails).
2. Re-read the files in **§Build-on inventory** fresh before editing — line numbers drift.
3. Build the phases in order; verify after each (§Verification). Each phase = one fresh session.
4. Keep the owner (product owner, **not** a developer) in the loop: lead with a 1–2 sentence
   plain-English summary; explain jargon in passing; keep it short.

## Goal
When this is done, the **Look-Ahead view looks and feels like a native SitePulse view, not a
bolted-in second app**, and it is **fully usable by finger on an iPad** (not just mouse/trackpad).
Concretely: it shares the app's dark mode, fonts (Outfit / Roboto Mono), blue accent, slate
surfaces, and glass chrome; there is **one app header** (no stacked second header); and every
desktop gesture — cycle a cell's status, drag-to-fill a status across cells, marquee-select a
rectangle, open a cell/row menu, reorder a task — works by touch.

In plain terms: today the weekly grid is a different-looking, mouse-only island living inside
SitePulse. After this it's indistinguishable from the rest of the app and works on a tablet in
the field.

## Out of scope / deferred (do NOT build these here)
- **Any change to the saved plan document.** The cloud blob (`projectBlob`) stays exactly
  `{ project, areas, areaOrder, currentAreaId }`. This is purely a presentation + interaction
  reskin — no data-model change, **no DB migration anywhere in this workstream**.
- **Unifying Look-Ahead's undo/redo with SitePulse's `useUndoRedo`.** They undo different data
  models (document snapshots vs `status_logs`); keep Look-Ahead's own `past`/`future` stacks.
- **Joining the offline `pendingChanges` / IndexedDB mutation queue.** Look-Ahead keeps its own
  debounced autosave (AGENTS.md §2; parent plan). Untouched here.
- **Task ↔ milestone mapping, schedule import / versioning / Monte Carlo.** Separate workstreams.
- **Phone-sized (<640px) layouts.** Target is **iPad (tablet) + desktop**. A true phone layout
  (à la `MobileSwipeDeck`) is a later decision — the dense grid isn't a phone form factor.

## Locked product decisions (from the owner)
- **Full touch parity** (not just responsive layout): rework the mouse-event interaction model to
  Pointer Events so finger gestures match mouse gestures. (Owner chose this over "responsive only".)
- **Plan-of-record first, then build phase by phase** with checkpoints (this doc).
- **Deliver on a fresh branch off `main`** — the current `feat/project-contacts-phase-1` branch is
  mid-stream on unrelated work. Do NOT build this on that branch.
- **Theme follows the app.** Look-Ahead's private Light/Dark toggle is removed; the view mirrors
  SitePulse's app-wide `[data-theme]`. (Safe — theme is device-local, never in the saved blob.)
- **Accent = SitePulse blue/sky** (currently the absorbed default is Orange).
- **Keep the data-driven grid-cell styling computed/inline** where Tailwind would mean a wall of
  arbitrary values (status palettes, flag tints, focus rings). Tailwind everywhere else (§4).

## Data model
**None.** No tables, columns, RPCs, or RLS touched. The only persistence fact that matters:
`projectBlob(state)` in `src/lookahead/store/useStore.ts` returns
`{ project, areas, areaOrder, currentAreaId }` — and **must keep returning exactly that**. The
theme bridge writes only to transient store `theme` state (not in the blob), so it cannot reach
the saved document or trip the autosave change-detector in `LookaheadWorkspace.tsx`.

## Build-on inventory (read these fresh before using)
- **Mount + app shell:** `src/app/project/[projectId]/page.jsx` (`viewMode === 'lookahead'` →
  `<LookaheadWorkspace projectId={...} />`); `src/components/TopHeader.tsx` (the real app header +
  the 5-view toggle; the Look-Ahead toggle is `hidden md:flex`).
- **App design system (the target to match):** `src/app/globals.css` (CSS vars `--bg`/`--border`/
  `--text`/`--text-h`, the `.glass-panel` class, `[data-theme="dark"]`), `src/app/layout.js`
  (loads **Outfit** `--font-outfit` + **Roboto Mono** `--font-roboto-mono`; **Geist is never
  loaded**, so the absorbed view's `'Geist'` stacks silently fall back to OS default).
- **The Look-Ahead module (what we're converging):**
  - `src/lookahead/LookaheadWorkspace.tsx` — the SitePulse mount + autosave seam. **Do not disturb
    its change-detection / `lastSavedRef` logic.** Add the theme bridge as a *separate* effect.
  - `src/lookahead/lib/tokens.ts` — `getTokens` (zinc palette → remap to slate + app vars),
    `getAccent` (Orange/Blue/Slate → default Blue), `seg`/`swatch`/`switchTrack`/`switchKnob`.
  - `src/lookahead/lib/config.ts` — `ACCENT = "Orange"` (→ `"Blue"`), `SHOW_NOTES`.
  - `src/lookahead/components/lookahead.css` — `.la-*` hover + 11×17 print rules (keep print).
  - `src/lookahead/components/LookAhead.tsx` — the grid + **the entire interaction model**
    (document-level `mouseup`/`mousemove`/`keydown` effect, per-cell `cellDown`/`cellEnter`/
    `fillDown`/`cellContext`, HTML5 `draggable` row reorder, inline `rectSelection`).
  - `src/lookahead/components/Header.tsx` — the absorbed view's own header (brand dot + title +
    meta + AreaSwitcher + undo/redo + Settings + Print) → collapse to a thin strip.
  - `src/lookahead/components/{Toolbar,ActionBars,Menus,AreaSwitcher,SettingsDrawer,RollModal}.tsx`
    — all inline-styled; reskin to Tailwind.
  - `src/lookahead/store/useStore.ts` — interaction state (`selCells`, `focusCell`, `selAnchor`,
    `dragging`, `dropTarget`, `menu`, `cellMenu`, `editing`), mutations, `past`/`future`,
    `projectBlob`, `setTheme`. Reuse; don't fork.
- **Do NOT fork / re-implement:** SitePulse's `useUndoRedo`, the `pendingChanges` queue, the
  TanStack Query hooks. This workstream touches **only** the lookahead module + its mount.

## Pure logic to extract + unit-test
Framework-free, deterministic, co-located `*.test.ts` (Vitest globals OFF — import `{ describe,
it, expect }` from `'vitest'`). Pass timestamps **in**; never call `Date.now()` inside:
- `src/lookahead/lib/selection.ts` — extract the existing inline `rectSelection(rowOrder, visCols,
  a, b)` from `LookAhead.tsx`. The marquee-rectangle math; load-bearing for mouse **and** touch.
- `src/lookahead/lib/gesture.ts` — `classifyPointerGesture({ downAt, upAt, dx, dy, longPressMs,
  moveThresholdPx })` → `'tap' | 'drag' | 'longpress'`. The heart of touch parity; unit-test the
  boundaries (tap vs drag threshold, long-press timing).

## Sub-phasing (ship + verify each)

### Phase 1 — Visual foundation (theme bridge, accent, fonts, palette)
- **Scope:** `tokens.ts` (zinc→slate hexes, wire to app CSS vars where clean; `getAccent` default
  Blue), `config.ts` (`ACCENT = "Blue"`), replace `'Geist'`/`'Geist Mono'` font stacks with
  `var(--font-outfit)` / `var(--font-roboto-mono)` (centralize in tokens + the few inline spots in
  `LookAhead.tsx`/`LookaheadWorkspace.tsx`). Add a **theme bridge**: a separate `useEffect` in
  `LookaheadWorkspace.tsx` that reads the app's `[data-theme]` (MutationObserver on
  `document.documentElement`) and calls `useStore.getState().setTheme(...)`. Remove the in-drawer
  **Light/Dark** toggle in `SettingsDrawer.tsx` (keep Row density).
- **No interaction or layout changes.** Pure look. Highest visible payoff, lowest risk.
- **Approval gates:** none beyond the standing "branch off `main`; don't commit/push until Approved."
- **Exit criteria:** typecheck + build green · open `dev:3010`, toggle app dark mode → the
  Look-Ahead view flips with it · accent/buttons read blue · fonts match the rest of the app ·
  saved plan unaffected (blob unchanged) · close with `verify-feature`.

### Phase 2 — One header + glass chrome
- **Scope:** collapse `Header.tsx` from a full second app-header into a **thin context strip**:
  drop the brand dot + duplicate "Short Interval Plan" title; keep AreaSwitcher + window subtitle +
  saving indicator + undo/redo + Settings + Print. Give the strip + `Toolbar` containers the app's
  `.glass-panel` + `rounded-xl` treatment so they read as sub-toolbars under SitePulse's TopHeader.
- **Stay inside the lookahead module** — do **not** edit `TopHeader.tsx`.
- **Approval gates:** standing only. (If you find a real need to move Look-Ahead controls *into*
  `TopHeader`, STOP and ask — that's a shared component / cross-view change.)
- **Exit criteria:** typecheck + build green · only one app-level header visible · undo/redo/
  settings/print all still work · `dev:3010` click-through · close with `verify-feature`.

### Phase 3 — Reskin chrome to Tailwind
- **Scope:** convert `Header`(strip), `Toolbar`, `ActionBars`, `Menus`, `AreaSwitcher` from inline
  `CSSProperties` to Tailwind utilities + app tokens. Extract `rectSelection` → `lib/selection.ts`
  (+ test) as part of detangling. **Keep grid-cell computed styles inline** in `LookAhead.tsx`.
- **No behavior change** — visual/structural parity only.
- **Exit criteria:** typecheck + test (selection) + build green · `dev:3010` parity check · close
  with `verify-feature`.

### Phase 4 — Reskin settings/modals to Tailwind
- **Scope:** convert `SettingsDrawer` + `RollModal` to Tailwind, matching SitePulse modal/drawer
  conventions. Reconcile the **accent picker** (drop it, or align its options to the app — owner
  decision at kickoff). Tidy the now-themeless Display section.
- **No behavior change.**
- **Exit criteria:** typecheck + build green · settings + roll-forward still work · `dev:3010` ·
  close with `verify-feature`.

### Phase 5 — Responsive layout (iPad fit, no new gestures)
- **Scope:** header strip + Toolbar wrap gracefully at tablet widths; size sticky task/sub columns
  for narrow; default narrow/portrait to a shorter week window; enlarge tap targets; momentum/
  overscroll-contain scrolling; confirm the view renders at iPad breakpoints (toggle is `md:`).
- **Pure CSS/layout** — interactions stay pointer/mouse for now.
- **Open decision (resolve at kickoff):** portrait default = 1-week window vs horizontal-scroll the
  full window. Recommend **1-week default on portrait**, full window on landscape.
- **Exit criteria:** typecheck + build green · usable on an iPad-sized viewport (DevTools device
  emulation + a real iPad if available) · `dev:3010` · close with `verify-feature`.

### Phase 6a — Pointer-event migration + touch tap / drag-fill / marquee
- **Scope:** migrate `LookAhead.tsx`'s document-level `mouseup`/`mousemove` + per-cell
  `mousedown`/`mouseenter` to **Pointer Events** (`pointerdown`/`pointermove`/`pointerup` +
  `setPointerCapture`), which unify mouse+touch+pen so **desktop keeps working unchanged**. Add
  `touch-action: none` to grid cells so drag-fill/marquee don't scroll the page. Wire
  `classifyPointerGesture` (`lib/gesture.ts` + test): tap → cycle status; drag → marquee/fill;
  enlarge the fill-handle hit area for fingers.
- **Approval gates:** standing. This is the riskiest phase — verify desktop parity explicitly.
- **Exit criteria:** typecheck + test (gesture) + build green · on a touch device/emulation: tap
  cycles, finger drag-fills, finger marquee selects · **desktop mouse behavior unchanged** ·
  close with `verify-feature`.

### Phase 6b — Long-press menus + touch row reorder
- **Scope:** replace `onContextMenu` cell/row menus with **long-press** (via
  `classifyPointerGesture`) on touch while keeping right-click on desktop. Replace the HTML5
  `draggable` row reorder (which doesn't fire on touch) with a **pointer-based** reorder using the
  existing grip handle + `dropTarget` store state.
- **Exit criteria:** typecheck + test + build green · long-press opens menus on touch, right-click
  still works on desktop, rows reorder by finger and by mouse · close with `verify-feature`.

## Hard guardrails (AGENTS.md — do not violate)
- **`projectBlob` stays `{ project, areas, areaOrder, currentAreaId }`.** Never add theme/density/
  UI state to the saved cloud document.
- **Do not disturb the autosave seam** in `LookaheadWorkspace.tsx` (the `lastSavedRef` change
  detector + debounce + flush-on-hide). The theme bridge is a *separate* effect; don't fold it in.
- **Isolation:** touch **only** the lookahead module + its mount. Do **not** modify other views.
  Editing the shared `TopHeader.tsx` (or changing the lookahead toggle's breakpoint) is an
  approval-gated, call-it-out change — default is to leave it alone.
- **Tailwind for new/reskinned chrome (§4);** the data-driven grid cells legitimately stay inline.
- **TypeScript (§6):** no `any`; type Pointer Events properly; test files are typecheck-clean
  (Vitest globals OFF — import from `'vitest'`).
- **Keep the print path intact** (`window.print()` + the 11×17 `@page`/`.print-only` rules in
  `lookahead.css`).
- **Branch off `main`; do not commit or push until the owner says "Approved."**

## Verification commands (exit-criteria gate)
Run npm with an absolute prefix (bash cwd persists; a stray `cd` prompts):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck   # tsc --noEmit (primary gate)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test         # vitest (target: ... run test -- src/lookahead/lib/selection.test.ts)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build        # next build (after editing live components)
```
- **Lint is NOT a gate** (~1850 pre-existing problems) — verify with typecheck + test + build.
- **No E2E framework** — live click-through via `npm run dev:3010` (from `sitepulse-next/`, port
  3010) is the only UI/interaction verification. For touch, use DevTools device emulation and, if
  possible, a real iPad.

## Open decisions
- **Phase 4:** drop the accent picker entirely, or keep it aligned to app accents? (Recommend drop
  — the app owns accent.) Resolve at Phase 4 kickoff.
- **Phase 5:** portrait default week count (recommend 1-week portrait / full landscape).
- **Phase 6b:** touch row-reorder affordance — long-press-then-drag vs an explicit drag handle
  (recommend explicit grip handle, already present, to avoid colliding with long-press menus).

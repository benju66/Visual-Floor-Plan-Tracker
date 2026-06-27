# Navigation & Per-View Header Redesign — context-aware header, labeled switcher, mobile nav, URL views (self-contained build plan)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: none — this is a standalone UX/navigation workstream. Related prior UI work:
> `Notes/plans/Lookahead-UI-Convergence-Plan.md` (touch parity precedent).

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) — especially §0 (how to talk to the
   owner), §2 (state management; viewMode lives in Zustand, not server state), §6 (TS/Zustand
   guardrails).
2. Re-read the files named in each phase **fresh** — do NOT trust line numbers in this doc;
   they drift. Re-grep before editing.
3. Build the phases in order. Phase 1 is the foundation the others lean on. Verify after each
   slice (§ Verification commands).
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence
   plain-English summary; explain jargon in passing; keep it short.

## Goal
When this is done: the top header shows **only the controls that the current view actually
uses** (no more dead Level dropdown / Milestones button on the Dashboard); the primary view
switcher has **text labels** next to its icons on desktop and one **consistent "selected"
color**; **phones get a bottom tab bar** so users can finally reach Map, Look-Ahead, and
Dashboard (today they're locked to List); the **active view lives in the URL** (`?view=map`)
so views are shareable/bookmarkable and the browser **Back button steps through views**; and
the Map toolbar is **split into "what I'm doing" (modes) vs "what's shown" (on/off settings)**.

## Out of scope / deferred
- **No new views.** This is purely about navigating between the existing 5 (Dashboard, List,
  Schedule, Map, Look-Ahead).
- **No data-model / DB / RLS / migration changes.** Zero backend work. If a phase seems to
  need one, stop — it's out of scope.
- **No changes to the offline mutation queue, `status_logs`, `pendingChanges`, or
  `progressAnalytics`.** This workstream only touches navigation/header UI + view-resolution
  state.
- **Path-based routing** (`/project/[id]/map`) is deferred — we use a `?view=` query param
  (owner decision) to avoid restructuring the single-page view switch.
- **Touch parity inside each view** is already handled by prior workstreams (Look-Ahead
  convergence, swipe deck). We only add the bottom tab bar that switches between views.

## Locked product decisions (from the owner)
- **Mobile bottom tab bar = field-focused 4:** List, Map, Look-Ahead, Dashboard. **Schedule /
  Gantt is intentionally excluded on phones** (unusable at phone width).
- **Back button walks views:** switching view pushes a browser-history entry, so Back returns
  to the previous view and only then exits the project. URL is `?view=<mode>`, shareable.
- **Unify the selected-state color to one accent (blue), but keep colors that encode meaning**
  — e.g. amber Lag Mode stays amber because there the color is information, not decoration.
- **Dashboard keeps a track/scope selector** — it is NOT dead — but it must be **re-sourced
  from project-level milestone tracks**, not from `activeSheet.active_scopes`.

## The three control families (the mental model this whole plan serves)
Make the header read as three distinct jobs, visually separated:
1. **Views** = "where am I" → the primary switcher (desktop top bar / mobile bottom bar).
2. **Scope / Track** = "what am I tracking" → the Production/Safety/etc. tabs.
3. **Level** = "which floor/sheet" → the `activeSheetId` dropdown.

## Per-view control matrix (the heart of the context-aware header)
Proposed default — **the Phase 3 session must confirm the uncertain cells (?) with the owner
before hiding anything.** "Show" = the control appears for that view; "—" = hidden.

| Control                         | Dashboard | List | Schedule | Map | Look-Ahead |
|---------------------------------|:---------:|:----:|:--------:|:---:|:----------:|
| **Level** selector (`activeSheetId`) | — (dead) | show | show | show | — (?) |
| **Scope/Track** tabs            | show¹     | show | show     | show| — (?) |
| **Milestones** filter button    | —         | show | — (?)    | show| — |
| **Export PDF** button           | —         | —    | — (?)    | show²| — |
| **Add / Manage Levels** buttons | show      | show | show     | show| show |

¹ Dashboard track selector re-sourced from project milestone tracks (see Phase 3).
² Export is already gated to `viewMode === 'map' && activeSheet?.base_image_url` today — keep that.

**Confirmed-dead today (safe to hide on Dashboard in Phase 3):**
- Level dropdown — Dashboard fetches **all-project** data and never reads `activeSheetId`
  (`ProjectDashboard.tsx` uses `trackingMode` only; AGENTS.md §3 "Dashboard scope").
- Milestones button — opens the milestone command/filter menu the Dashboard doesn't consume.

## Build-on inventory (read these fresh before using)
- `src/components/TopHeader.tsx` — the header. Today renders, unconditionally: Home link,
  project title, **Level `<select>`**, Add/Manage Level buttons, **Milestones button**,
  **Scope tabs** (sourced from `activeSheet.active_scopes`), the **5-icon view switcher**
  (`hidden md:flex`, icon-only), Export, Settings, Undo/Redo. Props are passed from page.jsx.
- `src/app/project/[projectId]/page.jsx` — `"use client"`. Owns the wiring. Note:
  - Mount effect **forces `viewMode='list'` when `window.innerWidth < 768`** (the line the
    mobile bar must relax), else applies `settings.defaultViewMode` on first load.
  - An effect clamps `trackingMode` to `activeSheet.active_scopes` — **this will fight a
    Dashboard project-level track selection; Phase 3 must scope/skip it for Dashboard.**
  - Renders the view body via `viewMode === 'dashboard' ? … : 'list' ? … : 'schedule' ? …`.
- `src/store/useUIStore.ts` — `viewMode: string` (default `'list'`), persisted to
  **sessionStorage** (`sitepulse-ui-session`, partialized). Keep this as the in-memory mirror;
  URL becomes the source of truth in Phase 1.
- `src/store/useMapStore.ts` — `trackingMode` (default `'Production'`) + `activeSheetId`,
  persisted to sessionStorage. `setToolMode('pan')` is fired on most view switches.
- `src/store/useSettingsStore.ts` — `settings.defaultViewMode` (localStorage). Editable in
  `SettingsMenu.tsx`. Use `useHydratedStore` for any persisted read (avoids hydration
  mismatch — AGENTS.md §2).
- `src/components/ProjectDashboard.tsx` — already takes `milestones` + `trackingMode`; filters
  rollups/history/forecasts by track. Re-source its track options from
  `[...new Set(milestones.map(m => m.track))]` in Phase 3.
- `src/components/MapHorizontalToolbar.tsx` — the floating circular icon toolbar (modes +
  on/off toggles). Reorganized in Phase 5.
- `src/components/MobileSwipeDeck.tsx` — the List view's mobile presenter (already uses
  `useRouter`). The bottom tab bar must coexist with it; mind the `hide-header-mobile` /
  `hide-in-swipe-view` CSS classes already used to hide chrome on mobile.

## Pure logic to extract + unit-test
Put framework-free helpers in `src/utils/viewRouting.ts` (+ `viewRouting.test.ts`):
- `VIEW_MODES` — the canonical list/order + a `isValidViewMode(s): boolean` guard.
- `resolveInitialView({ urlParam, isMobile, defaultViewMode, mobileAllowed })` — pure
  precedence resolver returning the view to show on first load. Precedence:
  **valid URL param → (mobile: clamp to a mobile-allowed view) → defaultViewMode → 'list'**.
  Pass `isMobile` IN; never read `window` inside the pure fn.
- `MOBILE_VIEWS` = `['list','map','lookahead','dashboard']` + `isMobileView(mode)`.
- (Phase 3) `controlVisibility(viewMode)` — returns the per-view control flags from the matrix
  above (`{ level, scope, milestones, export, levelAdmin }`). Pure + table-driven + tested.
Tests assert the precedence table and the matrix cells exactly. This is where the load-bearing
correctness lives — keep `Date.now()`/`window` out of these.

## Sub-phasing (ship + verify each)

### Phase 1 — View in the URL + clean view-resolution precedence (foundation)
- **Scope:** Make `?view=<mode>` the source of truth for the active view.
  - Add `src/utils/viewRouting.ts` (+ test) with `VIEW_MODES`, `isValidViewMode`,
    `resolveInitialView`, `MOBILE_VIEWS`.
  - In `page.jsx`: read `useSearchParams()`; on mount resolve the initial view via
    `resolveInitialView(...)` and reconcile it into `useUIStore.viewMode`. Replace the bare
    `setViewMode` callers' effect so the **URL is authoritative**: a helper
    `navigateToView(mode)` does `router.push(\`?view=${mode}\`)` (push → Back walks views) AND
    `setViewMode(mode)` + `setToolMode('pan')`. Wire `TopHeader`'s switcher + any in-app
    `setViewMode('map')` jumps (e.g. `onLocateUnit`, `ProjectDashboard` line ~254) through
    `navigateToView`.
  - Keep `useUIStore.viewMode` as the in-memory mirror (cheap reads, no churn). Guard against
    update loops (only push when the param actually differs).
  - **Relax the mobile force-to-list rule**: it should only apply when there's no valid
    `?view=` param (so a shared `?view=map` link still opens Map on a phone). Full mobile
    reachability lands in Phase 4; here, just stop the URL from being overridden.
- **Approval gates:** none beyond the standing "don't commit/push until I say Approved." No
  DB/RLS/queue changes.
- **Exit criteria:** typecheck + test + build green · `viewRouting.test.ts` covers the
  precedence table · live `dev:3010` check: switching views updates the URL, Back steps
  through views, a pasted `?view=map` URL deep-links correctly · close with `verify-feature`,
  then STOP.

### Phase 2 — Desktop view switcher: labels + unified accent + family separation
- **Scope:** `TopHeader.tsx` visuals only (no behavior change).
  - Add **icon + text label** to each of the 5 switcher buttons; collapse to icon-only below a
    breakpoint (e.g. labels show `lg:`+, icons-only `md:`–`lg:`). Keep tooltips.
  - Apply the **single accent** (blue) to the switcher's selected state (replace the dark-slate
    fill) so it matches the scope tabs.
  - **Separate the three families** (Views / Scope / Level) with dividers or spacing so they
    don't read as one undifferentiated pill row. Move the view switcher out of the cramped
    `overflow-x-auto` cluster if it risks scrolling off-screen.
- **Approval gates:** none. Pure presentational.
- **Exit criteria:** typecheck + build green · live `dev:3010`: labels render, one consistent
  selected color, families visually distinct, no horizontal-scroll clipping at common laptop
  widths · `verify-feature` → STOP.

### Phase 3 — Per-view context-aware header + re-source Dashboard track selector
- **Scope:** the behavioral core.
  - Add `controlVisibility(viewMode)` to `viewRouting.ts` (+ tests) implementing the matrix.
  - In `TopHeader.tsx`, gate the Level selector, Scope tabs, Milestones button, and Export per
    `controlVisibility(viewMode)`. **Confirm the uncertain (?) matrix cells with the owner
    before hiding them.**
  - **Re-source the track/scope selector**: when `viewMode === 'dashboard'`, the Scope tabs'
    options come from project-level tracks (`[...new Set(milestones.map(m => m.track))]`), not
    `activeSheet.active_scopes`. Other views keep current behavior.
  - **Neutralize the clamp fight**: the `page.jsx` effect that resets `trackingMode` to
    `activeSheet.active_scopes` must not clobber a Dashboard project-level track selection —
    scope/skip it for Dashboard (or clamp to the project track set there instead).
- **Approval gates:** none DB-wise; ⚠ owner sign-off on the final matrix cells before hiding.
- **Exit criteria:** typecheck + test + build green · matrix unit-tested · live `dev:3010`:
  Dashboard shows no Level dropdown / no Milestones button, its track selector switches the
  dashboard's track and the clamp no longer overrides it; other views unchanged ·
  `verify-feature` → STOP.

### Phase 4 — Mobile bottom tab bar (List · Map · Look-Ahead · Dashboard)
- **Scope:** new `src/components/MobileViewTabBar.tsx`.
  - Fixed bottom bar, thumb-reachable, icon + tiny label, 4 tabs (`MOBILE_VIEWS`). Hidden on
    desktop (`md:hidden`); selected state uses the unified accent. Drives `navigateToView`
    (same URL state from Phase 1).
  - **Remove the hard mobile→list force** now that mobile can navigate; rely on
    `resolveInitialView` (URL → defaultViewMode clamped to a mobile-allowed view → list).
  - Coexist with `MobileSwipeDeck` (List presenter) and the existing `hide-*-mobile` chrome
    classes; ensure the bar doesn't overlap swipe-deck controls / safe-area insets.
- **Approval gates:** none.
- **Exit criteria:** typecheck + build green · live `dev:3010` at mobile width (and a real
  phone if possible): all 4 tabs switch views, URL updates, Back walks views, Schedule is
  absent on mobile, no overlap with the swipe deck · `verify-feature` → STOP.

### Phase 5 — Map toolbar: split modes vs settings + unified accent
- **Scope:** `MapHorizontalToolbar.tsx`.
  - Reorganize into two groups with a divider: **modes** (pan/draw/select/route/etc. — one
    active at a time) and **on/off settings** (snapping, magnifier, walk-sequence, legend,
    history, crosshair). Optionally tuck rarely-used toggles behind an overflow "⋯".
  - Apply the unified accent to selection states **but keep meaning-colors** (amber Lag Mode,
    etc.) per the owner decision.
- **Approval gates:** none.
- **Exit criteria:** typecheck + build green · live `dev:3010`: modes vs settings visually
  grouped, meaning-colors intact, every toggle still works · `verify-feature` → STOP.

## Verification commands (the exit-criteria gate)
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
- **Lint is NOT a gate** (~1850 pre-existing problems). Verify with typecheck + test + build.
- **No E2E framework** — a live click-through via `npm run dev:3010` (from `sitepulse-next/`,
  port 3010) is the only UI verification. Test mobile via browser device emulation + a real
  phone for Phase 4.
- Vitest globals are OFF: import `{ describe, it, expect, vi }` from `'vitest'`; co-locate
  `foo.test.ts` next to `foo.ts`.

## Hard guardrails (AGENTS.md — do not violate)
- **No server-state for view/nav.** `viewMode` stays Zustand/URL — never TanStack Query.
- **Use `useHydratedStore`** for any persisted settings read (e.g. `defaultViewMode`) to avoid
  hydration mismatch.
- **Do not touch** the offline mutation queue, `pendingChanges` (stays local `useState`),
  `status_logs` writes, or `progressAnalytics` math. The Dashboard track change only swaps the
  `trackingMode` string the existing analytics already consume — do not fork that math.
- **Do not recolor `mapDisplayStatuses`** in `page.jsx` (it feeds write paths) — the accent
  unification is chrome only; Lag Mode recolor stays inside `FloorplanCanvas` as today.
- **Typed Zustand setters / no `any`** (AGENTS.md §6). New util files are `.ts`; tests type-clean.
- **Don't commit or push until the owner says "Approved."** Branch off `main` per phase.

## Open decisions (resolve in-phase)
- Exact per-view matrix cells marked `?` (Schedule's Milestones/Export, Look-Ahead's
  Level/Scope) — confirm with owner in **Phase 3** before hiding.
- Whether the desktop switcher physically relocates (out of the scrolling cluster) or just
  gets a divider — decide visually in **Phase 2** with a `dev:3010` preview.
- Bottom-tab visual treatment (filled vs underline active) — settle in **Phase 4** preview.

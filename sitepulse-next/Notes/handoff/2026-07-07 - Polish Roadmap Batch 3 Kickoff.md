# Kickoff — Polish Roadmap, Batch 3: one status-color language + mobile tab bar + map-toolbar split

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Batch 3 of the Polish Roadmap** — the final batch: a tiny owner-noted fix
> plus three sub-phases on ONE branch, one commit each, in order: (0) empty-level list
> toolbar fix [owner-noted 2026-07-07], (1) shared status-color module + ongoing=BLUE
> everywhere [Polish plan P2], (2) mobile bottom tab bar [Navigation plan P4], (3) map
> toolbar modes-vs-settings split [Navigation plan P5]. Read these in full, then follow
> them:
> - `sitepulse-next/Notes/handoff/2026-07-07 - Polish Roadmap Batch 3 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/UI-Polish-Design-Consistency-Plan.md` (§ Roadmap, P2)
> - `sitepulse-next/Notes/plans/Navigation-Per-View-Header-Plan.md` (Phases 4–5)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Every decision is pre-locked — run the whole batch without asking me
> anything; end with ONE review summary (include the canvas-marker before/after). No
> DB/backend changes of any kind. Don't commit until each sub-phase's gates are green;
> don't push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Batch model (owner-locked 2026-07-06)
Third and FINAL of 3 autonomous batches (roadmap table in the Polish plan; Batches 1–2
shipped 2026-07-07). Rules: **one branch**, **one commit per sub-phase** (bisectable),
**no mid-batch owner questions** (judgment calls → pick sensibly, flag in the review),
**one review at the end** with before/after screenshots, then STOP — no push until
"Approved". Completing this batch un-gates the **Data Storytelling** workstream (its
Batch A kickoff already exists in `Notes/handoff/`).

## What Batches 1–2 already landed (build on it, don't re-create it)
- `src/utils/viewRouting.ts`: VIEW_MODES, resolveInitialView (+`mobileAllowed` arg),
  MOBILE_VIEWS, and **controlVisibility(viewMode)** (per-view header matrix, tested).
- View switching is URL-first: `navigateToView` (page.tsx) threaded as a prop — the tab
  bar must drive it, never a bare `setViewMode` (AGENTS.md §2).
- The page passes `mobileAllowed: ['list']` to resolveInitialView — **Nav P4 widens it
  to MOBILE_VIEWS** and removes the hard mobile force-to-list.
- TopHeader: labeled switcher (labels at `xl:`+), ONE blue accent
  (`bg-blue-600/90 text-white dark:bg-blue-500/90`) — the tab bar and map toolbar reuse
  this exact accent.
- StatusTable has `DateChipCell` + `listDensity`; FloorplanCanvas is decomposed
  (CanvasBase/Units/OverlayLayer; canvas display code = `src/utils/constants.ts` +
  `src/components/canvas/MappedUnit.tsx`).
- ⚠ Next.js 16.2.3; bundled docs at `node_modules/next/dist/docs/` — read before using
  unfamiliar APIs. Dev server: `npm run dev:3010`. Dev banner points at PRODUCTION data
  — read/UI-state probes only; never write-probe real rows.

## Sub-phase 0 — Empty-level list toolbar fix (owner-noted 2026-07-07, tiny)
`FieldStatusTable.tsx`: the "No locations mapped on this level yet" early-return renders
BEFORE `ManageToolbar`, so on an empty level the toolbar — including the **"All levels"
scope switch** — is unreachable. Fix: on desktop, render the toolbar (at minimum the
This-level/All-levels scope group) above the empty-state message instead of replacing
it. Keep the mobile path unchanged. One small commit.

## Sub-phase 1 — Shared status-color module + ongoing = BLUE (Polish plan, Phase 2)
- New `src/utils/statusColors.ts` (+ test pinning the palette): THE canonical
  temporal-state palette keyed `'none' | 'planned' | 'ongoing' | 'completed'` — hex
  values (Konva/lookahead inline styles) + Tailwind class bundles (chip, dot, segment,
  inverted). Adopt in all four sources (visual parity, no behavior change):
  1. `FieldStatusAtoms.getTemporalStateStyle` / `getInvertedBadgeStyle` / `STATUS_SEGMENTS`
  2. `MapSidebar.STAGE_DOT`
  3. `constants.TEMPORAL_COLORS` → `MappedUnit` (canvas markers)
  4. lookahead `t.st.*` tokens (`ActionBars.tsx` / `Menus.tsx` / `Toolbar.tsx`)
- **Ongoing = BLUE is owner-locked (2026-07-06)** — the canvas marker changes amber→blue
  (amber stays reserved for "planned"); keep the play-triangle glyph; markers still hide
  below 0.7× zoom. Include a canvas before/after screenshot in the batch review.
- `BottleneckIndicator`: plain-language tooltip ("Out of sequence — a later step started
  before an earlier one finished") wherever the red dot renders (StatusTable + swipe deck).
- Look-ahead `Toolbar.tsx` undo hint: platform-aware `Ctrl+Z` / `⌘Z` (small isMac check
  in the component).
- DB-sourced `status_logs.status_color` polygon fills are UNTOUCHED; never recolor
  `mapDisplayStatuses` in page.tsx.

## Sub-phase 2 — Mobile bottom tab bar (Navigation plan, Phase 4)
- New `src/components/MobileViewTabBar.tsx`: fixed bottom bar, 4 tabs from
  `MOBILE_VIEWS` (List · Map · Look-Ahead · Dashboard — **Schedule intentionally absent
  on phones**), icon + tiny label, `md:hidden`, selected state = the unified blue
  accent (visual treatment beyond that = implementing session's pick; flag it). Drives
  `navigateToView`.
- Widen page.tsx `mobileAllowed` to `MOBILE_VIEWS` (removes the hard force-to-list; the
  URL still wins — Batch 1 wiring).
- Coexist with `MobileSwipeDeck` + the `hide-*-mobile` chrome classes; respect
  safe-area insets; no overlap with swipe-deck controls or the pending-changes UI.
- This widens `mobileAllowed` — re-check `viewRouting.test.ts` precedence cases and the
  first-load clamp on a phone-width viewport.

## Sub-phase 3 — Map toolbar: modes vs settings split (Navigation plan, Phase 5)
- `MapHorizontalToolbar.tsx`: reorganize into two divider-separated groups — **modes**
  (pan/draw/select/route… one active at a time) vs **on/off settings** (snapping,
  magnifier, walk-sequence, legend, history, crosshair, mini-map…).
- **Conservative default (owner-locked):** group with dividers, do NOT hide tools
  behind an overflow "⋯" menu.
- Unified blue accent on selection states, but **keep meaning-colors** (amber Lag Mode
  etc. — color that encodes information stays).

## Hard guardrails (both plans + AGENTS.md)
- No DB/RLS/migration/backend changes; no `status_logs` write-path changes;
  `pendingChanges` stays local `useState`; never fork `progressAnalytics`; don't
  recolor `mapDisplayStatuses`; `VARIANCE_COLORS` untouched.
- Canvas changes live in constants/MappedUnit display code only; Lag Mode recolor stays
  inside FloorplanCanvas (pure `canvasRecolor`).
- `useHydratedStore` for every persisted read. New files `.ts`/`.tsx`, no `any`; tests
  import from `'vitest'` (globals OFF).
- Mouse-wheel must always zoom (owner standing rule) — don't disturb wheel handling
  while touching the map toolbar.

## Exit criteria (whole batch)
Per sub-phase before its commit, then once more at the end:
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green
- `... run test` green (`statusColors` palette pinned; viewRouting precedence updated)
- `... run build` green
- dev:3010 click-throughs: empty level shows the scope switch (sub-phase 0) · map
  legend, list segments, swipe deck, look-ahead chips, schedule dots, and canvas
  markers all speak the same four colors; ongoing reads blue on the map; markers still
  hide below 0.7× zoom (sub-phase 1) · at phone width all 4 tabs switch views, URL
  updates, Back walks views, Schedule absent, no swipe-deck overlap — plus a real
  phone if available (sub-phase 2) · modes vs settings read as two groups, every
  toggle still works, amber Lag Mode intact (sub-phase 3).
- Close with `verify-feature` across all sub-phases → ONE review summary with
  screenshots (incl. canvas marker before/after) → STOP (no push until "Approved"),
  then draft the Data Storytelling un-gate note / next kickoff.

# UI Polish & Design Consistency — one theme, one status language, honest empty states (self-contained build plan)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Sibling plan: `Notes/plans/Navigation-Per-View-Header-Plan.md` — the two workstreams
> interleave (see § Roadmap). That plan owns URL views, the labeled switcher, the
> context-aware header, the mobile tab bar, and the map-toolbar regroup. THIS plan owns
> theme unification, the shared status-color language, empty states, dashboard color
> calibration, and list-view polish. Do not duplicate its scope here.

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) — especially §0 (how to talk to
   the owner), §2 (state management), §3 (map engine + progressAnalytics single source of
   truth), §6 (TS guardrails).
2. Re-read the files named in each phase **fresh** — do NOT trust line numbers in this
   doc; they drift. Re-grep before editing.
3. Build the phases in order (within the § Roadmap interleave). Verify after each slice
   (§ Verification commands).
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence
   plain-English summary; explain jargon in passing; keep it short.

## Goal
When this is done: the whole app — home dashboard, project views, and workbench — follows
the one Light/Dark/System setting instead of changing identity per zone; every surface
(map legend, list segmented control, schedule dots, look-ahead chips, canvas markers)
speaks **one status-color language** from a single tested module; "stalled" reads amber
(needs attention) instead of alarm red; the schedule timeline and dashboard explain their
empty moments instead of showing silent gray rows and `—` dashes; and the field list's 80
repeated `mm/dd/yyyy` ghost inputs become quiet date chips, with an optional compact row
density for PM screens.

## Out of scope / deferred
- **Everything in the Navigation plan**: `?view=` URLs, switcher labels/accent, per-view
  header control matrix, mobile bottom tab bar, map-toolbar mode/setting split. That plan
  is the vehicle for those — run its phases per the § Roadmap.
- **No data-model / DB / RLS / migration changes.** Zero backend work anywhere in this
  plan. If a phase seems to need one, stop — it's out of scope.
- **No changes to stored `status_logs.status_color` or any write path.** Every color
  change here is chrome (display) only.
- **No redesign of the variance scale** (`VARIANCE_COLORS` behind1→behind15 tiers stays
  exactly as-is — red for 15+ days behind is correct and stays).
- Marketing-style home-page redesign; new fonts; motion/animation passes.

## Locked product decisions (from the owner, 2026-07-06)
- **One theme everywhere** — move the `data-theme` wiring to the root layout so home,
  project, and workbench all follow the Light/Dark/System setting. Workbench keeps its
  purple accent; it just gains a dark rendition.
- **Stalled → amber** — stalled (no movement 14+ days) renders amber everywhere;
  red is reserved for the late variance tiers (15+ days behind plan) and for the
  "pace dropped" sparkline (getting worse ≠ stalled).
- **Ongoing = BLUE everywhere** — the canvas markers change amber→blue to match the
  legend/list/swipe deck; amber stays reserved for "planned". (Resolves the P2 color
  question — no in-phase preview gate needed.)
- **Header matrix: hide all four `?` cells** — Schedule loses the Milestones button and
  Export; Look-Ahead loses the Level selector and Scope tabs (recorded in the
  Navigation plan's matrix too).
- **Batched autonomous execution** — the 9 phases run as **3 unattended batches**
  (below). Every decision is pre-locked so no mid-batch owner input is needed. Each
  batch: **one branch, one commit per sub-phase** (bisectable), one owner click-through
  review at the end, nothing pushed until "Approved".

## Roadmap (3 autonomous batches across both plans)
| Batch | Contents (in build order) | Plan phases |
|-------|---------------------------|-------------|
| **1** ✅ shipped 2026-07-07 | View in the URL (`?view=`) · Theme unification · Empty states + stalled→amber | Nav P1 · Polish P1 · Polish P3 |
| **2** | Switcher labels + accent · Context-aware header (matrix locked above) · List date chips + compact density | Nav P2 · Nav P3 · Polish P4 |
| **3** | Shared status-color module (ongoing=blue) · Mobile bottom tab bar · Map toolbar split | Polish P2 · Nav P4 · Nav P5 |

Batch ordering notes: Batch 2 builds on Batch 1's `viewRouting.ts` (adds
`controlVisibility`); Batch 3's tab bar reuses Batch 1's `navigateToView`. Codebase
Health Slice 2 P9 (canvasRecolor) is already merged, clearing Polish P2's collision
risk — but if Slice 2 **P10 (FloorplanCanvas render split)** is in flight when Batch 3
starts, rebase on it before touching `MappedUnit`/canvas display code. Batch 3's map
toolbar work takes the conservative default: group with dividers, hide nothing behind
an overflow menu. Each batch is opened by its own kickoff in `Notes/handoff/` and
closed by `verify-feature` covering every sub-phase's exit criteria.

## Data model
None. This workstream reads existing client state only:
- `useSettingsStore.colorMode` (`'light' | 'dark' | 'system'`, persisted localStorage) —
  read via `useHydratedStore` (AGENTS.md §2).
- Display-side status/variance data already flowing into the components being restyled.
It writes nothing to Supabase and adds no columns, RPCs, or policies.

## Build-on inventory (read these fresh before using)
- `src/app/globals.css` — `[data-theme='dark']` custom variant + the CSS variables both
  themes key off. The mechanism is sound; only *where the attribute gets set* is wrong.
- `src/app/project/[projectId]/page.jsx` — the `useEffect` that sets/removes
  `document.documentElement`'s `data-theme` from `colorMode`. **This effect moves to a
  root-level client component in P1** (and is removed here).
- `src/app/layout.js` — root layout; already mounts a client island (`DevDbBanner`), so a
  sibling `ThemeApplier` client component follows the established pattern.
- `src/store/useSettingsStore.ts` — `colorMode` + `useHydratedStore`.
- **The four scattered status-color sources to consolidate in P2:**
  1. `src/components/ui/FieldStatusAtoms.tsx` — `getTemporalStateStyle()` /
     `getInvertedBadgeStyle()` (Tailwind class strings), `STATUS_SEGMENTS` (×/PLN/ONG/✓),
     `BottleneckIndicator` (the pulsing red dot = **out-of-sequence**, not "behind
     schedule" — it needs a tooltip/label saying so).
  2. `src/components/MapSidebar.tsx` — `STAGE_DOT` constant (separate hardcoded map).
  3. `src/utils/constants.ts` + `src/components/canvas/MappedUnit.tsx` —
     `TEMPORAL_COLORS` + marker glyph paths. ⚠ **Known inconsistency:** the canvas marker
     colors `ongoing` amber (`#f59e0b`) while every other surface colors ongoing blue.
  4. `src/lookahead/components/ActionBars.tsx` / `Menus.tsx` / `Toolbar.tsx` — theme
     tokens `t.st.start/ongoing/done`; `Toolbar.tsx` also holds the `⌘Z undo` hint text.
- `src/utils/progressAnalytics.ts` — `VARIANCE_COLORS` / `varianceFill` /
  `varianceLabel` / `VARIANCE_LEGEND` + stall detection (`STALL_THRESHOLD_DAYS = 14`,
  `GroupRollup.stalledUnitIds`). **Single source of truth — never fork it** (AGENTS.md
  §3). P3 changes how *consumers* color the stalled count, not the variance scale.
- Stalled-red consumers: `src/components/ProjectDashboard.tsx` ("N stalled locations"
  red text under Projected Finish), `src/components/dashboard/FloorPulse.tsx` (stalled
  chips + the `—` suppression captions), `src/components/dashboard/TypeScorecard.tsx`
  (stalled chips; its red/emerald sparkline = pace decay and **stays red**).
- `src/components/schedule/GanttTimeline.tsx` — timeline rows + the `w-2.5` location
  dots (`meta?.color || '#cbd5e1'`); this is where the P3 empty-state banner goes.
  (`SchedulePlanPanel.tsx` is the floor-plan reference panel, already has an empty state.)
- `src/components/StatusTable.tsx` — desktop list presenter: native
  `<input type="date">` pairs (main + expanded child rows), the pending-amber border
  treatment (keep it), row padding classes (`py-3`/`py-2`), `BottleneckIndicator` usage.
- `src/components/MobileSwipeDeck.tsx` — shares `FieldStatusAtoms`; anything changed
  there must be eyeballed on the swipe deck too.

## Pure logic to extract + unit-test
- **P2: `src/utils/statusColors.ts` (+ `.test.ts`)** — THE canonical temporal-state
  palette: one record keyed by `'none' | 'planned' | 'ongoing' | 'completed'` exposing
  hex values (for Konva/canvas + lookahead inline styles) and Tailwind class bundles
  (chip, dot, segment, inverted) for DOM surfaces. Tests pin the palette (a snapshot of
  the mapping) so a drive-by edit to one surface can't silently fork the language again.
  All four inventory sources above re-export/consume from here.
- **P4: `formatPlannedDate(iso: string | null): string`** in `src/utils/` (+ test) —
  the quiet display form for date chips ("—" when null, short local format otherwise).
  Pass strings in; no `Date.now()` inside.
- P1 needs no new pure logic (the effect moves verbatim); P3's banner is presentational.

## Sub-phasing (ship + verify each)

### Phase 1 — Theme unification (root-layout wiring + dark audit)
> ✅ **SHIPPED 2026-07-07** (Polish Batch 1, main `23f4ed7`). Bonus taken: `'system'`
> now follows `prefers-color-scheme` live via a matchMedia listener in ThemeApplier
> (plan-authorized as trivial); explicit Light/Dark unchanged. Dark audit of
> /dashboard, /workbench, /workbench/<id> found no stragglers.
- **Scope:**
  - New client component `src/components/ThemeApplier.tsx`: reads `colorMode` via
    `useHydratedStore`, sets/removes `data-theme` on `document.documentElement` in an
    effect (move the logic verbatim from `project/[projectId]/page.jsx`, then delete it
    there). Mount in `src/app/layout.js` next to `DevDbBanner`.
  - Live audit at dev:3010 in dark mode: `/dashboard`, `/workbench`, `/workbench/<id>`
    (most components already carry `dark:` variants — fix the stragglers that don't;
    keep the workbench purple accent in both themes).
  - Known quirk to preserve, not fix: `'system'` currently removes the attribute and
    renders light (no `prefers-color-scheme` handling). Matching current project-page
    behavior app-wide is the scope; wiring real system detection is a bonus ONLY if
    trivial (matchMedia listener in ThemeApplier), else note and move on.
- **Approval gates:** none beyond the standing "don't commit/push until Approved."
- **Exit criteria:** typecheck + test + build green · dev:3010 click-through: theme
  toggle in Settings flips home + project + workbench together; no flash-of-wrong-theme
  regressions on hard reload · `verify-feature` → STOP.

### Phase 2 — Shared status-color module + chip/marker consistency
- **Scope:**
  - Add `src/utils/statusColors.ts` (+ tests) per § Pure logic.
  - Adopt it in all four sources: `FieldStatusAtoms.getTemporalStateStyle` /
    `getInvertedBadgeStyle`, `MapSidebar.STAGE_DOT`, `constants.TEMPORAL_COLORS`
    (consumed by `MappedUnit`), and the lookahead `t.st.*` tokens — visual parity, no
    behavior change. DB-sourced `status_color` polygon fills are untouched.
  - **Ongoing = blue is owner-locked (2026-07-06)** — the canvas "ongoing" marker
    changes amber→blue; no preview gate needed. Keep the play-triangle glyph. Include a
    before/after screenshot in the batch-review summary so the owner sees the map-read
    change explicitly.
  - `BottleneckIndicator`: add a plain-language tooltip/title ("Out of sequence — a
    later step started before an earlier one finished") wherever the red dot renders
    (StatusTable + swipe deck).
  - Look-ahead `Toolbar.tsx` hint: platform-aware modifier — show `Ctrl+Z` on
    Windows/Linux, `⌘Z` on Mac (small `isMac` check via `navigator.platform`/userAgent,
    computed in the component, not in a pure util pretending to be testable).
- **Approval gates:** none in-phase (color locked); marker before/after goes in the
  batch-review summary.
- **Exit criteria:** typecheck + test + build green · `statusColors.test.ts` pins the
  palette · dev:3010: map legend, list segments, swipe deck, look-ahead chips, schedule
  dots, and canvas markers all show the same four colors; markers still hide below 0.7×
  zoom · `verify-feature` → STOP.

### Phase 3 — Empty states + dashboard color calibration
> ✅ **SHIPPED 2026-07-07** (Polish Batch 1, main `4d122c9`). Stalled→amber in all
> three consumers; Gantt empty-plan banner (pinned by `GanttTimeline.test.tsx`; live
> case verified on Orchard Level 1 — Mill Pond never reaches the timeline, it has no
> activities); `—` cells got muted captions + tooltips reading the now-exported
> `progressAnalytics` constants (values unchanged).
- **Scope:**
  - **Stalled → amber** (locked decision): the "N stalled locations" text in
    `ProjectDashboard.tsx` and the stalled chips in `FloorPulse.tsx` /
    `TypeScorecard.tsx` switch red→amber classes. `VARIANCE_COLORS`, `varianceFill`,
    `VARIANCE_LEGEND`, and the TypeScorecard pace-decay sparkline red are **untouched**.
  - **Schedule timeline empty state**: in `GanttTimeline.tsx`, when the visible rows
    have zero planned dates, render one clear banner in the timeline area — "No planned
    dates yet — set them with **Level dates** or **Import**" (name the real buttons).
    Suppress it as soon as any bar exists.
  - **Dashboard `—` presentation**: keep the honesty (never fake a forecast —
    AGENTS.md §3), but give the suppressed cells a consistent quiet treatment: the `—`
    plus its reason caption ("too few tasks to project" / "no recent pace") in one
    muted style, with a `title` tooltip explaining the threshold (12 slots / 6-week
    pace window — read the real constants from `progressAnalytics.ts`, do not restate
    them wrong). Copy tweaks only; `summarizeGroup` / `projectForecastDate` logic is
    off-limits.
  - Schedule row dots: with the banner explaining emptiness, leave the dot semantics
    (variance-colored via `meta?.color`) as-is; just confirm the no-data fallback dot
    reads as intentional (muted slate) next to the banner.
- **Approval gates:** none.
- **Exit criteria:** typecheck + test + build green · dev:3010: Orchard dashboard shows
  amber stalled + red variance tiers distinctly; Mill Pond's schedule timeline shows the
  banner; dashes have tooltips · `verify-feature` → STOP.

### Phase 4 — List-view polish (date chips + compact density)
- **Scope:**
  - **Quiet date cells** in `StatusTable.tsx` (main rows + expanded child rows): render
    `formatPlannedDate(...)` as a flat text chip ("—" when unset); clicking/focusing the
    chip swaps in the native `<input type="date">` (auto-focused, opens the picker),
    reverting on blur. Keep the amber pending-change border on the active input and add
    an equivalent amber tint to a chip with a pending date. Keyboard: chip is a button,
    Enter/Space activates. No mutation-path changes — same handlers, same values.
  - **Compact density toggle**: a `listDensity: 'comfortable' | 'compact'` in
    `useSettingsStore` (persisted; read via `useHydratedStore`), a small toggle in the
    list toolbar, and a `py`/text-size swap in `StatusTable` rows. Default stays
    comfortable. Desktop presenter only — the swipe deck is untouched.
- **Approval gates:** none.
- **Exit criteria:** typecheck + test + build green · `formatPlannedDate` unit-tested ·
  dev:3010: date edit round-trips (set, clear, pending-amber, offline-queued apply still
  works), density toggle persists across reload · `verify-feature` → STOP.

## Verification commands (the exit-criteria gate)
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
- **Lint is NOT a gate** (~1850 pre-existing problems). Verify with typecheck + test + build.
- **No E2E framework** — live click-through via `npm run dev:3010` (from `sitepulse-next/`,
  port 3010) is the only UI verification. Phases 2–4 must be eyeballed on BOTH a
  data-rich project (Orchard Path III) and an empty one (Mill Pond) — the empty states
  are half the point.
- Vitest globals are OFF: import `{ describe, it, expect, vi }` from `'vitest'`;
  co-locate `foo.test.ts` next to `foo.ts`.

## Hard guardrails (AGENTS.md — do not violate)
- **Never fork `progressAnalytics`** — variance/stall math and `VARIANCE_COLORS` stay
  the single source of truth; P3 recolors *consumer chrome* only.
- **Do not recolor `mapDisplayStatuses`** in `page.jsx` (feeds write paths); canvas
  color changes live in `constants.ts`/`MappedUnit` display code only.
- **No `status_logs` write-path changes**; `pendingChanges` stays local `useState`;
  the P4 date-chip swap reuses the existing handlers untouched.
- **`useHydratedStore` for every persisted read** (colorMode, listDensity) — hydration
  mismatch is the classic failure here.
- **Typed everything** (AGENTS.md §6): new files `.ts`/`.tsx`, no `any`, typed Zustand
  setters; test files type-clean.
- **Don't commit or push until the owner says "Approved."** Branch off `main` per phase.

## Open decisions
None blocking — everything needed for autonomous batch runs is locked above. Judgment
calls delegated to the implementing session (owner adjusts at batch review if needed):
- **P3:** exact empty-state banner copy — draft it; owner wordsmiths at review.
- **P4:** compact-mode row metrics (how tight is "compact") — pick sensible; owner
  adjusts at review.

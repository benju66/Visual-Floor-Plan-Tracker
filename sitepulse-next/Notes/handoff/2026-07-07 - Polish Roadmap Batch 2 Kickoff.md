# Kickoff — Polish Roadmap, Batch 2: switcher labels + context-aware header + list date chips

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Batch 2 of the Polish Roadmap** — three sub-phases on ONE branch, one
> commit each, in order: (1) desktop switcher labels + unified accent [Navigation
> plan P2], (2) per-view context-aware header + Dashboard track re-source
> [Navigation plan P3], (3) list date chips + compact density [Polish plan P4].
> Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-07 - Polish Roadmap Batch 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Navigation-Per-View-Header-Plan.md` (Phases 2–3 + the control matrix)
> - `sitepulse-next/Notes/plans/UI-Polish-Design-Consistency-Plan.md` (§ Roadmap, P4)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Every decision is pre-locked — run the whole batch without asking me
> anything; end with ONE review summary. No DB/backend changes of any kind. Don't commit
> until each sub-phase's gates are green; don't push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Batch model (owner-locked 2026-07-06)
Second of **3 autonomous batches** (roadmap table in the Polish plan; Batch 1 shipped
2026-07-07). Rules: **one branch**, **one commit per sub-phase** (bisectable), **no
mid-batch owner questions** (judgment calls → pick sensibly, flag in the review),
**one review at the end** with before/after screenshots, then STOP — no push until
"Approved". After approval, the closing session drafts the **Batch 3 kickoff**
(Polish P2 statusColors + Nav P4 mobile tab bar + Nav P5 map-toolbar split).

## What Batch 1 already landed (build on it, don't re-create it)
- `src/utils/viewRouting.ts` exists (VIEW_MODES, isValidViewMode, MOBILE_VIEWS,
  resolveInitialView + tests). **Nav P3's `controlVisibility` goes in this file.**
- View switching is URL-first: `navigateToView` (page.tsx) is threaded as a prop into
  `TopHeader`, `ProjectDashboard`, `SettingsMenu`. Keep routing all view jumps through
  it (AGENTS.md §2 bullet).
- The page passes `mobileAllowed: ['list']` to resolveInitialView — leave that alone
  (it widens to MOBILE_VIEWS in Nav P4, Batch 3).
- ThemeApplier lives in the root layout; stalled = amber; Gantt empty-plan banner has
  a component test (`GanttTimeline.test.tsx`) — don't regress these.
- ⚠ Next.js is 16.2.3; bundled docs DO exist at `node_modules/next/dist/docs/`
  (the Batch 1 kickoff said otherwise). Read them before using unfamiliar APIs.

## Sub-phase 1 — Desktop switcher: labels + unified accent (Navigation plan, Phase 2)
`TopHeader.tsx` visuals only, no behavior change:
- Icon + **text label** on each of the 5 view buttons; labels at `lg:`+, icon-only
  `md:`–`lg:`. Keep tooltips.
- Selected state: replace the dark-slate fill (`bg-slate-800 …dark:bg-white`) with the
  **single blue accent** matching the scope tabs (`bg-blue-600/90 text-white
  dark:bg-blue-500/90`).
- Visually separate the three control families (Views / Scope-Track / Level) with
  dividers or spacing; if the switcher risks scrolling off in the `overflow-x-auto`
  cluster at laptop widths, move it out (divider is the default; owner adjusts at
  review).

## Sub-phase 2 — Context-aware header + Dashboard track re-source (Navigation plan, Phase 3)
- Add `controlVisibility(viewMode)` to `viewRouting.ts` (+ table-driven tests)
  implementing the **owner-confirmed matrix** (all cells locked 2026-07-06 — Schedule
  hides the activities-filter button and Export; Look-Ahead hides Level selector and
  Scope tabs; Dashboard hides Level selector and the activities-filter button). Gate
  the TopHeader controls with it.
- ⚠ Terminology drift: the plan's "Milestones button" is today's **"Activities
  (Ctrl+K)"** button, and "milestones.map(m => m.track)" is now **activities** (the
  milestone→activity sweep renamed everything). Same semantics.
- **Re-source the Dashboard track selector**: on `viewMode === 'dashboard'` the Scope
  tabs list project-level tracks (`[...new Set(activities.map(a => a.track))]`), not
  `activeSheet.active_scopes`. TopHeader doesn't currently receive `activities` —
  thread the list (or the derived track array) from page.tsx.
- **Neutralize the clamp fight**: the page.tsx effect that resets `trackingMode` to
  `activeSheet.active_scopes` must not clobber a Dashboard project-level track pick —
  skip it while on Dashboard (or clamp to the project track set there instead).

## Sub-phase 3 — List date chips + compact density (Polish plan, Phase 4)
- Pure `formatPlannedDate(iso: string | null): string` in `src/utils/` (+ test): "—"
  when null, short local format otherwise; no `Date.now()` inside.
- `StatusTable.tsx` (desktop presenter ONLY — swipe deck untouched): render planned
  dates as quiet text chips; click/focus swaps in the native `<input type="date">`
  (auto-focused, opens picker), reverting on blur. Chip is a keyboard-activatable
  button. Keep the amber pending-change border on the active input and give a pending
  chip an equivalent amber tint. **Same handlers, same values — zero mutation-path
  changes** (the offline `pendingChanges` flow must round-trip untouched).
- `listDensity: 'comfortable' | 'compact'` in `useSettingsStore` (persisted; read via
  `useHydratedStore`), a small toggle in the list toolbar, `py`/text-size swap in the
  rows. Default comfortable. Compact metrics = implementing session's pick; flag it.

## Hard guardrails (both plans + AGENTS.md)
- No DB/RLS/migration/backend changes; no `status_logs` write-path changes;
  `pendingChanges` stays local `useState`; **never fork `progressAnalytics`**; don't
  recolor `mapDisplayStatuses`.
- Keep meaning-colors (amber Lag Mode etc.) — the accent unification is chrome only.
- `useHydratedStore` for every persisted read (`listDensity`). New files `.ts`/`.tsx`,
  no `any`; tests import from `'vitest'` (globals OFF).
- The dev banner points at PRODUCTION data — verify with reads and UI-state probes
  only; never write-probe live rows (a date-chip edit IS a write — test the
  round-trip on a sandbox project's location, not Orchard/Mill Pond real rows).

## Exit criteria (whole batch)
Per sub-phase before its commit, then once more at the end:
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green
- `... run test` green (`controlVisibility` matrix + `formatPlannedDate` unit-tested)
- `... run build` green
- dev:3010 click-throughs: labels render, one blue selected state, families read as
  three groups, no horizontal clipping (sub-phase 1) · Dashboard shows no Level
  dropdown / no activities button, its track selector switches the dashboard and the
  clamp no longer overrides it; Schedule/Look-Ahead hide their matrix cells; other
  views unchanged (sub-phase 2) · date chip edit round-trips (set, clear,
  pending-amber, offline apply) on a sandbox project; density toggle persists across
  reload (sub-phase 3).
- Close with `verify-feature` across all three sub-phases → ONE review summary with
  screenshots → STOP (no push until "Approved"), then draft the Batch 3 kickoff.

# Data Storytelling — make correct numbers tell the true story (self-contained build plan)
> ✅ **STATUS: COMPLETE — shipped to `main` 2026-07-08.** Batch A (P1 planned-vs-projected +
> hero clamp, P2 honest empties/swarm/counting) shipped 2026-07-07; Batch B (P3 list
> accountability — age, days-behind, ownership, "By" column — + P4 benchmarking→home)
> approved + merged 2026-07-08. **Owner adjustment at the Batch B review:** the "Actual
> Completed" column was KEPT as its own column (the planned completed-fold was reverted).
> Follow-up workstream spawned: `Notes/plans/Schedule-Variance-Columns-Plan.md`.
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: none. Siblings: `Notes/plans/UI-Polish-Design-Consistency-Plan.md` +
> `Notes/plans/Navigation-Per-View-Header-Plan.md` (the Polish Roadmap).
> ⛔ **Sequencing gate: this workstream starts only after the Polish Roadmap's Batch 3 is
> approved and pushed.** It builds on Polish deliverables: the shared `statusColors.ts`
> module, the list date-chip pattern (Polish P4), and stalled→amber (Polish P3).

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) + the two sibling plans'
   "Locked decisions" sections (they changed the surfaces this plan edits).
2. Re-read the files named below fresh — do not trust line numbers; they drift.
   ⚠ Investigation note: NEVER read from `.claude/worktrees/` — stale snapshots.
3. Build the phases in order, in the two autonomous batches (§ Execution model).
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence
   plain-English summary; explain jargon in passing; keep it short.

## Goal
When this is done, the app's numbers answer a PM's real questions instead of merely being
correct: the dashboard shows **planned finish next to projected finish with the delta in
days** ("projected vs promised"); the hero projection can never contradict its own
per-level rows; a mostly-stalled project says "no work logged in 2+ weeks — data may be
out of date" instead of shouting 115 chips; every list row shows **how old its data is**,
**how many days behind** it is (as a number, not just a color), and **whose court the
ball is in** (assigned person and/or the bottleneck activity's subcontractor); the
mostly-empty "Actual Completed" column folds into the status cell; plan-dependent
widgets explain how to unlock themselves instead of rendering dead "no plan dates"
cells; and Private Benchmarking moves to the home Projects Dashboard where its
cross-project content belongs.

## Out of scope / deferred (owner-decided 2026-07-07)
- **SF-weighted progress — DEFERRED entirely** (revisit after more sheets have calibrated
  areas). Do not add area weighting to any progress math.
- **Look-ahead ↔ tracker integration (PPC)** and **field evidence (photos/notes/reasons)**
  — explicitly later workstreams.
- **No data-model / DB / RLS / migration changes.** Display + client-side derivation only.
  The audit log, assignments, and subcontractor links all already exist.
- **No forecast-math changes** — `projectForecastDate` / `summarizeGroup` pace math stays
  untouched; this plan adds *presentation* (clamp + planned-finish comparison) around it.
- No new columns fetched per-row in hot paths without checking query cost (§ guardrails).

## Locked product decisions (from the owner)
- **Planned vs Projected on the dashboard** (2026-07-07) — the single most
  decision-relevant number; planned finish derives from existing `planned_end_date` data.
- **Hero forecast must not contradict level rows** — clamp the project "Projected Finish"
  to no earlier than the latest per-level forecast, with a hint explaining the basis.
- **Stalled swarm collapses to ONE banner** past a threshold (~60% of tracked locations
  stalled): "No work logged in 2+ weeks across most of this project — data may be out of
  date." Below threshold, per-level amber chips behave as today (post-Polish).
- **"Actual Completed" column folds into the status cell** — completed date becomes a
  small editable chip under the ✓ state; the dedicated column is removed; the correction
  ability is preserved.
- **Private Benchmarking moves to the home Projects Dashboard** — it is cross-project by
  design (its own doc-comment says so) and follows the owner's standing global-vs-project
  placement rule.
- **Staleness v1 = age only, from data already loaded** (max `client_timestamp` across a
  location's status rows). "By whom" lives in the Unit History modal (resolve names
  there via the existing members hook), not as a list column.
- **Batched autonomous execution** (same model as the Polish Roadmap): 2 batches, one
  branch each, one commit per phase, no mid-batch questions, one review at the end,
  push only on "Approved".

## Execution model (2 autonomous batches, after Polish Batch 3)
| Batch | Contents (in build order) | Phases |
|-------|---------------------------|--------|
| **A** | Planned-vs-Projected + hero clamp · honest empties/swarm/counting fixes | P1 · P2 |
| **B** | List accountability (staleness, days-behind, ownership, completed-fold) · Benchmarking relocation | P3 · P4 |

## Data model (read-only — nothing new is written)
- `status_logs.planned_end_date` (planned finish derivation) + `client_timestamp`
  (staleness) — both already fetched by the views that need them.
- `status_audit_log.user_id` / `changed_at` — already in the Unit History modal's data;
  names resolve client-side via `useProjectMembers` (join `profiles` display_name).
- `units.assigned_to` (person) via `useProjectMembers`; bottleneck ownership via the
  bottleneck activity's `activities.subcontractor_id` → `useCompanies()` name lookup.
- Applicability is respected everywhere via the existing `ApplicabilityIndex` params —
  never count N/A slots (AGENTS.md §3).

## Build-on inventory (read these fresh before using)
- `src/utils/progressAnalytics.ts` — `summarizeGroup`, `projectForecastDate`,
  `varianceFill`/`varianceLabel` (the days-behind numbers already exist inside
  `VarianceInfo`), `STALL_THRESHOLD_DAYS`. **Extend with new pure fns; never fork.**
- `src/components/ProjectDashboard.tsx` — hero "Projected Finish" card
  (`scopeRollup.forecastDate` + `forecastHint`), velocity chart's `plannedEnds`
  derivation (the planned-finish source pattern), stalled count text.
- `src/components/dashboard/FloorPulse.tsx` — computes one `summarizeGroup` rollup per
  sheet internally. P1 lifts these per-level rollups so the hero can clamp against them
  (compute once in ProjectDashboard and pass down, or return them up — do NOT compute
  twice). Its "N LOCATION(S)" label already pluralizes correctly.
- `src/components/dashboard/TypeScorecard.tsx` — variance column ("no plan dates" dead
  cells → P2 nudge), `"{row.units.length} LOCATIONS"` (does NOT pluralize — P2 fix).
- `src/components/MapSidebar.tsx` — `summarizeSheetProgress()` display: shows
  done/ongoing/planned but **omits the existing `buckets.none`** (the unaccounted-units
  gap) and pairs unit-level "done" with slot-level "%" unlabeled (P2 clarifies both).
- `src/utils/unitProgress.ts` — `summarizeSheetProgress()` buckets incl. `none`.
- `src/components/StatusTable.tsx` — "Actual Completed" column (conditional editable
  date when completed, "—" otherwise; main + expanded child rows), `BottleneckIndicator`,
  variance dot, `AssigneeCell` (`src/components/manage/AssigneeCell.tsx` resolves
  `assigned_to` via members). **Polish P4 will have restyled this table's date cells —
  reuse its chip pattern, do not invent a second one.**
- `src/components/MobileSwipeDeck.tsx` — shares atoms; eyeball after P3 changes.
- `src/hooks/useProjectQueries.ts` — `useProjectMembers` (profiles names),
  `useUnitHistory` (audit rows; no profile join — P3 adds a client-side name map in the
  modal), `useStatusHistory` (dashboard; completed-only — not suitable for staleness,
  which is why staleness derives from `status_logs.client_timestamp` instead).
- `src/components/dashboard/SubcontractorBenchmark.tsx` — **zero props, self-contained**,
  lazy `useBenchmarkDataset(open)` (RLS-scoped, paginated past the 1000-row cap). P4
  moves the mount from `ProjectDashboard.tsx` to `src/app/dashboard/page.jsx`.
- `src/app/dashboard/page.jsx` — home page; `QueryProvider` is app-wide (root layout),
  so the benchmark mounts as-is. Theme-aware after Polish Batch 1.
- `src/lookahead/lib/defaults.ts` — `blankWeekDoc()`/`blankRow()` seed a "New Group" +
  empty row; a seed row is `task === '' && sub === '' && cells === {}` (P2 styles these
  as placeholders).

## Pure logic to extract + unit-test
Add to `src/utils/progressAnalytics.ts` (+ extend its `.test.ts`) — schedule math lives
in the single source of truth:
- `scopePlannedFinish(statuses, track): string | null` — max `planned_end_date` among the
  scope's slots; null when none exist (drives both the delta card and its "no planned
  dates" nudge state).
- `clampProjectForecast(heroForecast, levelForecasts): { date, clampedToLevel }` — the
  hero is never earlier than the latest non-null level forecast; reports when clamped so
  the UI can hint "pinned to Level 1's pace".
- `isStalledSwarm(stalledCount, trackedCount, threshold = 0.6): boolean`.
- `planVsProjected(planned, projected): number | null` — whole-day delta (positive =
  projected late vs plan). Pass ISO strings in; no `Date.now()` anywhere.
New `src/utils/staleness.ts` (+ test):
- `lastActivityIso(statusLogs): string | null` — max `client_timestamp` for a unit's rows.
- `formatAge(lastIso, todayIso): string` — "today", "3d", "2w", "—" for null.
Tests pin: clamp only moves dates earlier→later, never later→earlier; swarm threshold
edges; age formatting boundaries; planned-finish null behavior.

## Sub-phasing (ship + verify each)

### Phase 1 — Planned vs Projected + hero clamp (dashboard truth)
- **Scope:**
  - Add the pure fns above to `progressAnalytics.ts` (+ tests).
  - Lift FloorPulse's per-sheet rollups: compute once in `ProjectDashboard.tsx`, pass to
    `FloorPulse` as props (rendering unchanged), clamp the hero card via
    `clampProjectForecast`; hint text explains when/why it clamped.
  - "Projected Finish" card becomes **Planned vs Projected**: planned finish (from
    `scopePlannedFinish`), projected finish (existing), and the delta in days with
    late/early wording. When no planned dates exist, show the projected date plus a
    one-line "set planned dates (Schedule → Level dates or Import) to see plan vs
    actual" nudge — never a bare "—".
- **Approval gates:** none (display only; forecast math untouched).
- **Exit criteria:** typecheck + test + build green · new fns unit-tested · dev:3010 on
  Orchard Path III: hero never earlier than the latest level row; delta reads correctly;
  Mill Pond (no plan dates) shows the nudge · `verify-feature` → STOP (commit, next phase).

### Phase 2 — Honest empties, swarm collapse, counting fixes
- **Scope:**
  - **Stalled swarm**: when `isStalledSwarm(...)`, replace the per-level stalled chips +
    hero stalled line with ONE banner ("No work logged in 2+ weeks across most of this
    project — data may be out of date", naming the threshold in a tooltip). Below
    threshold: today's (amber) behavior.
  - **Plan-dependent nudges**: TypeScorecard's variance column and the velocity chart's
    planned line render ONE "set planned dates to unlock plan-vs-actual" hint (not
    per-row dead cells) when `scopePlannedFinish` is null.
  - **Counting fixes**: `MapSidebar` renders the existing-but-hidden `buckets.none` as
    "N not started" and labels the pair distinctly ("N locations done" vs "N% of tasks
    complete"); `TypeScorecard` pluralizes "1 LOCATION".
  - **Look-ahead seed rows**: style untouched seed rows (empty task+sub+cells) as
    placeholders (muted/italic "Describe the task…") so they can't read as real data.
- **Approval gates:** none.
- **Exit criteria:** typecheck + test + build green · dev:3010: Orchard (mostly stalled)
  shows the single banner; a healthy project keeps chips; sidebar buckets sum to the
  sheet's unit count; look-ahead new week shows placeholder styling · `verify-feature`
  → STOP. **End of Batch A — write the batch review summary.**

### Phase 3 — List accountability: age, days-behind, ownership, completed-fold
- **Scope (all in `StatusTable.tsx` + atoms; swipe deck gets the same data where its
  card already shows the equivalent):**
  - **Age**: per row, "updated 3d ago"-style chip from `lastActivityIso`/`formatAge`
    (muted; tooltip shows the exact date). No new queries. In the Unit History modal,
    resolve `status_audit_log.user_id` → name via a `useProjectMembers` map so "by whom"
    is answerable there.
  - **Days-behind number**: next to the variance color, render the signed day count
    already inside `VarianceInfo` (e.g. "6d late") — color unchanged (statusColors/
    variance scale are Polish-owned).
  - **Ownership**: one "Owner" cell showing `assigned_to` (person, via the existing
    `AssigneeCell`/members) and, when the bottleneck activity has a subcontractor, the
    company name (via `useCompanies`) as a secondary line/badge. No new writes — display
    of existing assignment + Slice B linkage.
  - **Completed-fold**: remove the "Actual Completed" column; when a row (main or
    expanded child) is completed, its `logged_date` renders as the same editable chip
    pattern Polish P4 established, inside the status cell; pending-amber treatment kept.
- **Approval gates:** none (no write-path changes — same handlers).
- **Exit criteria:** typecheck + test + build green · staleness utils unit-tested ·
  dev:3010: date edit for a completed row round-trips (incl. offline pending state);
  owner cell shows person and/or sub correctly; table width holds at laptop sizes with
  compact mode on/off · `verify-feature` → STOP.

### Phase 4 — Private Benchmarking moves home
- **Scope:** unmount `SubcontractorBenchmark` from `ProjectDashboard.tsx`; mount it on
  `src/app/dashboard/page.jsx` below the project cards (its lazy "Load cross-project
  benchmark" behavior unchanged); verify dark/light rendering post-theme-unification;
  keep its section header copy ("your own jobs only · never shared").
- **Approval gates:** none.
- **Exit criteria:** typecheck + build green · dev:3010: benchmark loads and renders on
  home; project dashboard no longer shows it; nothing else on home regressed ·
  `verify-feature` → STOP. **End of Batch B — write the batch review summary.**

## Verification commands (the exit-criteria gate)
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
- **Lint is NOT a gate** (~1850 pre-existing problems).
- **No E2E framework** — dev:3010 click-throughs on BOTH a data-rich project (Orchard
  Path III) and a thin one (Mill Pond); the nudge/empty paths are half the point.
- Vitest globals OFF: import `{ describe, it, expect, vi }` from `'vitest'`.

## Hard guardrails (AGENTS.md — do not violate)
- **Extend, never fork, `progressAnalytics`** — new pure fns live there with tests;
  existing pace/variance math and `VARIANCE_COLORS` untouched. Respect applicability in
  every count.
- **No write-path changes**: `status_logs` writes, `pendingChanges` (local `useState`),
  the offline queue, and `upsert_status_log` are all untouched; the completed-date fold
  reuses the existing handlers.
- **Do not recolor `mapDisplayStatuses`**; days-behind adds a *number*, colors stay
  owned by the Polish workstream's `statusColors.ts` / variance scale.
- **No new hot-path queries**: staleness uses already-fetched `client_timestamp`; the
  history-modal name map reuses `useProjectMembers`' cached result. Anything needing a
  new project-wide fetch must paginate (1000-row cap) — flag it in review.
- **Types**: derive from `database.types.ts`; no `any`; `useHydratedStore` for persisted
  reads; new files `.ts`/`.tsx`.
- **Don't commit or push until the owner says "Approved."** One branch per batch.

## Open decisions
None blocking. Owner-locked at Batch A review (2026-07-07): hero "late" delta = **amber**
(red stays reserved for the 15+-day variance tiers); swarm banner trips at **≥60% of ALL
locations** stalled; Batch B "Owner" cell = **stacked** (person over muted sub, not a badge
or hover); Batch B age cue = **compact chip under the location name**, right-aligned, muted,
hover = exact date. Still delegated to the implementing session: banner/nudge exact wording.

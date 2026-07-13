# Schedule That Thinks — confidence-banded forecasts + risk radar (self-contained build plan)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: none. Sibling: `Notes/plans/Data-Storytelling-Plan.md` (this plan extends
> the hero card its Batch A builds).
> ✅ **Sequencing gate SATISFIED (verified on `main` 2026-07-08):** Data Storytelling
> Batch A (and B) are merged — the Planned-vs-Projected hero card, the lifted per-level
> rollups in `ProjectDashboard.tsx`, and `clampProjectForecast` all exist. The Schedule
> Variance Columns workstream also landed (new `progressAnalytics` exports:
> `activitySchedule`, `resolveActualStartIso`, `firstOngoingIso`, `varianceCompletedColor`)
> — no naming collisions with this plan's additions; re-read the file fresh anyway.

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) + the Data Storytelling plan's
   "Locked decisions" + P1 sections (they changed the hero card this plan edits).
2. Re-read the files named below fresh — do not trust line numbers; they drift.
   ⚠ NEVER read from `.claude/worktrees/` — stale repo snapshots live there.
3. Build the phases in order, in the two autonomous batches (§ Execution model).
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence
   plain-English summary; explain jargon in passing; keep it short.

## Goal
When this is done, every projected finish date on the project dashboard carries an honest
confidence range derived from the project's OWN captured pace history — "Projected
Aug 20 · likely Aug 14–29" on the hero card and on each FloorPulse level row — computed
by Monte Carlo simulation (resampling real weekly completion counts a thousand times and
reading off the spread; the technique P6 risk consultants sell, run on live field data).
A new compact dashboard module ("Risk Radar") ranks the activities putting the finish
date most at risk, and — final phase, owner may cut at review — suggests the single
highest-impact move ("if Level 3 matched Level 1's pace, the finish moves up ~6 days").
Everything inherits the app's suppression honesty: thin history shows "not enough
history yet", never a fabricated band.

## Out of scope / deferred
- **No CPM / dependency-network simulation** — that is the Pro-Logic integration
  workstream (separate repo, separate lane). This plan's seams anticipate it: the band
  type and Risk Radar UI are engine-agnostic so a smarter compute layer can slot in
  behind the same surfaces later.
- **No DB / RLS / migration / backend changes.** Display + client-side derivation only.
  (One possible column-list widening on an EXISTING query — see § Data model.)
- **No changes to existing forecast math** — `projectForecastDate` / `summarizeGroup` /
  `clampProjectForecast` stay untouched; the band is a NEW layer beside them.
- **No SF weighting** (owner-deferred for Data Storytelling; same here) — simulate slot
  counts, mirroring the existing pace math.
- No user-configurable confidence level in v1 — fixed 80% band (P10–P90), stated in the
  tooltip.
- No Web Worker for the simulation in v1 — memoized main-thread compute; see § Perf.

## Locked product decisions (from the owner, 2026-07-07)
- **Placement = blend + one small module**: the confidence range folds into the existing
  hero card and FloorPulse level rows; risk ranking + what-if get ONE new compact
  dashboard module. No big new dashboard section; not in the Schedule view.
- **V1 includes the highest-impact-move suggester as the FINAL phase** on the same
  workstream, explicitly cuttable at batch review if it under-delivers.
- **Sequence: after Data Storytelling Batch A**, before/independent of Batch B.
- **Batched autonomous execution** (Polish/Data-Storytelling model): 2 batches, one
  branch each, one commit per phase, no mid-batch questions, one review at the end,
  push only on "Approved".

## Data model (read-only)
- Everything the simulation needs is already fetched by `ProjectDashboard.tsx`:
  units (`useAllProjectUnits`), current statuses (`useAllProjectStatuses`), completed
  audit history (`useStatusHistory`), applicability index.
- Weekly pace comes from `GroupRollup.weekly` (the rollups Batch A lifts into
  `ProjectDashboard`) — full weeks only, mirroring `projectForecastDate`.
- **P3 verification point — RESOLVED (verified 2026-07-08):** `useStatusHistory`
  already selects `activity_id` (plus `activity_name`, `track`, `logged_date`) from
  `status_audit_log`. No query change needed for per-activity risk.
- Planned finishes per activity derive from already-fetched `status_logs.planned_end_date`
  (max per activity across its applicable slots — the `scopePlannedFinish` pattern).
- Applicability respected everywhere via the existing `ApplicabilityIndex` (AGENTS.md §3).

## Build-on inventory (read these fresh before using)
- `src/utils/progressAnalytics.ts` — `projectForecastDate` (the deterministic point
  forecast; the band NEVER replaces it), `summarizeGroup` → `GroupRollup.weekly`,
  `SMALL_SAMPLE_SLOTS`, `FORECAST_WINDOW_WEEKS`, `parseDay`/`dayDiff`/`mondayOf`, and —
  post-Batch A — `scopePlannedFinish` + `clampProjectForecast`. **Extend the vocabulary
  (import these); never fork or modify.**
- `src/utils/forecastTrend.ts` — the proven pattern for layering new forecast math on
  `projectForecastDate` without forking (this plan mirrors its structure and JSDoc tone).
- `src/utils/productionRates.ts` — suppression discipline to mirror (`MIN_RATE_EVENTS`,
  suppress-never-fake); per-activity event shaping reference for P3.
- `src/components/ProjectDashboard.tsx` — post-Batch A owner of the per-level rollups
  (computed once, passed down) and the Planned-vs-Projected hero card. Bands are
  computed HERE (memoized, once per scope change) and passed down as props.
- `src/components/dashboard/FloorPulse.tsx` — post-Batch A a props-consumer of rollups;
  level rows gain the band annotation.
- `src/components/dashboard/TypeScorecard.tsx` / `ProductionRates.tsx` — layout/tone
  reference for the new Risk Radar module (compact card, muted captions, Info tooltips
  quoting real constants — the `STALL_THRESHOLD_DAYS` pattern).
- `src/utils/statusColors.ts` (exists after Polish Batch 3) — use for any temporal-state
  colors; band/risk visuals should otherwise stay neutral (slate) — variance colors are
  `VARIANCE_COLORS`-owned and untouched.
- `src/utils/applicability.ts` — `applicableActivities` / `applicableSlotCount`.

## Pure logic to extract + unit-test
New `src/utils/monteCarloForecast.ts` (+ `.test.ts`) — deterministic, framework-free.
Callers pass `today` AND a numeric `seed`; **never `Date.now()` or `Math.random()`**:
- `mulberry32(seed): () => number` — tiny seeded PRNG (deterministic tests; a fixed
  app-side seed means the dashboard shows stable numbers across re-renders).
- `simulateFinishBand({ remaining, totalSlots, fullWeekCounts, today, iterations = 1000,
  seed, maxWeeks = 520 }): ForecastBand` where
  `ForecastBand = { p10: string|null, p50: string|null, p90: string|null,
  suppressed: 'complete'|'small-sample'|'no-pace'|null }`.
  Method: window = trailing `FORECAST_WINDOW_WEEKS` of `fullWeekCounts` (same window
  the point forecast uses). Each iteration: draw weekly counts from the window with
  replacement (bootstrap) until `remaining` is exhausted; record weeks-to-finish;
  censor at `maxWeeks`. Percentiles → dates via the same `today + ceil(weeks*7)` day
  math as `projectForecastDate`. Suppression mirrors it exactly: 'complete' when
  nothing remains, 'small-sample' below `SMALL_SAMPLE_SLOTS`, 'no-pace' when the
  window is all zeros — and additionally when >10% of iterations censor (pace too
  erratic to bound honestly).
- `bandForRollup(rollup: GroupRollup, today: Date, seed: number): ForecastBand` —
  convenience adapter from the lifted rollups (full weeks = `weekly` minus the current
  partial week, remaining = `totalSlots − completedSlots`).
- P3: `activityRisk({ activities, units, statuses, history, applicabilityIndex, track,
  today, seed })` → per-activity `{ activityId, name, remainingSlots, band,
  plannedFinish, riskDays }` ranked worst-first. `riskDays` = p90 vs that activity's
  max `planned_end_date` when dated, else band width; activities whose history is too
  thin surface with `band.suppressed` set (listed as "not enough history yet", never
  fake-ranked).
- P4: `bestPaceMove({ levelRollups, today, seed })` — for each lagging level, transplant
  the best-performing level's weekly window, re-simulate, and measure the p50
  improvement of the PROJECT finish (max across level p50s). Returns the top move
  `{ fromSheetId, toSheetId, daysSaved, ... }` or null when nothing meaningful (< 2
  days saved, or fewer than 2 levels with unsuppressed bands).
Tests pin: seed determinism (same seed → identical band); `p10 ≤ p50 ≤ p90`; suppression
parity with `projectForecastDate` on the same inputs (every case the point forecast
suppresses, the band suppresses too); constant weekly pace collapses the band to ~the
point forecast; censoring → 'no-pace'; risk ranking respects applicability; `bestPaceMove`
returns null on uniform pace.

## Consistency rules (bands must never contradict the existing story)
- The hero shows Batch A's clamped point forecast UNCHANGED. Its band uses the same
  basis the clamp chose: if the hero was pinned to a level's forecast, show THAT
  level's band; otherwise the project-scope band. One basis, one story.
  (`clampProjectForecast` returns only `clampedToLevel: boolean` — when true, identify
  the pinning level as the one whose `levelRollups[id].forecastDate` is the latest;
  that is by construction the date the clamp chose.)
- A suppressed point forecast never gains a band (no band where there's no date).
- Band copy is calibrated, not falsely precise: "likely Aug 14–29", tooltip: "80%
  confidence range from N weeks of this project's actual pace, simulated 1,000 times."

## Execution model (2 autonomous batches, after Data Storytelling Batch A)
| Batch | Contents (in build order) | Phases |
|-------|---------------------------|--------|
| **1** | Simulation math · bands on hero + FloorPulse | P1 · P2 |
| **2** | Risk Radar module · highest-impact move (cuttable) | P3 · P4 |

## Sub-phasing (ship + verify each)

### Phase 1 — Monte Carlo math (pure, no UI)
- **Scope:** `src/utils/monteCarloForecast.ts` with `mulberry32`, `simulateFinishBand`,
  `bandForRollup`, `ForecastBand` + the full test suite above. Nothing renders yet.
- **Approval gates:** none.
- **Exit criteria:** typecheck + test + build green · every test listed above passing ·
  `verify-feature` → STOP (commit, next phase).

### Phase 2 — Bands on the dashboard (hero + level rows)
- **Scope:** `ProjectDashboard.tsx` computes bands once (memoized: project scope + per
  level via `bandForRollup`, fixed seed) and passes them down. Hero card gains the
  "likely X–Y" line under the projected date (basis rule per § Consistency). FloorPulse
  level rows gain a compact range annotation next to the forecast date (muted; tooltip
  with the full band + method sentence). Suppressed bands render nothing new.
- **Approval gates:** none (display only).
- **Exit criteria:** typecheck + test + build green · dev:3010 on Orchard Path III
  (data-rich): hero band brackets the point date, basis matches the clamp hint; level
  rows show ranges only where forecasts exist · Mill Pond (thin data): no bands, no new
  noise · `verify-feature` → STOP. **End of Batch 1 — write the batch review summary.**

### Phase 3 — Risk Radar module
- **Scope:** verify/widen `useStatusHistory`'s columns for activity identity (§ Data
  model). Add `activityRisk` to `monteCarloForecast.ts` (+ tests). New
  `src/components/dashboard/RiskRadar.tsx`: compact card listing the top ~5 activities
  by `riskDays` — name, remaining slots, band vs planned finish, plain-English one-liner
  ("Drywall's 80% range ends 12d after its planned finish"); a muted "not enough history
  yet" group; Info tooltip quoting the real constants. Mount in `ProjectDashboard.tsx`
  near TypeScorecard; respects the dashboard's scope selector.
- **Approval gates:** none.
- **Exit criteria:** typecheck + test + build green · dev:3010: rankings sane on Orchard
  (a genuinely-behind activity ranks first); thin activities in the muted group, never
  ranked; scope switch re-ranks · `verify-feature` → STOP.

### Phase 4 — Highest-impact move (owner may cut at review)
- **Scope:** `bestPaceMove` (+ tests). Risk Radar gains ONE suggestion line when a
  meaningful move exists: "If {level} matched {level}'s pace, the projected finish
  moves up ~{n} days." with an "estimate from recent pace — not crew logistics" caption.
  Renders nothing when `bestPaceMove` returns null.
- **Approval gates:** none in-build; **the feature itself is the gate** — present it
  prominently in the batch review; the owner decides keep/cut before push.
- **Exit criteria:** typecheck + test + build green · dev:3010: suggestion appears on
  Orchard only if a ≥2-day move exists; wording matches the template · `verify-feature`
  → STOP. **End of Batch 2 — write the batch review summary.**

## Perf note (v1 stance)
Bands are memoized in `ProjectDashboard` and recompute only on scope/data change.
Budget ≈ (1 project + N levels + M activities) × 1,000 iterations × ~tens of samples —
single-digit milliseconds at current project sizes (≤ ~10 levels, ≤ ~30 activities).
If the review click-through shows jank on scope switch, drop `iterations` to 500 or
defer via `startTransition` — do NOT reach for a Worker in v1.

## Verification commands (the exit-criteria gate)
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
- **Lint is NOT a gate** (~1850 pre-existing problems).
- **No E2E framework** — dev:3010 click-throughs on BOTH Orchard Path III (data-rich)
  and Mill Pond (thin); the suppression paths are half the point.
- Vitest globals OFF: import `{ describe, it, expect, vi }` from `'vitest'`.

## Hard guardrails (AGENTS.md — do not violate)
- **Extend, never fork or modify, `progressAnalytics`** — existing point-forecast math,
  `VARIANCE_COLORS`, and Batch A's clamp are untouched; the band is additive.
- **Determinism:** no `Date.now()` / `Math.random()` anywhere in pure fns — `today` and
  `seed` are passed in.
- **Suppress, never fake:** every suppression case of the point forecast suppresses the
  band; thin per-activity history is labeled, not ranked.
- **Respect applicability** in every count (`ApplicabilityIndex`; AGENTS.md §3).
- **No write-path changes**; no `pendingChanges`/offline-queue contact; no
  `mapDisplayStatuses` recolor; no new project-wide queries (only the possible column
  widening on `useStatusHistory` — flag it in review); paginate anything new (1000-row
  cap — should not arise).
- **Types:** derive from `database.types.ts`; no `any`; new files `.ts`/`.tsx`;
  `useHydratedStore` for any persisted read (none expected).
- **Don't commit or push until the owner says "Approved."** One branch per batch.

## Open decisions
None blocking. Delegated to the implementing sessions (owner adjusts at batch review):
exact band copy ("likely" vs "80% range"); Risk Radar title + top-N (suggest 5); where
the module sits relative to TypeScorecard; Phase 4 keep/cut (owner decides at Batch 2
review).

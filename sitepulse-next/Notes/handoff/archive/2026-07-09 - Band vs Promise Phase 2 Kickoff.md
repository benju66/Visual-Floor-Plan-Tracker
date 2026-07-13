# Kickoff — Band vs Promise, Phase 2: the promise line on the hero card

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of Band vs Promise** (the "are we keeping our word?" line on the
> dashboard hero card, measuring the Monte Carlo confidence band against the project's
> contract completion date). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-09 - Band vs Promise Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Band-vs-Promise-Plan.md` (Phase 2 + Open decisions 1–2)
> - `sitepulse-next/AGENTS.md` §3 (the `monteCarloForecast` additive-layer rule; extend, never fork)
>
> Branch off `main`. Build **only Phase 2**. It is **display-only — no migration, no approval
> gate**. Add the pure `promiseOutlook` helper (with tests) and render the line. Don't commit
> or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Where Phase 1 left off
- Phase 1 is committed on branch `band-vs-promise-phase1` (commit `738b385`) — **may or may not
  be merged to `main` yet; check `git log main` first.** If it isn't merged, branch Phase 2 off
  `band-vs-promise-phase1` (or wait for the merge) so the `projects` date columns + types are present.
- The migration `20260712_project_dates.sql` (adds `projects.construction_start_date` +
  `contract_completion_date`, both nullable `date`) **is already applied to prod.** So
  `useProject(projectId)` returns `project.contract_completion_date` (ISO `'YYYY-MM-DD'` or `null`)
  for free — the read plumbing is done.
- Owners enter the date in **Settings → Project Info** (added in P1). No dashboard rendering exists
  yet — that is this phase's entire job.

## Why this phase
This is the payoff of the manual-promise block: turn "when will we finish?" into "are we going
to keep our word?". Under the existing "vs planned" line on the "Planned vs Projected" hero card,
show — **only when a contract completion date is set and the band is unsuppressed** — the 80%
range, the signed delta vs the promised date, and a one-word verdict. Never a fabricated promise.

## Required reading
- `sitepulse-next/AGENTS.md` §3 — `monteCarloForecast.ts` is an **additive layer beside
  `progressAnalytics`, never a fork**; it's deterministic (fixed `FORECAST_BAND_SEED` + `today`
  passed in, no `Date.now()`/`Math.random()`) and delegates suppression to the point forecast so
  a suppressed band never gains a line. The new helper obeys the same rules.
- `sitepulse-next/Notes/plans/Band-vs-Promise-Plan.md` — the Phase 2 scope, the exact
  `promiseOutlook` signature + verdict thresholds under **"Pure logic to extract + unit-test"**,
  and **Open decisions 1 & 2** (resolve both this phase; recommended defaults below).
- Re-read fresh (do not trust line numbers):
  - `src/utils/monteCarloForecast.ts` — `ForecastBand` (`p10/p50/p90/suppressed`),
    `bandMethodSentence()`, `bandForRollup`. **Home for the new `promiseOutlook`.**
  - `src/utils/progressAnalytics.ts` — reuse `parseDay` + `dayDiff` for the delta math
    (positive = finish later than the promise). Do NOT fork the forecast math.
  - `src/components/ProjectDashboard.tsx` — already computes `heroBand` (a `ForecastBand`),
    `projectedDate`, `plannedFinish` (`scopePlannedFinish`), `planComparison` (`planVsProjected`),
    and `heroBandRange` (the p10–p90 display range). The "vs planned {date} · {comparison}" line is
    the anchor — the new promise line goes beside it. `fmtFinish` formats the dates; the existing
    `heroBandRange` tooltip already quotes `bandMethodSentence()`.
  - Check `ProjectDashboardProps` + `src/app/project/[projectId]/page.tsx`: the page has
    `useProject`; thread `project.contract_completion_date` (or the whole `project`) down as one
    new prop. Keep `viewMode`/trackingMode behavior intact.

## Scope (build ONLY this)
1. **Pure helper** `promiseOutlook({ promise, band })` in `monteCarloForecast.ts` — signature +
   verdict thresholds are spelled out verbatim in the plan. Returns `null` (render nothing) when
   `promise` is null OR `band.suppressed` OR the band lacks dated `p10/p50/p90`. Verdict from where
   the promise falls in the 80% range: `promise >= p90` → `on-track`; `promise <= p10` →
   `likely-miss`; else `at-risk`. Deltas via `dayDiff(parseDay(promise), parseDay(band.pXX))`.
2. **Tests** in `monteCarloForecast.test.ts` (import `{ describe, it, expect }` from `'vitest'`) —
   pin: null on suppressed band / null promise; the three verdict boundaries (promise == p90 /
   inside / == p10); sign of `medianDeltaDays` (late = +, ahead = −); determinism (pure).
3. **Render** the promise line on the hero card when `promiseOutlook(...)` is non-null: the p10–p90
   range, the signed P50 delta vs the promised date, and the one-word verdict (on track / at risk /
   likely to miss), with a tooltip quoting `bandMethodSentence()`. Renders nothing when there's no
   completion date or the band is suppressed.

## Open decisions to resolve this phase (recommended defaults — confirm with the owner)
1. **Promise line vs the existing "vs planned" line** — *default:* when a contract completion date
   is set, **lead** with the promise line and demote "vs planned {current-plan date}" to a smaller
   secondary; no date set → the current plan line is unchanged, plus optionally a one-time muted
   nudge ("Set a contract completion date in Settings → Project Info to track the promise").
2. **Which band edge headlines the delta** — *default:* headline the **median (P50)** delta
   ("~9 days past the promised date"), show the full P10–P90 range for context, derive the verdict
   from where the promise falls in the range.

## Guardrails specific to this phase
- **Display-only. No migration, no DB write, no approval gate.**
- **Extend, never fork** `monteCarloForecast` / `progressAnalytics`; `VARIANCE_COLORS` untouched.
- **Honesty:** the line renders ONLY against a real entered `contract_completion_date` AND an
  unsuppressed band — never a fabricated/implied promise; a suppressed band shows nothing.
- **Determinism:** `promiseOutlook` is pure — dates/band passed in, no `Date.now()`.
- No `any`; new/edited files `.ts`/`.tsx`; tests import from `'vitest'` (globals OFF).

## Exit criteria
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green
- `... run test` green (incl. new `promiseOutlook` tests) · `... run build` green
- dev:3010 on a project **with** a completion date (set one on a real project via Settings →
  Project Info): the promise line shows range + delta + verdict and matches the band; on a project
  with **no** completion date: no promise line, no fabricated number.
- Close with the **verify-feature** skill (Definition of Done → STOP). Commit; do NOT push until
  the owner says "Approved."
- **End of the manual-promise block (P1–P2): write a short review summary and get the owner's read
  on whether the "promise" framing resonates before starting the baseline layer (P3).**

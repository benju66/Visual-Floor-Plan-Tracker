# Kickoff — Schedule That Thinks, Batch 1: Monte Carlo math + confidence bands on the dashboard (P1 + P2)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Batch 1 of Schedule That Thinks** — two phases on ONE branch, one commit
> each: (P1) the pure Monte Carlo simulation math, (P2) confidence bands on the hero
> card + FloorPulse level rows. Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-07 - Schedule That Thinks Batch 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Schedule-That-Thinks-Plan.md` (P1 + P2)
> - `sitepulse-next/AGENTS.md`
>
> GATE ✅ SATISFIED (verified 2026-07-08): Data Storytelling Batch A is merged to
> `main` — the Planned-vs-Projected hero card and lifted per-level rollups this batch
> extends all exist. Branch off `main`. Display-only: no DB/backend changes;
> never modify the existing forecast math — the band is an additive layer. Run
> autonomously (all decisions are pre-locked); end with ONE review summary. Don't
> commit until each phase's gates are green; don't push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this feature
The dashboard's projected finish is a single date computed from median weekly pace. A
single date reads as more certain than it is. This workstream resamples the project's
OWN weekly completion history a thousand times (Monte Carlo bootstrap — a seeded,
deterministic simulation) and shows the honest spread: "Projected Aug 20 · likely
Aug 14–29." Batch 2 (P3 Risk Radar + P4 highest-impact move, cuttable) follows after
this batch is approved — draft its kickoff when closing this one (standing ritual).
Strategic backdrop: these UI surfaces are deliberately engine-agnostic; the Pro-Logic
CPM engine (separate repo, separate lane) later slots in behind them.

## Phase 1 — Monte Carlo math (pure, no UI)
Full spec in the plan (§ Pure logic). Highlights:
- New `src/utils/monteCarloForecast.ts` + test: `mulberry32` seeded PRNG,
  `simulateFinishBand` (bootstrap over the SAME trailing-weeks window
  `projectForecastDate` uses), `bandForRollup` adapter, `ForecastBand` type.
- Determinism is non-negotiable: `today` and `seed` are parameters; no `Date.now()`,
  no `Math.random()`. Same seed → identical band (pinned by test).
- Suppression parity pinned by test: every case where `projectForecastDate` suppresses
  ('complete' / 'small-sample' / 'no-pace'), the band suppresses too; plus 'no-pace'
  when >10% of iterations censor at `maxWeeks`.

## Phase 2 — Bands on the dashboard
- `ProjectDashboard.tsx` computes bands ONCE (memoized; fixed seed) — project scope +
  per level via `bandForRollup` over the Batch-A-lifted rollups — and passes them down.
- Hero card: "likely X–Y" line under the projected date. **Basis rule (consistency):**
  if Batch A's clamp pinned the hero to a level's forecast, show THAT level's band;
  otherwise the project band. Never two contradictory stories.
- FloorPulse level rows: compact muted range next to the forecast date; tooltip carries
  the full band + one method sentence ("80% confidence range from N weeks of this
  project's actual pace, simulated 1,000 times").
- Suppressed point forecast ⇒ no band, no new noise.

## Watch-outs
- ⚠ NEVER read from `.claude/worktrees/` — stale repo snapshots.
- Re-read `ProjectDashboard.tsx` / `FloorPulse.tsx` FRESH — Data Storytelling Batch A
  just reshaped both (lifted rollups, Planned-vs-Projected hero, clamp hint).
- `statusColors.ts` exists (Polish Batch 3) for any temporal-state colors; band visuals
  otherwise stay neutral slate — `VARIANCE_COLORS` untouched.
- Respect applicability in anything counted (`ApplicabilityIndex`, AGENTS.md §3).
- Verify on BOTH Orchard Path III (data-rich → real bands) and Mill Pond (thin → clean
  suppression, no bands).

## Hard guardrails
- Display-only. No DB/RLS/migrations; no write-path/offline-queue contact; extend —
  never fork or modify — `progressAnalytics`; no `mapDisplayStatuses` recolor; no new
  project-wide queries in this batch.
- New files `.ts`/`.tsx`, no `any`; tests import from `'vitest'` (globals OFF).
- Don't commit or push until the owner says "Approved." One branch for the whole batch.

## Exit criteria (whole batch)
Per phase before its commit, then once at the end:
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green
- `... run test` green (all P1 tests listed in the plan)
- `... run build` green
- dev:3010: hero band brackets the point date with the correct basis; level rows show
  ranges only where forecasts exist; Mill Pond shows nothing new.
- Close with `verify-feature` across both phases → ONE review summary → STOP (no push
  until "Approved"), then draft the Batch 2 kickoff (P3 Risk Radar + P4 move suggester).

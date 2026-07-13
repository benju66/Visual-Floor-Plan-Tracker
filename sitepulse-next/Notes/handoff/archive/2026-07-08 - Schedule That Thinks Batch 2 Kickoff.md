# Kickoff — Schedule That Thinks, Batch 2: Risk Radar module + highest-impact move (P3 + P4)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Batch 2 of Schedule That Thinks** — two phases on ONE branch, one commit
> each: (P3) a compact "Risk Radar" dashboard module ranking the activities most at
> risk, and (P4) a single highest-impact-move suggestion line (**owner may cut this at
> review**). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-08 - Schedule That Thinks Batch 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Schedule-That-Thinks-Plan.md` (P3 + P4, § Pure logic, § Consistency)
> - `sitepulse-next/AGENTS.md`
> - `sitepulse-next/src/utils/monteCarloForecast.ts` (Batch 1 — you extend this file)
>
> GATE: Batch 1 (P1 Monte Carlo math + P2 hero/FloorPulse bands) must be **approved and
> merged to `main`** first. Branch off `main`. Display-only: no DB/backend changes; never
> modify the existing forecast math (`progressAnalytics`) — extend `monteCarloForecast`.
> Run autonomously (all decisions pre-locked); end with ONE review summary. Don't commit
> until each phase's gates are green; don't push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this batch
Batch 1 put an honest confidence range on every projected finish. Batch 2 answers the
next question the owner will ask: **"so what do I do about it?"** P3 ranks the activities
whose 80% range runs latest past their planned finish (a compact "Risk Radar" card). P4
adds ONE what-if line — the single pace transplant that would pull the project finish in
the most. P4 is explicitly **cuttable at review**: if it under-delivers, the owner cuts it
and Batch 2 ships as Risk Radar alone. Same engine-agnostic seams as Batch 1 — the
Pro-Logic CPM engine (separate repo/lane) can later feed these same surfaces.

## Phase 3 — Risk Radar module
Full spec in the plan (§ Sub-phasing P3 + § Pure logic). Highlights:
- **No query change needed.** `useStatusHistory` already selects `activity_id`,
  `activity_name`, `track`, `logged_date` from `status_audit_log` (verified on `main`
  2026-07-08). Confirm once, then rely on it — do NOT widen the query.
- Add `activityRisk({ activities, units, statuses, history, applicabilityIndex, track,
  today, seed })` to `monteCarloForecast.ts` (+ tests). Returns per-activity
  `{ activityId, name, remainingSlots, band, plannedFinish, riskDays }` ranked
  worst-first. `riskDays` = P90 vs that activity's max `planned_end_date` when dated,
  else band width. Reuse Batch 1's `simulateFinishBand`/`FORECAST_BAND_SEED` — do not
  fork the bootstrap. Respect applicability in every slot count (`applicableActivities`,
  AGENTS.md §3).
- New `src/components/dashboard/RiskRadar.tsx`: compact card (layout/tone reference =
  `TypeScorecard.tsx` / `ProductionRates.tsx`), top ~5 by `riskDays` — name, remaining
  slots, band vs planned finish, a plain-English one-liner ("Drywall's 80% range ends 12d
  after its planned finish"); a muted **"not enough history yet"** group for thin-history
  activities (surfaced with `band.suppressed` set — listed, never fake-ranked); an Info
  tooltip quoting the REAL constants (`SMALL_SAMPLE_SLOTS`, `FORECAST_WINDOW_WEEKS`, and
  the Batch-1 `bandMethodSentence()`).
- Mount in `ProjectDashboard.tsx` near `TypeScorecard`; it must **respect the dashboard's
  scope selector** (re-rank when the scope changes) and be memoized like the Batch-1
  bands (fixed seed, recompute only on scope/data change).

## Phase 4 — Highest-impact move (owner may cut at review)
- Add `bestPaceMove({ levelRollups, today, seed })` (+ tests). For each lagging level,
  transplant the best-performing level's weekly window, re-simulate, and measure the P50
  improvement of the PROJECT finish (max across level P50s). Returns the top move
  `{ fromSheetId, toSheetId, daysSaved, ... }` or **null** when nothing meaningful
  (< 2 days saved, or fewer than 2 levels with unsuppressed bands).
- Risk Radar gains ONE suggestion line when a move exists: **"If {level} matched
  {level}'s pace, the projected finish moves up ~{n} days."** with an **"estimate from
  recent pace — not crew logistics"** caption. Renders nothing when `bestPaceMove` is null.
- **The feature itself is the gate.** Present it prominently in the batch review; the
  owner decides keep/cut before push.

## Watch-outs
- ⚠ NEVER read from `.claude/worktrees/` — stale repo snapshots.
- Re-read `ProjectDashboard.tsx` / `monteCarloForecast.ts` FRESH — Batch 1 reshaped both
  (band memos, `levelBands`, shared seed + method sentence).
- `bestPaceMove` reads the **lifted `levelRollups`** already computed in
  `ProjectDashboard` — do not recompute rollups or add a new project-wide query.
- Suppression honesty: an activity/level with a suppressed band is listed as
  "not enough history yet", never ranked or used as a transplant source.
- Verify on BOTH Orchard Path III (data-rich → a genuinely-behind activity ranks first;
  a real move suggestion may appear) and Mill Pond (thin → the muted group only, no
  ranking, no move line).

## Hard guardrails
- Display-only. No DB/RLS/migrations; no write-path/offline-queue contact; extend —
  never fork or modify — `progressAnalytics`; no `mapDisplayStatuses` recolor; no new
  project-wide queries (P3's history query is already sufficient — confirm, don't widen).
- Extend `monteCarloForecast.ts`; reuse `FORECAST_BAND_SEED` + `simulateFinishBand`.
  Risk/band visuals stay neutral slate unless reusing `statusColors.ts`;
  `VARIANCE_COLORS` untouched.
- New files `.ts`/`.tsx`, no `any`; tests import from `'vitest'` (globals OFF);
  determinism — `today` + `seed` passed in, no `Date.now()`/`Math.random()`.
- Don't commit or push until the owner says "Approved." One branch for the whole batch.

## Exit criteria (whole batch)
Per phase before its commit, then once at the end:
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green
- `... run test` green (all P3/P4 tests listed in the plan)
- `... run build` green
- dev:3010 on Orchard Path III: Risk Radar ranks a genuinely-behind activity first, thin
  activities sit in the muted group (never ranked), scope switch re-ranks; the P4 line
  appears only if a ≥2-day move exists and matches the template. Mill Pond: muted group
  only, no ranking, no move line.
- Close with `verify-feature` across both phases → ONE review summary (present P4
  prominently for the keep/cut decision) → STOP (no push until "Approved"). Batch 2 is the
  final batch — note the workstream complete in the review, and update the
  `schedule-that-thinks-workstream` memory.

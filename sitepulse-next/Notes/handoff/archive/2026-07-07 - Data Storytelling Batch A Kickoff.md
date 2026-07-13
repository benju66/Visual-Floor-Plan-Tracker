# Kickoff — Data Storytelling, Batch A: planned-vs-projected + honest empties (P1 + P2)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Batch A of Data Storytelling** — two phases on ONE branch, one commit each:
> (P1) Planned-vs-Projected finish delta + hero forecast clamp on the project dashboard,
> (P2) stalled-swarm banner + plan-dependent nudges + counting fixes. Read these in full,
> then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-07 - Data Storytelling Batch A Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Data-Storytelling-Plan.md` (P1 + P2)
> - `sitepulse-next/AGENTS.md`
>
> ⛔ GATE: do NOT start unless the Polish Roadmap's Batch 3 is merged to `main` (check
> `Notes/plans/UI-Polish-Design-Consistency-Plan.md` § Roadmap for ✅ marks) — this batch
> builds on statusColors.ts and the amber-stalled work. Branch off `main`. Display-only:
> no DB/backend changes, no forecast-math changes. Run autonomously (all decisions are
> pre-locked); end with ONE review summary. Don't commit until gates are green; don't
> push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this batch
The dashboard's numbers are correct but can tell a misleading story: the hero projection
can show an earlier date than its own slowest level; "115 stalled locations" reads as 115
problems when it means "data is stale"; plan-dependent widgets render dead "no plan
dates" cells; and small counting gaps (hidden not-started bucket, "1 LOCATIONS") erode
trust. Batch A fixes the story on the dashboard + map sidebar. Batch B (P3+P4: list
accountability + benchmarking move) follows after this batch is approved — draft its
kickoff when closing this one (standing ritual).

## Phase 1 — Planned vs Projected + hero clamp
Full scope in the plan. Highlights:
- New pure fns in `src/utils/progressAnalytics.ts` (+ tests): `scopePlannedFinish`,
  `clampProjectForecast`, `planVsProjected`, `isStalledSwarm` (P2 uses the last one).
  Extend the existing test file; pass dates IN (no `Date.now()`).
- Lift FloorPulse's per-sheet `summarizeGroup` rollups to `ProjectDashboard.tsx` (compute
  ONCE, pass down as props) so the hero card can clamp against level forecasts.
- Hero card becomes Planned vs Projected with the day delta; null-planned state shows a
  "set planned dates (Schedule → Level dates or Import) to see plan vs actual" nudge.

## Phase 2 — Honest empties, swarm collapse, counting fixes
- Swarm: `isStalledSwarm` ≥ ~60% → ONE banner replaces per-level stalled chips + hero
  stalled line; tooltip names the 14-day threshold (read `STALL_THRESHOLD_DAYS`, don't
  hardcode 14 in copy).
- Nudges: TypeScorecard variance column + velocity planned line render one unlock hint
  when no planned dates exist (no per-row dead cells).
- Counting: MapSidebar renders the existing `buckets.none` ("N not started") and labels
  "locations done" vs "% of tasks complete" distinctly; TypeScorecard pluralizes
  LOCATION/LOCATIONS.
- Look-ahead seed rows (`src/lookahead/lib/defaults.ts` blanks): placeholder styling so
  an untouched "New Group"/empty row can't read as real data.

## Watch-outs
- ⚠ NEVER read from `.claude/worktrees/` — stale repo snapshots live there.
- FloorPulse currently computes rollups internally — move the computation, don't
  duplicate it (perf: `summarizeGroup` per sheet is not free).
- The stalled chips/text are AMBER after Polish P3 — build on that, not on old red
  classes. `statusColors.ts` exists after Polish Batch 3 — use it for any state colors.
- Respect applicability (`ApplicabilityIndex`) in anything counted (AGENTS.md §3).
- Verify on BOTH Orchard Path III (data-rich, mostly stalled → banner) and Mill Pond
  (no plan dates → nudges).

## Hard guardrails
- Display-only. No DB/RLS/migrations; no `status_logs` write-path changes; no
  `pendingChanges`/offline-queue changes; extend (never fork) `progressAnalytics`; no
  `mapDisplayStatuses` recolor; no new unpaginated project-wide queries.
- Don't commit or push until the owner says "Approved." One branch for the whole batch.

## Exit criteria (whole batch)
Per phase before its commit, then once at the end:
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green
- `... run test` green (new progressAnalytics fns covered)
- `... run build` green
- dev:3010: hero never earlier than the latest level forecast; delta wording correct;
  Mill Pond shows nudges; Orchard shows the single swarm banner; sidebar buckets sum to
  unit count; look-ahead placeholders styled.
- Close with `verify-feature` across both phases → ONE review summary → STOP (no push
  until "Approved"), then draft the Batch B kickoff (P3 list accountability + P4
  benchmarking move).

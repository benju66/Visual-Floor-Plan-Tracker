# Schedule Variance Columns — where did the time actually go? (self-contained build plan)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent context: follow-up to `Notes/plans/Data-Storytelling-Plan.md` (Batch B P3 added
> the per-location "days behind" number; this plan adds the per-ACTIVITY breakdown behind it).

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) + the Data Storytelling plan.
2. Re-read the files named below fresh — do not trust line numbers; they drift.
   ⚠ NEVER read from `.claude/worktrees/` — stale snapshots. Pin searches to `sitepulse-next/src`.
3. Build the phases in order; verify + close each with `verify-feature` before the next.
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence
   plain-English summary; explain jargon in passing; keep it short.

## Goal
Today the list tells a PM *that* a location is "6d late" (Data Storytelling P3). This
workstream tells them **where the time went**: for each activity — not just the location's
current one — show **Planned Duration**, **Actual Started**, **Actual Duration**, and the
three signed variances (**Variance Start**, **Variance Completed**, **Variance Duration**).
"Framing was planned 10 days, ran 16, and started 4 days late" — the difference between
knowing something slipped and knowing *why*. These appear as columns on the **expanded
per-activity rows** of the desktop list (the cheap metrics) and, in full, inside the **Unit
History modal** (the audit-backed metrics), which already loads one location's timeline on
demand. The flat per-location list stays a summary; the existing "Actual Completed" column
stays as-is.

## Out of scope / deferred
- **No six new columns on the main (per-location) list row.** The main row shows one
  activity (the current/bottleneck), so per-activity durations only make sense on the
  expanded per-activity rows + the modal. Cramming six columns onto the summary row would
  blow the laptop-width budget — the exact pressure that motivated Batch B's completed-fold.
- **No list-wide / all-levels audit prefetch.** Actual-start & duration metrics need the
  audit timeline (`status_audit_log`). Loading that for every location × activity across a
  level (or all levels) is the hot-path query cost + 1000-row pagination trap the guardrails
  warn about ([[supabase-1000-row-cap]], AGENTS.md §2/§3). The modal loads ONE unit's audit
  at a time (`useUnitHistory`) — that is the cheap home for the audit-backed metrics. Only
  revisit a bulk path if a concrete need appears; if you ever do, it MUST paginate.
- **No DB / RLS / migration / write-path / forecast-math changes.** Display + client-side
  derivation only. Everything needed already exists in `status_logs` + `status_audit_log`.
- **No new colors.** Reuse the existing variance encoding (`VARIANCE_COLORS`/`varianceFill`);
  this adds *numbers*, never a new palette (same rule as Batch B P3).

## Locked product decisions (from the owner)
- **This is a per-activity schedule-analytics view, born from the Batch B review
  (2026-07-08):** the owner wants Planned Duration + Actual Started + Actual Duration +
  Variance Start/Completed/Duration, alongside the "Actual Completed" date they asked to keep
  as its own column (that column was restored in Data Storytelling P3-followup — do NOT
  re-fold it).
- **Planned as its own workstream**, not bolted into Batch B (owner picked "plan as a new
  workstream" at the Batch B review).

## Data model (read-only — nothing new is written)
Per activity slot (one `status_logs` row = unit × activity × track):
- **Cheap (already loaded on `status_logs`):**
  - Planned Duration = `dayDiff(planned_start_date, planned_end_date)` (whole days).
  - Variance Completed = `dayDiff(planned_end_date, logged_date)` (signed; + = finished late).
- **Audit-backed (needs `status_audit_log`, loaded per-unit by `useUnitHistory`):**
  - Actual Started = first `temporal_state==='ongoing'` event's `client_timestamp`/`changed_at`
    (fallback: jumped straight to complete → the completion day). This is EXACTLY the
    derivation `UnitHistoryModal`'s Journey tab already does inline (`firstOngoing`) — extract
    it, don't re-derive it.
  - Actual End = `logged_date` when completed, else `today` when ongoing, else null.
  - Actual Duration = `dayDiff(actualStart, actualEnd)`.
  - Variance Start = `dayDiff(planned_start_date, actualStart)` (signed; + = started late).
  - Variance Duration = Actual Duration − Planned Duration (signed; + = ran long).
- Applicability: N/A (unit × activity) slots never show a variance row/number — respect the
  `ApplicabilityIndex` exactly as `computeUnitVariance`/`summarizeGroup` do (AGENTS.md §3).

## Build-on inventory (read these fresh before using)
- `src/utils/progressAnalytics.ts` — the single source of truth for schedule math:
  `parseDay`, `dayDiff`, `lastActivityAt`, `computeUnitVariance`, `VarianceInfo`,
  `varianceFill`/`varianceLabel`/`VARIANCE_COLORS`. **EXTEND with new pure fns; never fork.**
- `src/components/UnitHistoryModal.tsx` — the Journey tab ALREADY computes, per activity,
  planned window vs actual bar vs idle gap vs duration ("Nd in / Nd planned") and derives
  `actualStart` from the audit rows; the Log tab lists Planned Start / Planned Finish / Actual
  Completion / Date Logged / By. This is the home for the full audit-backed set. Its
  `firstOngoing`/`actualStart` logic is the thing to lift into `progressAnalytics`.
- `src/hooks/useProjectQueries.ts` — `useUnitHistory(unitId)` returns one unit's
  `status_audit_log` rows (mapped `activity_name`→`activityName`), on demand. The audit-backed
  metrics ride on THIS — no new query.
- `src/components/StatusTable.tsx` — the desktop list. Expanded per-activity **child rows**
  already render each activity's Planned Start / Planned Completion / Actual Completed cells
  and already have `childLog` (its `status_logs` row) in scope — the cheap metrics slot in
  here with zero new data. Keep the flat "Actual Completed" column (P3-followup).
- `src/utils/applicability.ts` — `applicableActivities` / `isActivityApplicable` /
  `ApplicabilityIndex`. Never count an N/A slot.
- `src/utils/staleness.ts` — Batch B's display-string util; a sibling pattern to copy
  (pure, dates-in, tested) if a small display helper is warranted.

## Pure logic to extract + unit-test (`src/utils/progressAnalytics.ts` + its `.test.ts`)
Framework-free, deterministic, `Date.now()`-free (pass timestamps IN). This is where the
load-bearing correctness lives:
- `firstOngoingIso(auditRows): string | null` — first `ongoing` event's stamp (the Journey
  tab's derivation, lifted). Refactor `UnitHistoryModal` to call it (no behavior change) so
  there is ONE definition of "actual start".
- `activitySchedule({ plannedStart, plannedEnd, actualStart, actualEnd })` →
  `{ plannedDuration, actualDuration, varianceStart, varianceCompleted, varianceDuration }`,
  each a whole-day signed number or `null` when its inputs are missing. Reuse `parseDay`/
  `dayDiff`. Tests pin: signs (late = positive), null-propagation (missing planned date →
  null duration, not 0), ongoing (actualEnd = today), and jumped-straight-to-complete.

## Sub-phasing (ship + verify each)

### Phase 1 — Pure schedule-variance helpers (+ tests), no UI
- **Scope:** add `firstOngoingIso` + `activitySchedule` (names negotiable) to
  `progressAnalytics.ts` with a co-located `.test.ts`; refactor `UnitHistoryModal`'s Journey
  tab to consume `firstOngoingIso` so there is a single source of "actual start" (assert the
  Journey render is unchanged). No new columns yet.
- **Approval gates:** none (pure logic + a no-behavior-change refactor).
- **Exit criteria:** typecheck + test + build green · new fns unit-tested (signs, nulls,
  ongoing, jump-to-complete) · existing `UnitHistoryModal.test.tsx` still green · close with
  `verify-feature` → STOP.

### Phase 2 — Cheap metrics on the expanded per-activity rows
- **Scope:** on `StatusTable`'s expanded child rows (and, if it reads well, the modal's Log
  tab), show **Planned Duration** and **Variance Completed** from the already-loaded
  `childLog` — no new query. Compact, muted; Variance Completed colored via the existing
  `varianceFill` scale (a number, not a new color). Respect applicability (N/A child rows
  show nothing). Watch table width at laptop sizes with compact mode on/off.
- **Approval gates:** none (display-only, no new data).
- **Exit criteria:** typecheck + test + build green · dev:3010 on Orchard Path III
  (data-rich) + Mill Pond (thin): durations + completion variance read correctly on expanded
  rows; width holds; N/A rows stay clean · `verify-feature` → STOP.

### Phase 3 — Full audit-backed variance set in the Unit History modal
- **Scope:** surface **Actual Started · Actual Duration · Variance Start · Variance Duration**
  (plus the Phase-2 pair) per activity inside `UnitHistoryModal`, powered by the already-loaded
  per-unit `useUnitHistory` audit — the cheap place for audit-backed math. Prefer extending the
  **Log tab** with the extra columns first (cheapest); a dedicated "Variance" sub-view is a
  fallback if the Log tab gets too wide (see Open decisions). Reuse `activitySchedule` +
  `firstOngoingIso` from Phase 1.
- **Approval gates:** none.
- **Exit criteria:** typecheck + test + build green · dev:3010: open a data-rich location's
  history — actual-start/duration/variances match its Journey bars; a not-yet-started activity
  shows blanks, not zeros; an ongoing activity's Actual Duration counts to today · Verify on
  Orchard Path III + Mill Pond · `verify-feature` → STOP. **End of workstream — mark plan +
  memory complete.**

## Verification commands (the exit-criteria gate)
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
- **Lint is NOT a gate** (~1850 pre-existing problems).
- **No E2E** — dev:3010 click-throughs on BOTH Orchard Path III (data-rich) and Mill Pond
  (thin/empty); the "not started → blank not zero" path is half the point.
- Vitest globals OFF: import `{ describe, it, expect, vi }` from `'vitest'`.

## Hard guardrails (AGENTS.md — do not violate)
- **Extend, never fork, `progressAnalytics`** — new pure fns with tests; existing
  pace/variance math + `VARIANCE_COLORS` untouched. Respect applicability in every derivation.
- **No write-path / DB / RLS / migration / forecast-math changes** — display + client
  derivation only, over data already fetched.
- **No new hot-path queries** — audit-backed metrics ride the existing per-unit
  `useUnitHistory`; any future bulk path MUST paginate past the 1000-row cap (flag in review).
- **No recolor** of `mapDisplayStatuses`; variance numbers reuse the existing scale.
- **Types** derive from `database.types.ts`; no `any`; new files `.ts`/`.tsx`.
- **Don't commit or push until the owner says "Approved."** One branch, one commit per phase.

## Open decisions (settle at kickoff — do not guess mid-build)
1. **Duration basis — calendar vs working days.** *Recommended: calendar days* (matches the
   existing `dayDiff` and every other duration in the app; zero new assumptions). Working days
   would need a new working-day-diff util + a holiday/weekend definition the app doesn't have
   yet — a bigger, separate change. Pick calendar unless the owner needs crew-days.
2. **Final placement confirm.** *Recommended: expanded per-activity rows (cheap) + Unit
   History modal (full set)*, NOT six columns on the per-location summary row (width + it would
   only ever show the one current activity). The owner said "columns" — deliver columns, just
   on the per-activity rows where they're meaningful.
3. **Phase 3 presentation** — extra columns on the existing **Log tab** (*recommended, cheapest*)
   vs. a dedicated "Variance" sub-view in the modal. Decide once you see the Log tab's width
   with the extra columns.

# Kickoff — Schedule Variance Columns, Phase 2: cheap metrics on the expanded per-activity rows

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of Schedule Variance Columns** (show **Planned Duration** and
> **Variance Completed** on the desktop list's expanded per-activity child rows — from the
> already-loaded `childLog`, no new query). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-08 - Schedule Variance Columns Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Schedule-Variance-Columns-Plan.md` (Phase 2 + Data model + Guardrails)
> - `sitepulse-next/AGENTS.md` §3 (progressAnalytics single-source; statusColors; applicability)
>
> Branch off `main`. Build **only Phase 2** (display-only; no new query, no DB/write-path
> changes, no new colors). Reuse `activitySchedule` from Phase 1 and the existing
> `varianceFill`/`VARIANCE_COLORS` scale — do not fork either. Don't commit or push until I
> say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Where Phase 1 left off (already on `main` once merged)
`src/utils/progressAnalytics.ts` now exports the tested pure helpers:
- `activitySchedule({ plannedStart, plannedEnd, actualStart, actualEnd })` →
  `{ plannedDuration, actualDuration, varianceStart, varianceCompleted, varianceDuration }`
  — each a signed whole-day number or `null` when inputs are missing (late = positive).
- `firstOngoingIso(auditRows)` — the single "actual start" definition (Phase 3 uses it).

Phase 2 uses **only** `activitySchedule` and only its two **cheap** outputs (`plannedDuration`,
`varianceCompleted`) — the ones computable from a `status_logs` row with no audit timeline.

## Why this phase
The expanded child rows already show each activity's **Planned Start · Planned Completion ·
Actual Completed** dates. Phase 2 adds the two numbers a PM can get *for free* from those same
dates: **Planned Duration** ("planned 10d") and **Variance Completed** ("finished 6d late").
No new data is fetched — it's arithmetic over cells already on screen. The full audit-backed
set (Actual Started/Duration, Variance Start/Duration) lands in the modal in Phase 3.

## Required reading
- `Notes/plans/Schedule-Variance-Columns-Plan.md` — **Phase 2**, **§ Data model** (the "cheap"
  bullet), **§ Hard guardrails**, **§ Open decision 2** (placement).
- `AGENTS.md` §3 — progressAnalytics is the single source of truth (EXTEND, never fork);
  applicability (N/A slots never show a number); `statusColors` is a *different* palette — the
  variance number reuses `VARIANCE_COLORS`, NOT the temporal `statusColors`.
- `src/components/StatusTable.tsx` — the expanded child-row block (the `expandedUnitIds.has(unit.id)
  && currentActivities?.map(...)` loop). Two branches per activity: an **N/A branch** (shows `—`
  everywhere — your metrics must stay blank here too) and the **normal branch** where `childLog`
  (its `status_logs` row, real or a `temporal_state:'none'` stub) is in scope. The child `<tr>`
  ends with a trailing right-aligned empty `<td>` — a natural home for a compact metric cell.
- `src/utils/progressAnalytics.ts` — `activitySchedule`, `varianceFill`, `VARIANCE_COLORS`.
- `src/components/StatusTable.tsx` header row — Planned Start / Planned Completion / Actual
  Completed `<th>`s; add matching header(s) only if you add real column(s) (keep column counts
  aligned across parent header, parent row, N/A branch, and normal branch).

## Scope (Phase 2 only)
- On each **normal** expanded child row, derive from `childLog` (dates-in):
  - **Planned Duration** = `activitySchedule({ plannedStart: childLog.planned_start_date,
    plannedEnd: childLog.planned_end_date, actualStart: null, actualEnd: childLog.logged_date }).plannedDuration`
  - **Variance Completed** = same call, read `.varianceCompleted` (non-null only once the
    activity is `completed` and has a `logged_date`).
  - Render both **compact + muted**; blank (`—` or nothing) when the value is `null`. Color the
    Variance Completed number with the existing scale (late → the `behind` ramp; on-time/early →
    muted/emerald). **No new color, no new palette.**
- On the **N/A** child branch: show nothing (keep the existing `—`/italic treatment).
- **Placement** (owner's steer, plan Open-decision 2): keep it on the **expanded per-activity
  rows**, not the flat per-location summary row. Decide the exact cell (a new trailing
  "Duration / Δ finish" column vs. muted text appended under the Planned Completion / Actual
  Completed cells) *after seeing laptop width with compact mode on AND off* — width is the
  constraint that motivated Batch B's completed-fold. Whatever you pick, keep the column counts
  consistent across all four row variants.
- **No new query, no DB/RLS/migration/write-path/forecast-math changes, no `Date.now()` in the
  pure layer** (today isn't needed for the cheap metrics — completion variance is against
  `logged_date`, not today).
- Optionally mirror the same two numbers on the modal's **Log tab** *only if it reads well*;
  skip if it crowds the table.

## Watch-outs
- **Null, not zero.** A missing planned date → blank Planned Duration, never `0`. Not-yet-
  completed → blank Variance Completed (no `logged_date` yet). A false "0d" reads as "on time".
- **Right palette.** Variance colors come from `VARIANCE_COLORS`/`varianceFill` (schedule-lag
  encoding), NOT `statusColors` (temporal state). Two different languages — don't cross them.
- **`varianceFill` takes a `VarianceInfo`, not a raw number.** To color a completion variance,
  either synthesize a minimal `{ kind: 'behind', days }`-shaped input for the late case and read
  `VARIANCE_COLORS` directly for on-time/early, or add a tiny pure `varianceCompletedColor(days)`
  helper to `progressAnalytics.ts` (with a test) — **do not fork** the threshold ramp; reuse
  `VARIANCE_COLORS`.
- **Applicability.** The N/A branch already exists and short-circuits before `childLog` — just
  don't add numbers there. Never compute a metric for an N/A slot.
- **Keep the flat "Actual Completed" column** (Data Storytelling P3-followup) exactly as-is.

## Exit criteria
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green
- `... run test` green — any new pure helper (e.g. a color mapper) unit-tested; existing
  `StatusTable`/progressAnalytics tests still green
- `... run build` green
- `dev:3010` (`npm run dev:3010`, http://localhost:3010) on **Orchard Path III** (data-rich) and
  **Mill Pond** (thin/empty): expand a location — Planned Duration + Variance Completed read
  correctly on activity rows, the "not completed → blank not zero" path holds, N/A rows stay
  clean, and table width survives compact mode **on and off**.
- Close with `verify-feature` → Definition of Done report → STOP. Do not commit or push until the
  owner says "Approved." Then draft the **Phase 3** kickoff (full audit-backed variance set —
  Actual Started/Duration + Variance Start/Duration — in the Unit History modal, powered by the
  already-loaded `useUnitHistory` audit, reusing `firstOngoingIso` + `activitySchedule`) and
  paste its launch prompt into chat.

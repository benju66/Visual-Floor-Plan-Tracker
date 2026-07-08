# Kickoff — Schedule Variance Columns, Phase 1: pure schedule-variance helpers (+ tests)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Schedule Variance Columns** (pure per-activity duration/variance
> helpers in `progressAnalytics.ts` + tests; lift the Journey tab's "actual start"
> derivation into one shared fn). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-08 - Schedule Variance Columns Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Schedule-Variance-Columns-Plan.md` (Phase 1)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 1** (pure logic + a no-behavior-change refactor of
> `UnitHistoryModal` to use the new fn — no new UI/columns). Extend `progressAnalytics.ts`,
> never fork it. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase
The owner wants each activity's full schedule story as numbers — Planned Duration, Actual
Started, Actual Duration, and the three signed variances — as a follow-up to Data Storytelling
Batch B (which added the per-location "6d late" number). Phase 1 lays the correctness
foundation: the pure, tested day-math, with **one** shared definition of "when did work
actually start" (today that logic is buried inline in the Unit History Journey tab). No UI
columns yet — those are Phases 2–3.

## Required reading
- `sitepulse-next/Notes/plans/Schedule-Variance-Columns-Plan.md` — the plan of record
  (§ Data model, § Pure logic, § Phase 1, § Open decisions).
- `sitepulse-next/AGENTS.md` §3 (progressAnalytics is the single source of truth — EXTEND,
  never fork; applicability), §6 (TypeScript guardrails), §9 (Vitest, globals OFF).
- `src/utils/progressAnalytics.ts` — where the new fns go; reuse `parseDay`/`dayDiff`.
- `src/components/UnitHistoryModal.tsx` — the Journey tab's `firstOngoing`/`actualStart`
  derivation to lift out (the refactor target).
- `src/hooks/useProjectQueries.ts` — `useUnitHistory` shape (the audit rows the helper reads).

## Scope (Phase 1 only)
- Add to `progressAnalytics.ts` (+ co-located `.test.ts`):
  - `firstOngoingIso(auditRows): string | null` — first `temporal_state==='ongoing'` event's
    `client_timestamp` (fallback `changed_at`); this is the Journey tab's existing derivation,
    lifted so there's ONE definition of "actual start".
  - `activitySchedule({ plannedStart, plannedEnd, actualStart, actualEnd })` →
    `{ plannedDuration, actualDuration, varianceStart, varianceCompleted, varianceDuration }`,
    each a whole-day **signed** number or `null` when inputs are missing. Late = positive.
    Reuse `parseDay`/`dayDiff`. **Pass dates IN — no `Date.now()`** (caller supplies `today`
    for the ongoing case).
- Refactor `UnitHistoryModal`'s Journey tab to call `firstOngoingIso` instead of its inline
  logic — a **no-behavior-change** refactor (the Journey render must be identical).
- **No new columns, no new queries, no UI additions.** Names above are negotiable — match
  the module's existing style.

## Watch-outs
- **Null-propagation, not zeros:** a missing planned date → `null` duration, never `0`. A
  not-yet-started activity has no actual start → null actual duration / variance. Tests must
  pin this (a false "0d" reads as "on time", which is a lie).
- **Ongoing:** Actual End = `today` when the activity is ongoing (caller passes `today`);
  Actual Duration then counts to today, matching the Journey bar.
- **Jumped straight to complete** (no `ongoing` event): Actual Start falls back to the
  completion day — mirror the Journey tab's current behavior exactly so the refactor is
  faithful.
- Keep the flat **"Actual Completed" column** the Data Storytelling P3-followup restored —
  do not touch StatusTable in this phase.

## Exit criteria
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green
- `... run test` green — new helpers unit-tested (signs, null-propagation, ongoing→today,
  jump-to-complete); existing `UnitHistoryModal.test.tsx` still green (refactor changed nothing)
- `... run build` green
- Close with `verify-feature` → Definition of Done report → STOP. Do not commit or push until
  the owner says "Approved." Then draft the Phase 2 kickoff (cheap metrics on the expanded
  per-activity rows) and paste its launch prompt into chat.

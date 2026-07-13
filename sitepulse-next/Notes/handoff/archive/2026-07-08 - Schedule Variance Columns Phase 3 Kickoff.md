# Kickoff — Schedule Variance Columns, Phase 3: full audit-backed variance set in the Unit History modal

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3 of Schedule Variance Columns** (the final phase — surface the full
> per-activity variance set **Actual Started · Actual Duration · Variance Start · Variance
> Duration**, plus the Phase-2 pair Planned Duration + Variance Completed, inside the **Unit
> History modal**, powered by the already-loaded per-unit `useUnitHistory` audit — no new query).
> Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-08 - Schedule Variance Columns Phase 3 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Schedule-Variance-Columns-Plan.md` (Phase 3 + Data model + Guardrails + Open decision 3)
> - `sitepulse-next/AGENTS.md` §3 (progressAnalytics single-source; statusColors vs VARIANCE_COLORS; applicability)
>
> Branch off `main` (see the note below — Phases 1+2 are stacked on `schedule-variance-columns-phase-2`,
> not yet on `main`; base off that tip so `activitySchedule`/`firstOngoingIso`/`varianceCompletedColor`
> exist). Build **only Phase 3** (display-only; no new query, no DB/write-path/forecast-math changes,
> no new colors). **Reuse `activitySchedule` + `firstOngoingIso` from Phase 1 and `varianceCompletedColor`
> from Phase 2 — do not fork any of them.** Don't commit or push until I say "Approved." This is the
> **last phase** — on approval, mark the plan + the `schedule-variance-columns` memory COMPLETE.

---

> Context for the session (the detail the launch prompt points at).

## ⚠ Branch base (important — same situation Phase 2 hit)
Phases 1 and 2 are **not on `main` yet** — they are stacked commits on the
`schedule-variance-columns-phase-2` branch:
- `40a84f2` — P1 pure helpers (`activitySchedule`, `firstOngoingIso`) + tests
- `4cae308` — P2 cheap metrics on the expanded list rows + `varianceCompletedColor` + test

"Branch off `main`" presupposes those are merged. They aren't. **Base your Phase 3 branch on the
`schedule-variance-columns-phase-2` tip** (that *is* "main once P1+P2 land"), or the helpers you must
reuse won't exist and nothing will build. Flag this in your summary the way P2 did, and let the owner
decide the eventual merge order (likely: merge P1→P2→P3 to `main` together after this final approval).

## Where Phases 1 & 2 left off
`src/utils/progressAnalytics.ts` exports the tested pure helpers you will reuse **as-is**:
- `activitySchedule({ plannedStart, plannedEnd, actualStart, actualEnd })` →
  `{ plannedDuration, actualDuration, varianceStart, varianceCompleted, varianceDuration }` — each a
  signed whole-day number or `null` when its inputs are missing (late = positive). **Phase 3 is the
  first consumer of ALL five outputs** (P2 used only the two cheap ones).
- `firstOngoingIso(auditRows)` — the single "actual start" definition. `UnitHistoryModal`'s Journey
  tab already calls it (Phase 1 refactor).
- `varianceCompletedColor(days)` (Phase 2) — colors a signed completion variance off `VARIANCE_COLORS`
  (late → `varianceFill`'s behind ramp; early → emerald; on-time → slate). Reuse it for Variance
  Completed; for the *other* signed variances (Start/Duration) either reuse it directly (same
  late=positive semantics) or, if you want a distinct label treatment, keep the SAME color rule — do
  not invent a second ramp.

`StatusTable`'s expanded child rows now show Planned Duration ("planned Nd") + Variance Completed
("Nd late/early") from the cheap `status_logs` dates (Phase 2). Phase 3 completes the picture in the
modal, where the per-unit audit timeline is already loaded.

## Why this phase
The list's expanded rows answer "how long was it planned, and did it finish late?" — the two numbers
free from `status_logs`. The remaining three — **when did it actually start, how long did it actually
run, and how far did the start slip** — need the **audit timeline** (`status_audit_log`), which the
Unit History modal already loads for ONE unit on demand (`useUnitHistory`). That is the cheap, correct
home for the audit-backed set (loading it list-wide is the 1000-row hot-path trap the guardrails
forbid — [[supabase-1000-row-cap]], AGENTS.md §2/§3). "Framing was planned 10 days, ran 16, started 4
days late, finished 6 late" — the full story, per activity, in the place a PM already opens to inspect
one location.

## Required reading
- `Notes/plans/Schedule-Variance-Columns-Plan.md` — **Phase 3**, **§ Data model** (the "audit-backed"
  bullet: Actual Started/End/Duration, Variance Start/Duration signs + null rules), **§ Hard
  guardrails**, **§ Open decisions 3** (Log tab columns vs a dedicated "Variance" sub-view).
- `AGENTS.md` §3 — progressAnalytics is the single source of truth (EXTEND/REUSE, never fork);
  applicability (N/A activities never get a variance row); `VARIANCE_COLORS` is the variance language,
  NOT the temporal `statusColors`.
- `src/components/UnitHistoryModal.tsx` — read it fresh. Key facts already true:
  - Two tabs: **Journey** (swimlane per applicable activity) and **Log** (a table). `tab` state at the
    top; the Log `<table>` header is Planned Start / **Planned Finish** / (actual) / **Date Logged** /
    By (search the `<th>`s ~"Planned Finish"/"Date Logged").
  - The **Journey `useMemo`** already resolves, per activity row (`JourneyRow`), exactly the four
    inputs `activitySchedule` needs: `plannedStart`, `plannedEnd`, `actualStart` (via `firstOngoingIso`,
    with the jump-straight-to-complete + clamp fallbacks), and `actualEnd` (= `logged_date` when
    completed, `today` when ongoing, else null). **Do not re-derive these** — feed the SAME resolved
    values into `activitySchedule` (as ISO strings) to get all five metrics from one source.
    ⚠ `JourneyRow` stores parsed `Date | null`s; `activitySchedule` wants ISO 'YYYY-MM-DD' strings.
    Resolve the metrics from the source strings (`current.planned_start_date`, `firstOngoingIso(events)`,
    `logged_date`/`todayIso`) rather than re-stringifying Dates, so there is one clean call per row.
  - It already respects applicability (`trackActivities` = `applicableActivities(...)`), so N/A slots
    are already excluded from the rows — keep it that way; never show a variance for an N/A activity.
- `src/hooks/useProjectQueries.ts` — `useUnitHistory(unitId)` (the audit rows the modal already loads;
  ride it, add NO query).
- `src/utils/progressAnalytics.ts` — `activitySchedule`, `firstOngoingIso`, `varianceCompletedColor`,
  `VARIANCE_COLORS`, `varianceFill`.

## Scope (Phase 3 only)
- For each applicable activity in the modal, compute the full set via a single
  `activitySchedule({ plannedStart, plannedEnd, actualStart, actualEnd })` call (reusing the Journey
  tab's already-resolved inputs) and surface: **Actual Started** (date), **Actual Duration** (`Nd`),
  **Variance Start** (signed `Nd late/early to start`), **Variance Duration** (signed `Nd over/under
  plan`), alongside the Phase-2 **Planned Duration** + **Variance Completed**.
- **Placement (plan Open-decision 3): extend the existing Log tab first** (cheapest) — add the columns
  there. If the Log table gets too wide at modal width, fall back to a dedicated **"Variance" sub-view**
  (a third tab) — decide *after seeing the Log tab's real width with the extra columns*, and say which
  you picked + why. Whatever you pick, keep it readable at the modal's width.
- Color the signed variances with the **existing** scale (reuse `varianceCompletedColor`, or read
  `VARIANCE_COLORS` directly) — **no new palette**. Muted/compact numbers; a blank (`—`) for every
  `null`.
- **Null, never zero** (this is half the point again): a not-yet-started activity → blank Actual
  Started / Duration / Variance Start (no `ongoing` event yet); an ongoing activity → Actual Duration
  counts **to today** (pass `todayIso` as `actualEnd`), Variance Completed still blank until completed;
  a same-day/actual==plan genuine `0` is real and kept.
- **No new query, no DB/RLS/migration/write-path/forecast-math change, no `Date.now()` in the pure
  layer** (the component owns `today`; the pure helpers stay deterministic).
- Add/extend a test only if you add new pure logic. If Phase 3 is pure wiring over `activitySchedule`
  (likely), a `UnitHistoryModal` render assertion that the metrics show for a data-rich unit and blanks
  for a not-started one is the higher-value test; keep existing `UnitHistoryModal`/`progressAnalytics`
  tests green.

## Watch-outs
- **One source of "actual start".** Use `firstOngoingIso` (already in the Journey memo). Do not add a
  second definition or read `ongoing` events by hand.
- **ISO in, not Dates.** Feed `activitySchedule` the source ISO strings; don't round-trip `JourneyRow`'s
  parsed `Date`s. Actual start can be a full `...T..:..Z` timestamp — `activitySchedule` parses it
  date-only (timezone-stable), as its Phase-1 tests pin.
- **Ongoing → today.** `actualEnd = todayIso` while ongoing so Actual Duration keeps counting; leave
  Variance Completed null until the slot is actually completed.
- **Right palette.** Variance numbers use `VARIANCE_COLORS`/`varianceCompletedColor`, NOT `statusColors`.
- **Applicability.** The modal's `trackActivities` is already the applicable list — don't widen it; N/A
  activities must not get a variance line.
- **Bad plan data surfaces honestly.** As seen in P2 verification, some real slots have
  `planned_end < planned_start` → a negative Planned/─Duration. That's the data, not a bug; render it
  (optionally `title`-tooltip it), don't clamp or hide.

## Exit criteria
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green
- `... run test` green — existing `UnitHistoryModal.test.tsx` + `progressAnalytics.test.ts` still green;
  any new assertion added is green
- `... run build` green
- `dev:3010` (`npm run dev:3010`): open a **data-rich** location's history on **Orchard Path III**
  (Level 4 has real per-slot planned dates + completions — e.g. unit 4101/4120) — Actual Started /
  Actual Duration / Variance Start / Variance Duration match that unit's Journey bars and the Phase-2
  list numbers; a **not-yet-started** activity shows blanks (not zeros); an **ongoing** activity's
  Actual Duration counts to today. Then sanity-check **Mill Pond** (thin/empty) opens cleanly with no
  metrics and no errors. (Verify read-only — the dev build points at the PRODUCTION db; never Apply a
  write, per [[no-live-write-probes]].)
- Close with `verify-feature` → Definition of Done report → STOP. Do not commit/push until the owner
  says "Approved."
- **This is the end of the workstream.** On approval: commit Phase 3, then mark
  `Notes/plans/Schedule-Variance-Columns-Plan.md` COMPLETE and update the `schedule-variance-columns`
  memory to DONE (all three phases shipped). No further kickoff to draft.

# BACKLOG — Actual-Start Lag → Risk Radar ("item 4")

> **Status: BACKLOGGED (deferred, not scheduled).** A standalone leading-indicator
> follow-on, sibling to the (COMPLETE) **Band vs Promise** workstream but explicitly out of
> scope there. Captured here so it can be picked up cold with the right context — it is a
> spec + decision record, **not** a launch-ready kickoff. Reopen only when the trigger below
> is met. Recorded 2026-07-09.

## One-line
A *leading* schedule-risk signal that flags activities which were **due to start but haven't**
(or **started late**) — catching slippage at the *start* of work, before the finish-date math
can see it.

## Why this exists / the gap it fills
The shipped **Risk Radar** (`activityRisk` in `src/utils/monteCarloForecast.ts`, rendered by
the dashboard's `RiskRadar` module) ranks activities by *finish* risk: it projects each
activity's pessimistic finish (the confidence band's **P90**) and surfaces the ones running
latest past their planned finish. That is a **lagging** view — it needs pace/progress data, so
it mostly lights up once work is underway and already drifting.

Actual-start lag is the **earliest** signal available: the gap between **planned start** and
**actual start**. A late start is the single earliest predictor that an activity finishes late
— known on day one of the slip, not weeks later when the finish projection catches up. Two
flavors:
- **Overdue to start** — planned start has passed, activity still "not started."
- **Started late** — actual start landed N days after planned start.

## How it would work (mechanism — the pieces already exist)
Display-only, pure-math extension; **no new table/migration/hook**:
- **Planned start** = `planned_start_date` on each `status_logs` slot.
- **Actual start** = the existing `resolveActualStartIso(events, { enteredStart })` in
  `src/utils/progressAnalytics.ts` (an entered `actual_start_date` wins; else the first genuine
  `ongoing` audit event; else null).
- **Math** = `dayDiff(parseDay(plannedStart), parseDay(actualStart ?? today))` — reuse
  `parseDay`/`dayDiff`; positive = late/overdue. Rank locations×activities by biggest start-lag.
- **Applicability** — respect N/A exactly like the rest (`applicableActivities` +
  `ApplicabilityIndex`, AGENTS.md §3): never count a slot that doesn't apply to a location.
- **Surface** = a rail in / beside the `RiskRadar` dashboard module, colored off the existing
  `VARIANCE_COLORS` ramp (no new palette). Deterministic — `today` passed in, no `Date.now()`.
- **Home for the pure fn** = extend the additive forecast layer (`monteCarloForecast.ts`) or
  add a companion in `progressAnalytics.ts`; **extend, never fork** the existing variance/pace
  math (AGENTS.md §3).

## THE honesty gate (the crux — do not skip)
The value is real but the trust hinges entirely on data honesty, and this codebase already
learned the failure mode. The **Actual-Dates Capture** work exists precisely because the field
"ongoing" tap is **unreliable** — supers batch-log, subs move unseen (see the
[[schedule-variance-columns]] memory + `resolveActualStartIso`'s doc-comment). So **"no ongoing
event logged" does NOT reliably mean "didn't start."**

- A naive radar built on "no ongoing event = not started" will **cry wolf** on every activity
  the crew started but nobody tapped — the exact trap that steered the app to *typed*
  actual-start dates. That would erode trust in the Radar's hard-won honesty (cf. the "no
  meaningful move" note the owner valued).
- Therefore the signal splits by how a project logs:
  - **Enters actual-start dates** → trustworthy, concrete, chase-able. Full value.
  - **Doesn't** → it may only honestly ask *"planned start has passed — is this started?"* (a
    soft prompt), NEVER assert *"N days late."* Frame the no-data case as a question.

## Overlap with what's already shipped (item 4's distinct job)
The List already exposes start slippage per-row: the **`Start Var.`** column (from
`activitySchedule`'s `varianceStart`) and the bottleneck `ahead`/`behind` states
(`computeUnitVariance`). Item 4's **distinct** contribution is the **roll-up / ranking** —
turning scattered per-activity start-lags into one "chase these first" dashboard list. Build
only that delta; don't re-surface per-row data that already exists.

## Worth-it verdict + sequencing (recommendation)
**Worth building — but honestly-gated and sequenced, not speculative.**
- **Do NOT build until** actual-start-date entry is a real habit on ≥1–2 live projects, so the
  signal stands on real data. That is the **trigger to reopen**.
- When built: gate the "N days late" assertion behind actual-start data; degrade to a soft
  "due to start, not yet marked" prompt otherwise — never a false "late."
- Kept deferred for now because the capture habit isn't widespread yet; a speculative build
  would be a false-alarm machine.

## Scope guardrails (when it's built)
- Display-only: no migration, no new table, no new hook, no new palette.
- Extend, never fork `monteCarloForecast` / `progressAnalytics`; reuse `resolveActualStartIso`,
  `parseDay`/`dayDiff`, `VARIANCE_COLORS`, applicability.
- Deterministic (`today` passed in); pure fn unit-tested; honest suppression (no data → prompt,
  not verdict).
- Open with the `plan-phases` skill, close each phase with `verify-feature`.

## Relationship to Band vs Promise
Sibling follow-on; **out of scope** of Band vs Promise (COMPLETE + shipped to main 2026-07-09,
through `88a2586`). Listed there under "Out of scope / deferred" as "item 4." Independent — no
dependency on the baseline layer.

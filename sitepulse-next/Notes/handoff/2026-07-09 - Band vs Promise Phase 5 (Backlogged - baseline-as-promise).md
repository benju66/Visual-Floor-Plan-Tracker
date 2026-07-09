# BACKLOG — Band vs Promise, Phase 5: baseline-as-automatic-promise (NOT built; cut at review 2026-07-09)

> **Status: BACKLOGGED — do not build as originally specified.** The Band vs Promise
> feature is considered **DONE at P4**. This note records *why* P5 was cut and, if it's
> ever revisited, the **inverted-fallback** design to build instead of the plan's original
> "baseline supersedes the contract date" version. It is deliberately **not** a launch
> prompt — do not start a session from this doc without the owner re-opening the work.

## The decision (owner, 2026-07-09)
After P4 shipped (baseline columns + drift read in the List), the owner asked for a
recommendation on P5 and chose to **backlog it**. The plan's P5 was: *when a baseline
exists, measure the hero confidence band against the baseline's implied finish, superseding
the manual contract completion date.* We are **not** building that.

## Why the "supersede" design was cut
The two dates answer **different questions**, and the workstream's whole framing is "are we
keeping our **word**?" — a *contractual* question:
- **The contract completion date is the promise.** It's the deadline in the actual contract
  — what claims / liquidated damages hinge on. It does not move.
- **The baseline's implied finish is the team's internal plan.** Teams usually plan to
  finish *before* the contract deadline; that gap is their buffer.

If the baseline supersedes the contract date, the hero can read **"on track vs baseline"**
while the project is actually **at risk vs the real contract deadline** (plan finishes
comfortably, contract date is tighter). That's an honesty regression against the feature's
own purpose — and honesty has been the owner's #1 concern throughout. Two more strikes:
- The baseline finish is **Layer-1 derived** — only as trustworthy as how completely the
  plan was cascaded when the baseline was captured. The contract date is unambiguous.
- A user who captures a baseline for the **P4 drift feature** would have it silently
  **redefine their contractual promise** — a surprising coupling, even with clear labels.

P4 already puts the baseline where it belongs (drift, in the List). P2's contract-date
promise works and the owner validated it. **P4 is a clean stopping point.**

## IF this is ever revisited — build the INVERTED-FALLBACK version (not supersede)
Trigger to reopen: projects that **live on a baseline and never enter a contract date**, and
want a top-line promise line anyway.
- **Contract completion date ALWAYS wins when it is set** — the contractual deadline is the
  promise; the internal plan never overwrites it.
- **The baseline's implied finish fills in ONLY when no contract date exists** — a fallback
  *for* the manual date, not a replacement of it. Label it clearly (e.g. "vs plan target
  {baseline name}") so it never reads as a contractual commitment.
- Never two promise lines at once; nothing when neither basis exists or the band is suppressed.

This gives baseline-first projects a promise line without ever letting the internal plan
mask contract risk.

## Technical pointers (so a revisit isn't from scratch)
- Extract `baselineImpliedFinish(snapshot): string | null` into `src/utils/scheduleBaseline.ts`
  (latest LEVEL end — the number `projectDriftSinceBaseline` already computes internally; have
  it call the new fn so "baseline finish" lives in one place; unit-test it).
- REUSE the existing P2 `promiseOutlook({ promise, band })` in `src/utils/monteCarloForecast.ts`
  **unchanged** — the inverted-fallback change is only *which date* is passed as `promise`
  (contract date when set, else `baselineImpliedFinish`) and the LABEL.
- Wire in `src/components/ProjectDashboard.tsx` where `promiseOutlook({ promise:
  contractCompletionDate, band: heroBand })` already renders the promise line; resolve the
  baseline via `useScheduleBaselines` + `resolveCurrentBaseline` (no new hook).
- Guardrails unchanged: display-only, no migration/table/hook/palette, extend never fork,
  suppressed band → no line.

## Sibling still deferred (separate from this)
- **Item 4 — actual-start lag signal into the Risk Radar.** A different follow-on, not part
  of Band vs Promise. See `Notes/plans/Band-vs-Promise-Plan.md` "Out of scope / deferred".

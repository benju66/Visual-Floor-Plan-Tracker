# Kickoff — Scheduling Analytics (Slice B), Phase 6: production rates + forward-looking analytics

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 6 of Scheduling Analytics (Slice B)** — production rates + the forward-looking analytics that make the pitch real (required-rate-vs-actual, forecast-trend, the bottleneck that costs the end date, and private per-GC benchmarking). This phase is **READ-ONLY: no migration, no status writes**. Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-03 - Scheduling Analytics Phase 6 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Scheduling-Analytics-Slice-B-Plan.md` (Phase 6 + Pure logic + Hard guardrails)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 6**. **DO NOT fork `progressAnalytics` — extend/wrap it.** **Respect applicability** (N/A slots never enter a denominator). **Suppress, don't fake**, tiny-sample / zero-span / zero-pace. Benchmarking is **private per-GC** (within-tenant, never cross-client). Don't commit or push until I say "Approved". **Consider splitting 6a / 6b / 6c.**

---

> Context for the session (the detail the launch prompt points at).

## What this is (plain English)
Phases 4–5 gave the schedule *behavior* (make-ready + date-ripple) and *identity* (cost code
+ subcontractor). Phase 6 turns that into a **forecast**: how fast is each cost code / sub
actually going (SF/week), are they on pace to hit the date (and if not, "~3 weeks late — needs
+1 crew"), where the forecast is trending, and which activity is the real **bottleneck that
moves the finish date**. Plus **private benchmarking**: compare a sub or a cost code across the
GC's own jobs. This is all **read-only** — it reads history, it never writes a status.

## Where Phase 5 left off (done + on main)
- `cost_codes` (global, 227 seeded) + `activity_dictionary.cost_code_id` FK; a canonical
  activity carries a cost code that propagates to every linked project activity.
- `companies` (global) + `activities.subcontractor_id`; a project activity names its sub.
- Hooks: `useCostCodes`, `useCompanies`; pickers in `ActivityManagerPanel`. **main == origin ==
  ccfde7a**, both migrations already on prod. See memory `scheduling-analytics-slice-b`.
- `units.computed_area` (Scale work) is the **SF quantity denominator** — already live.

## Critical ground-truth facts (verify fresh)
- **`progressAnalytics.ts` is the single source of truth** for lag/pace/forecast math
  (`summarizeGroup`, `computeUnitVariance`, `byWeek`, `varianceFill/Label`, `GroupRollup`).
  **Extend or wrap it — do NOT fork.** (AGENTS.md §3.)
- **Applicability is respected everywhere**: `summarizeGroup` takes an optional
  `ApplicabilityIndex`; `computeUnitVariance` takes an already-filtered activity list. Every
  rate denominator must exclude N/A (unit × activity) slots (`applicability.ts`).
- **History source = `status_audit_log`** (append-only, dated completions), read via the
  existing `useProjectQueries`/`useProjectActions` layer. `status_logs` is current-state only.
- **`ProjectDashboard` already fetches all-project units/statuses/history** — extend it; do NOT
  re-fetch in a fork. Cost code lives on the dictionary entry (join via `activities.dictionary_id
  → activity_dictionary.cost_code_id`); sub lives on `activities.subcontractor_id`.
- **Cross-project benchmarking respects the AI-training-style privacy stance**: within the
  tenant's own projects only (RLS already scopes reads to the user's memberships). Never pool
  across tenants.

## Required reading (in order)
1. `sitepulse-next/AGENTS.md` — §2 (READ-ONLY on `status_audit_log`; never `.insert()` status;
   no offline-queue involvement), §3 (do NOT fork `progressAnalytics`; applicability in every
   denominator; don't recolor `mapDisplayStatuses`), §6 (types / JSONB narrowing).
2. `sitepulse-next/Notes/plans/Scheduling-Analytics-Slice-B-Plan.md` — **Phase 6** scope, the
   **Pure logic to extract** block (the three new util signatures), **Hard guardrails**.
3. Read fresh, as the surfaces to EXTEND (do NOT fork):
   - `src/utils/progressAnalytics.ts` — `summarizeGroup`/`byWeek`/`computeUnitVariance`. Wrap for
     rates + required-rate + forecast history.
   - `src/utils/applicability.ts` — `buildApplicabilityIndex`, `isMilestoneApplicable`.
   - `src/components/ProjectDashboard.tsx` + `src/components/dashboard/FloorPulse.tsx` +
     `TypeScorecard.tsx` — the analytics surface (already fetches all-project data).
   - `src/hooks/useProjectQueries.ts` / `useProjectActions.ts` — `status_audit_log` reads.
   - Phase-5 hooks `src/hooks/useCostCodes.ts` / `useCompanies.ts` — join cost code / sub identity.

## Scope (only this — read-only)
1. **Pure logic (framework-free, deterministic, unit-tested; never call `Date.now()` inside —
   callers pass `today`):**
   - `src/utils/productionRates.ts` — `completedAreaEvents(auditRows, units, applicabilityIndex)`
     → dated `{ costCodeId|subId|activityId, sqFt, date }[]` (applicable + completed only);
     `productionRateBy(events, key, opts)` → `{ totalSqFt, spanDays, sqFtPerWeek }` (+ optional
     weekly series like `byWeek`). **Suppress tiny-sample / zero-span.**
   - `src/utils/requiredRate.ts` — `requiredRate(remainingQty, today, targetDate)` +
     `paceGap(actualRate, requiredRate)` → the staffing/date delta ("need +N crews or date → X").
   - `src/utils/forecastTrend.ts` — series of historical `forecastDate` values → the
     slipping-forecast line (reuse `summarizeGroup`'s forecast; this is its history over time).
2. **Dashboard modules (extend `ProjectDashboard`/`FloorPulse`/`TypeScorecard`):** production
   rate per cost code / sub (SF/week); **required-rate-vs-actual** card (staffing/date action);
   **forecast-trend** line; make-ready surfaced; the **bottleneck-that-costs-the-end-date**.
3. **Private per-GC benchmarking:** compare a sub / cost code across the tenant's own projects.
4. **Suppress (don't fake)** tiny-sample / zero-span / zero-pace — keep the existing honesty.

## Guardrails
- **No migration. No status writes.** Analytics is READ-ONLY on `status_audit_log`. Any status
  write anywhere still goes through `upsert_status_log` / `.upsert(onConflict)` — never `.insert()`.
- **DO NOT fork `progressAnalytics`** — extend/wrap `summarizeGroup`/`byWeek`.
- **Respect applicability** — N/A (unit × activity) never enters a rate/variance denominator.
- **Don't rebuild P6/CPM** — FS + lag only; no critical-path/float/resource-leveling.
- **Benchmarking is private per-GC** (within-tenant) — never pool across customers.
- Types derive from `database.types.ts`; narrow JSONB at the query boundary; no `Json` into props.
- Don't recolor `mapDisplayStatuses`; don't touch the offline queue or snapping pipeline.

## Exit criteria (Definition of Done)
- `typecheck` + `test` + `build` green (absolute-prefix commands in the plan's Verification section).
- New util tests pin the rate math + applicability filtering + small-sample/zero-span suppression
  + required-rate/pace-gap + forecast-trend history.
- Live `dev:3010`: a coded activity with completed area shows a sensible SF/week; required-rate
  reads as an action; un-coded / N/A activities are excluded cleanly; benchmarking compares a sub
  across ≥2 of the tenant's projects.
- Close with the **`verify-feature`** skill (Definition of Done → STOP). **Do not commit or push
  until the owner says "Approved."** Slice B is COMPLETE after this phase.
- **Consider splitting 6a = production rates (single project) / 6b = required-rate + forecast-trend
  / 6c = cross-project per-GC benchmarking** if one session gets large — an extra kickoff is cheap.

# Scheduling Analytics (Slice B) — dependency behavior, cost codes & production rates (self-contained build plan)

> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: `sitepulse-next/Notes/plans/Scheduling-Activities-Master-Plan.md` (Slice B).
> Adopts the cost-code + `productionRates.ts` design from
> `sitepulse-next/Notes/plans/Scale-Measure-Production-Rates-Plan.md` (its Phases 6–8).

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` in full — CRITICAL invariants: `status_logs` upsert-only /
   no `.insert()` (§2), capture-time `client_timestamp`, RLS posture (§2), **do not fork
   `progressAnalytics` + respect applicability (§3)**, TS/JSONB guardrails (§6).
2. Re-read the files named below **fresh** — do not trust line numbers; they drift.
3. Build the phases **in order** (4 → 5 → 6). Each is one fresh session; close each with
   `verify-feature` (Definition of Done → STOP). Do not commit/push until the owner says "Approved."
4. Keep the owner (product owner, not a developer) in the loop: 1–2 sentence plain-English summary
   first; explain jargon in passing; keep it short.

## Goal
When Slice B is done, the schedule stops being a record and becomes a forecast. **Make-ready** shows
what's ready to work vs. blocked (on the floor plan + Schedule view), and a slip on a predecessor
**ripples** downstream planned dates automatically. Activities carry a **cost code** (CSI MasterFormat)
and a **subcontractor**, so the dashboard shows **production rates** (SF/week by activity / cost code /
sub) and the forward-looking views that make the pitch real: **required-rate-vs-actual** translated into
a staffing/date action ("at this pace ~3 weeks late; needs +1 crew"), a **forecast-trend** line, and the
**bottleneck that actually costs the end date** — plus **private per-GC benchmarking** of subs across the
tenant's own jobs.

## Out of scope / deferred
- **Critical path / float, resource leveling, non-FS relationships** — NOT built. Dependencies stay
  **Finish-to-Start + lag, coarse**. (The date-ripple is a forward propagation, not a full CPM engine.)
- **Cross-client benchmarking** — benchmarking is **private, per-tenant (per-GC)** only, across that
  GC's own projects. Never pool data across customers.
- **Systems / Areas** (roof→rough-in cross-scope) — still deferred (master plan).
- **Offline-durable** cost-code/sub edits, ripple writes, and analytics — **online-first** (the field
  status-marking path stays fully offline; these admin/analysis actions are online-first).
- **Per-area subcontractor override** (two flooring subs split by tower) — v1 assigns a sub at the
  project-activity level; area-level override is deferred.

## Locked product decisions (from the owner, 2026-07-02)
- **Phase order: make-ready first (4 → 5 → 6).** Make-ready reuses the dependency edges + planned dates
  already shipped in Slice A, needs no data accrual, and drives the weekly-meeting usage that generates
  the completion data cost-code rates depend on. Rates come last (they need dated history to mean
  anything).
- **Phase 5 includes subcontractor assignment**, not just cost codes — the per-GC sub
  productivity/reliability benchmarking is the differentiator, and it's the same assignment surface.
- **Don't rebuild P6** — FS + lag, coarse, defer critical-path/float.
- **Benchmarking is private per-GC** (within-tenant, cross-project) — never cross-client.

## Data model
Read `src/types/database.types.ts` + `src/types/domain.ts` fresh (hand-maintained; drift — memory
`schema-types-drift`). Migrations additive/idempotent; present SQL + STOP (⛔).

**Already present (verified 2026-07-02):**
- `activity_dictionary.cost_code_id UUID` — **reserved slot, no FK/table yet** (migration comment says
  "RESERVED for Slice B"). Phase 5 creates `cost_codes` and adds the FK.
- `activity_dependencies` (predecessor_activity_id, successor_activity_id, type, lag) — the FS edges.
- `status_logs` keyed on `activity_id`; `planned_start_date`/`planned_end_date`/`logged_date`;
  `status_audit_log` = append-only dated completion history (the rate source).
- `units.computed_area` — correct SF (Scale work done). The **quantity denominator** for rates.
- `project_contacts.company` — project-scoped only (no global vendor identity yet).

**Phase 4 — no schema change.** Reads deps + completion state + planned dates; writes only *recomputed
planned dates* on downstream `status_logs` via the existing planned-date write path (online-first).

**Phase 5 — NEW + additive (⛔ migrations, present SQL + STOP):**
- `cost_codes` — NEW global table (adopt the Scale-Measure plan's shape): `id`, `code`, `description`,
  `division`, `unit_of_measure` (default `'SF'`), `status` (`active`/`deprecated`), `sort_order`,
  timestamps; UNIQUE on `lower(code)` (idempotent import). RLS read=member / write=owner·admin·pm /
  **never anon** (copy `subtypes`/`sheet_metadata`). Add FK `activity_dictionary.cost_code_id →
  cost_codes(id) ON DELETE SET NULL`.
- **Subcontractor/company:** a tenant-wide company identity (promote `project_contacts.company` into a
  global `companies` record, OR a new lightweight `companies` dictionary — resolve at Phase 5 start).
  Assign the sub at the **project-activity** level: `activities.subcontractor_id UUID null` (a GC uses
  different subs per job). RLS mirrors the privileged-write pattern.
- Manager UI: cost-code dictionary in `GlobalSettingsModal` (import/edit/deprecate, idempotent CSV/paste
  seed of CSI MasterFormat); cost-code + sub pickers in the activity editor (Schedule view).

**Phase 6 — reads only.** `status_audit_log` (dated completions), `units.computed_area`, `activities`
(+ `cost_code_id`, `subcontractor_id`), planned dates. **No new write path; no status writes.**

## Build-on inventory (read these fresh before using)
REUSE — do not fork:
- `src/utils/activityDependencies.ts` — `predecessorEdgeFor`, `wouldCreateCycle`, `dependencyLabel`.
  Phase 4 adds readiness + ripple on top of these.
- `src/utils/progressAnalytics.ts` — `summarizeGroup`, `computeUnitVariance`, `CompletionEvent`,
  `GroupRollup`, `orderedTrackActivities`, the `byWeek` rollup, `varianceFill/Label`. **Extend/wrap for
  rates + required-rate + forecast-trend. DO NOT FORK.**
- `src/utils/applicability.ts` — `buildApplicabilityIndex`, `isMilestoneApplicable`. **Every rate
  denominator excludes N/A slots** (§3).
- `src/components/dashboard/FloorPulse.tsx` + `TypeScorecard.tsx` + `src/components/ProjectDashboard.tsx`
  — the analytics surface to **extend** (ProjectDashboard already fetches all-project
  units/statuses/history; don't re-fetch in a fork).
- `src/hooks/useProjectQueries.ts` / `useProjectActions.ts` — `status_audit_log` reads; the established
  Query hook layer (add rate/cost-code/sub hooks here).
- `src/components/GlobalSettingsModal.jsx` + `src/app/dashboard/page.jsx` — global/cross-project settings
  home for the cost-code dictionary (memory `global-vs-project-settings`).
- The Schedule view (`src/components/schedule/`) — where make-ready surfaces + the cost-code/sub pickers
  attach.

## Pure logic to extract + unit-test
Framework-free, deterministic, no I/O, never call `Date.now()` inside (callers pass `today`/timestamps).
Suppress (don't fake) on thin data — mirror `summarizeGroup`.
- **`src/utils/activityReadiness.ts`** (Phase 4) — `readinessFor(unit, activity, deps, completedSet)` →
  `ready | blocked | done` (+ which predecessors block). Pure over the edge graph + completion state.
- **`src/utils/dateRipple.ts`** (Phase 4) — `rippleForward(edges, plannedDates, slippedActivityId,
  newFinish, lagByEdge)` → the downstream planned-date deltas (FS + lag). No cycles (reuse
  `wouldCreateCycle`); coarse; deterministic.
- **`src/utils/productionRates.ts`** (Phase 6, adopt the Scale-Measure design) —
  `completedAreaEvents(auditRows, units, applicabilityIndex)` → dated `{ costCodeId|subId|activityId,
  sqFt, date }[]` (applicable, completed only); `productionRateBy(events, key, opts)` → `{ totalSqFt,
  spanDays, sqFtPerWeek }` (+ optional weekly series like `byWeek`). Suppress tiny/zero-span.
- **`src/utils/requiredRate.ts`** (Phase 6) — `requiredRate(remainingQty, today, targetDate)` +
  `paceGap(actualRate, requiredRate)` → the staffing/date delta ("need +N crews or date moves to X").
- **`src/utils/forecastTrend.ts`** (Phase 6) — series of historical `forecastDate` values → the
  slipping-forecast line (reuse `summarizeGroup`'s forecast; this is its history over time).

## Sub-phasing (ship + verify each)

### Phase 4 — Dependency behavior: make-ready + date-ripple (no migration)
- **Scope:**
  1. `activityReadiness.ts` + `dateRipple.ts` (+ tests). Reuse `activityDependencies`.
  2. **Make-ready surfacing** (read-only): show ready vs. blocked per unit×activity on the Schedule view
     and the floor plan; precise out-of-sequence from real edges (not just `sequence_order`).
  3. **Date-ripple:** when a predecessor slips, recompute downstream planned dates and write them via the
     **existing planned-date path** (online-first; NOT the offline `pendingChanges` buffer, NOT
     `.insert()`). Confirm the affected count before the bulk write.
- **Approval gates:** none hard (no migration/RLS). The ripple bulk write touches planned dates via the
  established path — **confirm the count with the user before firing.**
- **Exit criteria:** `typecheck` + `test` + `build` green · `activityReadiness`/`dateRipple` tests pin
  readiness + FS/lag propagation + cycle-safety · live `dev:3010`: block/unblock shows correctly; slip a
  predecessor → downstream dates shift · close with `verify-feature`. **Consider split: 4a = readiness
  (read-only surfacing); 4b = date-ripple (writes).**

### Phase 5 — Cost codes + subcontractor assignment ⛔ migrations
- **Scope:**
  1. ⛔ **Migration:** `cost_codes` global table (see Data model) + RLS + FK
     `activity_dictionary.cost_code_id`. Present SQL + STOP.
  2. ⛔ **Migration:** company identity (`companies` dictionary or promote `project_contacts.company`) +
     `activities.subcontractor_id`. Present SQL + STOP. Resolve the company-identity shape at phase start.
  3. Add tables to `database.types.ts`; derive `CostCode`/`Company` in `domain.ts`.
  4. Cost-code dictionary **manager UI in `GlobalSettingsModal`** (import/edit/deprecate, idempotent CSI
     MasterFormat seed); **cost-code + sub pickers** in the Schedule-view activity editor. Privileged
     writes; reads = member.
- **Approval gates:** ⛔ two DB migrations + RLS. Present SQL + STOP for each; never touch prod data
  without go-ahead.
- **Exit criteria:** `typecheck` + `test` + `build` green · idempotent code import (re-import no dupes) ·
  live: seed codes, assign a code + sub to an activity, reload → persists · close with `verify-feature`.
  **Consider split: 5a = cost codes + dictionary manager + assign; 5b = company identity + sub assign.**

### Phase 6 — Production rates & forward-looking analytics (read-only)
- **Scope:**
  1. `productionRates.ts` + `requiredRate.ts` + `forecastTrend.ts` (+ tests). **Extend, don't fork
     `progressAnalytics`; respect applicability** (N/A never in a denominator).
  2. Dashboard modules (extend `ProjectDashboard`/`FloorPulse`/`TypeScorecard`): production rate per
     cost code / sub (SF/week); **required-rate-vs-actual** card (staffing/date delta); **forecast-trend**
     line; make-ready surfaced; the **bottleneck-that-costs-the-end-date**.
  3. **Private per-GC benchmarking:** compare a sub / cost code across the tenant's own projects.
  4. **Suppress (don't fake)** tiny-sample / zero-span / zero-pace — keep the existing honesty.
- **Approval gates:** none (read-only analytics; no writes, no migration).
- **Exit criteria:** `typecheck` + `test` + `build` green · rate/required-rate/forecast tests pin the math
  + applicability filtering + small-sample suppression · live: coded activities with completed area show
  a sensible SF/week; required-rate reads as an action; un-coded activities excluded cleanly · close with
  `verify-feature`. **Consider split: 6a = production rates (single project); 6b = required-rate +
  forecast-trend; 6c = cross-project per-GC benchmarking.**

## Verification commands (exit-criteria gate)
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck   # tsc --noEmit (primary gate)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test         # vitest (one file: ... run test -- src/utils/productionRates.test.ts)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build         # next build (after editing live components)
```
- **Lint is NOT a gate** (~1850 pre-existing). Verify with typecheck + test + build.
- **No E2E** — UI via `npm run dev:3010` (from `sitepulse-next/`, port 3010).
- Vitest globals OFF: import `{ describe, it, expect, vi }` from `'vitest'`; co-locate `*.test.ts`.

## Hard guardrails (AGENTS.md — do not violate)
- **DO NOT fork `progressAnalytics`** — extend/wrap `summarizeGroup`/`byWeek`. **Respect applicability**
  — N/A (unit × activity) slots NEVER enter a rate/variance denominator (§3).
- **Analytics is READ-ONLY on `status_audit_log`.** No status writes. Any status write anywhere stays on
  `upsert_status_log` / `.upsert(onConflict)` — never `.insert()` (§2). Phase 4's ripple writes only
  *planned dates* via the established path, **online-first** (NOT the offline `pendingChanges` buffer).
- **Don't rebuild P6** — FS + lag only; the ripple is forward propagation, not CPM/float.
- **Migrations (Phase 5):** additive + idempotent, guarded RLS, **no `anon` grants**, `COMMENT ON`.
  Present SQL + STOP (⛔).
- **Benchmarking is private per-GC** (within-tenant) — never cross-client.
- **Types:** derive from `database.types.ts`; narrow JSONB at the query boundary; no `Json` into props.
- Don't recolor `mapDisplayStatuses`; don't break the offline mutation queue or snapping pipeline.

## Open decisions
- **Company identity shape** (Phase 5) — promote `project_contacts.company` to a global `companies`
  record vs. a fresh lightweight `companies` dictionary. Resolve at Phase 5 start (needs cross-project
  identity for benchmarking).
- **CSI MasterFormat seed depth** (Phase 5) — full division list vs. the owner's actual code list.
  Resolve from the owner's list at Phase 5 start (mirrors the Scale-Measure plan's open item).
- **Per-area sub override** (deferred) — v1 assigns sub at the project-activity level; revisit if a real
  job splits a trade by area.

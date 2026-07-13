# Band vs Promise — confidence band measured against the promised finish date (self-contained build plan)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: `Notes/plans/Schedule-That-Thinks-Plan.md` (COMPLETE — this is a follow-on
> that reuses its `monteCarloForecast` band). Sibling follow-on, OUT of scope here: the
> actual-start lag signal into the Risk Radar ("item 4").
>
> This plan has TWO blocks: **P1–P2 = the manual promise** (a contract completion date + the
> band measured against it — the cheap, always-visible "keeping our word" probe), then
> **P3–P5 = the baseline layer** (make schedule baselines first-class and visible: capture
> them without friction, show target-vs-current-vs-actual in the List, and let a real baseline
> become the richer automatic promise). P3+ is deliberately sequenced AFTER P1–P2: the manual
> date proves owners engage with the "promise" framing before the larger baseline investment.

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) + the Schedule That Thinks plan.
2. Re-read the files named below fresh — do not trust line numbers; they drift.
3. Build the phases in order (P1–P2 = the manual promise; P3–P5 = the baseline layer). Verify after each (§ Verification commands).
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence
   plain-English summary; explain jargon in passing; keep it short.

## Goal
When this is done, the project dashboard answers **"are we going to keep our word?"**, not
just "when will we finish?". The owner enters a **Contract Completion date** (and a
Construction Start date) in a new **Project Info** settings tab, and the hero card's
confidence band is measured against that promised date in one plain sentence — e.g.
*"80% likely to finish May 3–20 · ~9 days past the promised May 1"* with a one-word verdict
(on track / at risk / likely to miss). The comparison appears **only when a completion date
is actually entered** — no date, no line; a suppressed band shows nothing. Nothing is ever
compared against a made-up promise.

Then the **baseline layer (P3–P5)** makes the frozen schedule baseline a first-class,
*visible* object rather than a buried import-diff reference: you can capture a baseline
without hunting for it (prompted at project setup and after a big import), the List schedule
grid gains **target (baseline) vs current-plan vs actual** columns per activity plus a
top-line "drifted ~N days since baseline" read, and — once a real baseline exists — it can
serve as the automatic, richer promise the hero band is measured against (superseding the
manual contract date). Baseline data is a frozen, read-only snapshot, so it can never show a
wrong live number; the only failure mode is "no baseline yet," which is handled by an honest
empty state + an obvious capture control, never by inventing one.

## Out of scope / deferred
- **A full P6-grade baseline suite.** The baseline layer (P3–P5) is deliberately the
  disciplined 20%: ONE "current baseline" per project, target-vs-actual in the List, and a
  drift headline. NOT in scope — multiple named baselines with a picker, per-scope/per-level
  baselines, re-baseline history/audit trails, or baseline-vs-baseline comparison. Resist
  regrowing Primavera; add more only when a real user asks.
- **Construction Start analytics.** The Construction Start date is entered + stored in P1 but
  only displayed; no "days into the job" math, no start-anchored forecasting yet.
- **Actual-start lag signal into the Risk Radar** ("item 4") — a separate later follow-on.
- **Per-scope promises.** The manual contract completion date (P1) is ONE project-level date;
  the band-vs-promise line shows on the all-levels hero (and reuses the same promise when
  scoped). No per-level contract dates.
- No offline durability for the new writes — project settings AND baseline capture are
  online-first authoring (baselines already are — `useScheduleBaselines`), never the field
  offline queue.

## Locked product decisions (from the owner)
- **The promise is an explicit, owner-entered date**, not the schedule baseline (see above).
- **Two date fields in v1:** Construction Start + Contract Completion, on the `projects` row.
- **Home = a new "Project Info" tab in `SettingsMenu`** (project-scoped settings live there;
  `GlobalSettingsModal` is for cross-project config — per the global-vs-project-settings
  convention). Privileged write (owner/admin/pm), mirroring existing project mutations.
- **Honesty first (the owner's top concern):** the line renders only against a real entered
  date; a suppressed band shows nothing; the copy is calibrated, never falsely precise.
- **The baseline layer follows the manual promise, and its make-or-break is CAPTURE.** A
  baseline only has value if it's actually snapped, so P3 must make capture frictionless and
  *prompted* (project setup + after a big import) and give every baseline surface an honest
  "no baseline yet — capture one" empty state. Do not build baseline displays before capture
  is first-class, or they ship dark (the same trap that steered the promise to a manual date).
- **Baseline stays a frozen, read-only snapshot.** Showing it can never be "wrong" — it's what
  was saved. Scope-disciplined (see Out of scope): one current baseline, no P6 suite.

## Data model (read + one additive write)
- **New migration** (additive, nullable — the `20260629_project_ai_training_optout.sql`
  pattern is the model): add to `public.projects`
  - `construction_start_date date NULL`
  - `contract_completion_date date NULL`
  No new RLS policy: the existing `projects` UPDATE policy governs the row (already used by
  `useUpdateProject` / the ai-training toggle in `GlobalSettingsModal`), so privileged
  owner/admin/pm writes to the new columns ride it. **Confirm** that policy is row-level
  (not a column allow-list) during the migration phase; no change expected.
- Name it to sort AFTER the latest existing migration (`20260711_status_logs_actual_start.sql`)
  — e.g. `20260712_project_dates.sql`. Author it via the **`create-migration` skill**.
- Reflect the two columns in `src/types/database.types.ts` (`projects` Row/Insert/Update)
  and, if a domain type is derived, `src/types/domain.ts`. Dates are ISO `'YYYY-MM-DD'`.

**Baseline layer (P3–P5) — reads the EXISTING `schedule_baselines` table; no new table.**
- `schedule_baselines` already exists (append-only, immutable, RLS: read = member, insert/
  delete = privileged): `snapshot` (JSONB) holds the frozen PLAN — every sheet's level×activity
  windows AND every dated slot's planned window (never progress fields, by contract). Narrow
  the JSONB with `isScheduleBaselineSnapshot` (domain.ts) at the boundary; a malformed snapshot
  degrades to "no baseline," never a crash.
- Capture/read/delete already have hooks: `useScheduleBaselines` (newest-first),
  `useSetScheduleBaseline` (append), `useDeleteScheduleBaseline`. P3 REUSES these — no new
  table, hook, or migration for the baseline layer. v1 uses the NEWEST baseline as "the current
  baseline" (no picker — see Open decisions).
- The pure snapshot math already exists in `src/utils/scheduleBaseline.ts`
  (`buildBaselineSnapshot`, `baselineDelta`, `mergeLevelWindows`) — extend it (never fork) for
  per-slot reads; do not duplicate snapshot shape knowledge in components.

## Build-on inventory (read these fresh before using)
- `src/hooks/useProjectQueries.ts` — **`useProject(projectId)`** (reads `projects.*`, so the
  new columns arrive for free once types are updated) and **`useUpdateProject(projectId)`**
  (`.update(updates)` — the existing mutation to REUSE for saving the dates; do NOT add a
  new project-write hook). Invalidate/patch the `useProject` cache on save as that hook
  already does.
- `src/components/SettingsMenu.tsx` — already imports `useProject` + `useUpdateProject` and
  is the tabbed project-settings home. Add the "Project Info" tab here; mirror the existing
  tab's read-current-value → edit → save-on-blur/confirm pattern. Do NOT regrow schedule or
  activity editors here (one home only — AGENTS.md §4).
- `src/components/GlobalSettingsModal.tsx` — reference for a privileged `projects` write
  (the ai-training toggle) if you need the role-gating idiom.
- `src/components/ProjectDashboard.tsx` — owns the hero "Planned vs Projected" card and
  already computes **`heroBand`** (a `ForecastBand`) + `projectedDate` + `plannedFinish`
  (`scopePlannedFinish`) + `planComparison` (`planVsProjected`). The new promise line is
  added HERE, beside the existing plan line. `useProject` is available on the page; thread
  `project.contract_completion_date` down (ProjectDashboard already receives project-scoped
  props — add one).
- `src/utils/monteCarloForecast.ts` — `ForecastBand` (`p10/p50/p90/suppressed`),
  `bandMethodSentence()`. Home for the new pure comparison helper (it consumes a band).
- `src/utils/progressAnalytics.ts` — `parseDay`, `dayDiff`, `planVsProjected`,
  `scopePlannedFinish`, and (for the List's per-activity numbers) `activitySchedule`. Reuse
  these; do NOT fork the forecast math.

Baseline layer (P3–P5), read fresh before using:
- `src/hooks/useScheduleBaselines.ts` — `useScheduleBaselines` / `useSetScheduleBaseline` /
  `useDeleteScheduleBaseline` (the capture/read/delete hooks to REUSE).
- `src/utils/scheduleBaseline.ts` — `buildBaselineSnapshot` (what P3's capture calls),
  `baselineDelta` (level-window compare; extend for the per-slot List compare), snapshot type.
- `src/components/schedule/MspImportPanel.tsx` — the ONLY current baseline UI: the "Set
  baseline" button + the "Comparing against {name} from {capture date}" strip + the per-task
  `= baseline / new vs baseline / ±Nd vs baseline` badges. This is the model for P3's capture
  control and P4's badges — reuse the wording/encoding; move capture OUT of the importer's
  exclusive ownership so it's reachable at project setup too.
- The **List schedule grid** (Schedule Variance Columns workstream) — the spreadsheet-grid
  List with 12 columns, `DateInputCell`, read-only duration/variance cells, frozen sticky-left
  checkbox+Location, sideways scroll, and `VARIANCE_COLORS` encoding. P4 adds the baseline
  columns HERE (a "Show baseline" toggle), reusing that grid + the existing variance colors —
  do NOT build a second grid or a new palette. Re-read the List component fresh to find it.

## Pure logic to extract + unit-test
New pure fn in `src/utils/monteCarloForecast.ts` (+ tests in `monteCarloForecast.test.ts`),
deterministic, `Date.now()`-free:

```
promiseOutlook({ promise: string|null, band: ForecastBand }): {
  medianDeltaDays: number | null;   // dayDiff(promise, band.p50); + = median finish AFTER the promise (late)
  p90DeltaDays: number | null;      // dayDiff(promise, band.p90)
  verdict: 'on-track' | 'at-risk' | 'likely-miss' | null;
} | null
```
- Returns `null` (render nothing) when `promise` is null OR `band.suppressed` is set OR the
  band has no dated `p10/p50/p90` — no promise line where there is no honest band or date.
- Verdict (compare the promised date to the 80% range):
  - `promise >= band.p90` → **'on-track'** (even the pessimistic finish beats the promise)
  - `promise <= band.p10` → **'likely-miss'** (even the optimistic finish is past the promise)
  - otherwise → **'at-risk'** (the promise falls inside the likely range)
- Deltas via `dayDiff(parseDay(promise), parseDay(band.pXX))` — positive = finish later than
  the promise. Reuse `parseDay`/`dayDiff`; ISO strings sort lexicographically.
- Tests pin: null on suppressed band / null promise; the three verdict boundaries
  (promise == p90, inside, == p10); sign of `medianDeltaDays` (late vs ahead);
  determinism (pure — same inputs, same output).

**Baseline layer (P3–P5)** — extend `src/utils/scheduleBaseline.ts` (+ its `.test.ts`), pure:
- `baselineSlotWindow(snapshot, sheetId, activityName): { start, end } | null` — the frozen
  planned window for ONE unit/level × activity slot (null when the baseline never had it →
  "new"). Reuse the same snapshot-reading path `baselineDelta` already uses; don't re-encode
  the JSONB shape.
- `projectDriftSinceBaseline(snapshot, currentPlannedFinish): { days: number | null }` — the
  top-line "the plan itself moved ~N days later since baseline" number (baseline's implied
  finish vs the current plan's finish). Distinct from execution variance (that's actual vs
  plan, already in the List). Tests pin: null when no baseline / no finish; sign (later = +);
  a slot absent from the baseline → 'new'; determinism.

## Sub-phasing (ship + verify each)

### Phase 1 — Project Info settings tab + the two date columns
- **Scope:** the additive migration (2 nullable date columns on `projects`); update
  `database.types.ts` (+ `domain.ts` if derived); a new **"Project Info"** tab in
  `SettingsMenu` that reads the current dates via `useProject` and saves via
  `useUpdateProject` (Construction Start + Contract Completion; empty = cleared to null).
  No dashboard changes yet.
- **⛔ Approval gates:** **DB migration** — author the SQL with the `create-migration` skill,
  present the exact SQL, and **STOP for the owner to apply it (production Supabase)**. Do not
  apply it yourself; do not touch production data. (RLS: confirm the existing `projects`
  UPDATE policy covers the new columns — no new policy expected; flag if it doesn't.)
- **Exit criteria:** typecheck + test + build green · dev:3010: open a project's Settings →
  Project Info, enter both dates, reload, confirm they persist; clear a date, confirm it
  saves as empty · close with the **verify-feature** skill → STOP (commit, do not push until
  the owner says "Approved").

### Phase 2 — Band vs Promise line on the hero card
- **Scope:** add `promiseOutlook` (+ tests) to `monteCarloForecast.ts`. Thread
  `project.contract_completion_date` into `ProjectDashboard`; under the existing "vs planned"
  line on the "Planned vs Projected" card, render the promise comparison when
  `promiseOutlook` is non-null: the 80% range, the signed delta vs the promised date, and the
  one-word verdict (on track / at risk / likely to miss), with a tooltip quoting
  `bandMethodSentence()`. Renders nothing when there's no completion date or the band is
  suppressed. **UX decision (see Open decisions):** when a completion date is set, LEAD with
  the promise line and keep the existing "vs planned {current-plan date}" line as the smaller
  secondary; when no completion date is set, the current plan line is unchanged and a muted
  nudge ("Set a contract completion date in Settings → Project Info to track the promise")
  may appear once.
- **Approval gates:** none (display only).
- **Exit criteria:** typecheck + test + build green · dev:3010 on a project WITH a completion
  date (set one on Orchard Path III in Phase 1): the promise line shows the range + delta +
  verdict and matches the band; on a project with NO completion date: no promise line, no
  fabricated number · `promiseOutlook` unit tests pass · close with **verify-feature** →
  STOP. **End of the manual-promise block (P1–P2) — write a review summary and get the
  owner's read on whether the "promise" framing resonates before starting the baseline layer.**

### Phase 3 — First-class baseline capture (the make-or-break)
- **Scope:** surface baseline capture OUTSIDE the import panel so it's reachable when it
  matters. Add a plain "Capture baseline" control in an obvious home (recommend the Schedule
  view header and/or the Project Info tab), reusing `useSetScheduleBaseline` +
  `buildBaselineSnapshot`. Add a prompt/nudge at the two moments a baseline is worth taking:
  first meaningful schedule setup, and right after a large re-import (the importer already has
  the button — add the nudge). Everywhere a baseline would be shown, render an honest empty
  state: "No baseline captured — snapshot the current plan to track drift," with the capture
  button inline. Show the current baseline's name + capture date (reuse the importer's strip
  wording). No List columns yet.
- **Approval gates:** none (reuses existing table + privileged-write hooks; no migration).
- **Exit criteria:** typecheck + test + build green · dev:3010: capture a baseline from the
  new control on a real project; confirm it appears (name + date) and the empty state is gone;
  a project with none shows the empty state + capture affordance · close with **verify-feature**
  → STOP.

### Phase 4 — Baseline columns in the List (target vs current vs actual)
- **Scope:** add `baselineSlotWindow` + `projectDriftSinceBaseline` (+ tests) to
  `scheduleBaseline.ts`. In the List schedule grid, behind a **"Show baseline"** toggle, add
  read-only baseline start/end per activity beside the existing current-plan + actual columns,
  and a per-activity "±Nd vs baseline / new / = baseline" flag reusing the importer's encoding
  + `VARIANCE_COLORS` (no new palette, no second grid). Above the grid, show the top-line
  "plan drifted ~N days since {baseline name}" read from `projectDriftSinceBaseline`. All of it
  hidden (or the honest empty state from P3) when there's no baseline.
- **Approval gates:** none (display only).
- **Exit criteria:** typecheck + test + build green · new pure fns unit-tested · dev:3010 on a
  project WITH a baseline: baseline columns populate, the drift line matches, the toggle
  works; WITHOUT a baseline: columns hidden / empty state, never fabricated · **verify-feature**
  → STOP.

### Phase 5 — Baseline as the automatic promise (capstone; owner may cut)
> **STATUS: BACKLOGGED / CUT at review 2026-07-09.** The feature is DONE at P4. The
> "supersede" design below was NOT built — it conflates the internal plan (baseline) with the
> contractual deadline (contract date) and risks a false "on track vs baseline" while at risk
> vs the real deadline. If ever revisited, build the **inverted-fallback** version (contract
> date always wins when set; baseline fills in ONLY when no contract date exists), not this.
> See `Notes/handoff/2026-07-09 - Band vs Promise Phase 5 (Backlogged - baseline-as-promise).md`.
- **Scope:** when a real baseline exists, let ITS implied finish be the promise the hero band
  is measured against (via the P2 `promiseOutlook`), superseding the manual contract date; the
  manual date remains the fallback when no baseline exists. One basis, clearly labeled
  ("vs baseline {name}" vs "vs contract date") — never two promises at once.
- **Approval gates:** none in-build; **the owner decides keep/cut at review** (whether the
  auto-baseline promise is clearer than the manual date, or redundant).
- **Exit criteria:** typecheck + test + build green · dev:3010: with a baseline, the hero
  promise line reads "vs baseline"; delete the baseline, it falls back to the contract date;
  neither present → no promise line · **verify-feature** → STOP. **End of feature — write the
  review summary (present P5 for the keep/cut decision).**

## Hard guardrails (AGENTS.md — do not violate)
- **Display-only apart from the one additive migration.** No changes to the forecast/band
  math — extend, never fork `progressAnalytics` / `monteCarloForecast`; `VARIANCE_COLORS`
  untouched.
- **Honesty:** the promise line renders ONLY against a real entered `contract_completion_date`
  and ONLY when the band is unsuppressed — never a fabricated or implied promise; a suppressed
  band shows nothing (no line where there's no honest date).
- **Writes:** project dates go through the EXISTING `useUpdateProject` (online-first project
  authoring) — never the offline mutation queue / `pendingChanges`; no `.insert()` games; do
  not touch `status_logs` / `upsert_status_log`.
- **Migration is additive + nullable**, applied by the OWNER after SQL review (⛔). Never run
  DDL against production yourself.
- **Types:** derive from `database.types.ts`; no `any`; new/edited files `.ts`/`.tsx`;
  tests import `{ describe, it, expect }` from `'vitest'` (globals OFF).
- **Determinism:** `promiseOutlook` (and the P4 baseline helpers) are pure — dates/snapshots
  passed in, no `Date.now()`.
- **Baseline layer:** reuse the EXISTING `schedule_baselines` table + `useScheduleBaselines`
  hooks + `scheduleBaseline.ts` math (extend, never fork); no new table/migration for P3–P5.
  Baseline capture is privileged + online-first (append-only; never UPDATE a baseline — fix by
  delete + re-capture). Baseline displays are read-only and gated behind "a baseline exists"
  with an honest empty state — never a blank or fabricated column. Reuse the List grid +
  `VARIANCE_COLORS`; no second grid, no new palette.

## Open decisions (recommended defaults chosen; owner confirms at review)
1. **Promise line vs the existing "vs planned" line** — *Recommended:* when a contract
   completion date is set, LEAD with the promise comparison and demote the current-plan "vs
   planned" line to a smaller secondary (the promise is the contractual question; the current
   plan drifts on re-import). Alternative: show both equally. Resolve in Phase 2.
2. **Which band edge headlines the delta** — *Recommended:* headline the **median (P50)**
   delta ("~9 days past the promised date") with the full P10–P90 range shown for context and
   the verdict derived from where the promise falls in the range. Alternative: headline the
   pessimistic P90. Resolve in Phase 2.
3. **Which baseline the layer uses** — *Recommended:* the **newest** captured baseline as "the
   current baseline," no picker (keeps it out of P6 territory). Alternative: a named-baseline
   picker. Resolve in Phase 3 (default to newest unless the owner asks for the picker).
4. **Baseline capture entry points** — *Recommended:* Schedule view header + a prompt after a
   large re-import (and keep the importer's button). Whether it also lives in the Project Info
   tab is a Phase-3 call.
5. **Auto-baseline promise vs manual contract date (P5)** — keep/cut is the owner's at the P5
   review: does the band measured against the baseline's finish replace the manual contract
   date, or is the manual date clearer? Default: baseline wins when present, contract date is
   the fallback.

## Verification commands (the exit-criteria gate)
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
- **Lint is NOT a gate** (~1850 pre-existing problems) — verify with typecheck + test + build.
- **No E2E framework** — dev:3010 click-through (from `sitepulse-next/`, port 3010) is the UI
  verification. Vitest globals OFF: import `{ describe, it, expect }` from `'vitest'`.
```

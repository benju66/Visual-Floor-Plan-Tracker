# Kickoff — Band vs Promise, Phase 4: baseline columns in the List (target vs current vs actual)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 4 of Band vs Promise** — now that a schedule **baseline** can be
> captured (P3), surface it in the List schedule grid: behind a **"Show baseline"** toggle,
> add read-only **baseline start/end per activity** beside the existing current-plan + actual
> columns, a per-activity **"±Nd vs baseline / new / = baseline"** flag, and a top-line
> **"plan drifted ~N days since {baseline name}"** read. Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-09 - Band vs Promise Phase 4 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Band-vs-Promise-Plan.md` (Phase 4 + "Pure logic to extract + unit-test")
> - `sitepulse-next/AGENTS.md` §3 (VARIANCE encoding — extend, never fork) + §4 (the
>   `schedule_baselines` invariants + `resolveCurrentBaseline` = the current baseline, no picker)
>
> Branch off `band-vs-promise-phase3` (P1–P3 are committed there, not yet merged to `main` —
> check `git log main`). Build **only Phase 4**. **Display-only: no migration, no new table,
> no new hook, no second grid, no new palette** — reuse the existing List grid +
> `schedule_baselines` + `scheduleBaseline.ts` (extend, never fork). Don't commit or push until
> I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Where P1–P3 left off
- **P1** (`738b385`): Project Info tab + `construction_start_date` / `contract_completion_date`
  columns (migration on prod). **P2** (`7cd9bc3`): the promise line on the hero card. Plus a
  **Forecast Coherence** follow-on (`e515bb6`): hero + Floor Pulse headline the band **midpoint (P50)**.
- **P3** (`5a06c18`, on `band-vs-promise-phase3`): **first-class baseline capture.** A new
  `BaselineControl` strip in the Schedule-view header (honest "No baseline captured — snapshot the
  current plan to track drift" empty state + a privileged owner/admin/pm Capture button + the
  current baseline's name/date + Recapture/Remove), a post-large-import capture nudge in
  `MspImportPanel`, and a shared **`resolveCurrentBaseline`** (newest = current, no picker; malformed
  snapshot → null) in `scheduleBaseline.ts`. **Reused** the existing `schedule_baselines` table +
  `useScheduleBaselines` hooks — no migration/table/hook. **All on branch `band-vs-promise-phase3`,
  NOT merged/pushed** — branch P4 off it so capture is present (P4 displays what P3 lets you capture).

## Why this phase
P3 made a baseline *capturable and visible-as-a-thing*; P4 makes it *usable in the daily grid* —
you can see, per activity, what the plan **originally said (baseline)** next to what it **says now
(current plan)** and what **actually happened (actual)**, plus a one-line read of how far the plan
itself has drifted since the baseline. This is the payoff the capture work was sequenced to unlock.
It stays **display-only and honestly gated**: every baseline surface is hidden (or shows P3's empty
state) when there's no baseline — never a blank or fabricated column.

## Required reading (re-read fresh — do not trust line numbers)
- `sitepulse-next/Notes/plans/Band-vs-Promise-Plan.md` — **Phase 4** scope + the **"Pure logic to
  extract + unit-test"** section (the two new fns below) + Hard guardrails.
- `sitepulse-next/AGENTS.md` **§3** — the schedule-variance encoding is the single source of truth
  (`varianceFill`/`varianceLabel`/`VARIANCE_LEGEND` in `progressAnalytics.ts`); the plan calls the
  reuse target "VARIANCE_COLORS." **Extend, never fork.** **§4** — baseline invariants +
  `resolveCurrentBaseline` (already exists — use it to pick the baseline; do NOT re-inline `baselines[0]`).
- Re-read fresh:
  - `src/utils/scheduleBaseline.ts` — home for the two new **pure** fns (extend, never fork):
    - `baselineSlotWindow(snapshot, sheetId, activityName): { start, end } | null` — the frozen
      planned window for ONE level×activity slot (null when the baseline never had it → "new").
      Read via the SAME snapshot path `baselineDelta` uses; don't re-encode the JSONB shape.
    - `projectDriftSinceBaseline(snapshot, currentPlannedFinish): { days: number | null }` — the
      top-line "the plan itself moved ~N days later since baseline" number (baseline's implied
      finish vs the current plan's finish). Distinct from execution variance (actual vs plan).
    - Tests pin: null when no baseline / no finish; sign (later = +); a slot absent from the baseline
      → 'new'; determinism (pure — `Date.now()`-free).
  - `src/components/StatusTable.tsx` — the **desktop List schedule grid** (Schedule Variance Columns
    workstream): the spreadsheet-grid with `DateInputCell`, read-only duration/variance cells, frozen
    sticky-left checkbox+Location, sideways scroll. **P4 adds the baseline columns HERE** behind a
    "Show baseline" toggle — reuse this grid, do NOT build a second one. (Re-read fresh to confirm
    this is still the grid home and how its columns are declared.)
  - `src/components/schedule/MspImportPanel.tsx` — the per-task **`= baseline / new vs baseline /
    ±Nd vs baseline`** badge encoding (search `rowDelta` / the badge block). Reuse this wording +
    color encoding for the per-activity flag; do NOT invent a new palette.
  - `src/hooks/useScheduleBaselines.ts` + `src/components/schedule/BaselineControl.tsx` — how the
    baseline is read + the honest empty state to reuse when none exists.

## Scope (build ONLY this)
1. `baselineSlotWindow` + `projectDriftSinceBaseline` (+ tests) in `scheduleBaseline.ts` — pure,
   deterministic, `Date.now()`-free.
2. In the List grid, behind a **"Show baseline"** toggle: read-only **baseline start / baseline end**
   per activity beside the current-plan + actual columns, and a per-activity **"±Nd vs baseline /
   new / = baseline"** flag reusing the importer's encoding + the existing variance colors.
3. Above the grid: a top-line **"plan drifted ~N days since {baseline name}"** read from
   `projectDriftSinceBaseline` (uses `resolveCurrentBaseline` for the name/snapshot).
4. **All of it hidden — or P3's honest empty state — when there's no baseline.** Never a blank or
   fabricated baseline column.

## Guardrails specific to this phase
- **Display-only.** No migration, no new table, no new hook. No changes to the forecast/variance
  math — **extend, never fork** `scheduleBaseline.ts` / `progressAnalytics`; the variance color
  encoding is untouched. **No second grid, no new palette.**
- Use **`resolveCurrentBaseline`** (P3) to pick the baseline (newest, no picker) — don't re-inline.
- A malformed snapshot degrades to "no baseline" (the empty state), never a crash.
- No `any`; new/edited files `.ts`/`.tsx`; tests import `{ describe, it, expect }` from `'vitest'`.

## Open decisions to resolve this phase
- **Default state of "Show baseline"** — recommend **off by default** (the grid is already dense;
  baseline columns are a deliberate overlay). Confirm with the owner at review.
- **Where the drift line sits** — recommend **above the grid**, next to / echoing the P3 header strip,
  so "current baseline" and "how far we've drifted from it" read together.

## Exit criteria
- `typecheck` + `test` + `build` green (verification commands in the plan) · the two new pure fns
  unit-tested.
- dev:3010 on a project **WITH** a baseline: the baseline columns populate, the drift line matches
  the numbers, the toggle shows/hides them; **WITHOUT** a baseline: columns hidden / P3 empty state,
  never fabricated.
- Close with the **verify-feature** skill (Definition of Done → STOP). Commit; do NOT push until the
  owner says "Approved." Then draft the **Phase 5** (baseline as the automatic promise — owner may
  cut) kickoff.

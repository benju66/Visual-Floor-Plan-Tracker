# Kickoff — Scale, Measure & Production Rates, Phase 1: Rescue the scale foundation (code only, no migration)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Scale, Measure & Production Rates** (the foundation rescue: port the already-written, already-tested scale utility + types onto `main` — **no behavior change, no migration, no UI**). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-30 - Scale Measure Production Rates Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Scale-Measure-Production-Rates-Plan.md` (**Phase 1** + "Critical starting facts" + "Data model" + "Pure logic to extract" + "Hard guardrails")
> - `sitepulse-next/AGENTS.md`
>
> Work on a fresh **`feat/scale-measure-phase-1`** branch cut off `main`. **First action: confirm the five `scale_%` columns are already live** (query below) — if any are missing, STOP and tell me. Then port **ONLY the scale files** from the stranded branch `origin/claude/code-repo-review-2vre2c`: `src/utils/scale.ts` + `src/utils/scale.test.ts`, the three new `sheets` columns in `src/types/database.types.ts` (Row/Insert/Update), and `ScaleCalibration` + `isScaleCalibration` in `src/types/domain.ts`. **Do NOT** bring over that branch's migration, its old plan/kickoff docs, or any magnifier/snap work. No component edits, no area-bug fix yet (that's Phase 3). Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English summary
This phase moves a chunk of **already-finished, already-tested** code onto the main
line so later phases can build on it. Specifically: a small math library that knows
how to turn a drawing's scale into real-world feet (and the correct square-footage
formula), plus the type definitions for the three database columns that store a
drawing's scale. **Nothing the user sees changes** — no buttons, no new behavior,
not even the square-footage bug fix yet. It's purely "land the foundation so Phase 2
(the scale tool UI) and Phase 3 (correct areas) have something to stand on."

## Why this phase exists / what's true right now
- **The scale DB columns are ALREADY LIVE.** The `sheets` table already has
  `scale_units_per_px numeric`, `scale_unit text`, and `scale_calibration jsonb`
  (all nullable), alongside the legacy `scale_ratio double precision` /
  `scale_preset text`. The migration was applied to prod long ago. **So Phase 1 needs
  NO migration** — it's a *code rescue*, not a schema change. Confirm before building
  (query in "First action / approval gate" below); if the new columns are somehow
  absent, STOP.
- **The foundation CODE is written but STRANDED on a side branch.** Branch
  `origin/claude/code-repo-review-2vre2c` carries the finished, unit-tested scale
  utility and the type changes — they were never merged because that branch also
  holds unrelated magnifier/inside-face-snap work that went a different route.
  **Verified present on that branch (2026-06-30):**
  - `sitepulse-next/src/utils/scale.ts` + `sitepulse-next/src/utils/scale.test.ts`
  - `sitepulse-next/src/types/database.types.ts` — adds the 3 `sheets` columns in
    Row/Insert/Update (diff is +12 lines over `main`)
  - `sitepulse-next/src/types/domain.ts` — adds `ScaleCalibration` type +
    `isScaleCalibration` guard (diff is +41 lines over `main`)
- **`main` today has only the legacy two columns typed** (`scale_ratio`,
  `scale_preset`) and **no `ScaleCalibration`** in `domain.ts` — confirmed. So the
  port is purely additive; nothing on `main` references the new names yet.
- **The area bug is real but NOT this phase's job.** Both create paths currently do
  `area = pixelArea × scale_ratio` — a *linear* factor applied to an *area* (wrong;
  area scales by the factor **squared**). Confirmed live on `main`:
  - `src/utils/workbench.ts` `computeLabelArea` (× `scale_ratio`), consumed by
    `src/hooks/useWorkbenchActions.ts:350`
  - `src/hooks/useMapActions.ts:236-237` (inline shoelace `area * sheet.scale_ratio`)
  `scale.ts` already contains the corrected `computeAreaFromUnitsPerPx`
  (`pixelArea × units_per_px²`) that fixes it — but **Phase 3** does the switch-over.
  **Phase 1 only lands `scale.ts`; it does not touch either call site.**

## What `scale.ts` contains (for reference — you're porting it as-is)
`ESTIMATED_RENDER_DPI = 288`, `ARCH_SCALE_PRESETS`, `pixelDistance`,
`unitsPerPxFromCalibration`, `presetUnitsPerPx`, `computeAreaFromUnitsPerPx` (the
corrected `pixelArea × units_per_px²` area math), `parseFeetInches`,
`formatFeetInches`, `formatArea`. It's framework-free, deterministic, no I/O, and
fully covered by `scale.test.ts`. Don't rewrite or "improve" it in this phase — port
it verbatim and let the tests vouch for it.

## Required reading (in order)
1. `sitepulse-next/AGENTS.md` — esp. §6 (TypeScript: `database.types.ts` is
   **hand-maintained** and drifts — add columns by hand; derive domain types from the
   Row, never hand-duplicate the shape; **narrow JSONB at the query boundary** with a
   guard, no `Json` into props) and §9 (Vitest globals OFF — import
   `{ describe, it, expect, vi }` from `'vitest'`; co-located `*.test.ts` is in
   `typecheck`, keep it type-clean).
2. `sitepulse-next/Notes/plans/Scale-Measure-Production-Rates-Plan.md` — **Phase 1**,
   "Critical starting facts", "Data model" (the three `sheets` columns + the
   `scale_calibration` JSONB shape), "Pure logic to extract" (the `scale.ts` API),
   "Hard guardrails".
3. The current source, read FRESH (line numbers drift):
   - `src/types/database.types.ts` on `main` — the `sheets` block (Row/Insert/Update)
     you'll add the three columns to.
   - `src/types/domain.ts` on `main` — where `ScaleCalibration` + `isScaleCalibration`
     land (next to the other domain types + JSONB guards like `isPercentPointArray`).
   - The stranded versions to copy from:
     `git show origin/claude/code-repo-review-2vre2c:sitepulse-next/src/utils/scale.ts`
     (and `:...scale.test.ts`, `:...database.types.ts`, `:...domain.ts`).

## Scope (build ONLY this)
1. **Port `src/utils/scale.ts` + `src/utils/scale.test.ts`** from the stranded branch
   verbatim (cherry-pick the files, or `git show <branch>:<path>` → write). They're
   new files on `main`, so no merge conflict.
2. **Add the three `sheets` columns to `src/types/database.types.ts`** by hand in all
   three spots — Row, Insert, Update: `scale_units_per_px: number | null`,
   `scale_unit: string | null`, `scale_calibration: Json | null` (Insert/Update get
   the `?:` optional variants). Match the exact placement/style the stranded branch
   used (right after `scale_preset`).
3. **Add `ScaleCalibration` + `isScaleCalibration` to `src/types/domain.ts`** from the
   stranded branch (the type + the narrowing guard; mirror the existing guard style).
4. **Nothing else.** No component edits, no mutation changes, no UI, no area-bug fix,
   **no migration**, no porting of the branch's other files.

## First action / approval gate (read before touching code)
- **No hard ⛔ gate** (no migration in this phase — the columns are already live).
- **Confirm the columns are live FIRST** (read-only; via the Supabase MCP
  `execute_sql`, or ask the owner to run it):
  ```sql
  select column_name from information_schema.columns
  where table_name = 'sheets' and column_name like 'scale_%';
  ```
  Expect **five**: `scale_ratio`, `scale_preset`, `scale_units_per_px`, `scale_unit`,
  `scale_calibration`. If the three new ones are missing, **STOP** and tell the owner
  before doing anything else (the plan's data model assumes them live).
- Standard rule: **do not commit or push until the owner says "Approved."**

## Hard "do NOT port" list (the stranded branch carries more than you want)
- ❌ `supabase/migrations/20260619_drawing_scale.sql` — the migration is **already
  applied to prod**; re-introducing it risks a confusing duplicate/no-op migration.
- ❌ `Notes/plans/Drawing-Scale-Calibration-Plan.md` and the old
  `2026-06-19 - Drawing Scale Calibration Phase 1 Kickoff.md` — **superseded** by the
  current Scale-Measure-Production-Rates plan.
- ❌ Any magnifier / inside-face-snap / repo-review changes on that branch — out of
  scope and already handled elsewhere on `main`.

## Exit criteria (Definition of Done)
- `typecheck` (primary gate) + `test` green — `build` is optional this phase (no live
  components changed), but run it if you want the extra signal:
  ```
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
  ```
- `scale.test.ts` passes on `main`'s toolchain (it should — it's already green on the
  stranded branch; this just confirms no drift).
- **No live click-through needed** — this phase ships no UI. The proof is the type
  files compile clean and the ported tests pass.
- Close the phase with the **`verify-feature`** skill (Definition of Done → STOP).
  On approval, per [[post-approval-handoff-ritual]] draft the **Phase 2 kickoff**
  (scale tool UI in the dock: ruler button + popover + preset + calibration line +
  persistence; recommend the 2a/2b split the plan suggests).

## Guardrails specific to this phase
- **`database.types.ts` is hand-maintained** (memory `schema-types-drift`) — edit it
  by hand in Row/Insert/Update; do not regenerate the whole file. Keep
  `scale_calibration` typed as `Json | null` at the table layer and narrow it with
  `isScaleCalibration` at any future query boundary (no `Json` into props — but no
  query consumes it yet in Phase 1).
- **`ScaleCalibration` must be JSON-serializable** (it's a plain object that will ride
  in the React Query cache / IDB later) — no class instances, no `Date` objects
  (the `at` field is an ISO string).
- **Pure-fn discipline:** `scale.ts` calls no `Date.now()` internally (callers stamp
  `at`); keep it that way if you touch anything. **Vitest globals OFF**; **lint is NOT
  a gate** — verify with typecheck + test.
- **Port, don't rewrite.** The whole point is to land vetted code unchanged; resist
  refactoring `scale.ts` or "tidying" the tests in this phase.

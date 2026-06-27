# Scale, Measure & Production Rates — set/verify a drawing's scale, measure on canvas, and roll completed square-footage into per-cost-code production rates (self-contained build plan)

> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent / sibling specs (context, not required reading): the **stranded**
> `Drawing-Scale-Calibration-Plan.md` (lives only on branch
> `claude/code-repo-review-2vre2c` — this plan supersedes and absorbs it),
> `Notes/plans/Location-Labeling-Workbench-Plan.md`, `Notes/plans/AI-Tracing-Assist-Plan.md`.

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) first — especially the
   `status_logs` upsert-only rule (§2), `pendingChanges` stays local (§2), the
   RLS posture (§2), no `progressAnalytics` fork + applicability (§3), and the
   TypeScript / JSONB-narrowing / IDB-serialization guardrails (§6).
2. Re-read the files named in each phase **fresh** — do not trust line numbers
   here; they drift.
3. Build the sub-phases **in order**. The precision half (Phases 1–5) ships before
   the analytics half (Phases 6–8) — that ordering is load-bearing: production
   rates are meaningless until square-footage is computed correctly (Phase 3).
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2
   sentence plain-English summary; explain jargon in passing; keep it short.
5. Close each phase with the **`verify-feature`** skill (Definition of Done →
   STOP). Do not commit/push until the owner says "Approved."

## Goal
Two capabilities, built precision-first:

**A. Precision on the canvas (Phases 1–5).** A user can **set a drawing's
real-world scale** from the canvas — either by **calibrating** (draw a line on a
known dimension, type its real length in feet-inches) or picking an
**architectural preset** (¼"=1', ⅛"=1', …, clearly labeled "approx"). They can
**verify** a scale by measuring a second known dimension and seeing the percent
error. A standalone **measuring tool** gives a live feet-inches readout snapped to
a selectable fraction (¼" / ⅛" / ⅛₆"), including multi-segment runs. Every location
traced afterward gets a **correct** square-footage (fixing today's area bug), shown
where the user works, and a **"Recalculate areas"** button refreshes existing ones.

**B. Production rates by cost code (Phases 6–8).** A company-standard **cost-code
dictionary** lives in Global Settings (import / manage / update / deprecate). Each
project milestone can carry a cost code. The dashboard then shows a **production
rate** per cost code — corrected square-footage completed ÷ elapsed days — built
from the dated completion history the app already records.

## Out of scope / deferred
- **Metric units (m / m²).** Schema is future-proofed (`sheets.scale_unit`); all
  v1 UI is feet-inches. Metric is a later additive pass, not a rewrite.
- **DPI-exact presets** via captured PDF page size (`page.view`). Presets stay
  *approximate* (calibration is the trusted path). A later phase can capture real
  paper size to make presets exact.
- **Offline-durable** scale edits / recalculate / cost-code edits. v1 is
  **online-first** (consistent with the locations workstream's Phase 3/4
  posture — generalize offline once, later). The field crew's status-marking path
  stays fully offline; only these new admin/analysis actions are online-first.
- **On-canvas visual scale bar / ruler legend** (graphic). v1 readouts are text.
- **Saving measurements as annotations.** The measuring tool is ephemeral
  (measure, read, move on) in v1. Persisting dimension strings is a later idea.
- **Cost codes as the thing crews mark complete.** Codes *tag* milestones; they
  do not replace the milestone/track field model. (Owner decision.)
- **Backfilling historical `computed_area`** beyond the explicit Recalculate
  button. No silent rewrites of historical numbers.
- **Removing the legacy `scale_ratio` / `scale_preset` columns.** They stay for
  back-compat/display; area math simply stops trusting `scale_ratio`.

## Locked product decisions (from the owner)
- **Build precision tools FIRST**, analytics second. (Area must be correct before
  any rate means anything.)
- **Units: feet & inches (US).** Enter lengths like `12'-6"`; areas in **sq ft**.
- **Calibration is trusted; presets are estimates** (labeled "approx"). Why: a
  preset is only exact if we know the PDF's true paper size, which we don't store —
  and raw image uploads have no paper size at all. Calibration needs no DPI.
- **Existing areas update only on an explicit "Recalculate areas" press.** New
  labels always use the new scale; no silent rewrites of historical numbers.
- **Measuring precision is user-selectable: ¼" / ⅛" / 1⁄16".**
- **Cost codes are company-standard (cross-project), owner-supplied.** They live
  in **Global Settings** (import/manage/update/deprecate), and are **assigned to
  milestones** as the primary link (kept flexible to tag other things later).
- **Production rate = Σ(corrected sq ft of completed locations) ÷ elapsed days,
  grouped by cost code.**

## Critical starting facts (verified 2026-06-26 — re-confirm before building)
- **The scale DB migration is ALREADY LIVE.** `sheets` already has
  `scale_units_per_px numeric`, `scale_unit text`, `scale_calibration jsonb`
  (nullable), alongside legacy `scale_ratio double precision` / `scale_preset text`.
  Confirmed against the live DB (project `pmccdxmuszuykawvlphj`,
  Visual-Floor-Plan-Tracker). **The precision half needs NO migration** — Phase 1
  is a *code rescue*, not a schema change. (Re-confirm with the columns query in
  Phase 1 before relying on it.)
- **The foundation CODE is written but STRANDED**, unmerged, on branch
  `claude/code-repo-review-2vre2c`:
  - `sitepulse-next/src/utils/scale.ts` (+ `scale.test.ts`, fully unit-tested) —
    `ESTIMATED_RENDER_DPI = 288`, `ARCH_SCALE_PRESETS`, `pixelDistance`,
    `unitsPerPxFromCalibration`, `presetUnitsPerPx`, `computeAreaFromUnitsPerPx`
    (the corrected `pixelArea × units_per_px²` math), `parseFeetInches`,
    `formatFeetInches`, `formatArea`.
  - `src/types/database.types.ts` — the three `sheets` columns added by hand.
  - `src/types/domain.ts` — `ScaleCalibration` type + `isScaleCalibration` guard.
  - That branch ALSO carries unrelated magnifier/inside-face-snap work — **rescue
    ONLY the scale files**, not the whole branch.
- **The area bug is on `main` today.** Both create paths compute
  `area = pixelArea × scale_ratio` — a *linear* factor applied to an *area*
  (dimensionally wrong; area scales by the factor **squared**). Fixed by storing a
  linear `units_per_px` and using `computeAreaFromUnitsPerPx`.

## Data model
**Precision half (Phases 1–5) — `sheets` table (already migrated, live):**
- `scale_units_per_px numeric` — **canonical** scale: real-world **feet per
  base-image pixel**. Set by calibration (exact) or preset (estimate). `NULL` =
  un-scaled (labels still save, area-less — preserve that).
- `scale_unit text` — `'ft'` in v1.
- `scale_calibration jsonb` — provenance + re-edit:
  `{ p1:{pctX,pctY}, p2:{pctX,pctY}, length, unit:'ft', source:'calibration'|'preset', preset:string|null, at:'<iso>' }`.
  **Narrow at the query boundary** with `isScaleCalibration`; never let `Json`
  reach props.
- Kept, **not trusted for area**: `scale_ratio` (legacy linear factor — still
  written by the preset path for display/back-compat), `scale_preset` (drives the
  dropdown + "approx" readout).
- `units.computed_area numeric` (existing) — now populated with the **corrected**
  value on new saves and on Recalculate. Existing values untouched until recalc.
- `units_per_px` is defined against the **base image's natural pixel size**
  (`sheets.base_image_url`), the same basis both create paths already use. Pixel
  distance from two percent-space points is `sqrt((dxPct·W)² + (dyPct·H)²)` with
  `W,H` = base-image natural dims (restores isotropy; percent space alone is
  anisotropic — see `geometry.ts` notes).

**Analytics half (Phases 6–8) — NEW + additive (⛔ migrations, present SQL + STOP):**
- **`cost_codes`** — NEW global table (company dictionary, cross-project, mirrors
  the `subtypes` / `sheet_metadata` posture). Suggested columns:
  `id uuid pk default gen_random_uuid()`, `code text not null` (e.g. `"09-250"`),
  `description text` (e.g. `"Gypsum Board"`), `division text` (optional grouping),
  `unit_of_measure text` (default `'SF'`), `status text` (`active`/`deprecated`),
  `sort_order int`, `created_at`/`updated_at`. Add a UNIQUE on `code` (or
  `lower(code)`) so imports are idempotent. **RLS: read = any authenticated member,
  write = `owner`/`admin`/`pm` only, NEVER `anon`** — copy the policy shape from
  `20260625_sheet_metadata.sql` / the `subtypes` policies. Confirm the final
  column list against the owner's actual code list before writing the migration.
- **`project_milestones.cost_code_id uuid null references cost_codes(id)`** — the
  primary assignment link (NEW, additive, nullable). `ON DELETE SET NULL` so
  deprecating/deleting a code never orphans a milestone. Keep the dictionary
  flexible enough that a later phase can also reference it from `units` /
  `subtypes` without reshaping it.
- **Reads only** for rates: `status_audit_log` (append-only dated completion
  history), `units.computed_area`, `project_milestones` (+ `cost_code_id`). No new
  write path for analytics. **Respect applicability** — only count
  (unit × milestone) slots that are applicable (`buildApplicabilityIndex` /
  `isMilestoneApplicable`); never let N/A slots into a rate denominator (AGENTS.md
  §3). **Never** route any write through `status_logs` except via the existing
  `upsert_status_log` RPC / `.upsert(onConflict)` — the analytics half does not
  write status at all.

## Build-on inventory (read these fresh before using)
REUSE — do not reinvent:
- `src/components/canvas/ViewportControls.tsx` — the shared top-left dock (Reset +
  zoom). The **ruler/scale button** and the **measure button** go here. It renders
  in both the live map and the workbench (mounted once by `FloorplanCanvas`).
- `src/components/FloorplanCanvas.tsx` — the shared canvas. Tracing flow: `toolMode`
  (Zustand `useMapStore`), `draftPoints` / pending-polygon state,
  `getSnappedCoordinate` inline call, the `toolMode === 'draw'` click branch, the
  `useEffect` that resets draft state on `toolMode` change, and the magnifier loupe
  (`useLoupeRenderer` / `LoupeOverlay`). The **calibration line** and the
  **measure tool** reuse ALL of this.
- `src/components/canvas/DraftPolygon.tsx` (+ `PendingPolygon.tsx`) — the
  in-progress drawing pattern; a 2-point calibration line and an N-point measure
  polyline are simple cases.
- `src/store/useMapStore.ts` — `ToolMode` union + `setToolMode`. Add `'calibrate'`
  and `'measure'`.
- `src/hooks/useProjectQueries.ts` — **`updateSheetScaleMutation`** (currently
  writes only `scale_preset` + `scale_ratio`). **Extend this one** to also write
  `scale_units_per_px` / `scale_unit` / `scale_calibration`; do NOT add a parallel
  mutation. `useMilestones` loads `project_milestones`.
- `src/utils/workbench.ts` `computeLabelArea` + `src/hooks/useWorkbenchActions.ts`
  (workbench create path) + `src/hooks/useMapActions.ts` `saveNewUnitFromPopover`
  (live create path, inline shoelace loop) — the **two area call sites** to switch
  onto `computeAreaFromUnitsPerPx`.
- `src/components/UnitInspector.tsx` — already shows `computed_area` read-only; the
  place to surface the corrected SF more prominently (Phase 3).
- `src/components/SettingsMenu.tsx` — existing per-project preset dropdown + custom
  ratio input (project-scoped settings live here). The **milestone editor** here is
  where the cost-code picker (Phase 7) attaches.
- `src/components/GlobalSettingsModal.jsx` + `src/app/dashboard/page.jsx` — the
  **global/cross-project** settings surface; the cost-code dictionary manager
  (Phase 6) lives here (memory `global-vs-project-settings`).
- `src/utils/progressAnalytics.ts` — `summarizeGroup` (the `byWeek` rollup from
  dated `CompletionEvent[]`), variance math. **Extend / wrap, do NOT fork.**
- `src/utils/applicability.ts` — `buildApplicabilityIndex`, `isMilestoneApplicable`.
- `src/utils/geometry.ts` — `getSnappedCoordinate`, `getCentroid`, shoelace +
  aspect notes. Don't fork.
- `src/types/database.types.ts` (hand-maintained — memory `schema-types-drift`) +
  `src/types/domain.ts` (`Sheet`, `Milestone`, guards). Add columns by hand;
  derive domain types from the Row.

Do **NOT** fork: `progressAnalytics`, the established Query hooks,
`getSnappedCoordinate`, `mixAlpha`, `upsert_status_log`.

## Pure logic to extract + unit-test
Framework-free, deterministic, no I/O, **never call `Date.now()` inside** (callers
stamp `at`). This is where load-bearing correctness lives — test it hard.

- **`src/utils/scale.ts`** (rescue from the stranded branch — already written +
  tested): `ESTIMATED_RENDER_DPI`, `ARCH_SCALE_PRESETS`, `pixelDistance`,
  `unitsPerPxFromCalibration`, `presetUnitsPerPx`, `computeAreaFromUnitsPerPx`,
  `parseFeetInches`, `formatFeetInches`, `formatArea`.
- **`src/utils/measure.ts`** (NEW, Phases 4–5):
  - `lengthFt(points, imgW, imgH, unitsPerPx)` → number | null (sum of segment
    `pixelDistance × unitsPerPx`; supports 2..N points).
  - `roundToFraction(ft, denom)` → number (snap decimal feet to nearest 1/`denom`
    inch; `denom ∈ {4,8,16}`).
  - `formatFeetInchesFraction(ft, denom)` → string (e.g. `12'-6 1⁄4"`; reuse/extend
    `formatFeetInches`). Handle inch roll-up (e.g. `11 16⁄16"` → next inch/foot).
  - `verificationError(measuredFt, actualFt)` → number | null (signed percent
    error `(measured − actual) / actual`; `null` if `actual ≤ 0`).
- **`src/utils/productionRates.ts`** (NEW, Phase 8):
  - `completedAreaEvents(auditRows, units, applicabilityIndex)` → dated
    `{ costCodeId|milestoneId, sqFt, date }[]` (only applicable, completed slots;
    pulls `computed_area` per unit). Pass everything in.
  - `productionRateByCode(events, opts)` → per-code `{ totalSqFt, spanDays,
    sqFtPerDay }` (+ optional weekly series mirroring `summarizeGroup`'s `byWeek`).
  - Keep it honest like `summarizeGroup`: **suppress** (don't fake) a rate when the
    sample/span is too small or zero.

## Sub-phasing (ship + verify each)

> Phases 1–5 = precision (no migrations — schema is already live). Phases 6–8 =
> analytics (⛔ migrations). Each phase is one fresh session.

### Phase 1 — Rescue the scale foundation (code only, no migration)
- **Scope:** Branch off `main`. Port from `claude/code-repo-review-2vre2c` (cherry-
  pick the files or copy their contents — **scale files ONLY**, not the magnifier
  work): `src/utils/scale.ts` + `src/utils/scale.test.ts`; the three `sheets`
  columns in `src/types/database.types.ts` (Row/Insert/Update); `ScaleCalibration`
  + `isScaleCalibration` in `src/types/domain.ts`. No component edits, no
  behavior change yet.
- **Approval gates:** none hard (no migration — the columns are already live;
  **confirm** with: `select column_name from information_schema.columns where
  table_name='sheets' and column_name like 'scale_%';` → expect all five). If the
  three new columns are somehow absent, STOP and tell the owner before doing
  anything else.
- **Exit criteria:** `typecheck` + `test` green (`scale.test.ts` passes on `main`'s
  toolchain) · close with `verify-feature`.

### Phase 2 — Scale tool UI in the dock (set + read the scale)
- **Scope:**
  1. **Ruler button** in `ViewportControls.tsx` → a small glass popover (match
     `ZoomIndicator`/dock styling): a **Preset** dropdown (`ARCH_SCALE_PRESETS`), a
     **Calibrate** action, and a **current-scale readout**
     (`Scale: ¼" = 1' (approx)` / `Calibrated: 1 px = 0.025 ft` / `Not set`).
  2. **Calibration interaction:** add `ToolMode 'calibrate'` (`useMapStore`).
     Entering it lets the user place exactly **2 snapped points** (reuse the
     `draw` click path + `getSnappedCoordinate` + loupe; render via the
     DraftPolygon pattern). After the 2nd point, prompt for the real length
     (feet-inches input → `parseFeetInches`) → `unitsPerPxFromCalibration` →
     persist. Extend the `toolMode`-reset effect to clear calibration state; honor
     Esc / existing cancel keys.
  3. **Persist:** extend `updateSheetScaleMutation` to write `scale_units_per_px`,
     `scale_unit`, `scale_calibration`, and (preset path) keep `scale_preset` /
     legacy `scale_ratio` in sync. Optimistic `sheets` cache update.
- **Split if needed:** **2a** = button + popover + preset + readout + persistence
  (no drawing); **2b** = the calibration-line drawing interaction.
- **Approval gates:** none hard (UI + one existing mutation; no migration/RLS).
- **Exit criteria:** `typecheck` + `test` + **`build`** green · live `dev:3010`
  click-through in **both** the workbench and the live map: set a preset (readout
  says "approx"), calibrate a line (readout says calibrated), reload → persists ·
  close with `verify-feature`.

### Phase 3 — Corrected areas on save + "Recalculate areas" + surface SF
- **Scope:**
  1. Switch the **two create paths** onto `computeAreaFromUnitsPerPx` using
     `scale_units_per_px` (replacing `× scale_ratio`): the `computeLabelArea`
     consumer in `useWorkbenchActions.ts`, and the inline shoelace loop in
     `useMapActions.saveNewUnitFromPopover`. Keep "no scale ⇒ area-less save".
  2. **"Recalculate areas on this drawing"** action in the scale popover: recompute
     `computed_area` for every `unit` on the active sheet from the current
     `units_per_px` (load base-image dims once; iterate polygons). **Online-first**
     bulk write via the existing **unit-update** path (a plain `units.computed_area`
     column update — NOT `status_logs`, NOT the `pendingChanges` buffer). Show the
     affected count and confirm before writing.
  3. **Surface SF** where the user works — at minimum the corrected number in
     `UnitInspector`, and consider the trace-complete popover / unit hover. Keep it
     read-only.
- **Approval gates:** none hard. The Recalculate bulk write touches a plain column
  via the established unit-update mutation — still **confirm the count** with the
  user before firing.
- **Exit criteria:** `typecheck` + `test` + `build` green · a unit test proves the
  old (`× ratio`) vs new (`× units_per_px²`) results differ and the new one is
  dimensionally correct · live: trace a room after calibrating → area is right;
  press Recalculate → existing areas refresh · close with `verify-feature`.

### Phase 4 — Standalone measuring tool (fractional feet-inches)
- **Scope:**
  1. `src/utils/measure.ts` (+ `measure.test.ts`) — `lengthFt`, `roundToFraction`,
     `formatFeetInchesFraction`, `verificationError` (see Pure logic). Test the
     fraction rounding + inch/foot roll-up hard.
  2. **Measure button** in `ViewportControls.tsx` + `ToolMode 'measure'`. Drop
     2..N snapped points (reuse the `draw` click path + `getSnappedCoordinate` +
     loupe + DraftPolygon polyline). **Live readout** of the running length in
     feet-inches, snapped to the active fraction, with a **¼" / ⅛" / 1⁄16" selector**
     (and per-segment + total for multi-segment runs). Desktop-mouse-primary
     (memory `nav-enhancement-desktop-only`). Double-click / Esc ends the run;
     extend the `toolMode`-reset effect to clear measure state. Ephemeral — nothing
     persists.
  3. Disable/annotate the tool when the sheet has no scale (`units_per_px` null) —
     prompt the user to set a scale first.
- **Approval gates:** none.
- **Exit criteria:** `typecheck` + `test` + `build` green · `measure.test.ts`
  covers 2-pt + multi-segment + each fraction + roll-up edge cases · live: measure
  a known dimension on a calibrated sheet and confirm the readout matches reality
  at the selected fraction · close with `verify-feature`.

### Phase 5 — Verify a scale (confidence check)
- **Scope:** A **"Verify scale"** action in the scale popover that reuses the
  measure interaction: user draws a line over a *second* known dimension, types its
  real length, and sees `measured vs actual` + **percent error**
  (`verificationError`) with a clear good/warn indicator (e.g. green ≤ 1%, amber ≤
  3%, red otherwise — thresholds owner-tunable). Does **not** change the stored
  scale; it only reports confidence. Offer a one-click "re-calibrate from this
  line" if the error is large (reuses Phase 2 persist).
- **Approval gates:** none.
- **Exit criteria:** `typecheck` + `test` + `build` green · live: calibrate, then
  verify against a different known dimension → sensible percent error · close with
  `verify-feature`.

> --- Precision half complete. Owner shares the company cost-code list before Phase 6. ---

### Phase 6 — Cost-code dictionary (global) ⛔ migration
- **Scope:**
  1. ⛔ **Migration** `supabase/migrations/<date>_cost_codes.sql` — NEW
     `cost_codes` table (see Data model) with **RLS read=member / write=
     owner·admin·pm / never anon** (copy `sheet_metadata` policy shape), additive +
     idempotent (`CREATE TABLE IF NOT EXISTS`, guarded policies), UNIQUE on the
     code. **Present the exact SQL via the `create-migration` skill and STOP for
     owner sign-off before applying. Never touch production data without explicit
     go-ahead.**
  2. Hand-add the table to `database.types.ts`; derive `CostCode` in `domain.ts`.
  3. **Manager UI in `GlobalSettingsModal`** — list / add / edit / deprecate codes,
     and an **import** (paste / CSV) that upserts by `code` (idempotent). New query
     hooks (read = any member; writes = privileged) in the established hook layer.
- **Approval gates:** ⛔ DB migration + RLS (above). No status_logs involvement.
- **Exit criteria:** `typecheck` + `test` + `build` green · CSV/paste import is
  idempotent (re-import doesn't duplicate) · live: import the owner's list, edit,
  deprecate · close with `verify-feature`.

### Phase 7 — Assign cost codes to milestones ⛔ migration
- **Scope:**
  1. ⛔ **Migration** — `project_milestones.cost_code_id uuid null references
     cost_codes(id) on delete set null` (additive, nullable, idempotent, RLS
     unchanged on `project_milestones`). Present SQL + STOP.
  2. Add the column to `database.types.ts`; `Milestone` picks it up.
  3. **Cost-code picker** in the milestone editor (`SettingsMenu`) — a searchable
     select of active codes; persists via the existing milestone-update path.
- **Approval gates:** ⛔ DB migration. (RLS unchanged.)
- **Exit criteria:** `typecheck` + `test` + `build` green · assign a code to a
  milestone, reload → persists · close with `verify-feature`.

### Phase 8 — Production-rate analytics (read-only, by cost code)
- **Scope:**
  1. `src/utils/productionRates.ts` (+ test) — see Pure logic. Build on the
     `summarizeGroup`/`byWeek` pattern; **do not fork** `progressAnalytics`.
     **Respect applicability** (only applicable completed slots in any denominator).
  2. A dashboard module (extend the existing analytics surface — `ProjectDashboard`
     fetches all-project units/statuses/history; do not re-fetch in a fork) showing
     per-cost-code **sq ft completed** and **sq ft/day**, with the honest
     suppression of tiny/zero-span samples.
- **Approval gates:** none (read-only analytics; no writes, no migration).
- **Exit criteria:** `typecheck` + `test` + `build` green · `productionRates.test.ts`
  pins the rate math + applicability filtering + small-sample suppression · live:
  codes with completed area show a sensible rate; un-coded milestones are excluded
  cleanly · close with `verify-feature`.

## Verification commands (exit-criteria gate)
Run npm with an absolute prefix (bash cwd persists; a stray `cd` prompts):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck   # tsc --noEmit (primary gate)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test         # vitest (one file: ... run test -- src/utils/scale.test.ts)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build         # next build (after editing live components)
```
- **Lint is NOT a gate** (~1850 pre-existing problems). Verify with
  typecheck + test + build.
- **No E2E** — UI/canvas verified via `npm run dev:3010` (from `sitepulse-next/`,
  port 3010, not 3000).
- Vitest globals are OFF: import `{ describe, it, expect, vi }` from `'vitest'`;
  co-locate `*.test.ts` next to the source.

## Hard guardrails (AGENTS.md — do not violate)
- **Migrations (Phases 6–7 only):** additive + nullable + idempotent
  (`ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`), guarded RLS policies,
  **no `anon` grants**, `COMMENT ON`. Present SQL and **STOP** (⛔). Phases 1–5 need
  **no** migration (scale columns already live).
- **Types:** `database.types.ts` is hand-maintained (memory `schema-types-drift`) —
  add columns/tables by hand; derive domain types from the Row, never hand-duplicate
  the shape. **Narrow JSONB at the query boundary** (`isScaleCalibration`); no
  `Json` into props (§6).
- **Pure fns:** no `Date.now()` inside `scale.ts` / `measure.ts` /
  `productionRates.ts`; callers pass timestamps. Keep everything flowing through
  Query cache JSON-serializable — no class instances (RBush stays out of cache, §5/§6).
- **Tool modes:** new `'calibrate'` / `'measure'` modes must be cleaned up like the
  others (extend the `toolMode`-change reset effect + cancel keys in
  `FloorplanCanvas`); don't leak draft state.
- **Status writes:** the analytics half is **read-only** on `status_audit_log`; it
  writes no status. Any status write anywhere stays on `upsert_status_log` /
  `.upsert(onConflict)` — **never** plain `.insert()` (§2).
- **Recalculate / area writes** touch `units.computed_area` only, via the existing
  unit-update path — NOT `status_logs`, NOT the offline `pendingChanges` buffer.
  Online-first is intentional.
- **Don't fork `progressAnalytics`**; respect applicability (N/A out of denominators,
  §3); don't recolor `mapDisplayStatuses`; don't break the offline mutation queue or
  the snapping-vector pipeline.

## Open decisions
- **Cost-code import format + column set** (Phase 6) — finalize against the owner's
  actual list (does it carry divisions? a unit of measure other than SF? a
  description column?). Resolve at the start of Phase 6 from the shared list.
- **Verify thresholds** (Phase 5) — green/amber/red percent cutoffs. Default
  1% / 3%; owner-tunable. Resolve in Phase 5 (low stakes).
- **Whether the legacy `SettingsMenu` preset UI is retired** in favor of the dock
  popover, or kept as a second entry point. Decide in Phase 2 (default = keep both).
- **How far to surface SF** (Phase 3) — inspector only, or also map/hover/popover.
  Decide in Phase 3 (low stakes).

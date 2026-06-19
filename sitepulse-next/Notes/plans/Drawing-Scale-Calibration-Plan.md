# Drawing Scale & Calibration — set/verify a drawing's real-world scale from the canvas (self-contained build plan)

> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent specs (context, not required): `Notes/plans/Location-Labeling-Workbench-Plan.md`,
> `Notes/plans/Drawing-Library-Management-Plan.md`, `Notes/plans/Fill-From-Walls-Accelerator-Plan.md`.

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) first.
2. Re-read the files named in each phase **fresh** — do not trust line numbers here; they drift.
3. Build the sub-phases in order (1 → 2 → 3). Verify after each slice (§ Verification).
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence
   plain-English summary; explain jargon in passing; keep it short.
5. Close each phase with the **`verify-feature`** skill (Definition of Done → STOP).
   Do not commit/push until the owner says "Approved."

## Goal
When this is done, a user can **set a drawing's real-world scale directly from the canvas**
(in both the live map and the Drawing Library workbench) using a new **ruler button in the
top-left dock** (next to Reset view / zoom). Two ways to set it:
- **Calibrate (trusted):** draw a 2-point line on a known dimension (a gridline, a door, a
  dimension string), type its real length in feet/inches, done. Works on any drawing,
  including plain image uploads.
- **Preset (estimate):** pick an architectural scale (¼"=1', etc.) for a rough scale, clearly
  labeled "approx" until calibrated.

A small readout shows the current scale. Every location traced/filled afterward gets a
**correct** real-world area (sq ft) — fixing today's area bug — and the user can press
**"Recalculate areas"** to refresh existing locations on that drawing.

## Locked product decisions (from the owner)
- **Units: feet & inches (US).** Enter lengths like `12'-6"`; areas shown in **sq ft**.
  Store a `scale_unit` column anyway (`'ft'`) so metric is a later additive change, not a rewrite.
- **Presets are estimates; calibration is trusted.** Presets produce an *approximate*
  scale (no backend changes); they're labeled "approx" and don't pretend to be exact.
  Calibration writes the authoritative scale. (Why: an architectural preset is only exact
  if we know the PDF's true page size, which we don't store — and plain-image uploads have
  no page size at all.)
- **Existing areas: explicit "Recalculate areas" button.** New labels always use the new
  scale; existing locations' areas update only when the user clicks recalculate. No silent
  rewrites of historical numbers.

## The bug this fixes (read carefully)
Today, real-world area is computed as `pixel_area × scale_ratio` in **two** places:
- `src/utils/workbench.ts` → `computeLabelArea()` (workbench create path), and
- `src/hooks/useMapActions.ts` → `saveNewUnitFromPopover` (live-map create path, inline loop).

`scale_ratio` is a **linear** factor (preset `¼"=1'` → `48`, `⅛"=1'` → `96`, …). Multiplying
an **area** by a linear factor is dimensionally wrong — area scales by the factor **squared**.
The fix is to store a clean **linear `units_per_px`** (real feet per base-image pixel) and
compute `area = pixel_area × units_per_px²`, `length = pixel_dist × units_per_px`.

## Out of scope / deferred
- **Metric units** (m / m²). Schema is future-proofed (`scale_unit`), UI is feet-only in v1.
- **DPI-accurate presets** via captured PDF page size (the "estimate" decision defers this).
  A later phase can add `pdf_point_width/height` from the worker's `page.view` to make
  presets exact.
- **On-canvas visual scale bar / ruler legend.** v1 readout is text only.
- **Live "measure as you trace" length readouts** on the room tracer. Natural follow-on once
  `units_per_px` exists; not in v1.
- **Standalone measure/dimension-annotation tool.**
- **Offline-durable** scale edits + recalculate. v1 is **online-first** (consistent with the
  locations workstream Phase 3/4 approach — generalize offline once, later).
- **Backfilling/repairing** historical `computed_area` beyond the explicit Recalculate button.
- Removing/migrating the legacy `scale_ratio`/`scale_preset` columns — they stay for
  back-compat; we stop *trusting* `scale_ratio` for area math.

## Data model
All changes are on the **`sheets`** table (a drawing = one `sheets` row; workbench drawings
and live levels are both `sheets`, so this covers the Drawing Library automatically).

New, **additive + nullable** columns:
- `scale_units_per_px numeric` — **canonical** scale: real-world **feet per base-image pixel**.
  Set by calibration (exact) or preset (estimate). `NULL` = un-scaled (labels still save,
  area-less — preserve that behavior).
- `scale_unit text` — `'ft'` in v1. Future-proofs metric. `NULL`/`'ft'` ⇒ feet.
- `scale_calibration jsonb` — provenance + re-edit support:
  `{ "p1": {"pctX":n,"pctY":n}, "p2": {"pctX":n,"pctY":n}, "length": n, "unit": "ft", "source": "calibration"|"preset", "preset": "1/4\" = 1'"|null, "at": "<iso>" }`.
  Narrow at the query boundary with a type guard (see §Guardrails); never let `Json` reach props.

Kept (legacy, do **not** trust for area going forward):
- `scale_ratio numeric` — legacy linear factor. Still written by the preset path for
  back-compat/display only; **area math no longer uses it.**
- `scale_preset text` — remembers which preset estimate is selected (drives the dropdown +
  the "approx" readout). Still used.

`units.computed_area numeric` — unchanged column; now populated with the **corrected** value
on new saves and on recalculate. Existing values are left as-is until recalculated.

**`units_per_px` is defined against the base image's natural pixel size** (`base_image_url`),
the same basis both create paths already use for area. Pixel distance from two percent-space
points is `sqrt((dxPct·W)² + (dyPct·H)²)` with `W,H` = base image natural dims (this restores
isotropy; percent space alone is anisotropic — see `geometry.ts` notes).

## Build-on inventory (read these fresh before using)
REUSE — do not reinvent:
- `src/components/canvas/ViewportControls.tsx` — the shared top-left dock (Reset + zoom).
  The ruler button goes here. It already renders in **both** map and workbench
  (`FloorplanCanvas.tsx` mounts it once).
- `src/components/FloorplanCanvas.tsx` — the shared canvas. Tracing flow: `toolMode`
  (Zustand `useMapStore`), `draftPoints`/`pendingPolygonPoints`, `getSnappedCoordinate`
  inline call, the click handler (`toolMode === 'draw'` branch), the `useEffect` that resets
  draft points on `toolMode` change, and the magnifier loupe (`useLoupeRenderer` /
  `LoupeOverlay`). The calibration line reuses ALL of this.
- `src/components/canvas/DraftPolygon.tsx` (+ `PendingPolygon.tsx`) — pattern for drawing the
  in-progress line; a 2-point calibration line is the trivial case.
- `src/store/useMapStore.ts` — `ToolMode` union + `setToolMode`. Add `'calibrate'`.
- `src/hooks/useProjectQueries.ts` — **`updateSheetScaleMutation`** (~L926): the existing
  sheet-scale mutation (optimistic cache update on the `sheets` list). **Extend this** to
  write the new columns; do not write a parallel one.
- `src/utils/workbench.ts` `computeLabelArea` + `src/hooks/useWorkbenchActions.ts` (the
  workbench create path) + `src/hooks/useMapActions.ts` `saveNewUnitFromPopover` (live create
  path) — the two area call sites to switch onto the corrected math.
- `src/components/SettingsMenu.tsx` (~L595–636) — the existing preset dropdown + custom-ratio
  input. Mirror the preset list; consider pointing it at the new readout/units later (not required).
- `src/utils/geometry.ts` — `getCentroid`, shoelace pattern, aspect notes. Don't fork.
- `src/types/database.types.ts` (hand-maintained — see memory `schema-types-drift`) +
  `src/types/domain.ts` (`Sheet` derived from the Row). Add the columns by hand.

Do **NOT** fork: `progressAnalytics`, the established Query hooks, `getSnappedCoordinate`,
`mixAlpha`.

## Pure logic to extract + unit-test (`src/utils/scale.ts` + `scale.test.ts`)
Framework-free, deterministic. Pass all inputs in; **never** call `Date.now()` inside (callers
stamp `at`). This is where the load-bearing correctness lives — test it hard.
- `ARCH_SCALE_PRESETS` — ordered list `{ label, realFeetPerPaperInch }`
  (`¼"=1'` → 4, `⅛"=1'` → 8, `⅜"=1'` → 8/3, `½"=1'` → 2, `1"=10'` → 10, `1"=20'` → 20).
- `pixelDistance(p1, p2, imgW, imgH)` → number (isotropic, percent→pixels).
- `unitsPerPxFromCalibration(p1, p2, imgW, imgH, knownLengthFt)` → number | null
  (= `knownLengthFt / pixelDistance`; `null` if distance ≤ 0 or length ≤ 0 or dims missing).
- `presetUnitsPerPx(realFeetPerPaperInch, assumedDpi)` → number
  (= `realFeetPerPaperInch / assumedDpi`; `assumedDpi` = the backend converter's render DPI —
  **the implementing Phase-1 session MUST confirm this constant from the backend PDF→PNG
  conversion** before relying on it; export it as a named constant `ESTIMATED_RENDER_DPI`
  with a comment, and treat the preset result as approximate regardless).
- `computeAreaFromUnitsPerPx(points, imgW, imgH, unitsPerPx)` → number | null
  (shoelace pixel area × `unitsPerPx²`; `null` for <3 pts / missing dims / falsy scale).
  **This replaces the buggy `computeLabelArea` math.**
- `parseFeetInches(input: string)` → number | null — accept `12.5`, `12'`, `150"`,
  `12'6"`, `12' 6"`, `12'-6"`. Return decimal feet; `null` on unparseable.
- `formatFeetInches(ft: number)` → string (`12'-6"`), `formatArea(sqft: number)` → string
  (`"1,234 sq ft"`) for readouts.

## Sub-phasing (ship + verify each)

### Phase 1 — Foundation: schema + pure scale math (no app behavior change)
- **Scope:**
  1. **Migration** `supabase/migrations/20260619_drawing_scale.sql` — `ADD COLUMN IF NOT
     EXISTS` the three nullable columns on `sheets` (+ `COMMENT ON COLUMN`). Additive,
     nullable, **no backfill**, **RLS unchanged**, idempotent. Model on
     `20260619_units_standard_version.sql`.
  2. Hand-add the three columns to `src/types/database.types.ts` (`sheets` Row/Insert/Update);
     `Sheet` in `domain.ts` picks them up automatically. Add an `isScaleCalibration` JSONB
     guard in `domain.ts` (mirror `isPercentPointArray`).
  3. `src/utils/scale.ts` + `src/utils/scale.test.ts` — all pure logic above, fully tested.
- **Approval gates:** ⛔ **DB migration** — present the exact SQL (use the `create-migration`
  skill conventions) and **STOP for owner sign-off before applying**. Never apply against
  production data without explicit go-ahead. Confirm `ESTIMATED_RENDER_DPI` from the backend
  converter; if it can't be confirmed, flag it and keep presets clearly approximate.
- **Exit criteria:** typecheck + test green (build optional — no component edits yet) ·
  `scale.test.ts` covers calibration, preset, corrected area, feet-inch parse/format incl.
  null/degenerate cases · close with `verify-feature`.

### Phase 2 — Scale tool UI in the dock (set + read the scale)
- **Scope:**
  1. Ruler button in `ViewportControls.tsx` → a small popover (glass style, match
     `ZoomIndicator`/dock). Popover contains: **Calibrate** action, **Preset** dropdown
     (from `ARCH_SCALE_PRESETS`), and a **current-scale readout**
     (`Scale: ¼" = 1' (approx)` / `Calibrated: 1 px = 0.025 ft` / `Not set`).
  2. **Calibration interaction:** add `ToolMode 'calibrate'` (`useMapStore`). Entering it lets
     the user place exactly **2 snapped points** (reuse the `draw` click path +
     `getSnappedCoordinate` + loupe); render the line via the DraftPolygon pattern. After the
     2nd point, prompt for the real length (feet/inches input, `parseFeetInches`). On confirm:
     `unitsPerPxFromCalibration` → persist. Extend the `toolMode`-reset `useEffect` to clear
     calibration state, and Esc/兼容 the existing cancel keys.
  3. **Persist:** extend `updateSheetScaleMutation` (useProjectQueries) to write
     `scale_units_per_px`, `scale_unit`, `scale_calibration`, and (preset path) keep
     `scale_preset`/legacy `scale_ratio` in sync. Optimistic `sheets` cache update.
- **If this is too big for one session, split:** **2a** = button + popover + preset estimate
  + readout + persistence (no drawing); **2b** = the calibration-line drawing interaction.
- **Approval gates:** none hard; it's UI + one mutation. (No migration, no RLS.)
- **Exit criteria:** typecheck + test + **build** green · live `dev:3010` click-through in
  **both** the workbench and the live map: set a preset (readout shows "approx"), calibrate a
  line (readout shows calibrated), reload and confirm persistence · close with `verify-feature`.

### Phase 3 — Corrected areas on save + "Recalculate areas"
- **Scope:**
  1. Switch the **two create paths** onto `computeAreaFromUnitsPerPx` using
     `scale_units_per_px` (replacing the `× scale_ratio` math): `computeLabelArea` consumers in
     `useWorkbenchActions.ts`, and the inline loop in `useMapActions.saveNewUnitFromPopover`.
     Keep the "no scale ⇒ area-less save" behavior.
  2. **"Recalculate areas on this drawing"** action in the scale popover: recompute
     `computed_area` for every `unit` on the active sheet from the current `units_per_px`
     (load base-image dims once; iterate polygons). **Online-first** bulk update via the
     established unit-update path; show the affected count and confirm before writing.
     Existing areas otherwise untouched.
- **Approval gates:** none hard. The recalculate is a **bulk write to `units.computed_area`**
  (a plain column — NOT `status_logs`, so no `upsert_status_log` rules apply); still confirm
  count with the user before firing, and follow the existing unit-update mutation pattern.
- **Exit criteria:** typecheck + test + build green · unit tests prove old (`× ratio`) vs new
  (`× ratio²` equiv via units_per_px) differ and new is dimensionally correct · live check:
  trace a room after calibrating → area is right; press Recalculate → existing areas refresh ·
  close with `verify-feature`.

## Verification commands (exit-criteria gate)
Run npm with an absolute prefix (bash cwd persists; a stray `cd` prompts):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck   # tsc --noEmit (primary gate)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test         # vitest (one file: ... run test -- src/utils/scale.test.ts)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build         # next build (after editing live components)
```
- **Lint is NOT a gate** (~1850 pre-existing problems). Verify with typecheck + test + build.
- **No E2E** — UI/canvas verified via `npm run dev:3010` (from `sitepulse-next/`, port 3010).
- Vitest globals are OFF: import `{ describe, it, expect, vi }` from `'vitest'`; co-locate
  `scale.test.ts` next to `scale.ts`.

## Hard guardrails (AGENTS.md — do not violate)
- **Migration:** additive + nullable + idempotent (`ADD COLUMN IF NOT EXISTS`), **RLS
  unchanged**, no `anon` grants, `COMMENT ON COLUMN`. Present SQL and **STOP** (⛔ Phase 1).
- **Types:** `database.types.ts` is hand-maintained (memory `schema-types-drift`) — add the
  columns by hand; derive `Sheet` from the Row, never hand-duplicate the shape. **Narrow the
  `scale_calibration` JSONB at the query boundary** with a guard; no `Json` into props (§6).
- **Pure fns:** no `Date.now()` inside `scale.ts`; callers pass `at`. Keep everything
  JSON-serializable that flows through Query cache (no class instances) (§6).
- **Tool modes:** the new `'calibrate'` mode must be cleaned up like the others (extend the
  `toolMode`-change reset effect + cancel keys in `FloorplanCanvas`); don't leak draft state.
- **Recalculate** writes `units.computed_area` only — a plain column update via the existing
  unit-update path. Do **not** route it through `status_logs` / `upsert_status_log`; do not
  touch the offline `pendingChanges` buffer. Online-first is intentional.
- Don't fork `progressAnalytics`; don't recolor `mapDisplayStatuses`; don't break the offline
  mutation queue or the snapping vector pipeline (RBush stays out of Query cache).

## Open decisions
- **`ESTIMATED_RENDER_DPI`** for the preset-estimate path — confirm the backend PDF→PNG
  conversion DPI in Phase 1. If unconfirmable, ship presets as clearly-approximate and let
  calibration be the trusted path (already the plan); a later phase can capture real PDF page
  size (`page.view`) to make presets exact.
- Whether the SettingsMenu preset UI should be retired in favor of the new dock popover, or
  kept as a second entry point. Decide during Phase 2 (low stakes; default = keep both).

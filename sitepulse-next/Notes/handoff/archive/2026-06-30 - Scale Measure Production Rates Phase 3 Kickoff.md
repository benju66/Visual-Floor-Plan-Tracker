# Kickoff — Scale, Measure & Production Rates, Phase 3: Corrected areas on save + "Recalculate areas" + surface SF

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3 of Scale, Measure & Production Rates** (make traced locations get a **correct** square-footage from the drawing's scale, add a **"Recalculate areas"** button that refreshes existing ones, and **show the SF** where the user works). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-30 - Scale Measure Production Rates Phase 3 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Scale-Measure-Production-Rates-Plan.md` (**Phase 3**, "Data model", "Build-on inventory", "Hard guardrails")
> - `sitepulse-next/AGENTS.md`
>
> Work on a fresh **`feat/scale-measure-phase-3`** branch cut off `main`. **First confirm Phases 1 AND 2 are on `main`** — Phase 3 imports `computeAreaFromUnitsPerPx` from `scale.ts` (Phase 1) and reads the `scale_units_per_px` that Phase 2's tool now sets. If `feat/scale-measure-phase-2` (commit `e1ce54a`) hasn't merged yet, STOP and tell me. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English summary
Today the app computes a room's square-footage with the WRONG math (it multiplies
a pixel area by a *linear* scale factor — area should scale by that factor
*squared*). Phase 1 shipped the correct formula (`computeAreaFromUnitsPerPx`) and
Phase 2 shipped the tool that sets a trustworthy `scale_units_per_px`. Phase 3
finally **connects them**: new traces get the right SF, a **"Recalculate areas"**
button fixes the SF on rooms traced before the scale was set, and the corrected
number is **shown** to the user (at minimum in the location inspector). This is the
payoff phase — after it, square-footage is real.

## Where Phase 2 left off (what you're building on)
- **Phase 1** put the correct math + types on main: `computeAreaFromUnitsPerPx`
  (`pixelArea × units_per_px²`), `formatArea`, the `sheets` scale columns.
- **Phase 2** (branch `feat/scale-measure-phase-2`, commit `e1ce54a`, owner-approved)
  shipped the scale tool: a ruler button in `ViewportControls` → popover with a
  preset dropdown + calibration line that writes `scale_units_per_px` /
  `scale_unit:'ft'` / `scale_calibration` via the **extended** `useUpdateSheetScale`
  mutation. It also added:
  - `useSheetById(sheetId)` (universal PK read — use it to load a sheet's
    `scale_units_per_px` + `base_image_url` in either context).
  - `describeScale()` in `scale.ts` (readout helper — not needed here, just FYI).
  - `ScaleControl.tsx` — **the scale popover is where the "Recalculate areas" button
    goes** (item 2 below).
- **The DB columns are already live** — no migration in Phase 3 either.

## Required reading (in order)
1. `AGENTS.md` — esp. §2 (extend the established Query hooks; the unit-update write
   path is NOT `status_logs` and NOT the offline `pendingChanges` buffer — a plain
   `units.computed_area` column update is **online-first** by design), §6 (narrow
   JSONB — `isPercentPointArray` for `polygon_coordinates`; no `Json` into props).
2. `Scale-Measure-Production-Rates-Plan.md` — **Phase 3**, "Data model" (the
   `computed_area` semantics: corrected on new saves + on Recalculate, existing
   values untouched until then), "Build-on inventory" (the two area call sites).
3. The current source, read FRESH (line numbers drift):
   - `src/utils/scale.ts` — `computeAreaFromUnitsPerPx(points, imgW, imgH, unitsPerPx)`.
     **Use this — do not re-derive area math.** It already returns `null` for
     un-scaled / <3-point / missing-dim inputs (preserve "no scale ⇒ area-less save").
   - **The two create paths** (switch both onto `computeAreaFromUnitsPerPx` against
     `scale_units_per_px`, replacing `× scale_ratio`):
     - `src/hooks/useWorkbenchActions.ts` — the `computeLabelArea(input.points, dims.width, dims.height, input.sheet.scale_ratio)` call (workbench create path).
     - `src/hooks/useMapActions.ts` `saveNewUnitFromPopover` — the inline shoelace loop that does `area * sheet.scale_ratio` (live-map create path).
   - `src/utils/workbench.ts` `computeLabelArea` — currently `× scale_ratio`; decide
     whether to retire it in favor of `computeAreaFromUnitsPerPx` or rewrite its body
     to delegate (keep ONE area formula — don't leave two).
   - `src/components/UnitInspector.tsx` — already shows `computed_area` read-only; the
     place to surface the corrected SF more prominently (use `formatArea`).
   - `src/components/canvas/ScaleControl.tsx` — add the **"Recalculate areas on this
     drawing"** action to this popover (below the calibrate button).
   - The existing **unit-update mutation** in `src/hooks/useProjectQueries.ts` /
     `useMapActions.ts` — the sanctioned path to write `units.computed_area` (find how
     geometry/polygon updates already persist a `units` column; reuse it, don't add a
     parallel writer). The base-image natural dims are available in `FloorplanCanvas`
     as `originalWidth`/`originalHeight` (set by `PdfBaseLayer.onDimensionsReady`) —
     the SAME basis Phase 2's calibration used; Recalculate must load them once.

## Scope (build ONLY this)
1. **Corrected areas on save.** Switch BOTH create paths onto
   `computeAreaFromUnitsPerPx` using `sheets.scale_units_per_px` (not `scale_ratio`).
   Keep "no scale ⇒ area-less save" (the util already returns `null`). A **unit test**
   must prove the old (`× ratio`) vs new (`× units_per_px²`) results differ and the new
   one is dimensionally correct.
2. **"Recalculate areas on this drawing"** action in the scale popover: recompute
   `computed_area` for every `unit` on the active sheet from the current
   `scale_units_per_px` (load base-image dims once; iterate each unit's
   `polygon_coordinates`). Bulk write via the **existing unit-update path** (plain
   `units.computed_area` column update — NOT `status_logs`, NOT `pendingChanges`).
   **Show the affected count and confirm before writing** (owner is not a dev — a
   plain-English "This will update SF on N locations. Continue?"). Online-first.
3. **Surface SF** where the user works — at minimum the corrected number in
   `UnitInspector` (via `formatArea`), and consider the trace-complete popover / unit
   hover. Keep it read-only. Degrade cleanly on an un-scaled sheet (no SF, don't show 0).

**Nothing else.** No measuring tool (Phase 4), no verify (Phase 5), no live overlay
(Phase 5b), no cost codes (Phase 6+), no migration, no backfill beyond the explicit
Recalculate press.

## First action / approval gate
- **No hard ⛔ gate** (no migration; the bulk write touches a plain `units` column via
  the established unit-update mutation). Still **confirm the affected count** with the
  user in the UI before firing Recalculate.
- **Confirm Phases 1 + 2 are on `main`** before building. If `feat/scale-measure-phase-2`
  (`e1ce54a`) isn't merged, STOP and tell the owner.
- Standard rule: **do not commit or push until the owner says "Approved."**

## Exit criteria (Definition of Done)
- `typecheck` + `test` + **`build`** green:
  ```
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
  ```
- A unit test pins old-vs-new area (dimensional correctness).
- Live `dev:3010` in **both** the workbench and the live map: calibrate/set a scale →
  trace a room → its SF is right; press **Recalculate** → existing rooms' SF refresh
  (with the confirm-count step); an un-scaled sheet still saves labels area-less and
  shows no wrong number.
- Close the phase with the **`verify-feature`** skill (Definition of Done → STOP). On
  approval, per [[post-approval-handoff-ritual]] draft the **Phase 4 kickoff**
  (standalone fractional measuring tool: `measure.ts` + `ToolMode 'measure'`).

## Guardrails specific to this phase
- **One area formula.** Everything routes through `computeAreaFromUnitsPerPx` — don't
  leave `computeLabelArea`'s old `× scale_ratio` body alive alongside it.
- **`scale_ratio` is legacy** — the area math stops trusting it. Don't delete the
  column (back-compat), just stop reading it for area.
- **Recalculate write path:** plain `units.computed_area` column update via the
  existing unit-update mutation — **NEVER** `status_logs` (§2) and **NEVER** the
  offline `pendingChanges` buffer. Online-first is intentional (matches the locations
  workstream's Phase 3/4 posture). Confirm the count first.
- **JSONB:** narrow `polygon_coordinates` with `isPercentPointArray` at the query
  boundary; no `Json` into props (§6).
- **Base-image natural dims** are the basis (`sheets.base_image_url`), same as Phase 2's
  calibration and the existing create paths — load once for Recalculate, don't recompute
  per unit.
- **Lint is NOT a gate** (~1850 pre-existing problems) — verify with typecheck + test +
  build. **No E2E** — verify the canvas live on `dev:3010` (port 3010, not 3000).

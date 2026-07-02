# Kickoff — Scale, Measure & Production Rates, Phase 2: Scale tool UI in the dock (set + read the scale)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of Scale, Measure & Production Rates** (the scale tool UI: a ruler button in the canvas dock that lets a user **set** a drawing's scale by picking an architectural preset OR drawing a calibration line, and **read** the current scale back). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-30 - Scale Measure Production Rates Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Scale-Measure-Production-Rates-Plan.md` (**Phase 2**, "Build-on inventory", "Data model", "Hard guardrails")
> - `sitepulse-next/AGENTS.md`
>
> Work on a fresh **`feat/scale-measure-phase-2`** branch cut off `main`. **First confirm Phase 1 is on `main`** — if `feat/scale-measure-phase-1` (commit `db9a7cf`: `src/utils/scale.ts`, the three `sheets.scale_%` type columns, `ScaleCalibration`/`isScaleCalibration`) hasn't merged yet, STOP and tell me (Phase 2 imports `scale.ts` + the new types — it can't build without them). Build the **2a slice first** (button + popover + preset + readout + persistence, no drawing), verify it, then **2b** (the calibration-line drawing interaction). Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English summary
This phase gives the user the first thing they can actually *touch*: a small ruler
button on the floor-plan that opens a popover where they either pick a standard
architectural scale (¼"=1', ⅛"=1', …) or "calibrate" by drawing a line over a
dimension they know the real length of and typing it in. The popover also shows the
current scale in plain words ("Calibrated: 1 px = 0.025 ft" / "Scale: ¼" = 1'
(approx)" / "Not set"). After this, the drawing knows its real-world scale — but the
square-footage **numbers don't change yet** (that's Phase 3). This phase only *sets
and reads* the scale.

## Where Phase 1 left off (what you're building on)
- **Phase 1 shipped the math + types** (`feat/scale-measure-phase-1`, commit
  `db9a7cf`, owner-approved). On `main` once merged you have:
  - `src/utils/scale.ts` — `ARCH_SCALE_PRESETS`, `pixelDistance`,
    `unitsPerPxFromCalibration`, `presetUnitsPerPx`, `parseFeetInches`,
    `formatFeetInches`, `computeAreaFromUnitsPerPx`, `formatArea`,
    `ESTIMATED_RENDER_DPI`. **Use these — do not reinvent any scale math.**
  - `sheets` columns typed in `database.types.ts`: `scale_units_per_px`,
    `scale_unit`, `scale_calibration` (all already LIVE on prod).
  - `ScaleCalibration` type + `isScaleCalibration` guard in `domain.ts`.
- **The DB columns are already live** — no migration in Phase 2 either.

## Required reading (in order)
1. `sitepulse-next/AGENTS.md` — esp. §2 (extend the established Query hooks; never
   `useState`/`useEffect` for server data; `useHydratedStore` for persisted Zustand),
   §3 (the `FloorplanCanvas` tool/draft lifecycle + native-event isolation), §6
   (narrow JSONB at the query boundary — `isScaleCalibration` — no `Json` into props).
2. `Scale-Measure-Production-Rates-Plan.md` — **Phase 2**, "Build-on inventory"
   (the exact files to reuse), "Data model" (the `scale_calibration` JSONB shape).
3. The current source, read FRESH (line numbers drift):
   - `src/components/canvas/ViewportControls.tsx` — the shared top-left dock (Reset +
     zoom). The **ruler/scale button** goes here; match `ZoomIndicator`/dock styling.
     It mounts once via `FloorplanCanvas`, so it appears in **both** the live map and
     the workbench — verify both.
   - `src/hooks/useProjectQueries.ts` — **`updateSheetScaleMutation`** (today writes
     only `scale_preset` + `scale_ratio`). **Extend THIS mutation** to also write
     `scale_units_per_px` / `scale_unit` / `scale_calibration`. Do NOT add a parallel
     mutation. Keep the optimistic `sheets` cache update.
   - `src/store/useMapStore.ts` — the `ToolMode` union + `setToolMode` (2b adds
     `'calibrate'`).
   - `src/components/FloorplanCanvas.tsx` — the draw click path, `draftPoints` /
     pending state, `getSnappedCoordinate` inline call, the loupe, and the
     `toolMode`-change reset `useEffect` (2b reuses ALL of this for the 2-point line).
   - `src/components/canvas/DraftPolygon.tsx` — the in-progress drawing render (a
     2-point calibration line is the simplest case).
   - `src/components/SettingsMenu.tsx` — the existing per-project preset dropdown +
     custom-ratio input (the legacy entry point; decide whether to keep it — default
     = keep both).

## Scope (build ONLY this) — ship 2a, verify, then 2b

### 2a — Button + popover + preset + readout + persistence (NO drawing)
1. **Ruler button** in `ViewportControls.tsx` → a small glass popover (match
   `ZoomIndicator`/dock styling — Tailwind only, no custom CSS).
2. Popover contents:
   - A **Preset dropdown** built from `ARCH_SCALE_PRESETS`. Choosing one →
     `presetUnitsPerPx(realFeetPerPaperInch)` → persist. Label the readout "(approx)".
   - A **current-scale readout**: `Not set` / `Scale: ¼" = 1' (approx)` (preset) /
     `Calibrated: 1 px = 0.0250 ft` (calibration). Read from the active sheet.
   - A **Calibrate** button (in 2a it can be present-but-disabled or wired in 2b).
3. **Persist:** extend `updateSheetScaleMutation` to write `scale_units_per_px`,
   `scale_unit: 'ft'`, `scale_calibration` (for the preset path:
   `{ p1, p2: canonical unit square, length, unit:'ft', source:'preset', preset:label,
   at: new Date().toISOString() }` — **caller stamps `at`, never `scale.ts`**), and
   keep legacy `scale_preset` / `scale_ratio` in sync for back-compat/display.
   Optimistic `sheets` cache update; narrow `scale_calibration` with
   `isScaleCalibration` at the query boundary if you read it back into props.

### 2b — Calibration-line drawing interaction
1. Add `ToolMode 'calibrate'` to `useMapStore`. Entering it lets the user place
   **exactly 2 snapped points** — reuse the `draw` click path +
   `getSnappedCoordinate` + the loupe; render the line via the `DraftPolygon` pattern.
2. After the 2nd point, prompt for the real length (feet-inches text input →
   `parseFeetInches`) → `unitsPerPxFromCalibration(p1, p2, baseImgW, baseImgH, ft)`
   → persist via the same extended mutation (`source:'calibration'`, `preset:null`).
   Use the **base image's natural pixel dimensions** (`sheets.base_image_url` basis,
   same as the area math) for `pixelDistance`.
3. **Clean up the tool mode like the others** (AGENTS.md guardrail + the
   [[drawing-tool-excellence]] pending-edit guard): extend the `toolMode`-change
   reset `useEffect` to clear calibration draft state, and honor Esc / existing
   cancel keys. Don't leak draft state into `'draw'`.

**Nothing else.** No area-bug fix (Phase 3), no measuring tool (Phase 4), no verify
(Phase 5), no migration.

## First action / approval gate
- **No hard ⛔ gate** (no migration — columns already live).
- **Confirm Phase 1 is on `main`** before building (Phase 2 imports `scale.ts` + the
  new types). If not merged, STOP and tell the owner.
- Standard rule: **do not commit or push until the owner says "Approved."**

## Exit criteria (Definition of Done)
- `typecheck` + `test` + **`build`** green (live components changed this time):
  ```
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
  ```
- Live `dev:3010` click-through in **both** the workbench and the live map: pick a
  preset → readout says "approx"; calibrate a line → readout says "calibrated";
  **reload → the scale persists** (it's in the DB).
- Close the phase with the **`verify-feature`** skill (Definition of Done → STOP).
  On approval, per [[post-approval-handoff-ritual]] draft the **Phase 3 kickoff**
  (corrected areas on save + "Recalculate areas" button + surface SF — the two area
  call sites switch onto `computeAreaFromUnitsPerPx`).

## Guardrails specific to this phase
- **Extend `updateSheetScaleMutation`, don't fork it.** One mutation writes all five
  scale fields. Keep the optimistic `sheets` cache update intact.
- **`scale.ts` is the only source of scale math** — import it; never re-derive
  ft/px, presets, or feet-inches parsing in a component.
- **Caller stamps `at`** (ISO string); `scale.ts` stays `Date.now()`-free.
- **New `'calibrate'` tool mode must be cleaned up** like the other modes (reset
  effect + cancel keys) and must respect the [[drawing-tool-excellence]] Phase-1
  pending-edit guard so it doesn't re-open the gesture-overlap bug class.
- **JSONB:** narrow `scale_calibration` with `isScaleCalibration` at any query
  boundary; no `Json` into props (AGENTS.md §6).
- **Lint is NOT a gate** (~1850 pre-existing problems) — verify with
  typecheck + test + build. **No E2E** — verify the canvas live on `dev:3010`.

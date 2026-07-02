# Kickoff — Scale, Measure & Production Rates, Phase 4: Standalone fractional measuring tool

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 4 of Scale, Measure & Production Rates** (a **measuring tool**: drop 2+ snapped points on a calibrated drawing and read the running length back in **fractional feet-inches** — ¼" / ⅛" / 1⁄16"). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-30 - Scale Measure Production Rates Phase 4 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Scale-Measure-Production-Rates-Plan.md` (**Phase 4**, "Pure logic to extract + unit-test" → `measure.ts`, "Build-on inventory", "Hard guardrails", the "Cross-plan sequencing" note)
> - `sitepulse-next/AGENTS.md`
>
> Work on a fresh **`feat/scale-measure-phase-4`** branch cut off `main`. **First confirm Phase 3 is on `main`** — Phase 4 reuses `pixelDistance` / `formatFeetInches` from `scale.ts` and reads the same `scale_units_per_px` + base-image basis Phase 3 fixed. If Phase 3 (merge `d570356`) isn't on `main`, STOP and tell me. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English summary
Phases 1–3 made square-footage real. Phase 4 adds the tool the field actually asks
for: **click two (or more) points on the drawing and read the distance** — a tape
measure. It reads out in **feet-and-inches to a chosen fraction** (¼" / ⅛" / 1⁄16"),
per segment and total for multi-point runs. It's **ephemeral** — nothing is saved;
it's a read-only measurement aid. It only works on a **scaled** sheet (needs
`scale_units_per_px`); on an un-scaled sheet it prompts the user to set a scale first.

## Where Phase 3 left off (what you're building on)
- **Phase 1** shipped the scale math in `src/utils/scale.ts` (incl. `pixelDistance`,
  `formatFeetInches`, `parseFeetInches`) — **reuse these; don't re-derive**.
- **Phase 2** shipped the scale tool (`ScaleControl.tsx`, `ToolMode 'calibrate'`, the
  2-point calibration line in `FloorplanCanvas`). The **measure tool mirrors the
  calibrate tool almost exactly** — a 2..N-point snapped polyline instead of a
  strict 2-point line. Copy that interaction wholesale.
- **Phase 3** (merge `d570356`) connected correct areas + fixed the **pixel-basis
  bug**: the canonical basis is the **`base_image_url` natural size**, loaded via the
  shared `src/utils/imageDimensions.ts` `loadImageDimensions(src)`. **Measure MUST use
  the same basis** — load base-image dims once and feed them to `lengthFt`, exactly
  like the area path. Do NOT measure against the on-canvas `originalWidth/originalHeight`
  (the pdf.js render size) — that's the basis mismatch Phase 3 just killed.
- **The DB columns are already live** — no migration in Phase 4 (nothing persists).

## Required reading (in order)
1. `AGENTS.md` — esp. §3 (canvas tool modes must be cleaned up on `toolMode` change +
   cancel keys; don't leak draft state), §2 (this tool writes NOTHING — no mutation,
   no `status_logs`, no `pendingChanges`), §6 (narrow JSONB; pure fns are
   `Date.now()`-free).
2. `Scale-Measure-Production-Rates-Plan.md` — **Phase 4**, the `measure.ts` bullet
   under "Pure logic to extract + unit-test", and the **"Cross-plan sequencing"** note
   (the new `'measure'` mode must respect the Drawing-Tool-Excellence pending-edit
   guard so it doesn't re-open the gesture-overlap bug class).
3. The current source, read FRESH (line numbers drift):
   - `src/utils/scale.ts` — reuse `pixelDistance`, `formatFeetInches`. Extend, don't fork.
   - `src/components/FloorplanCanvas.tsx` — the `'calibrate'` tool: `calibratePoints`
     state, the click-to-drop-snapped-point path (`getSnappedCoordinate` + loupe +
     `DraftPolygon`), the length prompt, the `toolMode`-reset effect, Esc/cancel. The
     measure tool is this pattern generalized to N points with a live readout.
   - `src/components/canvas/ViewportControls.tsx` — where the ruler (scale) button
     lives; the **measure button** goes here too.
   - `src/store/useMapStore.ts` — the `ToolMode` union (`'calibrate'` already added);
     add `'measure'` and its reset handling.
   - `src/utils/imageDimensions.ts` — `loadImageDimensions(base_image_url)`; the
     measure readout loads base-image dims ONCE (same basis as area/calibration).
   - `src/hooks/useSheetById.ts` usage in `ScaleControl` — how to read the active
     sheet's `scale_units_per_px` self-contained (works on map + workbench).

## Scope (build ONLY this)
1. **`src/utils/measure.ts` (+ `measure.test.ts`)** — pure, deterministic,
   `Date.now()`-free:
   - `lengthFt(points, imgW, imgH, unitsPerPx)` → `number | null` (sum of segment
     `pixelDistance × unitsPerPx`; supports 2..N points; `null` if un-scaled / <2 pts /
     missing dims).
   - `roundToFraction(ft, denom)` → `number` (snap to nearest 1/`denom` inch;
     `denom ∈ {4,8,16}`).
   - `formatFeetInchesFraction(ft, denom)` → `string` (e.g. `12'-6 1⁄4"`; reuse/extend
     `formatFeetInches`; handle inch **roll-up** — `11 16⁄16"` → next inch/foot, `12"`
     → next foot).
   - `verificationError(measuredFt, actualFt)` → `number | null` (signed percent error;
     `null` if `actual ≤ 0`). *(Phase 5 uses this — put it here now, test it now.)*
   - **Test the fraction rounding + roll-up HARD** (2-pt + multi-segment + each of
     ¼/⅛/1⁄16 + boundary roll-ups). This is where the correctness lives.
2. **Measure tool on the canvas** — a **measure button** in `ViewportControls.tsx` +
   `ToolMode 'measure'`. Drop 2..N snapped points reusing the `calibrate`/`draw` click
   path (`getSnappedCoordinate` + loupe + `DraftPolygon` polyline). **Live readout** of
   the running length in fractional feet-inches, with a **¼" / ⅛" / 1⁄16" selector**;
   show **per-segment + total** for multi-segment runs. Double-click / Esc ends the run;
   extend the `toolMode`-reset effect to clear measure state. **Ephemeral — nothing
   persists.** Desktop-mouse-primary (memory `nav-enhancement-desktop-only`).
3. **Degrade on an un-scaled sheet** — when `scale_units_per_px` is null, disable or
   annotate the tool and prompt "set a scale first" (point at the scale popover).

**Nothing else.** No verify-scale action (Phase 5), no live draw/edit overlay
(Phase 5b), no cost codes (Phase 6+), no persistence, no migration.

## First action / approval gate
- **No hard ⛔ gate** (nothing persists, no migration, no schema).
- **Confirm Phase 3 is on `main`** (merge `d570356`) before building.
- Standard rule: **do not commit or push until the owner says "Approved."**

## Exit criteria (Definition of Done)
- `typecheck` + `test` + **`build`** green:
  ```
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
  ```
- `measure.test.ts` covers 2-pt + multi-segment + each fraction + roll-up edges.
- Live `dev:3010` in **both** the workbench and the live map: on a **calibrated** sheet,
  measure a **known** dimension and confirm the readout matches reality at the selected
  fraction; switch fractions and confirm the rounding changes; an un-scaled sheet
  prompts to set a scale instead of showing a wrong number.
- Close the phase with the **`verify-feature`** skill (Definition of Done → STOP). On
  approval, per [[post-approval-handoff-ritual]] draft the **Phase 5 kickoff** ("Verify
  scale" — reuses `verificationError` + the measure interaction to report % error).

## Guardrails specific to this phase
- **Same pixel basis as Phase 3.** Measure against `base_image_url` natural size via
  `loadImageDimensions` — NOT `originalWidth/originalHeight` (pdf.js render). Mixing
  bases is the ~4× area bug Phase 3 fixed; don't reintroduce it in the ruler.
- **Reuse, don't fork:** `pixelDistance`/`formatFeetInches` (scale.ts), the calibrate
  click/snap/loupe/DraftPolygon path, `getSnappedCoordinate`. One measurement formula.
- **Tool-mode hygiene (§3):** `'measure'` must clear its draft state on `toolMode`
  change + Esc, like `'calibrate'`/`'draw'`; respect the Drawing-Tool-Excellence
  pending-edit guard (cross-plan note) so the new mode doesn't overlap other gestures.
- **Writes nothing (§2):** no mutation, no `status_logs`, no `pendingChanges`. Pure
  read-only overlay.
- **Pure fns Date.now()-free**; keep Query cache JSON-serializable (no class instances).
- **Lint is NOT a gate** (~1850 pre-existing). Verify with typecheck + test + build.
  **No E2E** — verify live on `dev:3010` (port 3010, not 3000).

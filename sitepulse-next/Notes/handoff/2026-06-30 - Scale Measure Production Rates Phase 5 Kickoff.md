# Kickoff — Scale, Measure & Production Rates, Phase 5: Verify a scale (confidence check)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 5 of Scale, Measure & Production Rates** (a **"Verify scale"** action: measure a *second* known dimension on a calibrated drawing, type its real length, and see the **percent error** — a confidence check that does NOT change the stored scale unless you re-calibrate). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-30 - Scale Measure Production Rates Phase 5 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Scale-Measure-Production-Rates-Plan.md` (**Phase 5**, the `measure.ts` `verificationError` bullet under "Pure logic", "Build-on inventory", "Hard guardrails", "Open decisions" → verify thresholds)
> - `sitepulse-next/AGENTS.md`
>
> Work on a fresh **`feat/scale-measure-phase-5`** branch cut off `main`. **First confirm Phase 4 is on `main`** — Phase 5 reuses `verificationError` from `measure.ts` and the calibrate/measure snapped-line interaction Phase 4 shipped. If Phase 4 (merge `ac4bb76`) isn't on `main`, STOP and tell me. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English summary
Phase 2 lets you set a scale (calibrate or preset); Phase 4 lets you measure. Phase 5
closes the loop on **trust**: draw a line over a *second* dimension you already know
the real length of (a different door, a grid bay, a dimension string on the sheet),
type that length, and the app tells you how far off the current scale is — as a
**percent error** with a clear green / amber / red verdict. It **doesn't silently
change** your scale; it just reports confidence. If the error is large, one click
**re-calibrates from that line** (reusing Phase 2's persist).

## Where Phase 4 left off (what you're building on)
- **`src/utils/measure.ts`** already exports **`verificationError(measuredFt, actualFt)`**
  → signed **percent** error `((measured − actual) / actual) × 100`, `null` when
  `actual ≤ 0`. It's already unit-tested (Phase 4). **Reuse it — don't re-derive.**
  Thresholds compare on `Math.abs(err)`.
- **`lengthFt` / `formatFeetInchesFraction`** (measure.ts) + **`parseFeetInches`**
  (scale.ts) give you the measured length + the typed-length parse. Reuse.
- **The measure/calibrate snapped-line interaction** in `FloorplanCanvas` is the model:
  a 2-point snapped line (`calibratePoints` pattern) or the N-point `measurePoints`
  pattern, `getSnappedCoordinate` + loupe + `DraftPolygon`, base-image dims via
  `loadImageDimensions`, cleaned up on `toolMode` change + Esc. Verify needs exactly a
  **2-point line** (like calibrate) + a typed real length.
- **`ScaleControl.tsx`** (the ruler popover) is where the **"Verify scale"** button
  goes, alongside Calibrate + Recalculate. **`useUpdateSheetScale`** is the persist for
  the optional "re-calibrate from this line" (do NOT fork it).
- **Base-image pixel basis** (`base_image_url` natural size via `loadImageDimensions`)
  is the ONLY basis — same as Phase 3/4. Don't measure against `originalWidth/Height`.

## Required reading (in order)
1. `AGENTS.md` — §3 (new/temporary canvas interaction state must be cleaned up on
   `toolMode` change + Esc; respect the Drawing-Tool-Excellence pending-edit guard),
   §2 (verify itself writes NOTHING; only the optional re-calibrate writes, through the
   existing `useUpdateSheetScale`), §6 (pure fns `Date.now()`-free; narrow JSONB).
2. `Scale-Measure-Production-Rates-Plan.md` — **Phase 5**, the `verificationError`
   bullet, and **"Open decisions" → verify thresholds** (default green ≤ 1% / amber ≤
   3% / red; owner-tunable — confirm with me at the start).
3. Current source, read FRESH (line numbers drift):
   - `src/utils/measure.ts` — `verificationError`, `lengthFt`, `formatFeetInchesFraction`.
   - `src/utils/scale.ts` — `parseFeetInches`, `unitsPerPxFromCalibration` (for the
     optional re-calibrate).
   - `src/components/canvas/ScaleControl.tsx` — where the Verify button + result UI live.
   - `src/components/FloorplanCanvas.tsx` — the `calibrate` / `measure` tool interaction
     to mirror (2-point snapped line, prompt, `toolMode`-reset effect, Esc/cancel).
   - `src/store/useMapStore.ts` — the `ToolMode` union (add a `'verify'` mode, OR reuse
     the calibrate interaction with a "verify vs set" intent flag — decide + justify).

## Scope (build ONLY this)
1. **A "Verify scale" flow** off the scale popover: the user draws a **2-point snapped
   line** over a second known dimension (reuse the calibrate/measure click+snap+loupe+
   `DraftPolygon` path against the base-image basis) and types its **real length**
   (`parseFeetInches`). Compute `measuredFt` via `lengthFt` and show:
   - measured vs actual (both in feet-inches, `formatFeetInchesFraction`),
   - **percent error** (`verificationError`) with a **green / amber / red** verdict
     (default ≤ 1% / ≤ 3% / else — confirm thresholds with the owner first).
2. **One-click "re-calibrate from this line"** when the error is large — reuses Phase 2's
   `unitsPerPxFromCalibration` + `useUpdateSheetScale` persist (the only write in this
   phase). Verify on its own changes **nothing** stored.
3. **Tool-mode hygiene:** whatever mode drives the verify line must clear its draft on
   `toolMode` change + Esc, like `calibrate`/`measure`; respect the pending-edit guard.
4. **Degrade on an un-scaled sheet:** there's nothing to verify — point the user at
   Calibrate instead (mirror the measure tool's disabled/annotated posture).

**Nothing else.** No live draw/edit overlay (Phase 5b), no cost codes (Phase 6+), no new
persistence beyond the optional re-calibrate, no migration.

## First action / approval gate
- **No hard ⛔ gate** (no migration, no schema; the only write reuses an existing mutation).
- **Confirm Phase 4 is on `main`** (merge `ac4bb76`) before building.
- **Confirm the verify thresholds** (green/amber/red %) with the owner at the start.
- Standard rule: **do not commit or push until the owner says "Approved."**

## Exit criteria (Definition of Done)
- `typecheck` + `test` + **`build`** green:
  ```
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
  ```
- A unit test pins the verdict banding (a % just under/over each threshold lands in the
  right bucket) on top of the existing `verificationError` tests.
- Live `dev:3010` in **both** the workbench and the live map: calibrate a sheet, then
  Verify against a *different* known dimension → sensible percent error + correct
  verdict color; "re-calibrate from this line" updates the stored scale and the readout.
- Close the phase with the **`verify-feature`** skill (Definition of Done → STOP). On
  approval, per [[post-approval-handoff-ritual]] draft the **Phase 5b kickoff** (live
  edge-length + area overlay while drawing/editing, toggleable via
  `mapSettings.showLiveMeasure` — reuses `lengthFt`/`formatFeetInchesFraction`/
  `computeAreaFromUnitsPerPx`).

## Guardrails specific to this phase
- **Reuse, don't fork:** `verificationError`/`lengthFt`/`formatFeetInchesFraction`
  (measure.ts), `parseFeetInches`/`unitsPerPxFromCalibration` (scale.ts), the calibrate/
  measure snapped-line interaction, `useUpdateSheetScale`. One measurement formula, one
  scale-write mutation.
- **Same pixel basis as Phase 3/4** — `base_image_url` natural size via
  `loadImageDimensions`, never `originalWidth/originalHeight`.
- **Verify writes nothing** (§2) — no mutation, no `status_logs`, no `pendingChanges`.
  Only the explicit "re-calibrate from this line" writes, via the existing mutation.
- **Tool-mode hygiene (§3):** clear draft state on `toolMode` change + Esc; respect the
  Drawing-Tool-Excellence pending-edit guard so the new interaction doesn't overlap other
  gestures.
- **Pure fns `Date.now()`-free**; Query cache stays JSON-serializable.
- **Lint is NOT a gate** (~1850 pre-existing). Verify with typecheck + test + build.
  **No E2E** — verify live on `dev:3010` (port 3010, not 3000).

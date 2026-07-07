# Kickoff — Codebase Health Slice 2 / FloorplanCanvas Decomposition, Phase 7: extract scale-calibration + measure → `useMeasureTools`

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 7 of the FloorplanCanvas Decomposition** (Codebase Health Slice 2, target 1) —
> extract the scale-calibration tool (2-point line → real-length prompt → `sheets` scale write) and
> the fractional measure tool (running polyline + readout) into a new `src/hooks/useMeasureTools.ts`
> hook. **Behavior-preserving; a pure move, no user-visible change.** Read these in full, then
> follow them:
> - `sitepulse-next/Notes/handoff/2026-07-06 - Codebase Health Slice 2 FloorplanCanvas Phase 7 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/FloorplanCanvas-Decomposition-Plan.md` (Phase 7 + the guardrails)
> - `sitepulse-next/AGENTS.md` (esp. §3 canvas engine, §6 TypeScript)
>
> Branch `feat/codebase-health-slice2-phase-7` off `main` (the slice-2 chain through Phase 6 is
> merged — Phase 6 landed a43778a). Build **only Phase 7**. Keep `FloorplanCanvas`'s behavior +
> public prop surface byte-identical; the golden-master test (`src/components/FloorplanCanvas.test.tsx`)
> must stay green. **The `useUpdateSheetScale` write inside `submitCalibrate` stays byte-identical**
> (a `sheets` update, NOT a status write). Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English goal
Two sibling tools share the "click points on the drawing" pattern: **calibrate** drops a 2-point
line across a known dimension, asks for its real length, and saves the sheet's scale (that's what
makes square-footage and the measure tool work); **measure** drops an ephemeral polyline and shows
its running real-world length with a fraction-precision picker, persisting nothing. Today both sit
inside `FloorplanCanvas.tsx`. This phase lifts them into one hook file. Nothing the user sees
changes — same 2-click calibrate → length prompt → SF recompute, same measure readout.

## Why this phase exists / where it sits
Seventh phase of **Slice 2, target 1**. Phases 1–6 are DONE + merged (`canvasLayout.ts`,
`useCanvasViewport`, `useCanvasSnapping`, `useGeometryGestures`, `useTraceTool`, `useStampTool`);
the file is at ~1,917 lines. Last of the three tool extractions (trace → stamp → **measure**).
Follow `useTraceTool.ts` / `useStampTool.ts` as templates — the seams are identical: tool-branch
handlers called from the component's routing chain, `[toolMode]` reset effects moved with the
state they clear, stable clear-callbacks + sync refs for the window keydown effect (which stays
in the component until Phase 8).

## The exact scope — build only this
Move both tools into a NEW `src/hooks/useMeasureTools.ts`. **Re-read the real file first — line
numbers WILL have drifted.** What moves (names verified post-Phase-6):

- **Calibrate state + sync refs (~336–343):** `calibratePoints`/`calibratePointsRef`,
  `calibratePrompt`/`calibratePromptRef`, `calibrateInput`, `calibrateError`. Preserve the
  ref-sync pattern verbatim (the keydown Esc ladder reads the refs).
- **Measure state (~345–358):** `measurePoints`/`measurePointsRef`, `measureDenom`
  (`FractionDenominator`, kept across runs), `measureBasis`.
- **Tool-change resets (~512–516):** the calibrate line AND the measure line of the reset effect —
  move each into the hook as `[toolMode]` effects, exactly like Phases 5/6 moved theirs.
- **Measure-basis load effect (~535–551):** loads the base image's NATURAL dims on entering
  measure mode (falls back to on-canvas dims). Needs `activeSheet?.base_image_url` +
  `originalWidth`/`originalHeight` passed in. Reuse `loadImageDimensions` — never fork.
- **Stage-click branches:** the `calibrate` (~994–1011) and `measure` (~1012–1024) branches of
  `handleStageClick` as `handleCalibrateClick(pctX, pctY)` / `handleMeasureClick(pctX, pctY)`.
  ⚠️ Same routing lesson as Phases 5/6: the else-if CHAIN keeps its conditions in the component
  (preserves the final-else legend-deselect fallthrough); both handlers consume
  `effectiveSnapping` + `lastSnapRef` (component-owned, shared with draw — pass the ref in).
- **`cancelCalibrate` (~1060) + `submitCalibrate` (~1077–1106):** move verbatim. ⚠️ **The
  `useUpdateSheetScale` write stays byte-identical** — it measures against the base image's
  natural pixel size (the same basis the area math uses; the ~4× pixel-basis fix lives here).
  Reuse `parseFeetInches` / `unitsPerPxFromCalibration` from `utils/scale` — never fork. Keep
  `useSheetById`/`useUpdateSheetScale` mounted in the component and pass `activeSheet` + the
  mutation in (or move the calls into the hook — derive from what's actually used; smallest move
  wins).
- **Keyboard Esc branches (~749–761) STAY** in the window keydown effect (Phase 8's job) — they
  read `calibratePointsRef`/`calibratePromptRef`/`measurePointsRef` and clear state; have them
  consume the hook's returned refs + stable clear callbacks (the `clearDraft` pattern from
  Phase 5). Keep the effect's dep array byte-identical.
- **Consumer wiring stays mounted in the component, fed from hook returns:** the calibrate
  popover JSX (~1296–1357: prompt/input/error + Enter/Esc handlers calling
  `submitCalibrate`/`cancelCalibrate`), the measure panel (~1359–1431: fraction picker
  `measureDenom`/`setMeasureDenom` + `MeasureReadout` + Clear), and the two `DraftPolygon`
  mounts (~1820 calibrate, ~1835 measure). The shared onMouseMove snap branch (~1630, gates on
  draw/calibrate/measure) also stays in the component.

**No callback props are involved this time** — the only write is `useUpdateSheetScale` (a
`sheets` update). The golden master has no `:calibrate`/`:measure` guard, but it must stay green
untouched (the shared chain/refs are its territory).

## Hard guardrails (AGENTS.md — do not violate)
- **Behavior-preserving.** Same calibrate flow, same measure readout, same Esc backouts. Any
  visible difference = STOP, bug.
- **Public surface frozen.** `FloorplanCanvasProps` + `useImperativeHandle` byte-identical.
- **Golden master is sacred.** `src/components/FloorplanCanvas.test.tsx` stays green, untouched.
- **Reuse, never fork** — `parseFeetInches`, `unitsPerPxFromCalibration`, `loadImageDimensions`,
  `FRACTION_LABELS`, the `measure.ts` math, `snapPoint` are called, not re-implemented.
- **The scale write path is the canvas's ONLY direct write** — keep it a `sheets` update keyed
  off the sheet's own `project_id`; nothing touches `status_logs`/the offline queue.
- **No `any`, no `@ts-nocheck`.** No DB / RLS / auth / schema / offline-queue changes.

## Exit criteria (Definition of Done → then STOP)
- `typecheck` + `test` + `build` all green; **golden master green**.
- `dev:3010` click-through (desktop only): calibrate a 2-point line → length prompt (Enter
  submits, Esc cancels, bad input errors) → SF recomputes; measure polyline reads correctly with
  fraction switching + Clear; Esc backout ladder (half-placed calibrate line / measure run →
  clear, then tool → pan) intact. ⚠️ The dev server points at the PROD database and calibration
  WRITES `sheets.scale_units_per_px` — verify ONLY on a Sandbox project sheet (its scale is
  scratch; Sandbox Project → Level 2 was used for Phase 6). Never calibrate a real project's
  sheet.
- Close with the `verify-feature` skill. **Do not commit or push until the owner says "Approved."**
- On approval, per the post-approval handoff ritual: draft the **Phase 8 (`useCanvasKeyboard`)**
  kickoff + paste its launch prompt.

## Verification commands
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
**Lint is NOT a gate.** ⚠️ a `next build` corrupts a running `dev:3010` server → restart via
`scripts/restart-dev.ps1`.

## Next after this
Phase 8 — extract the window keydown/keyup/blur + container-size effect (`useCanvasKeyboard`,
consuming all the tool hooks' returns). Then recolor → render split (see the plan-of-record).
Line-count trajectory so far: 2,749 → 2,710 (P1) → 2,369 (P2) → 2,336 (P3) → 2,156 (P4) →
2,063 (P5) → 1,917 (P6).

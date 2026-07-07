# Kickoff — Codebase Health Slice 2 / FloorplanCanvas Decomposition, Phase 10: render split + final thinning (close the slice, re-measure, STOP)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 10 of the FloorplanCanvas Decomposition** (Codebase Health Slice 2, target 1;
> the FINAL phase) — split the JSX `<Stage>` layers into small layer sub-components
> (`CanvasBaseLayer` / `CanvasUnitsLayer` / `CanvasOverlayLayer` in `src/components/canvas/`),
> group the outside-Stage chrome, and leave `FloorplanCanvas` a thin coordinator that composes
> the Phase 1–9 hooks/utils + the layer components. **Behavior-preserving; a pure move, no
> user-visible change.** Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-06 - Codebase Health Slice 2 FloorplanCanvas Phase 10 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/FloorplanCanvas-Decomposition-Plan.md` (Phase 10 + the guardrails)
> - `sitepulse-next/AGENTS.md` (esp. §3 canvas engine, §5 snapping/RBush, §6 TypeScript, §9 testing)
>
> Branch `feat/codebase-health-slice2-phase-10` off `main` (the chain through Phase 9 is merged —
> Phase 9 landed 22a6fcf). Build **only Phase 10**. Keep `FloorplanCanvas`'s behavior + public
> prop surface + `useImperativeHandle` (`exportFullImage`, `zoomToFit`) byte-identical; the
> golden-master test (`src/components/FloorplanCanvas.test.tsx`) must stay green, untouched.
> After the split, re-measure the line count, do the FULL `dev:3010` regression pass, close with
> `verify-feature`, then STOP — Slice 2 re-evaluates before any further target. Don't commit or
> push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English goal
The canvas file's logic now lives in nine extracted hooks/utils, but the drawing markup — the
three Konva layers (background drawing, room polygons, editing previews) plus all the floating
chrome (loading chips, popovers, toolbars, overlays) — is still one ~750-line JSX block. This
last phase moves that markup into small named sub-components so `FloorplanCanvas` becomes a thin
coordinator: hooks at the top, a short readable render at the bottom. Nothing on screen changes;
the payoff is the next canvas feature edits one small file, and the whole Slice-2 target is done.

## Why this phase exists / where it sits
Tenth and FINAL phase of **Slice 2, target 1**. Phases 1–9 are DONE + merged (`canvasLayout`,
`useCanvasViewport`, `useCanvasSnapping`, `useGeometryGestures`, `useTraceTool`, `useStampTool`,
`useMeasureTools`, `useCanvasKeyboard`, `canvasRecolor`); the file is at 1,771 lines, roughly
~940 of setup/hooks + ~830 of render. After this phase the slice **re-evaluates** (continue to
`useProjectQueries`/`SettingsMenu` or return to features) — that's an owner decision, not yours.

## The exact scope — build only this
**Re-read the real file first — line numbers WILL have drifted.** Anchors verified post-Phase-9:

- **The `<Stage>` layers (~1222–1697) → three sub-components** in `src/components/canvas/`:
  - **`CanvasBaseLayer`** (~1433–1464): the `listening={false}` PDF/raster layer —
    `PdfBaseLayer` (active sheet) or the legacy `KonvaImage` fallback.
  - **`CanvasUnitsLayer`** (~1467–1512): the `visibleUnits.map → MappedUnit` block. The prop
    list is huge — pass it through UNCHANGED (note `activeStatuses={displayStatuses}` and
    `lagMode={lagMode || makeReadyMode}` — Phase 9's recolor feed; don't "simplify" either).
  - **`CanvasOverlayLayer`** (~1518–1696): the ephemeral previews/editing chrome —
    tool-gated `DraftPolygon` mounts, `PendingPolygon`, gridline/opening overlays,
    `WalkRouteOverlay`, capture overlays, `StampPreview`. ⚠️ This `<Layer>` carries
    `ref={overlayLayerRef}` (the magnifier loupe composites the live trace from it) — the
    sub-component must keep that ref wired to the actual Konva `Layer` node.
  - Each sub-component renders a `<Layer>` (react-konva components compose fine inside
    `<Stage>`); keep mount ORDER identical (base → units → overlay). Type the props
    explicitly (§6) — expect wide prop interfaces; that's fine, this is a move not a redesign.
- **The `<Stage>`'s inline handlers stay in the component** (onClick/onWheel/onDblClick/
  onPointerDown/onPointerUp/onMouseMove, ~1222–1432): they are ROUTING over component-owned
  state (`boxOrigin`, `pendingRoute`, `activeRouteDrag`, `pointerStore`) and hook returns —
  the routing-seam precedent from Phases 5–7. Moving them buys nothing and risks the gates.
- **Group the outside-Stage chrome** (~959–1220 and ~1701–end) only where it's a clean lift
  (e.g. the PDF loading/sharpening/error overlays could become one small `CanvasPdfStatus`
  component). The calibrate popover + measure panel read many hook returns — leave them inline
  if extraction means threading 15 props for no gain. **Judgment call, bias to less:** the goal
  is a READABLE coordinator, not maximum extraction.
- **Re-measure and confirm:** line count of `FloorplanCanvas.tsx` (trajectory below), prop
  surface + `useImperativeHandle` unchanged (parents `page.tsx` / `WorkbenchTracer` compile
  untouched). The plan says "if a hook is still oversized, split it" — flag it in the DoD
  report instead of doing it; the slice re-evaluation decides.

## Hard guardrails (AGENTS.md — do not violate)
- **Behavior-preserving.** Every pixel, gesture, and mount order identical. Any difference = STOP, bug.
- **Golden master is sacred.** `src/components/FloorplanCanvas.test.tsx` stays green, untouched.
  (It mocks at module level, so components moving into children keeps the same mocks — if a
  mock path ever seems to need editing, slow down and reconsider the split instead.)
- **Public surface frozen.** `FloorplanCanvasProps` + `useImperativeHandle` byte-identical.
- **Preserve the ref-sync pattern verbatim** — refs feed the keyboard hook + Konva's
  synchronous `dragBoundFunc`; the layer split must not convert live-read refs to props-in-time.
- **RBush/`Map`/`Set` stay OUT of Query/IDB state** (§5); no store migrations; no DB / RLS /
  auth / schema / offline-queue changes (§2).
- **No `any`, no `@ts-nocheck`.** New sub-components fully typed, `.tsx`, `"use client"` as needed.

## Exit criteria (Definition of Done → then STOP — the slice closes here)
- `typecheck` + `test` + `build` all green; **golden master green, untouched**.
- **Full `dev:3010` regression pass** (desktop, the "Test" project has mapped units on Level 2):
  draw (click-trace + box-drag), edit (node drag / whole-drag / flip / rotate / vertex
  insert+delete), stamp (armed + selected-room), measure + calibrate, pan/zoom/mini-map/loupe,
  Lag Mode + Make-Ready recolor toggles, keyboard ladder (Esc/Enter/arrows/Ctrl+Z/1-2-3/M),
  and a workbench (`/workbench/[sheetId]`) trace with opening tags.
- Report the final line count + the before/after structure (hooks composed, layers mounted).
- Close with the `verify-feature` skill. **Do not commit or push until the owner says "Approved."**
- On approval: archive this kickoff, mark Phase 10 done in the plan, and present the **Slice 2
  re-evaluation** (per the master plan: continue to `useProjectQueries` / `SettingsMenu`, or
  return to features) as an owner decision — do NOT auto-start a next phase.

## Verification commands
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
**Lint is NOT a gate.** ⚠️ a `next build` corrupts a running `dev:3010` server → restart via
`scripts/restart-dev.ps1` (repo root).

## Next after this
Nothing is queued. Slice 2 target 1 is complete; the re-evaluation (other god files vs. back to
features — e.g. the planned Navigation/UI-Polish interleave or the Unified Schedule Engine) is
the owner's call at the DoD report.
Line-count trajectory: 2,749 → 2,710 (P1) → 2,369 (P2) → 2,336 (P3) → 2,156 (P4) → 2,063 (P5)
→ 2,051 (P6) → 1,984 (P7) → 1,814 (P8) → 1,771 (P9) → target: a thin coordinator.

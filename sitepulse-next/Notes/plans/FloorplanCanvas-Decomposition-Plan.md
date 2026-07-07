# FloorplanCanvas Decomposition — break the 2,704-line canvas into a thin coordinator + focused hooks (self-contained build plan)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: `Notes/plans/Codebase-Health-Refactor-Master-Plan.md` (this is **Slice 2, target 1**).

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants — esp. §2 sync, §3 canvas engine, §5 snapping/RBush, §6 TS) + the parent master plan.
2. Re-read the files named below **fresh** — do NOT trust line numbers; they drift every phase (this file itself shrinks as phases land).
3. Build the phases **in order** — the ordering IS the dependency graph (layout → viewport → snapping → gestures → tools → keyboard → recolor → render). Each hook may consume already-extracted ones; extracting out of order creates churn.
4. Verify after each phase (§ Verification commands). Close each phase with the **`verify-feature`** skill (Definition of Done → stop; do not commit/push until the owner says "Approved").
5. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence plain-English summary; explain jargon in passing; keep it short.

## Goal
When this is done, `FloorplanCanvas.tsx` is a **thin coordinator** (~a few hundred lines) that composes a handful of focused, individually-testable hooks (`useCanvasViewport`, `useCanvasSnapping`, `useGeometryGestures`, `useTraceTool`, `useStampTool`, `useMeasureTools`, `useCanvasKeyboard`) plus a couple of pure `src/utils/*` helpers (`canvasLayout`, `canvasRecolor`) and small layer sub-components — with the **exact same on-screen behavior and the exact same public prop surface** it has today. Nothing the user sees changes; the payoff is that the next canvas feature touches one small hook instead of a 2,700-line file, and the load-bearing math is unit-tested.

## Locked product decisions (from the owner)
- **Full decomposition (2026-07-06):** commit to the whole phase set below (not just the pure-math slices), driving `FloorplanCanvas` down to a thin coordinator + focused hooks. (Owner picked "Full decomposition" over "first batch then re-evaluate.")
- **Behavior-preserving, proven by the Slice 0 net** — every phase is a pure move/rename; if the user would see any difference, that's a bug, stop. The Phase 0.4 characterization test (`src/components/FloorplanCanvas.test.tsx`, the "golden master") + the 0.2 hook contracts + a `dev:3010` click-through are the proof each phase is safe.
- **No new features, no behavior changes, no DB/RLS/auth/schema changes** (Slice 2 is presentation-/structure-layer only).

## Out of scope / deferred
- **The OTHER Slice-2 god files** — `useProjectQueries.ts` (1,503) and `SettingsMenu.tsx` (1,230). The master plan says "re-evaluate after FloorplanCanvas"; this plan owns ONLY `FloorplanCanvas.tsx`.
- **Phase 0.5 Playwright smoke** — still OPTIONAL + ⛔ owner-gated. Do NOT add `@playwright/test` unprompted. jsdom can't drive the real canvas, so a *visual* canvas regression is caught by the `dev:3010` click-through, not by RTL.
- **Fixing the flagged latent bugs** (the Slice-1 StatusTable "Actual-Completed null-log" crash; the fill-room naming popover bug) — those are behavior fixes, not this refactor. Leave them exactly as-is (preserve current behavior, `!`-guards and all).
- **Any change to the geometry-persist semantics** — flip mirrors about bbox mid-x/mid-y, rotate is aspect-corrected 90° about the centroid, non-finite → no save, delete floor-of-3, capture-time behavior — all frozen by the golden master. Moving the code must not alter the result.

## Data model
**No schema changes.** `FloorplanCanvas` READS units/statuses/activities/dependencies/sheet via existing hooks (`useUnits`, `useActivities`, `useActivityDependencies`, `useSheetById`, `useSnappingVectors`, `useLoupeRenderer`) and WRITES geometry **only through its callback props** (`onUpdateUnitPolygon`, `onPolygonComplete`, `onInstantStamp`, `onStampWithNaming`, `onInstantStampShape`, `onPendingPolygonMove`, `onAddNodeToSegment`) — the PARENT (`page.tsx` map / `WorkbenchTracer`) wires those to the real mutation hooks. **The only direct write the canvas itself performs is `useUpdateSheetScale` (scale calibration)** — that path stays byte-identical (it is a `sheets` update, NOT a `status_logs` write). The decomposition touches **none** of: the offline mutation queue, `pendingChanges`, `status_logs` / `upsert_status_log`, `client_timestamp`, RLS, or auth.

## Build-on inventory (read these fresh before using)
- `src/components/FloorplanCanvas.tsx` — the file under decomposition. Note the **ref-sync pattern**: dozens of `const xRef = useRef(x); useEffect(() => { xRef.current = x }, [x])` pairs feed the window-level keydown handler and Konva's synchronous `dragBoundFunc`. **This pattern is load-bearing — preserve it verbatim when code moves into a hook.** (The golden master + the live snap ring both depend on refs holding the freshest value.)
- `src/components/FloorplanCanvas.test.tsx` — **the Phase 0.4 golden master.** Run it after every phase; it is the tripwire for the geometry gestures. If a phase legitimately needs to touch it (e.g. a mock path moves), that is a signal to slow down — prefer keeping it untouched.
- `src/utils/viewport.ts` (`classifyWheelIntent`, `clampStagePosition`, `createViewportSync`, `dampToward`) — the viewport pure math ALREADY exists + is tested. Phase 2 REUSES it; extend `viewport.test.ts` only for genuinely-new extracted math.
- `src/utils/geometry.ts` (`getCentroid`, `getSnappedCoordinate`, `isFinitePolygon`, `mixAlpha`, `distToSegment`, `nearestCentroidWithin`), `src/utils/stampTransform.ts` (`flipPolygon`, `rotatePolygon`, `buildStampPolygon`, …), `src/utils/editHistory.ts`, `src/utils/polygonValidity.ts`, `src/utils/measure.ts`, `src/utils/scale.ts`, `src/utils/pointerStore.ts`, `src/utils/gridAwareSnap.ts`, `src/utils/cursor.ts` — all the pure math the canvas leans on. **REUSE, NEVER FORK.** Hooks call these; they don't re-implement them.
- `src/utils/progressAnalytics.ts` (`computeUnitVariance`, `varianceFill`, `orderedTrackActivities`) + `src/utils/activityReadiness.ts` (`unitMakeReady`, `makeReadyFill`, `slotKey`) + `src/utils/applicability.ts` — the lag / make-ready recolor math. **NEVER FORK** (AGENTS §3). Phase 9 extracts the *wiring* into a pure helper that CALLS these; it does not re-derive variance.
- `src/store/useMapStore.ts` / `useUIStore.ts` / `useSettingsStore.ts` (+ `useHydratedStore`) — global UI state; keep reading from these, don't migrate anything into them.
- The child canvas components already split out: `MappedUnit`, `DraftPolygon`, `PendingPolygon`, `StampPreview`, `StampDrawer`, `MeasureReadout`, `ContextActionDock`, `MapLegend`, `MiniMapOverlay`, `LoupeOverlay`, `CrosshairOverlay`, `CanvasContextMenu`, `PdfBaseLayer`, the overlays — these are the existing modular seam; the render split (Phase 10) groups their mounting, it does not rewrite them.

## Pure logic to extract + unit-test
Framework-free, deterministic functions (no `Date.now()` inside — pass timestamps IN):
- **`src/utils/canvasLayout.ts`** (Phase 1) — `computeLayout(stageW, stageH, imgW, imgH) → { offsetX, offsetY, drawW, drawH, stageW, stageH }`; `computeVisibleBox(layout, stagePosition, stageScale, dimensions) → box | null`; `cullVisibleUnits(units, box, layoutDrawW, toolMode) → Unit[]`. Co-located `canvasLayout.test.ts` pins the exact pixel↔percent mapping the golden master assumes.
- **`src/utils/canvasRecolor.ts`** (Phase 9) — `recolorForLag(activeStatuses, rawStatuses, units, activities, index, today)` and `recolorForMakeReady(...)` returning NEW status copies with `status_color` swapped. Pure orchestration over the existing `progressAnalytics` / `activityReadiness` functions (imported, never forked). Co-located test pins: N/A slots respected, empty inputs → passthrough, and that only the display copy is recolored (never the source array).
- Extend `src/utils/viewport.test.ts` only if Phase 2 pulls genuinely-new math out of the wheel/zoom handlers.

## Sub-phasing (ship + verify each)
> Ordering is the dependency chain. Each phase is one fresh session, behavior-preserving, closed with `verify-feature`. After EVERY phase: `npm run test -- src/components/FloorplanCanvas.test.tsx` must stay green (the golden master), plus the full gate below.

### Phase 1 — Extract pure layout + culling math → `src/utils/canvasLayout.ts` — ✅ DONE (e4f9274, Approved)
- **Scope:** Move the `layout` memo (928–947), `visibleBoundingBox` memo (951–963), and `visibleUnits` filter (965–983) into pure functions in `canvasLayout.ts` with a co-located test. `FloorplanCanvas` imports and calls them (state/memo wrappers stay in the component). Smallest, purest phase — establishes the extraction pattern and the highest test payoff. No hook yet.
- **Approval gates:** none (no DB/queue/UI-behavior change).
- **Exit criteria:** typecheck + test + build green · `canvasLayout.test.ts` covers the mapping the golden master assumes · golden master still green · `dev:3010`: floor plan renders, markers positioned correctly, culling on pan/zoom unchanged · `verify-feature`.

### Phase 2 — Extract the viewport/camera engine → `useCanvasViewport` — ✅ DONE (87399e3, Approved)
> Landed as `src/hooks/useCanvasViewport.ts` (flat hooks folder — decision resolved). Two seams: the
> component keeps a 3-line `handleZoom` wrapper (clears the context menu — component UI state), and the
> hook RETURNS `viewportSync` + `liveViewportRef` because the Stage's drag handlers (Phase 4 territory)
> write through them. No new pure math fell out — `viewport.test.ts` unchanged. FloorplanCanvas 2,709 → 2,368 lines.
- **Scope:** Move `stageScale`/`stagePosition` state + `liveViewportRef` + `viewportSync`, the wheel path (`handleWheel`, `cancelSmoothWheel`, `stepSmoothWheel`, and the `wheel*Ref`s), `animateViewport`, `handleZoom`, `resetView`, `zoomToFit`, `zoomToLevel`, and the mini-map helpers (`miniMapRecenter`/`miniMapPanTo`/`miniMapPanEnd`/`miniMapResize`) into `src/hooks/useCanvasViewport.ts`. The hook takes `stageRef` + `layout` + `dimensions` and returns `{ stageScale, stagePosition, handleWheel, animateViewport, zoomToFit, zoomToLevel, resetView, miniMap* }`. The `useImperativeHandle` (`exportFullImage`, `zoomToFit`) keeps exposing the same surface. REUSE `viewport.ts` math.
- **Approval gates:** none.
- **Exit criteria:** gate green · golden master green · `dev:3010`: mouse-wheel zoom (must stay wheel-zoom, not scroll-pan — [[users-are-mouse-wheel-primary]]), smooth-glide, double-click zoom, pan, fit-to-view, mini-map drag/resize all identical · `verify-feature`.

### Phase 3 — Extract snapping → `useCanvasSnapping` — ✅ DONE (6bf0402, Approved)
> Landed as `src/hooks/useCanvasSnapping.ts` (flat hooks folder). Also returns `gridAwareSnapping`.
> Takes the mapSettings snap fields + `magnifierActive` as primitives (same arg style as
> useCanvasViewport); the `aspect` quirk (a per-render `layoutRef.current` read, deliberately NOT
> a memo) moved verbatim into the hook body; RBush stays in hook `useState` (AGENTS §5). The hook
> call sits AFTER useCanvasViewport (snapPoint needs stageScale/layout). All consumers stayed in
> the component. AGENTS §5 + the useSnappingVectors doc comment now name the hook as the RBush
> home. FloorplanCanvas 2,368 → 2,335 lines.
- **Scope:** Move the `rawVectors → vectorTree` RBush build effect (307–328), `gridAwareSnapping` (333–334), `snapPoint` (1744), `effectiveSnapping` (482), and `aspect` (615) into `src/hooks/useCanvasSnapping.ts`. Returns `{ vectorTree, snapPoint, effectiveSnapping, aspect }`.
- **Approval gates:** none. ⚠️ **AGENTS §5 hard rule:** the `RBush` index MUST stay in the hook's `useState`/`useEffect` — **NEVER** put it in TanStack Query / IDB state (it crashes the persist serializer). Only the raw JSON vectors live in the Query cache; the hook instantiates RBush locally, exactly as today.
- **Exit criteria:** gate green · golden master green · `dev:3010`: trace snapping + snap ring behave identically on a sheet with detected vectors · `verify-feature`.

### Phase 4 — Extract geometry-edit gestures → `useGeometryGestures`  ★ golden-master phase — ✅ DONE (c299a6e, Approved)
> Landed as `src/hooks/useGeometryGestures.ts` (384 lines). All gesture handlers + the
> pending-edit history (seed/record/apply) moved verbatim; the window keydown effect
> reaches `nudgeSelected`/`undoRedoPendingEdit` through the component's callback refs;
> the refs passed in stay owned + synced by the component. Golden master 15/15 untouched.
> FloorplanCanvas 2,336 → 2,156 lines. (Note added at the Phase 5 close — the P4 close
> commit archived its kickoff but missed this annotation.)
- **Scope:** Move `handleFlip`, `handleRotatePolygon`, `handlePolygonDragEnd`, `handleAnchorDragEnd`, `handleAnchorClick`, the `add_node` branch of `handlePolygonClick`, `handleInsertPendingVertex`, `handleDeletePendingVertex`, `handleInsertSavedVertex`, `handlePendingPolygonEdit` + the `editHistory` seed/undo/redo wiring, and the arrow-nudge invocation into `src/hooks/useGeometryGestures.ts`. **The 4 callback prop signatures stay identical** (`onUpdateUnitPolygon`/`onPolygonComplete`/`onInstantStamp`/`onPendingPolygonMove`). Preserve every ref (`onUpdateUnitPolygonRef`, `unitsRef`, `selectedUnitIdsRef`, `pendingPolygonPointsRef`, `layoutRef`) and its sync effect verbatim.
- **Approval gates:** none. **This is the phase the Phase 0.4 golden master exists for** — it is the tripwire; treat any red as a real regression, not a test to edit.
- **Exit criteria:** gate green · **golden master green (all 15 gestures + the two guards)** · `dev:3010`: node move / whole-drag / arrow-nudge / flip / rotate / add-node / delete-node / insert-vertex all persist correctly on both map + workbench · `verify-feature`.

### Phase 5 — Extract the trace + box tool → `useTraceTool` — ✅ DONE (815d3e6, Approved)
> Landed as `src/hooks/useTraceTool.ts` (300 lines): draft state + sync refs, the draw
> click as `handleDrawClick(e, pctX, pctY)` — the `toolMode==='draw' && !isEditingPending`
> ROUTING gate stays in handleStageClick's else-if chain (preserves the final-else
> legend-deselect fallthrough) — `finishDrawing` + a separate `finishDrawingViaEnter`
> (keeps the distinct `:draw-enter` guard label; internal onPolygonCompleteRef, same
> pattern as Phase 4's onPendingPolygonMoveRef), stable `clearDraft`/`undoLastDraftVertex`
> for the keyboard, the box pointer handlers (full gates inside; `:box` stays a single-arg
> onPolygonComplete call), the opening hold-key effect + `armedOpeningType`, and the
> leave-draw reset. Seams: `boxOrigin`/`lastBoxEndRef`/`lastSnapRef` stay component-owned
> (shared with capture_box/capture_line/calibrate/measure); the window keydown EFFECT
> stays in the component but moved BELOW the tool-hook calls (deps byte-identical) so its
> draft branches consume the hook returns directly — extracting it is still Phase 8's job.
> FloorplanCanvas 2,156 → 2,063 lines.
- **Scope:** Move `draftPoints`/`draftOpeningEdges` state + refs, the `draw` branch of `handleStageClick`, `finishDrawing`, the box `onPointerDown`/`onPointerUp` handlers, the draw-Enter handling, and the opening hold-key effect (582–613) into `src/hooks/useTraceTool.ts`. `onPolygonComplete` args stay identical (golden master guards `:finish` / `:draw-enter` / `:box`). `DraftPolygon` stays a child, fed from the hook.
- **Approval gates:** none.
- **Exit criteria:** gate green · golden master green · `dev:3010`: click-trace → Enter/Finish, Shift-ortho, box-drag room, opening tags (workbench) all identical · `verify-feature`.

### Phase 6 — Extract the stamp tool → `useStampTool` — ✅ DONE (a43778a, Approved)
> Landed as `src/hooks/useStampTool.ts` (153 lines): the useMapStore stamp slice
> (stampTransform/rotate/flip/reset + armedStamp/clearArmedStamp — the hook
> subscribes itself), both stamp branches of handleStageClick as
> `handleArmedStampClick`/`handleUnitStampClick(pctX, pctY)` — the branch
> CONDITIONS stayed in the component's else-if chain (preserves the final-else
> legend-deselect fallthrough, same routing seam as Phase 5) — and the
> leave-stamp reset as its own `[toolMode]` effect. Wiring-guard labels
> preserved verbatim (incl. the historical `onInstantStamp:armed` on the
> onInstantStampShape path). `nameEachStamp` passed as a primitive arg
> (`!!mapSettings?.nameEachStamp`, same arg style as Phase 3); the R/H/V
> keydown branch stayed in the component's keydown effect (Phase 8's job),
> consuming the hook's returned rotateStamp/flipStamp; StampPreview +
> ContextActionDock stay mounted in the component fed from hook returns;
> StampDrawer untouched (talks to the store itself). FloorplanCanvas
> 2,063 → 1,917 lines.
- **Scope:** Move the `armedStamp`/`stampTransform` wiring, the two `stamp` branches of `handleStageClick` (armed-drawer + selected-room source), and the `StampPreview` wiring into `src/hooks/useStampTool.ts`. `onInstantStamp`/`onInstantStampShape`/`onStampWithNaming` args stay identical (golden master guards `:stamp`).
- **Approval gates:** none.
- **Exit criteria:** gate green · golden master green · `dev:3010`: stamp a selected room + an armed drawer stamp, rotate/flip-before-drop, "name each stamp" flow all identical · `verify-feature`.

### Phase 7 — Extract scale-calibration + measure → `useMeasureTools`
- **Scope:** Move `calibratePoints`/`calibratePrompt`/`calibrateInput`/`calibrateError` + `submitCalibrate`/`cancelCalibrate`, `measurePoints`/`measureDenom`/`measureBasis` + the `calibrate`/`measure` branches of `handleStageClick`, and the `MeasureReadout` + calibrate-popover wiring into `src/hooks/useMeasureTools.ts`. **The `useUpdateSheetScale` write inside `submitCalibrate` stays byte-identical** (a `sheets` update, not a status write).
- **Approval gates:** none.
- **Exit criteria:** gate green · golden master green · `dev:3010`: set scale via calibration line → real length prompt → SF recomputes; fractional measure tool reads correctly · `verify-feature`.

### Phase 8 — Extract keyboard shortcuts → `useCanvasKeyboard`
- **Scope:** Move the big keydown/keyup/blur effect (649–860) — Escape backout ladder, arrow-nudge, Ctrl/Cmd+Z pending-edit + draft-vertex undo/redo, Enter-to-finish, tool number keys (1/2/3), stamp R/H/V keys, magnifier M/`[`/`]` keys, `f`-to-fit, space-pan — plus the container `checkSize`/`resize` wiring into `src/hooks/useCanvasKeyboard.ts`. It CONSUMES the other hooks' refs/handlers, so it comes AFTER them. Highest-branch-count effect → deliberately late. Golden master guards `:arrow-nudge` / `:draw-enter` / the pending-undo path.
- **Approval gates:** none.
- **Exit criteria:** gate green · golden master green · `dev:3010`: every shortcut above fires identically; Esc ladder (magnifier → draft → tool → pan) intact; arrow-nudge + Ctrl+Z on a pending polygon work · `verify-feature`.

### Phase 9 — Extract the lag / make-ready recolor → `src/utils/canvasRecolor.ts`
- **Scope:** Move the `displayStatuses` memo body (248–298) into pure `recolorForLag` / `recolorForMakeReady` in `canvasRecolor.ts` (+ co-located test). The memo in `FloorplanCanvas` just calls them. Import `progressAnalytics` / `activityReadiness` / `applicability` — **never fork**; respect the `ApplicabilityIndex` (N/A slots excluded) exactly as today.
- **Approval gates:** none. **AGENTS §3 hard rule:** recolor happens ONLY on the display copies passed to renderers — never recolor `mapDisplayStatuses` and never write `status_logs.status_color`. The extracted fns return new objects; they must not mutate inputs.
- **Exit criteria:** gate green · golden master green · `canvasRecolor.test.ts` pins N/A handling + passthrough + no-mutation · `dev:3010`: Lag Mode + Make-Ready Mode recolor identically, and write paths (bulk dock / quick modals) still see the ORIGINAL colors · `verify-feature`.

### Phase 10 — Render split + final thinning (re-measure and stop)
- **Scope:** Split the JSX `<Stage>` layers into small sub-components (e.g. `CanvasBaseLayer` / `CanvasUnitsLayer` / `CanvasOverlayLayer`) and group the outside-Stage chrome, leaving `FloorplanCanvas` a thin coordinator that composes the Phase 2–9 hooks + the layer components. Re-measure the line count; if a hook is still oversized, split it. Confirm the prop surface and `useImperativeHandle` are unchanged.
- **Approval gates:** none.
- **Exit criteria:** gate green · golden master green · `FloorplanCanvas.tsx` down to a thin coordinator · full `dev:3010` regression pass (draw, edit, stamp, measure, pan/zoom, lag/make-ready, workbench) · `verify-feature`. **Then Slice 2 re-evaluates whether to proceed to `useProjectQueries` / `SettingsMenu` or return to features.**

## Hard guardrails (AGENTS.md — do not violate)
- **Behavior-preserving:** every phase is a move/rename. If the user would see a difference, STOP — it's a bug, not the plan.
- **Public surface frozen:** `FloorplanCanvasProps` and the `useImperativeHandle` (`exportFullImage`, `zoomToFit`) stay byte-identical every phase (the parent `page.tsx` / `WorkbenchTracer` wiring must keep compiling unchanged — Slice 1 typed `page.tsx`, so a mis-wired prop now fails typecheck).
- **Never fork** `progressAnalytics` / bottleneck / geometry / `stampTransform` math — hooks CALL these, never re-implement (§3).
- **RBush/`Map`/`Set` stay OUT of Query/IDB state** — the vector index lives in hook `useState`, never the TanStack cache (§5).
- **Preserve the ref-sync pattern** verbatim — it feeds the window keydown handler + Konva's synchronous `dragBoundFunc`; it is not cleanup-able.
- **No `.insert()` for `status_logs`, no `pendingChanges` migration, no `client_timestamp` retiming, no RLS/auth/schema change** — the canvas doesn't own these, and this refactor must not reach them (§2).
- **Do not recolor `mapDisplayStatuses`** or write `status_logs.status_color` (§3) — recolor stays on display copies only.
- **No `any`, no `@ts-nocheck` on merge; derive types from `database.types.ts`; narrow JSONB at the boundary** (§6). New hooks/utils are fully typed.
- **Golden master is sacred:** `src/components/FloorplanCanvas.test.tsx` must stay green after every phase; don't edit it to make a phase pass.

## Verification commands (the exit-criteria gate)
Run npm with an absolute prefix (Bash cwd persists; a stray `cd` prompts):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck   # tsc --noEmit (primary gate)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test         # vitest (golden master: ... run test -- src/components/FloorplanCanvas.test.tsx)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build         # next build (after editing live components)
```
- **Lint is NOT a gate** (~1850 pre-existing problems). No E2E framework — UI/canvas verified by a live `npm run dev:3010` click-through (port 3010, not 3000). ⚠️ a `next build` corrupts a running `dev:3010` server → restart via `scripts/restart-dev.ps1`. Vitest globals are OFF: import `{ describe, it, expect, vi }` from `'vitest'`; co-locate `foo.test.ts`.

## Open decisions
- **Hook folder layout** — ✅ RESOLVED in Phase 2: **flat `src/hooks/`** (`useCanvasViewport.ts` landed there; later canvas hooks follow suit).
- **Post-FloorplanCanvas Slice-2 breadth** — whether to continue to `useProjectQueries` / `SettingsMenu` after Phase 10, or return to features. Resolve at the Phase 10 re-evaluation, per the master plan's diminishing-returns caveat.

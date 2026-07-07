# Kickoff — Codebase Health Slice 2 / FloorplanCanvas Decomposition, Phase 8: extract keyboard shortcuts + container sizing → `useCanvasKeyboard`

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 8 of the FloorplanCanvas Decomposition** (Codebase Health Slice 2, target 1) —
> extract the window-level keydown/keyup/blur effect (the Escape backout ladder, arrow-nudge,
> Ctrl/Cmd+Z undo/redo, Enter-to-finish, tool number keys, space-pan, stamp R/H/V, magnifier
> M/[/], +/- zoom, 0/Home reset, f-to-fit) plus the container checkSize/resize wiring into a new
> `src/hooks/useCanvasKeyboard.ts` hook. **Behavior-preserving; a pure move, no user-visible
> change.** Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-06 - Codebase Health Slice 2 FloorplanCanvas Phase 8 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/FloorplanCanvas-Decomposition-Plan.md` (Phase 8 + the guardrails)
> - `sitepulse-next/AGENTS.md` (esp. §3 canvas engine, §6 TypeScript)
>
> Branch `feat/codebase-health-slice2-phase-8` off `main` (the slice-2 chain through Phase 7 is
> merged — Phase 7 landed 8b293b0). Build **only Phase 8**. Keep `FloorplanCanvas`'s behavior +
> public prop surface byte-identical; the golden-master test (`src/components/FloorplanCanvas.test.tsx`)
> must stay green — it pins `:arrow-nudge` / `:draw-enter` / the pending-undo path, which all route
> through this effect. **The handler bodies move verbatim; the effect's dep array stays
> byte-identical** (`[imageUrl, toolMode, onPolygonComplete, onToolModeChange]`). Don't commit or
> push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English goal
Every keyboard shortcut the map understands — Esc backing out of tools one layer at a time,
arrows nudging a selected room, Ctrl+Z undo, Enter finishing a trace, number keys switching
tools, space for temporary pan, R/H/V spinning a stamp, M and [ ] for the magnifier, +/- and
0/Home and F for zoom — lives in one giant effect inside `FloorplanCanvas.tsx`, together with
the "re-measure the canvas when the window resizes" wiring. This phase lifts that whole effect
into its own hook file. Nothing the user sees or presses changes.

## Why this phase exists / where it sits
Eighth phase of **Slice 2, target 1**. Phases 1–7 are DONE + merged (`canvasLayout.ts`,
`useCanvasViewport`, `useCanvasSnapping`, `useGeometryGestures`, `useTraceTool`, `useStampTool`,
`useMeasureTools`); the file is at 1,984 lines. This is the phase the whole hook ordering was
built for: the keydown effect CONSUMES the other hooks' returns (draft refs + clear callbacks
from useTraceTool, rotate/flip from useStampTool, calibrate/measure refs + clears from
useMeasureTools, nudge/undo callback refs from useGeometryGestures, zoom callback refs from
useCanvasViewport), which is why it was deliberately left last of the interaction extractions
and why the hook call must sit AFTER all of them.

## The exact scope — build only this
Move the window keydown/keyup/blur + container-size effect into a NEW
`src/hooks/useCanvasKeyboard.ts`. **Re-read the real file first — line numbers WILL have
drifted.** What moves (anchors verified post-Phase-7):

- **The whole effect (~723–916):** `handleKeyDown` (~728) — the Esc ladder (legend deselect →
  magnifier → draft → capture_line origin → calibrate line/prompt → measure run → pending-name
  no-op → tool-to-pan), Shift tracking, arrow-nudge (via `nudgeSelectedRef`), the two Ctrl/Cmd+Z
  branches (pending-edit history via `undoRedoPendingEditRef`, draft-vertex via
  `undoLastDraftVertex`), draw-Enter (via `finishDrawingViaEnter`), space-pan arm, tool number
  keys 1/2/3, stamp R/H/V (via `rotateStamp`/`flipStamp`), magnifier M + [ ] (writes
  `useSettingsStore` directly — keep that), +/- zoom + 0/Home reset + f-fit (via
  `handleZoomRef`/`resetViewRef`/`zoomToFitRef`), `handleKeyUp` (~874, Shift + space release),
  `handleBlur` (~885, space-pan safety), `checkSize` (~896) + the 100/500/1000ms timeouts + the
  `resize` listener, and all the add/removeEventListener plumbing. **Dep array byte-identical:**
  `[imageUrl, toolMode, onPolygonComplete, onToolModeChange]` (~916).
- **State/refs that move WITH the effect if nothing else uses them — verify, don't assume:**
  `spaceWasPanRef` (~312) is read only by this effect → moves in. `isShiftDown`/`setIsShiftDown`
  (~401) is CONSUMED by JSX (DraftPolygon/PendingPolygon/MappedUnit/cursor) → the STATE stays in
  the component; pass `setIsShiftDown` in (or have the hook own the state and return
  `isShiftDown` — smallest diff wins, pick ONE and say so). Same test for `dimensions`/
  `setDimensions` (~315, layout consumes it → stays, pass the setter + `containerRef` in) and
  `setIsLegendSelected`/`setBoxOrigin` (component-owned, pass in).
- **Refs the hook consumes but does NOT own — pass them in unchanged:** `magnifierActiveRef`/
  `magnifierZoomRef` (~378), `boxOriginRef` (~404), `isEditingPendingRef`, `selectedUnitIdsRef`,
  `layoutRef`, the callback refs `handleZoomRef`/`resetViewRef`/`zoomToFitRef`/
  `nudgeSelectedRef`/`undoRedoPendingEditRef` (~450) **and their per-render sync assignments
  (~1092)** — the sync assignments stay in the component (they read component-scope values).
- **Hook-return inputs (already extracted, pass in):** `draftPointsRef`, `clearDraft`,
  `undoLastDraftVertex`, `finishDrawingViaEnter` (useTraceTool); `rotateStamp`, `flipStamp`
  (useStampTool); `calibratePointsRef`, `calibratePromptRef`, `cancelCalibrate`,
  `measurePointsRef`, `clearMeasureRun` (useMeasureTools).
- **The `ResizeObserver` container effect (~462) is SEPARATE** — decide whether it rides along
  (it's the same "container sizing" concern; the plan names "the container checkSize/resize
  wiring") or stays; either way say so explicitly. The HiDPI pixel-ratio effect stays.

**No callback props are involved and nothing here writes data** — this is pure event wiring.
The golden master exercises `:arrow-nudge`, `:draw-enter` and the pending-undo path through
real `window.dispatchEvent(new KeyboardEvent(...))` calls, so it is the direct tripwire for
this phase.

## Hard guardrails (AGENTS.md — do not violate)
- **Behavior-preserving.** Every shortcut, every gate (`isInputActive`, `e.repeat`,
  `stopImmediatePropagation` ordering, the capture-phase `true` on the listeners), every
  ladder rung fires exactly as today. Any difference = STOP, bug.
- **Public surface frozen.** `FloorplanCanvasProps` + `useImperativeHandle` byte-identical.
- **Golden master is sacred.** `src/components/FloorplanCanvas.test.tsx` stays green, untouched.
- **Preserve the ref-sync pattern verbatim** — the handler is created once per dep-change and
  reads everything live through refs; do not "clean up" refs into deps (that re-registers the
  listener and changes Esc/space semantics mid-gesture).
- **Keep the listeners on `window` with capture=true** for keydown/keyup — the
  `stopImmediatePropagation` calls in the ladder depend on it.
- **No `any`, no `@ts-nocheck`.** No DB / RLS / auth / schema / offline-queue changes.

## Exit criteria (Definition of Done → then STOP)
- `typecheck` + `test` + `build` all green; **golden master green** (it drives this effect
  directly — treat any red as a real regression).
- `dev:3010` click-through (desktop only): Esc ladder end-to-end (magnifier → half-draft →
  half-calibrate → measure run → tool → pan); arrow-nudge a selected room; Ctrl+Z mid-draft and
  on a pending polygon (with Shift for redo); Enter finishes a ≥3-point trace; 1/2/3 switch
  tools; space-pan press/release (and window-blur release); R/H/V on a stamp ghost; M toggles
  the loupe, [ ] change its zoom; +/- zoom, 0 fit, F fit-selection; drag the side panel /
  resize the window → the sheet refits. No prod writes are involved in this phase; the Sandbox
  project is still the safe place to click.
- Close with the `verify-feature` skill. **Do not commit or push until the owner says "Approved."**
- On approval, per the post-approval handoff ritual: draft the **Phase 9 (`canvasRecolor`)**
  kickoff + paste its launch prompt.

## Verification commands
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
**Lint is NOT a gate.** ⚠️ a `next build` corrupts a running `dev:3010` server → restart via
`scripts/restart-dev.ps1` (repo root).

## Next after this
Phase 9 — extract the lag / make-ready recolor memo into pure `src/utils/canvasRecolor.ts`
(+ co-located test), then Phase 10 — the render split + final thinning (see the plan-of-record).
Line-count trajectory so far (corrected at the Phase 7 close): 2,749 → 2,710 (P1) → 2,369 (P2)
→ 2,336 (P3) → 2,156 (P4) → 2,063 (P5) → 2,051 (P6) → 1,984 (P7).

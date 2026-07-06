# Kickoff — Codebase Health Slice 2 / FloorplanCanvas Decomposition, Phase 3: extract snapping → `useCanvasSnapping`

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3 of the FloorplanCanvas Decomposition** (Codebase Health Slice 2, target 1) —
> extract the snapping engine (the RBush vector-tree build, `snapPoint`, `effectiveSnapping`,
> `gridAwareSnapping`, `aspect`) into a new `src/hooks/useCanvasSnapping.ts` hook.
> **Behavior-preserving; a pure move, no user-visible change.** Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-06 - Codebase Health Slice 2 FloorplanCanvas Phase 3 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/FloorplanCanvas-Decomposition-Plan.md` (Phase 3 + the guardrails)
> - `sitepulse-next/AGENTS.md` (esp. §3 canvas engine, **§5 snapping/RBush — hard rule**, §6 TypeScript)
>
> Branch `feat/codebase-health-slice2-phase-3` off `main` (the slice-2 chain — golden master + Phases
> 1–2 — merged to main 2026-07-06, main==85b7f15). Build **only Phase 3**. Keep `FloorplanCanvas`'s
> behavior + public prop surface byte-identical; the golden-master test
> (`src/components/FloorplanCanvas.test.tsx`) must stay green. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English goal
When you trace a room, the cursor "magnetically" snaps to the walls the backend detected in the
drawing. That engine — the spatial index of detected lines, the snap lookup, the "snapping is
suspended while the magnifier is up" rule, and the grid-aware de-prioritizing of grid lines — sits
inside the giant `FloorplanCanvas.tsx` today. This phase lifts it into its own hook file. Nothing
the user sees or feels changes — same snap ring, same wall-hugging, same magnifier behavior.

## Why this phase exists / where it sits
Third phase of **Slice 2, target 1** (`FloorplanCanvas.tsx`). Phase 1 (`canvasLayout.ts`, e4f9274)
and Phase 2 (`useCanvasViewport.ts`, 87399e3) are DONE + Approved; the extraction pattern (and the
flat `src/hooks/` layout) is settled. The golden master (Phase 0.4, 15 gesture tests) stays the
safety net. Snapping comes before Phase 4 (gestures) because the gesture handlers consume
`snapPoint`/`vectorTree`/`aspect` — extracting in dependency order avoids churn.

## The exact scope — build only this
Move the snapping engine into a NEW `src/hooks/useCanvasSnapping.ts`. **Re-read the real file first —
line numbers WILL have drifted.** What moves (names verified against the current file):

- **Vector source + spatial index:** the `useSnappingVectors(activeSheetId)` call (~300), the
  `vectorTree` `useState` + deferred `setTimeout(10)` RBush build effect (~302–324, including the
  `tagVectorsWithGrid` grid-tagging + the `layoutRef`-based `classifyAspect` read).
- **Derived flags:** `gridAwareSnapping` (~329) and `effectiveSnapping` (~468 — note it reads
  `magnifierActive`, which STAYS in the component; pass the boolean in).
- **Geometry ratio:** `aspect` (~601) — a render-time read of `layoutRef.current`; preserve that
  quirk verbatim (it is NOT a memo; it refreshes every render).
- **Snap lookup:** `snapPoint` (~1422) — the `useCallback` over `getSnappedCoordinate`.

The hook takes roughly `{ activeSheetId, confirmedGridlines, layoutRef, layoutDrawW, stageScale,
enableSnapping, snappingStrength, magnifierActive (or the resolved effectiveSnapping), gridAwareSnapping toggle }`
— derive the exact surface from usage, don't invent extras — and returns
`{ vectorTree, snapPoint, effectiveSnapping, gridAwareSnapping, aspect }`. Everything that CONSUMES
these (the `onMouseMove` inline `getSnappedCoordinate` call with the interior hint, `handleAnchorDragEnd`,
`handleStageClick`'s draw/calibrate/measure branches, and the `MappedUnit`/`PendingPolygon`/`DraftPolygon`/
`StampPreview`/`CaptureLineOverlay`/`GridlineOverlay` props) **stays in the component**, reading the
hook's returns. REUSE `getSnappedCoordinate` / `tagVectorsWithGrid` — never fork (§3). Nothing else
moves this phase (gestures, trace state, keyboard — all stay put).

## Hard guardrails (AGENTS.md + memory — do not violate)
- ⚠️ **AGENTS §5 hard rule:** the `RBush` index MUST stay in the hook's `useState`/`useEffect` —
  **NEVER** in TanStack Query / IDB state (it crashes the persist serializer). Only the raw JSON
  vectors live in the Query cache; the hook instantiates RBush locally in the same deferred
  `setTimeout(10)` effect, exactly as today.
- **Behavior-preserving.** Same snap feel, same snap ring, same magnifier-suspends-snapping rule,
  same grid-aware weighting. If anything feels different on-screen, STOP — bug.
- **Public surface frozen.** `FloorplanCanvasProps` + `useImperativeHandle` byte-identical.
- **Golden master is sacred.** `src/components/FloorplanCanvas.test.tsx` stays green, untouched.
- **No `any`, no `@ts-nocheck`** in the new hook (the existing `RBush<any>` state type may move
  as-is — typing the RBush item shape is OPTIONAL, not a license to refactor).
- No DB / RLS / auth / schema / offline-queue changes (none are near this).

## Exit criteria (Definition of Done → then STOP)
- `typecheck` + `test` + `build` all green (absolute-prefix commands below); golden master green.
- `dev:3010` click-through (desktop only), on a sheet WITH detected vectors (workbench is easiest):
  trace snapping + the snap ring behave identically; magnifier ON suspends snapping; grid-aware
  snapping still prefers walls over confirmed grid lines; node-drag snap on a saved room unchanged.
- Close with the `verify-feature` skill. **Do not commit or push until the owner says "Approved."**
- On approval, per the post-approval handoff ritual: draft the **Phase 4 (`useGeometryGestures` —
  ★ the golden-master phase)** kickoff + paste its launch prompt.

## Verification commands
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
**Lint is NOT a gate.** ⚠️ a `next build` corrupts a running `dev:3010` server → restart via
`scripts/restart-dev.ps1`.

## Branching
The former stacked slice-2 chain (golden master 648a496 → Phase 1 e4f9274 → Phase 2 87399e3) was
**merged to main + pushed 2026-07-06 (main == origin == 85b7f15)** and the local phase branches were
deleted. **Branch `feat/codebase-health-slice2-phase-3` off `main`.**

## Next after this
Phase 4 — extract the geometry-edit gestures (`useGeometryGestures`) — ★ **the phase the golden
master exists for**; treat any red as a real regression, never a test to edit. Then trace/box →
stamp → measure → keyboard → recolor → render split (see the plan-of-record).

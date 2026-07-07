# Kickoff — Codebase Health Slice 2 / FloorplanCanvas Decomposition, Phase 9: extract the lag / make-ready recolor → pure `canvasRecolor.ts`

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 9 of the FloorplanCanvas Decomposition** (Codebase Health Slice 2, target 1) —
> extract the `displayStatuses` memo body (the Lag Mode schedule-variance recolor and the
> Make-Ready dependency-readiness recolor) into pure `recolorForLag` / `recolorForMakeReady`
> functions in a new `src/utils/canvasRecolor.ts`, with a co-located `canvasRecolor.test.ts`.
> **Behavior-preserving; a pure move, no user-visible change.** Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-06 - Codebase Health Slice 2 FloorplanCanvas Phase 9 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/FloorplanCanvas-Decomposition-Plan.md` (Phase 9 + the guardrails)
> - `sitepulse-next/AGENTS.md` (esp. §3 canvas engine + lag-mode rule, §6 TypeScript, §9 testing)
>
> Branch `feat/codebase-health-slice2-phase-9` off `main` (the slice-2 chain through Phase 8 is
> merged — Phase 8 landed 587a189). Build **only Phase 9**. Keep `FloorplanCanvas`'s behavior +
> public prop surface byte-identical; the golden-master test (`src/components/FloorplanCanvas.test.tsx`)
> must stay green, untouched. **The extracted functions are PURE** (no hooks, no `Date.now()` —
> `today` is passed in) and they **CALL `progressAnalytics` / `activityReadiness` /
> `applicability` — never fork that math** (AGENTS §3). Recolor happens ONLY on new display
> copies — never mutate the inputs, never recolor `mapDisplayStatuses`, never write
> `status_logs.status_color`. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English goal
When the map is in Lag Mode (color rooms by how far behind schedule they are) or Make-Ready
Mode (color rooms by whether their next activity is unblocked), the canvas re-skins each
room's status color on a throwaway copy before drawing. That ~50-line block of math wiring
lives inside a memo in `FloorplanCanvas.tsx`. This phase lifts it into a small pure utility
file with its own unit test. Nothing on screen changes; the payoff is the recolor logic
becomes directly testable and the canvas file keeps shrinking.

## Why this phase exists / where it sits
Ninth phase of **Slice 2, target 1**. Phases 1–8 are DONE + merged (`canvasLayout.ts`,
`useCanvasViewport`, `useCanvasSnapping`, `useGeometryGestures`, `useTraceTool`,
`useStampTool`, `useMeasureTools`, `useCanvasKeyboard`); the file is at 1,814 lines. This is
the second of the two pure-`utils` extractions (Phase 1 was the first) — no hook, no refs, no
event wiring; the easiest phase left. Phase 10 (the render split) closes the slice.

## The exact scope — build only this
Move the body of the `displayStatuses` memo into a NEW pure `src/utils/canvasRecolor.ts`
(+ co-located `canvasRecolor.test.ts`). **Re-read the real file first — line numbers WILL
have drifted.** Anchors verified post-Phase-8:

- **What moves (~232–282):** the `displayStatuses = useMemo(...)` BODY — the early
  passthrough (`!lagMode && !makeReadyMode` → return `activeStatuses`, the SAME array
  reference, not a copy), the `unitById` map build, the Make-Ready branch (completed-slot set
  from `rawStatuses`, the applicable-slot set built only when an `applicabilityIndex` exists,
  `unitMakeReady` + `makeReadyFill` per status copy) and the Lag branch (`logsByUnit`
  grouping filtered by track, `applicableActivities` per unit, `computeUnitVariance` +
  `varianceFill` per status copy). Shape it as the plan names it: `recolorForLag(...)` and
  `recolorForMakeReady(...)` — pure functions that take everything they read as arguments
  (statuses, units, activities/allActivities, trackingMode, dependencies, applicabilityIndex,
  `today`) and return NEW status copies with only `status_color` swapped. The memo in
  `FloorplanCanvas` stays and just dispatches: passthrough → `recolorForMakeReady` →
  `recolorForLag`. **The memo's dep array stays byte-identical** (incl. the deliberate
  `eslint-disable` note — `activities` is derived from `allActivities`+`trackingMode` and is
  intentionally NOT a dep; pass the derived array in as an argument, exactly as the body
  reads it today).
- **What stays in the component:** `lagMode` (~224), `makeReadyMode` (~228, incl. the
  mutually-exclusive stale-both-prefers-Lag guard — that's mode DERIVATION, not recolor),
  `today` (~231, the component-lifetime `useMemo(() => new Date(), [])` — the pure fns take
  it as a param, never call `new Date()` themselves), and the memo wrapper itself.
- **The single consumer is untouched:** `MappedUnit`'s `activeStatuses={displayStatuses}`
  (~1517). `MapLegend` deliberately receives the ORIGINAL `activeStatuses` + the mode flags —
  do not "fix" that.
- **The co-located test pins (plan-of-record list):** N/A slots respected (an
  `ApplicabilityIndex` excludes a slot → it can't become the bottleneck/blocked slot), empty
  inputs → passthrough (and modes-off returns the input array identity), and **no mutation** —
  the source `activeStatuses`/`rawStatuses` objects keep their original `status_color`; only
  the returned copies differ. Vitest conventions: globals OFF — import
  `{ describe, it, expect }` from `'vitest'`; see the `write-tests` skill.
- **Import, never fork:** `computeUnitVariance`/`varianceFill`/`orderedTrackActivities`
  (`progressAnalytics`), `unitMakeReady`/`makeReadyFill`/`slotKey` (`activityReadiness`),
  `applicableActivities`/`isActivityApplicable` (`applicability`). After the move, prune any
  of these imports `FloorplanCanvas` no longer uses directly (verify each — don't assume).

**No callback props are involved and nothing here writes data** — recolor is display-only by
architecture (AGENTS §3): the variance colors must never reach `status_logs` or the write
paths (BulkActionDock bottlenecks, quick modals read `mapDisplayStatuses` in the parent).

## Hard guardrails (AGENTS.md — do not violate)
- **Behavior-preserving.** Same colors, same passthrough identity, same N/A handling. Any
  difference = STOP, bug.
- **Pure means pure.** No hooks, no store reads, no `Date.now()`/`new Date()` inside the
  extracted functions — `today` comes in as an argument.
- **Never fork the math** — `progressAnalytics` / `activityReadiness` / `applicability` are
  imported and called, exactly as today (§3).
- **Recolor only display copies.** Return new objects; never mutate inputs; never recolor
  `mapDisplayStatuses`; never write `status_logs.status_color` (§3).
- **Public surface frozen.** `FloorplanCanvasProps` + `useImperativeHandle` byte-identical.
- **Golden master is sacred.** `src/components/FloorplanCanvas.test.tsx` stays green, untouched.
- **No `any`, no `@ts-nocheck`.** New util + test fully typed. No DB / RLS / auth / schema /
  offline-queue changes.

## Exit criteria (Definition of Done → then STOP)
- `typecheck` + `test` + `build` all green; **golden master green**; the new
  `canvasRecolor.test.ts` covers N/A handling + passthrough + no-mutation.
- `dev:3010` click-through (desktop only, Sandbox project): toggle Lag Mode on the toolbar →
  rooms recolor by variance exactly as before (hover card still shows the schedule verdict);
  toggle Make-Ready Mode → readiness colors as before; toggle both off → normal status
  colors return; open a quick status modal / the bulk dock on a colored room → it shows the
  ORIGINAL status color, not the lag color.
- Close with the `verify-feature` skill. **Do not commit or push until the owner says "Approved."**
- On approval, per the post-approval handoff ritual: draft the **Phase 10 (render split +
  final thinning)** kickoff + paste its launch prompt.

## Verification commands
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
**Lint is NOT a gate.** ⚠️ a `next build` corrupts a running `dev:3010` server → restart via
`scripts/restart-dev.ps1` (repo root).

## Next after this
Phase 10 — the render split + final thinning: split the `<Stage>` layers into small
sub-components, leave `FloorplanCanvas` a thin coordinator, re-measure, then **Slice 2
re-evaluates** (continue to `useProjectQueries`/`SettingsMenu` or return to features).
Line-count trajectory so far: 2,749 → 2,710 (P1) → 2,369 (P2) → 2,336 (P3) → 2,156 (P4)
→ 2,063 (P5) → 2,051 (P6) → 1,984 (P7) → 1,814 (P8).

# Kickoff — Codebase Health Slice 2 / FloorplanCanvas Decomposition, Phase 1: extract pure layout + culling math

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of the FloorplanCanvas Decomposition** (Codebase Health Slice 2, target 1) —
> extract the canvas's pure layout + visible-unit-culling math into `src/utils/canvasLayout.ts` with a
> co-located test, and wire `FloorplanCanvas` to call it. **Behavior-preserving; new util + tests only,
> no user-visible change.** Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-06 - Codebase Health Slice 2 FloorplanCanvas Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/FloorplanCanvas-Decomposition-Plan.md` (Phase 1 + the guardrails)
> - `sitepulse-next/AGENTS.md` (esp. §3 canvas engine, §6 TypeScript)
>
> Branch off `main`. Create `feat/codebase-health-slice2-phase-1`. Build **only Phase 1**. Keep
> `FloorplanCanvas`'s behavior + public prop surface byte-identical; the golden-master test
> (`src/components/FloorplanCanvas.test.tsx`) must stay green. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English goal
The canvas figures out, on every render, **how big to draw the floor plan** (fit the image into the
available box, centered) and **which rooms are currently on-screen** (so it doesn't draw markers you
can't see). Today that arithmetic is baked inside the giant `FloorplanCanvas.tsx`. This phase lifts that
pure arithmetic out into a small, standalone file with its own tests — no change to what you see, it just
makes the math testable and shrinks the god file a little. It's the **first, safest** step of breaking up
the 2,704-line canvas, and it sets the pattern the later phases follow.

## Why this phase exists / where it sits
First phase of **Slice 2, target 1** (`FloorplanCanvas.tsx`) of the Codebase Health & Refactor workstream.
The gate for touching the canvas — **Phase 0.4, the characterization "golden master"** — is DONE and green
(`src/components/FloorplanCanvas.test.tsx`, committed on branch `feat/codebase-health-phase-0-4`, 15 tests
pinning every geometry-write gesture). That net is what makes this decomposition safe. Owner picked **full
decomposition** (drive `FloorplanCanvas` down to a thin coordinator + focused hooks over ~10 phases); this
is Phase 1 of that set. Start with the purest, lowest-risk extraction to establish the pattern.

## The exact scope — build only this
Extract three pure functions into a NEW `src/utils/canvasLayout.ts` (+ co-located `canvasLayout.test.ts`),
then have `FloorplanCanvas` call them instead of inlining the math. **Re-read the real file first — line
numbers below WILL have drifted.**

1. **`computeLayout(stageW, stageH, imgW, imgH)`** — from the `layout` memo (~928–947). Returns
   `{ offsetX, offsetY, drawW, drawH, stageW, stageH }`. Preserve the current branches EXACTLY:
   - `stageW`/`stageH` falsy → all-zero layout;
   - image dims falsy → `{ drawW: stageW, drawH: stageH, offset 0 }`;
   - else `scale = min(stageW/imgW, stageH/imgH)`, `drawW/H = img*scale`, centered offsets.
2. **`computeVisibleBox(layout, stagePosition, stageScale, dimensions)`** — from `visibleBoundingBox`
   (~951–963). Returns the padded `{ minPctX, maxPctX, minPctY, maxPctY }` (±0.05) or `null` when
   layout/dimensions are empty. Keep the exact same formula (the golden master's pixel↔percent mapping
   assumes offsetX=100, drawW=800 for a 1000×800 box over a 1000×1000 image — don't change it).
3. **`cullVisibleUnits(units, box, layoutDrawW, toolMode)`** — from `visibleUnits` (~965–983). Same
   passthrough-when-no-box rule, same "unmapped units only in draw mode", same "some vertex inside the box".

Then in `FloorplanCanvas.tsx`: keep the `useMemo` wrappers (they own the React deps), but have each memo
body just call the new pure fn. Nothing else moves this phase — no hook yet, no state relocation.

## Pin the behavior with a co-located test
`src/utils/canvasLayout.test.ts` (Vitest, globals OFF — `import { describe, it, expect } from 'vitest'`).
Cover: the fit-scale + centered-offset math (incl. the golden-master 1000×800/1000×1000 → drawW=drawH=800,
offsetX=100 case, so the two tests corroborate), the empty/degenerate branches (zero stage, zero image),
the visible-box padding + null cases, and culling (inside/outside, unmapped-in-draw-mode, no-box passthrough).
Pure + deterministic — no mocks, no `Date.now()`.

## Hard guardrails (AGENTS.md — do not violate)
- **Behavior-preserving.** This is a pure move. If any on-screen positioning/culling changes, STOP — bug.
- **Public surface frozen.** `FloorplanCanvasProps` + the `useImperativeHandle` surface stay byte-identical.
- **Golden master is sacred.** `src/components/FloorplanCanvas.test.tsx` must stay green; do NOT edit it.
- **No `any`, no `@ts-nocheck`.** Type the new util fully; reuse `PercentPoint`/`Unit`/`ToolMode` from the
  existing types. Derive nothing new that duplicates a DB shape.
- **Don't fork** any geometry math — this phase only moves layout/culling arithmetic that currently lives
  inline in the component (it isn't in `geometry.ts`); if you find an overlap with an existing util, reuse it.
- No DB / RLS / auth / schema / offline-queue / `status_logs` / `pendingChanges` changes (none are near this).

## Exit criteria (Definition of Done → then STOP)
- `typecheck` + `test` + `build` all green (absolute-prefix commands below).
- `canvasLayout.test.ts` covers the mapping + all branches; **the golden master
  (`... run test -- src/components/FloorplanCanvas.test.tsx`) stays green.**
- `dev:3010` click-through: floor plan renders + fits, markers positioned correctly, culling on pan/zoom
  unchanged (no markers vanishing/appearing wrongly). Desktop only.
- Close with the `verify-feature` skill. **Do not commit or push until the owner says "Approved."**
- On approval, per the post-approval handoff ritual: draft the **Phase 2 (`useCanvasViewport`)** kickoff +
  paste its launch prompt.

## Verification commands
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
Target one file: `... run test -- src/utils/canvasLayout.test.ts`. **Lint is NOT a gate.** ⚠️ a `next build`
corrupts a running `dev:3010` server → restart via `scripts/restart-dev.ps1`.

## Branching
Phase 0.4 (the golden master) is on branch `feat/codebase-health-phase-0-4` (648a496), pending the owner's
merge to `main`. Confirm with the owner whether 0.4 is merged before branching; **branch this phase off
`main`** (it only needs the golden master + `FloorplanCanvas.tsx`, both of which land on main once 0.4 merges).
Create `feat/codebase-health-slice2-phase-1`.

## Next after this
Phase 2 — extract the viewport/camera engine (`useCanvasViewport`: wheel/smooth-zoom, pan, animate,
zoom-to-fit, mini-map). Then snapping → geometry gestures → trace/box → stamp → measure → keyboard →
recolor → render split (see the plan-of-record for the full ordered set).

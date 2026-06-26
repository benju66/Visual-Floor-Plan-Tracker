# Kickoff — Canvas Tracing Precision Aids, Phase 1: inside-face-aware magnetic snapping

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Canvas Tracing Precision Aids** (inside-face-aware magnetic snapping). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-26 - Canvas Tracing Precision Aids Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Canvas-Tracing-Precision-Aids-Plan.md` (Phase 1)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main` (precondition: the current AI Tracing working-tree changes must already be committed — confirm `git status` is clean first). Build **only Phase 1**. The change must be backward-compatible (new `getSnappedCoordinate` param defaults to null). Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## What this phase delivers
Smarter magnetic snapping for tracing: on **thick** walls it favors the *inside
face* the tracer is meant to follow (instead of grabbing whichever face is a hair
closer), and it stops leaping to the wrong corner where walls cross. Because the
snapping engine is shared, this improves **both** the Drawing-Library workbench
tracer and the project-level map at once. Plain-English framing for the owner: "the
snap now hugs the inside line of the wall you're tracing and stops jumping to the
wrong corner at junctions."

## Precondition (check first)
This whole workstream was deferred until the AI Tracing phase was committed. Before
branching, run `git status` — if `src/components/FloorplanCanvas.tsx`,
`useMapStore.ts`, `cursor.ts`, or the `CaptureBoxOverlay`/`titleBlockParse`/migration
files show as uncommitted, STOP and tell the owner the AI tracing work still needs
committing; do not start on a dirty tree.

## Required reading (in full, fresh)
1. `sitepulse-next/AGENTS.md` — especially §5 (snapping engine: `getSnappedCoordinate`
   is the single source; RBush instantiation rules) and §6 (TS guardrails, tests).
2. `sitepulse-next/Notes/plans/Canvas-Tracing-Precision-Aids-Plan.md` — the whole
   plan; you are building **Phase 1** only.
3. The real current files (do not trust line numbers — re-read):
   - `src/utils/geometry.ts` and `src/utils/geometry.test.ts`
   - `src/components/FloorplanCanvas.tsx` — the draw-mode snap call sites in the
     stage `onMouseMove` handler (and the fill-from-walls path **only if it exists
     on `main`** — it may not).

## Source to port (already written, do not reinvent)
The exact change lives in commit `4cc9101` on branch `claude/code-repo-review-2vre2c`:
```
git show 4cc9101 -- sitepulse-next/src/utils/geometry.ts
git show 4cc9101 -- sitepulse-next/src/utils/geometry.test.ts
git show 4cc9101 -- sitepulse-next/src/components/FloorplanCanvas.tsx
```
Port it by hand onto current `main` (geometry.ts is identical in prod, so it applies
cleanly). Do NOT cherry-pick the commit wholesale and do NOT bring any other change.

## Scope (Phase 1 only)
- `src/utils/geometry.ts`: add `const CORNER_ZONE_FRACTION = 0.6` (softens corner
  gravity so a thick wall's far corner / a crossing wall's corner can't hijack a
  point placed along an edge). Add an **optional** trailing param
  `interiorPoint: PercentPoint | null = null` to `getSnappedCoordinate`; when
  supplied, bias edge/vertex selection toward the wall face on the room-interior
  side (track `*Eff` interior-biased distances for selection vs. `*Raw` true
  distances for the radius threshold — see the diff). MUST stay backward-compatible.
- `src/utils/geometry.test.ts`: port the added cases (softened corner gravity;
  inside-face bias on a thick wall).
- `src/components/FloorplanCanvas.tsx`: feed the interior hint at the draw-mode snap
  call site — `const interior = draftPoints.length >= 3 ? getCentroid(draftPoints) : null;`
  passed as the new arg. If a fill-from-walls path exists on `main`, also pass the
  detected-room centroid there; if it doesn't exist, skip that call site entirely.

## Out of scope (later phases)
Crosshair styles (Phase 2), magnifier loupe (Phase 3), magnifier trace overlays
(Phase 4), mini-map (Phase 5). Do not start them.

## Guardrails
- Snapping math stays inside `getSnappedCoordinate` — extend, never fork (§5).
- New param optional + defaulted → existing callers (e.g. `MappedUnit` drag snap)
  keep working untouched.
- No `any`; keep tests type-clean (vitest globals OFF — import `{ describe, it, expect }`
  from `'vitest'`).

## Exit criteria (Definition of Done → then STOP)
Run from the repo with an absolute prefix (a stray `cd` triggers a prompt):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test -- src/utils/geometry.test.ts
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
- typecheck + full test run + build all green (lint is NOT a gate).
- New geometry tests pass.
- Live `dev:3010` click-through (the only UI verification — no E2E): trace a room
  over a thick-walled sheet in BOTH the workbench tracer and the project map; confirm
  points land on the inside face and don't hijack to a crossing wall's corner. (Per
  the project's browser-verification notes, the dev server may already be on :3010;
  probe via JS if CDP screenshots are flaky on the map page.)
- Close with the **verify-feature** skill (its Definition of Done → stop). Do NOT
  commit or push until the owner says "Approved."

# Kickoff — Canvas Tracing Precision Aids, Phase 1: inside-face-aware magnetic snapping

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Canvas Tracing Precision Aids** (inside-face-aware magnetic snapping). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-26 - Canvas Tracing Precision Aids Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Canvas-Tracing-Precision-Aids-Plan.md` (Phase 1)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main` (precondition: the current AI Tracing working-tree changes must already be committed — confirm `git status` is clean first). Build **only Phase 1**. The change must be backward-compatible (new `getSnappedCoordinate` param defaults to null). Don't commit or push until I say "Approved."

> **⚠️ RECONCILED 2026-06-26 — read this first.** Since this kickoff was written, commit `96fc108` (grid-aware snapping, Phase 3c) merged to `main` and **refactored `getSnappedCoordinate`**. The old "geometry.ts is identical in prod, applies cleanly" assumption is **no longer true**. The port is now a small re-architecture, not a verbatim apply. See **"Source to port"** and **"Scope"** below — they have been rewritten to match current `main`. The Phase 1 *behavior* is unchanged; only where the code goes changed.

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
This whole workstream was deferred until the AI Tracing phase was committed. **As of
2026-06-26 that precondition is MET** — the AI tracing work (through Phase 3c +
gridline select/adjust/delete + the gridline UX refinement) is all committed and on
`main`; the tree is clean. Still run `git status` to confirm clean before branching;
if anything shows uncommitted, STOP and ask the owner rather than starting on a dirty
tree.

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

## Source to port (already written — but `main` has since diverged; adapt, don't apply)
The intended *behavior* lives in commit `4cc9101` on branch `claude/code-repo-review-2vre2c`:
```
git show 4cc9101 -- sitepulse-next/src/utils/geometry.ts
git show 4cc9101 -- sitepulse-next/src/utils/geometry.test.ts
git show 4cc9101 -- sitepulse-next/src/components/FloorplanCanvas.tsx
```
**This diff will NOT apply cleanly anymore.** Commit `96fc108` (grid-aware snapping)
refactored `getSnappedCoordinate` on `main`:
- The inner snap loop (vertex + edge search, corner gravity) was extracted into a
  pure helper **`snapAmongLines(lines, cursorPctX, cursorPctY, aspect, snapRadiusX)`**.
  `getSnappedCoordinate` now calls it **twice** (a walls-first pass, then a full-set
  fallback) when grid-aware is on.
- A param **`gridAware: boolean = false`** was added in the **8th** slot — the exact
  slot `4cc9101` used for `interiorPoint`.

So treat `4cc9101` as the **specification of the math**, and re-home it onto the
current structure (details in Scope). Do NOT cherry-pick the commit wholesale and do
NOT bring any other change.

## Scope (Phase 1 only) — re-homed onto current `main`
- `src/utils/geometry.ts`:
  - Add `const CORNER_ZONE_FRACTION = 0.6` (softens corner gravity so a thick wall's
    far corner / a crossing wall's corner can't hijack a point placed along an edge).
  - Thread the interior bias **into `snapAmongLines`**, not into `getSnappedCoordinate`
    directly (the old inline `forEach` now lives in the helper). Give `snapAmongLines`
    a trailing optional `interiorPoint: PercentPoint | null = null` param; inside it,
    track `*Eff` (interior-biased) distances for **selection** vs. `*Raw` (true cursor)
    distances for the **radius threshold** and the softened corner-zone test — exactly
    the `farSidePenalty` / `bestEdgeEff/Raw` / `bestVertexEff/Raw` logic from `4cc9101`.
  - Add `interiorPoint: PercentPoint | null = null` to `getSnappedCoordinate` as the
    **9th** param (AFTER the existing `gridAware` 8th param — do NOT reorder; the live
    grid-aware call site passes `gridAware` positionally). Pass `interiorPoint` through
    to **both** `snapAmongLines` calls (walls-first AND fallback) so the bias applies in
    either pass. MUST stay backward-compatible (both new optionals default to null/false).
- `src/utils/geometry.test.ts`: port the added cases (softened corner gravity;
  inside-face bias on a thick wall). **Adjust the interior-hint test call** — in
  `4cc9101` it passed the interior point as the 8th arg; on current `main` it is the
  **9th**, so call `getSnappedCoordinate(..., stageScale, 15, false, { pctX, pctY })`
  (with `gridAware=false` in the 8th slot). Keep the existing grid-aware tests intact.
- `src/components/FloorplanCanvas.tsx`: feed the interior hint at the draw-mode trace
  snap call site (currently **line ~1598**, inside the stage `onMouseMove`, which
  already passes `gridAwareSnapping` as arg 8). The handler reads refs, so use
  `draftPointsRef.current`: `const interior = draftPointsRef.current.length >= 3 ?
  getCentroid(draftPointsRef.current) : null;` and pass it as arg **9** after
  `gridAwareSnapping`. (`getCentroid` is already exported from `geometry.ts`.)
  **There is NO fill-from-walls snap call site on `main`** (confirmed) — skip it
  entirely, exactly as this kickoff allowed. Leave the other call sites
  (`MappedUnit` drag, the anchor-drag and capture-line `snapPoint`) untouched — they
  rely on the defaults.

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

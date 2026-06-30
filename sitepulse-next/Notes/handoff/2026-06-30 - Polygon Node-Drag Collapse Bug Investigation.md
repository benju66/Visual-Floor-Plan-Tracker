# Investigation handoff — polygon collapses to a 3/4-node shape on a long node-drag

## ▶ Launch prompt (paste this to start a fresh session)
> Investigate and fix a polygon-corruption bug. When a location's node (vertex) is dragged a **significant distance**, the **entire polygon collapses to a 4-node rectangle (sometimes a 3-node triangle)** — the vertex count drops. Read this file in full first, then `sitepulse-next/AGENTS.md`. **Do the bisection in § "Do this first" before changing any code, and do NOT drag nodes on real banked workbench labels (corpus data) — reproduce on the Sandbox project map.** There are already UNCOMMITTED changes in the working tree (see § State) — understand them before adding more. Don't commit or push until I say "Approved."

---

## The symptom (owner, 2026-06-30)
Dragging a polygon **node a significant distance** makes the **whole shape collapse into a small 4-node rectangle — sometimes a 3-node triangle.** Intermittent. Reported in the labeling workbench, but the code is shared with the project map (same `MappedUnit` + `FloorplanCanvas`), so it should reproduce on the map too.

**Owner steer (important): this is NOT snapping / magnetic-snap related.** Do not chase `getSnappedCoordinate` / `dragBoundFunc` / `snappingStrength` as the cause — toggling snapping off should still reproduce it. The trigger is the *distance moved*, pointing at either an extreme/garbage coordinate or a real points-array reduction (see the bisection).

## Why this clue matters (rethink required)
The earlier working assumption was **"a node drag preserves vertex count"** — because the saved path does `newPoints = [...unit.polygon_coordinates]; newPoints[index] = …` ([FloorplanCanvas.tsx](../../src/components/FloorplanCanvas.tsx) `handleAnchorDragEnd`), which replaces ONE vertex. A collapse to 3–4 nodes **contradicts that**, so one of these is true:
- **(Render artifact)** The data still has N points, but the long drag produced an **extreme/NaN/Infinity coordinate** for the dragged node, and the closed Konva `Line` *renders* the finite remainder as a simple rectangle/triangle. (Fits "significant distance" → huge coord.)
- **(Real data reduction)** Some path actually rebuilds `polygon_coordinates` with fewer points (a hull / bounding-box / simplify / dedupe / `.slice` / `.filter`). Find it.

## Do this first — the bisection (read-only, before any fix)
Reproduce on the **Sandbox project map** (`/project/f0148e1e-10d8-485c-83b3-970599d80d1b`, Interactive Map View — it has 4/12/16-vertex test units; safe to edit). Select the **12- or 16-vertex** unit, drag one node a long way to trigger the collapse, then **read the actual `units.polygon_coordinates`** (React Query cache or the Konva fill `Line.points()`):
- If the collapsed shape's **data still has N points** (one wildly out of range) → it's the **render-artifact** branch: the dragged coordinate went extreme. Fix by **clamping the dragged vertex to the canvas** in `handleAnchorDragEnd`/`MappedUnit.onDragEnd`, and tighten the persist guard (see below).
- If the data **really has 3–4 points** → grep for the reducer: `convexHull|boundingBox|bbox|simplif|\.slice(|dedup|filter(` across `MappedUnit.tsx`, `FloorplanCanvas.tsx`, `src/utils/geometry.ts`, `useWorkbenchActions.ts`, and the workbench sidecar (`computeLabelArea` in `src/utils/workbench.ts`).

Determining which branch it is **before** coding is the whole game — don't guess.

## Suspects / where to look (NOT snapping — see owner steer)
- `MappedUnit.tsx` anchor `onDragEnd` — computes `pctX=(node.x()-offsetX)/drawW`. A far drag past the canvas makes `node.x()` large → `pct ≫ 1`. There is **no clamp** on a dragged vertex; a long drag can put it far outside [0,1]. Prime candidate for the "render-artifact / extreme-coord" branch.
- `FloorplanCanvas.tsx` `handleAnchorDragEnd` — builds `[...unit.polygon_coordinates]` with one index replaced (preserves count on paper). If the saved DATA nonetheless has 3–4 points, the reduction happens elsewhere.
- The points-array reducers to grep if the data really shrinks: `convexHull|boundingBox|bbox|simplif|\.slice(|dedup|filter(` across `MappedUnit.tsx`, `FloorplanCanvas.tsx`, `src/utils/geometry.ts`, `useWorkbenchActions.ts`, and the sidecar `computeLabelArea` (`src/utils/workbench.ts`).
- The whole-polygon **group drag** (`handlePolygonDragEnd`) vs the **node/anchor drag** — confirm which one the owner is actually doing when it collapses (the anchor is a sibling of the draggable group; a near-miss could grab the body).

## State of the working tree (UNCOMMITTED — from the prior session)
All verified green (typecheck + 672 tests + build) but **NOT committed/merged**. Understand these before adding more:
1. **Workbench geometry persistence** — `useUpdateWorkbenchGeometry` mutation in `useWorkbenchActions.ts` + wired via `onUpdateUnitPolygon` in `WorkbenchTracer.tsx`. This is what made node moves *persist* in the workbench (previously they reverted). It also made this collapse bug *stick* instead of harmlessly reverting.
2. **Corruption fixes (this is the bug's neighborhood — partial, did NOT fully resolve it):**
   - `MappedUnit.tsx` memo comparator now compares all four `layout` fields (was `drawW` only) — fixes a stale-layout squash. Keep.
   - `MappedUnit.tsx` `onDragEnd` passes `{pctX,pctY}` as `overridePct` so saved == drawn. Keep.
   - `geometry.ts` `isFinitePolygon()` (+ test) — refuses to persist a polygon with <3 points or coords outside (-1,2) or non-finite. Applied at the two drag-persist sites in `FloorplanCanvas.tsx`. **NOTE:** its bound is generous — a "significant distance" drag landing in [1,2] would still PASS and persist. Consider clamping the drag coordinate AND/OR tightening this guard once the bisection says which branch it is.
3. **Unrelated docs (leave):** `Notes/plans/Robustness-Trust-Hardening-Plan.md` + `Notes/handoff/2026-06-30 - Robustness Trust Hardening Phase 1 Kickoff.md`.

## Guardrails
- Reproduce on the **Sandbox map**, never on real banked workbench labels (`AGENTS.md` "no live-write probes"; the corpus `trace_events` log is immutable).
- `AGENTS.md` §6 (JSONB narrowing — `isPercentPointArray`), §9 (Vitest: globals OFF, import from `'vitest'`, co-locate tests). Lint is not a gate; verify with typecheck + `npm run test` + `npm run build` (absolute `--prefix`). Dev server: `npm run dev:3010`.
- Don't commit/push until the owner says "Approved." When fixed, the owner wants this merged together with the workbench geometry-persist fix (one PR).

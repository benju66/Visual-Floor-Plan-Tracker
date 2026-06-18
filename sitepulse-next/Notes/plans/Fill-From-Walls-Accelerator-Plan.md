# Fill-From-Walls Accelerator + Labeling-Standard Versioning — self-contained build plan

> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing (line numbers drift).
> Parent: `docs/initiative-brief.md` — this is **Workstream B / Phase B1 ("Fill room from walls")**, the *highest-ROI accelerator* and the "geometry precursor to AI-assisted tracing." It also folds in one small Workstream-A debt the brief implies but never shipped: **labeling-standard version stamping** (the standard's §10 "change control" requires it; no column records it today).

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` first — especially **§2** (data via TanStack hooks; floating UI in Zustand with an explicit interface; never touch the offline `pendingChanges` queue or `status_logs`; RLS posture — never widen RLS, never grant `anon`), **§3** (don't bloat `FloorplanCanvas`; canvas modularization; `onPolygonComplete` is the shared save entry), **§5** (the vector-snapping engine; **never persist `RBush` into Query cache** — raw JSON only, instantiate in a deferred effect), **§6** (TS guardrails: derive types from `database.types.ts`, narrow JSONB at the boundary, **no `any`**, new files `.ts`/`.tsx`), **§9** (Vitest globals OFF — import from `'vitest'`; co-locate `*.test.ts`; pure logic is the priority test layer).
2. Re-read the files in **Build-on inventory** fresh — do not trust line numbers.
3. Build phases in order. The hard, risky part (the geometry) is isolated into **Phase F1 as pure, tested functions with no UI** so it can be proven before any canvas wiring. Verify after each slice. Close each phase with the **verify-feature** skill; do not commit/push until the owner says "Approved."
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence plain-English summary; explain jargon in passing; frame technical choices as decisions with trade-offs.

## Goal
When this is done, a labeler can **click once inside a room and get a proposed polygon snapped to the surrounding walls**, instead of clicking every corner by hand. The proposal drops straight into the existing editable "pending polygon" so the human nudges it and names it exactly as today. Every accepted/corrected label is **stamped with the labeling-standard version it was made under** (so the training corpus stays internally consistent as the rulebook evolves), and — once Phase F4 lands — **the original proposal and the human's correction are both recorded**, turning every fix into training signal (the flywheel) and giving us an honest "is this tool actually saving time?" metric.

## The situation this is built for (locked context — 2026-06-18)
- **Source files are vector PDFs from architects, usually WITHOUT CAD layers turned on.** So we cannot filter walls by layer name; wall isolation must be done from geometry alone (line length/weight/connectivity). Asking architects to export with layers is a cheap future win but is **not assumed here.**
- The backend **already extracts** clean structural line vectors (`extract_vectors_from_pdf`, `main.py`) and the frontend **already loads them** in percent space via `useSnappingVectors`. **This plan needs ZERO backend changes** until the optional auto-name phase (F5).
- This is **deterministic geometry, not AI.** It is useful immediately on clean vector drawings AND it manufactures the labeled corrections that a future vision model (brief Phases 6/7, out of scope) will train on.
- The accelerator must work **identically in the live map and the workbench**, because both mount the same `FloorplanCanvas` and both finish a polygon through the same `onPolygonComplete` callback.

## Out of scope / deferred (named so nothing is silently dropped)
- **Any ML / trained model / vision-model proposals** → brief Phases 6/7, separate. F1–F4 are the deterministic bootstrap + the data capture that make them possible.
- **CAD-layer-aware wall isolation** → deferred until/if architects export layered PDFs (then layer filtering replaces/augments the geometric heuristic in `wallIsolation.ts`). Designed for, not built.
- **Auto-name from the PDF text layer** and **whole-sheet "detect all rooms" batch** → Phase **F5** (optional/gold-plating). Auto-name needs a new backend text-extraction path (`main.py`); keep it last.
- **Grid stamp** (brief Phase B2) → its own plan.
- **Scanned/raster drawings** → no vectors to enclose; those stay manual (or wait for the vision model). The tool simply does nothing useful there (and should fail gracefully — see F2).

## Locked product decisions (from the owner — 2026-06-18)
1. **Build fill-from-walls first**, before SAM/any model. It reuses vectors we already have, costs nothing to run, is debuggable, and feeds the corpus.
2. **Address labeling-standard versioning before volume tracing** (Phase V) — it's cheap now and impossible to backfill once thousands of labels are mixed across rulebook versions.
3. **Capture corrections** (Phase F4) so the tool measurably improves over time and the corpus carries proposal→correction pairs. This is a first-class goal, not a nice-to-have.
4. **Human-in-the-loop is the design, not a fallback.** The tool proposes; the human always reviews/edits before save. Never auto-commit a detected polygon.

---

## PHASE V — Labeling-standard version stamping  ⛔ APPROVAL GATE (migration)
*Small, foundational, do first. This is the "before you trace" item.*

**Why:** `docs/location-labeling-standard.md` is at **Version 0.2 (Draft)** and its **§10 "Change control"** mandates: *"This standard is versioned… a silent rule change mid-corpus quietly degrades a model. Old labels stay valid under the version they were made."* Yet no column records which version a label was made under. Add it now.

**Scope:**
- **Migration** `supabase/migrations/<today>_units_standard_version.sql` (built to the **create-migration** skill): add nullable **`units.standard_version TEXT`** (additive, nullable, no backfill, idempotent `ADD COLUMN IF NOT EXISTS`). **RLS: UNCHANGED** (existing `units` membership policies cover it; no policy added/widened; no `anon` grant) — state this explicitly in the header.
- **Decision: stamp per-label on `units`, NOT per-drawing on `workbench_sheets`.** A drawing is labeled over many sessions that may straddle a version bump; only a per-label stamp stays correct, and the unit *is* the training example. (Mirrors why `spans_levels`/`level_note`/`has_void` live on `units`.) Don't duplicate onto `workbench_sheets`; a drawing's version span is derivable from its units.
- **New constant** `LABELING_STANDARD_VERSION = '0.2'` (recommended home: `src/utils/locationTaxonomy.ts`, alongside the other standard-derived constants — confirm in Open decisions). Single source of truth; bump it in lockstep with the doc header.
- **Stamp at create only:** add `standard_version: LABELING_STANDARD_VERSION` to the create object in **`useCreateWorkbenchLabel`** (`src/hooks/useWorkbenchActions.ts`, the `createUnit.mutateAsync({...})` call). **Leave `useUpdateWorkbenchLabel` un-stamping** — per §10, an edit preserves the version the label was originally made under. The live-app create path (`useCreateUnit` via `saveNewUnitFromPopover`) leaves it `undefined` → column stays `NULL` for live units (which aren't corpus).
- Regenerate `src/types/database.types.ts`; the derived `Unit`/`UnitInsert` in `domain.ts` pick the column up automatically. Add a row to the root `README.md` migrations table.

**Approval gate:** ⛔ DDL — present the full SQL via the create-migration skill and **STOP**; apply dev/branch-first only after explicit owner approval. Additive + nullable only; no backfill; no RLS change.

**Exit criteria:** typecheck + build green · migration applied/verified on dev/branch · a newly-traced workbench label row has `standard_version='0.2'`; a live-app unit has `NULL`; editing a label does not change its stamp · close with verify-feature.

---

## PHASE F1 — Geometry foundation (pure, tested, NO UI)
*De-risk the hard part in isolation. All functions are framework-free, deterministic (data IN, no `Date.now()`/no I/O), in `src/utils/` with co-located `*.test.ts`.*

The research found the canvas/save pipeline and the percent-space coordinates already exist; **only the region-detection math is missing.** Build and unit-test it here before touching the canvas.

- **`src/utils/wallIsolation.ts` — `isolateWalls(vectors, opts)`**: given the raw `{start,end}` percent-space segments, return the subset that are "wall-like." Heuristics (tunable, since no layers): drop sub-threshold-length segments (already partly done backend-side), and — as a later refinement — prefer long/connected segments and reject lone thin strokes (dimension/leader noise). v1 can be a length + connectivity filter; the function signature must allow swapping in layer-based filtering later. Tests: empty, all-noise, a clean rectangle of 4 walls, walls + scattered furniture/dimension segments.
- **`src/utils/regionDetect.ts` — `detectRoomPolygon(walls, clickPt, opts)`**: the core. **Recommended approach: raster flood-fill** (most robust to messy soup + trivial gap-bridging), returning an ordered percent-space polygon or `null`:
  1. Rasterize `walls` onto an offscreen grid at a fixed resolution (in **aspect-corrected** space — see §coords).
  2. **Dilate** the wall pixels by `gapBridgePx` to close door openings / imprecise CAD joints (tunable; this is the gap-bridging knob).
  3. Flood-fill from `clickPt`; if the fill escapes to the image border, return `null` (open/leaky region — honest failure, not a garbage polygon).
  4. Trace the filled region's outer boundary (Moore-neighbor / marching squares) → dense pixel loop → back to percent space.
  - *(Alternative considered: exact planar-arrangement face-finding — vector-native but brittle on un-isolated soup and can't bridge gaps. Flood-fill + human edit is the pragmatic v1; note the trade-off.)*
- **`src/utils/polygonSimplify.ts` — `simplifyPolygon(points, tol)`**: Douglas–Peucker + collinear-vertex merge, to turn a many-hundred-point raster boundary into a clean editable polygon. Tests: collinear run collapses; a near-straight jagged edge simplifies within tol; a true corner is preserved.
- **`src/utils/geometry.ts` additions — `pointInPolygon(pt, poly)`** (ray-cast; currently missing) and a shared **shoelace `polygonArea`** (today it's inline-duplicated in `useMapActions.ts:184` and `workbench.ts`'s `computeLabelArea` — extract once, reuse). Tests for both.

**Coords (critical):** wall vectors, `draftPoints`, `pendingPolygonPoints`, and stored `units.polygon_coordinates` are **all percent space (0–1) of the page rect** — *no conversion* between them. BUT percent space is **anisotropic** (x and y normalized by different page dimensions), so any rasterizing/distance/offset math must apply the `aspect` (drawW/drawH) correction the snapping engine already uses (`geometry.ts` `getSnappedCoordinate`, and `FloorplanCanvas` `handleRotatePolygon`). Convert to aspect-corrected space, compute, convert back.

**Approval gate:** ⛔ none (no DB, no UI). **Exit criteria:** typecheck + test green with thorough fixtures; `npm run test` on the four new test files passes; no canvas changes yet.

---

## PHASE F2 — Wire the tool into the canvas (MVP, both surfaces)
- **New `toolMode: 'fill_room'`** in the map store's tool union (`src/store/useMapStore.ts`, explicit interface per §6) + a toolbar button (the canvas toolbar; keep logic OUT of `FloorplanCanvas` per §3 — the heavy lifting is the F1 utils).
- In **`FloorplanCanvas.handleStageClick`** (where `pctX/pctY` are already computed), when `toolMode==='fill_room'`: run `isolateWalls` → `detectRoomPolygon(walls, {pctX,pctY})` → `simplifyPolygon` → snap each vertex to the nearest wall via the existing **`getSnappedCoordinate`** (crisp corners, reuses the in-scope `vectorTree`) → call the existing **`onPolygonComplete(points)`**. That single call already drives the editable pending-polygon → naming popover → save pipeline in **both** the live map (`useMapActions.handlePolygonComplete`) and the workbench (`WorkbenchTracer.handlePolygonComplete`). **No save/popover wiring changes.**
- **Graceful failure:** if `detectRoomPolygon` returns `null` (leaky/open region, or no vectors — e.g. a scanned sheet), show a brief non-blocking hint ("Couldn't find an enclosed room here — trace it manually") and stay in the tool. Never drop a half-baked polygon.
- Register the new mode in the tool-reset effects and cursor logic already in `FloorplanCanvas`.

**Approval gate:** ⛔ none. **Exit criteria:** typecheck + build green · live `dev`: on a clean vector sheet, one click inside a room yields a snapped polygon in the editable pending state; naming/saving works unchanged in **both** the workbench and a live project; clicking empty space or a scanned sheet fails gracefully · close with verify-feature.

---

## PHASE F3 — Robustness pass (make it "actually work" on real sheets)
Tune against real architect PDFs (no layers). Iterate the F1 knobs — all data-driven, all still unit-testable:
- **Gap bridging:** calibrate `gapBridgePx` so standard door openings close without merging adjacent rooms.
- **Interior-face offset:** the standard wants the **interior** wall face traced; walls are double lines, so optionally offset the detected loop inward by ~half the local wall thickness (new `offsetPolygonInward` util, tested). If reliable offsetting proves brittle, defer and rely on the flood-fill naturally hugging the interior void + human edit (note the decision).
- **Wall isolation refinement:** strengthen `isolateWalls` against dimension strings / grid lines / furniture using length + connectivity + (later) double-line pairing.
- **Resolution/perf:** pick a raster resolution that's accurate but fast; ensure detection runs off the click without janking pan/zoom.

**Approval gate:** ⛔ none. **Exit criteria:** on a representative sample of real sheets, the median proposal needs only minor nudging (qualitative owner sign-off); typecheck + test + build green · close with verify-feature.

---

## PHASE F4 — Correction capture (the flywheel instrumentation)  ⛔ APPROVAL GATE (migration)
*The piece that makes the tool "improve the more we do" and feeds future ML. Do before real volume tracing so early traces aren't lost.*

- **Migration** `<today>_fill_proposal_events.sql`: a new additive table **`fill_proposal_events`** (id, sheet_id FK→sheets ON DELETE CASCADE, `proposed_polygon JSONB`, `final_polygon JSONB`, `accepted_unedited BOOLEAN`, `edit_distance NUMERIC` (how far the human moved it — a cheap pure metric), `standard_version TEXT`, `created_by UUID`, `created_at`). **RLS:** enable with the same member-read / privileged-write posture as `workbench_sheets` (read = any member, write = `owner`/`admin`/`pm`, **never `anon`**) — mirror an existing policy block; do not widen anything. Idempotent + additive.
- **Capture point:** when a `fill_room`-originated pending polygon is saved, write one event with the original proposal vs. the final saved polygon. (Tag the pending polygon's origin so only tool-proposed saves are logged, not hand-traced ones.)
- **Two payoffs from one capture:** (1) an **acceptance-rate / edit-distance metric** — the honest "is fill-from-walls faster than hand-tracing yet?" signal (surface a small stat in the workbench health strip via the existing `workbenchStats` pattern); (2) a **proposal→correction dataset** that is exactly what the future model trains on.

**Approval gate:** ⛔ DDL + new table + RLS — present full SQL via create-migration skill and **STOP**; dev/branch-first after approval. **Exit criteria:** saving a tool-proposed label writes one correct event; a hand-traced label writes none; the metric reflects real edits; RLS verified (no `anon`) · close with verify-feature.

---

## PHASE F5 — Confidence + auto-name + whole-sheet (OPTIONAL / gold-plating; defer until F1–F4 prove out)
- **Confidence score** per proposal (clean closed loop = high; lots of dilation/bridging = low) → color the pending polygon so the human knows what to trust. (Pure add to `regionDetect`.)
- **Auto-name from the PDF text layer** — *needs a NEW backend path* (`main.py`) to extract text + positions so a detected region can be pre-named from the drawing's own room labels. Biggest item; keep last; its own approval gate (backend change).
- **Whole-sheet batch** — detect all enclosed regions at once → a review queue of proposals to accept/reject. Huge multiplier once single-room detection is trusted.

**Approval gate:** ⛔ (F5 auto-name only) backend change. **Exit criteria:** per sub-feature; each shippable alone.

---

## Build-on inventory (read fresh before using; line numbers drift)
- **`src/hooks/useSnappingVectors.ts`** — loads wall vectors (percent space) as raw JSON `{start:{pctX,pctY}, end:{pctX,pctY}}[]`; 3-layer cache. **Never** put the `RBush` index in Query cache (§5).
- **`src/components/FloorplanCanvas.tsx`** — `handleStageClick` (the click entry; `pctX/pctY` already computed), `rawVectors`/`vectorTree` in scope, `aspect` available, `onPolygonComplete` callback, tool-reset effects. Keep new logic in utils/hooks, **don't bloat this file** (§3).
- **`src/components/canvas/PendingPolygon.tsx` / `DraftPolygon.tsx`** — the editable pending polygon (drag shape + vertices) the proposal lands in; display-only draft renderer.
- **`src/hooks/useMapActions.ts`** — `handlePolygonComplete` (opens naming popover), `saveNewUnitFromPopover` (live save + inline shoelace area at ~`:184`).
- **`src/components/workbench/WorkbenchTracer.tsx` + `WorkbenchLabelPopover.tsx` + `src/hooks/useWorkbenchActions.ts`** — the workbench finish/save path (`useCreateWorkbenchLabel` → reuses `useCreateUnit`); **the Phase V stamp goes in the create object here.**
- **`src/hooks/useProjectQueries.ts`** — `useCreateUnit` (the single physical `units` insert; generic, spreads `Partial<Unit>`).
- **`src/utils/geometry.ts`** — `getSnappedCoordinate` (aspect-aware vertex snap — reuse for crisp corners), `distToSegment`, `getCentroid`; **add** `pointInPolygon` + shared `polygonArea`.
- **`src/utils/locationTaxonomy.ts`** — recommended home for `LABELING_STANDARD_VERSION`.
- **`src/utils/workbenchStats.ts`** — the pure-stats pattern to extend for the F4 acceptance metric.
- **`src/types/queryKeys.ts`** — add keys if F4 stats get their own query.
- **Do NOT touch:** `progressAnalytics`/`bottleneck`/`mapDisplayStatuses`, `status_logs`, the offline `pendingChanges` queue, `main.py` (until F5), RLS posture.

## Hard guardrails (AGENTS.md — do not violate)
- **No backend/auth/RLS changes** until F5; no `anon` grants; no service-role from the client. F4's new table reuses the established member-read/privileged-write RLS pattern.
- **Region-detection math lives in pure, tested `src/utils/` modules** — not inline in `FloorplanCanvas` (§3). The canvas only routes a click to the util and the result to `onPolygonComplete`.
- **Reuse the existing save pipeline** (`onPolygonComplete` → pending polygon → popover → `useCreateUnit`) in both surfaces. Don't fork it.
- **Percent space throughout; apply `aspect` correction** for any geometric measurement (§5).
- **Additive, nullable, idempotent migrations** (V, F4); regenerate `database.types.ts`, derive in `domain.ts`; data-touching/DDL is gated + dev-first.
- **Types:** no `any`; new files `.ts`/`.tsx`; narrow JSONB at the boundary; explicit Zustand interfaces.
- **Tests:** Vitest globals OFF (import from `'vitest'`); co-locate `*.test.ts`; the F1 geometry utils are the priority coverage.
- Whole-repo lint is NOT a gate (large pre-existing backlog) — typecheck + test + build are.

## Verification commands (adjust `--prefix` to your local absolute path)
```
npm --prefix sitepulse-next run typecheck   # tsc --noEmit (primary gate)
npm --prefix sitepulse-next run test         # vitest (target one file: ... run test -- src/utils/regionDetect.test.ts)
npm --prefix sitepulse-next run build         # next build (after editing live components / new tool)
```
Live UI: `npm run dev` from `sitepulse-next/`. The backend is only needed for NEW PDF ingest / vector extraction, not for the fill tool on an already-ingested sheet.

## Open decisions (resolve at the noted phase)
- **`LABELING_STANDARD_VERSION` home + value** (Phase V): recommend `src/utils/locationTaxonomy.ts`, store bare `'0.2'` (not `'0.2 (Draft)'`) for clean filtering. Confirm.
- **Re-stamp on edit?** (Phase V): recommend **no** (preserve original-version provenance per §10). Confirm.
- **Region-detection approach** (F1): recommend **raster flood-fill** over exact planar arrangement for robustness + gap-bridging. Confirm before building.
- **Interior-face offset now or deferred?** (F3): recommend build it, but fall back to flood-fill-hugs-interior + human edit if offsetting proves brittle on double-line walls.
- **F4 edit-distance metric definition**: recommend a simple normalized vertex-displacement / area-delta measure (pure, testable). Confirm the exact formula at F4.
- **Auto-name backend path** (F5): defer; decide whether it's worth the only backend change in this plan once single-room detection is trusted.

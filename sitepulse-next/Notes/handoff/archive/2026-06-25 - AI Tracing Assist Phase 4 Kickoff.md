# Kickoff — AI Tracing Assist, Phase 4: openings as tagged room-boundary edges

> **⚠️ This SUPERSEDES the earlier "jamb-to-jamb floating line" framing of Phase 4.** After a design
> review (2026-06), openings are captured **inline, as tagged edges of the room polygon** — not as
> separate floating lines in a `sheet_openings` table. Reasons, recorded so a future session doesn't
> revert: (1) an opening tagged *on the boundary you're already tracing* is **free** (byproduct of the
> trace), **perfectly located**, and **attributed to its room**; (2) it directly serves the two goals
> that matter — **room-closing** (the human closes the room by tracing through the doorway; the tag just
> records it was an opening) and **room connectivity** (an opening on a shared wall links two rooms);
> (3) door-*object* detection is handled separately via an anchored, optional layer (§ 4d). The old
> floating-line tool would have produced unattributed geometry and still needed all of this.

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 4 of AI Tracing Assist** (**openings as tagged room-boundary edges** — the tracer
> marks floor-level passages on a room's perimeter as they trace; reconciliation derives canonical
> openings + a room-connectivity graph; the review DoD gains opening + completeness checks). Read in full:
> - `sitepulse-next/Notes/handoff/2026-06-25 - AI Tracing Assist Phase 4 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/AI-Tracing-Assist-Plan.md` (§ Phase 4)
> - `docs/ANNOTATION_SPEC.md` (§2 geometry incl. the wall-protrusion rule; §3 naming) and `sitepulse-next/AGENTS.md`
>
> Work on branch `claude/ai-location-tracing-pipeline-ip709o` (Phases 1–3 merged; branch == `main`).
> Build the sub-phases **4a → 4b → 4c** in order (**4d is deferred/optional**). **4a and 4c each carry an
> approval-gated migration** — present SQL via the `create-migration` skill and **STOP for owner approval
> before applying**. Verify each slice with the live `dev:3010` click-through + `verify-feature`.
> **Do not commit or push until the owner says "Approved."**

---

## What this delivers (plain English)
While tracing a room, when the tracer reaches a doorway they **drop a node at one jamb, hold a key to
enter "opening" mode, click the other jamb, and that edge of the polygon is marked as an opening** (shown
in a distinct color), then they keep tracing. The room closes normally; the boundary just carries little
"this segment is a door" tags. From those raw per-room tags the app **derives** the real openings (merging
the two sides of each shared wall) and a **room-connectivity graph** — and the review screen gains checks so
a sheet isn't called "reviewed" until its openings and completeness are sound. Door *symbols* (swing/type
for counting) are a separate, optional later layer (§ 4d) that also rides the free CAD-layer path.

## The core principle (this is what makes it rock-solid)
**Capture raw truth cheaply; derive everything else.** The human only ever tags openings on *their own
room's* edges. Canonical openings, connectivity, dedup, and door-objects are all **derived** by a
deterministic, re-runnable pass — never captured a second time by hand. The raw per-room tags are the
ground truth and are never altered by derivation.

## Scope: WHAT gets tagged (precise — no handwave)
Tag **floor-level passages only** — anything you can walk or drive through, where the enclosure is
interrupted *at floor level*:
- `door` — a doorway (with or without a leaf)
- `cased_opening` — an archway / cased opening / wide pass-through with no door
- `overhead` — overhead/coiling/garage door (e.g. a carwash wash-bay entry/exit)
- `pass_through` — a service pass-through at floor level

**Do NOT tag windows.** A window sits above the sill, so **at floor level the wall is solid beneath it** —
the floor boundary is continuous there and a window is *not* on the boundary you trace. Tagging it would
mislabel solid-at-floor wall as an opening. Windows are a **separate wall-feature layer** and come **free
from the CAD `A-Glaz` layer** (Phase 3.5); out of scope here. *Edge case — full-height storefront/curtain
wall:* the boundary follows the glass (it's the enclosure); tag only the actual **door** openings within it,
not the glazing run.

**Completeness rule (load-bearing for training):** if you tag openings on a room, tag **all** of its floor
passages. A half-tagged room teaches the model the untagged doors are solid wall — the same false-negative
poison as partial room-tracing. The review DoD (§ 4c) enforces this via the completeness flag.

---

## Sub-phasing (ship + verify each)

### Phase 4a — inline opening-edge capture (the raw truth)
- **Data model — on `units` (NOT a separate per-sheet table):** add `opening_edges JSONB NOT NULL DEFAULT
  '[]'` =
  `[{ edgeIndex:int, type:'door'|'cased_opening'|'overhead'|'pass_through' }]`, where `edgeIndex` is the
  index of the **start vertex** of the polygon edge (`polygon_coordinates[edgeIndex] → [edgeIndex+1]`).
  Referenced **by index** so tags ride polygon edits. Openings are part of the room, so they ride the
  **existing unit write path + M1 provenance + `trace_events`** — do NOT add a parallel capture mechanism or
  a `sheet_openings` capture table. The two jamb nodes the tracer places ARE two consecutive polygon
  vertices, so an opening is exactly one polygon edge (multiple openings on one wall = multiple vertex pairs
  — natively unambiguous).
- **Capture UX — integrated into tracing (`WorkbenchTracer` + `FloorplanCanvas`):** while drawing the
  polygon, an "opening mode" modifier (hold-key, plus a small active-type control defaulting to `door`)
  makes the *next placed edge* an opening of the active type; the edge renders in a distinct color. Also
  provide **edit-after**: select a saved room → click one of its boundary edges → set/clear its opening
  type (for corrections and for rooms traced before Phase 4). State (active type, in-progress opening edges)
  in `useWorkbenchStore` per §2 — never `useState`/`useEffect` for data.
- **Overlay:** opening edges drawn over the room boundary, color/icon per type; reuse the Konva overlay
  pattern from 3b/3c (`listening={false}` for display; gate interactivity on selection).
- **Pure logic (`src/utils/openingEdges.ts` + vitest):** add/remove/normalize an opening tag on a polygon;
  **keep `edgeIndex` valid across vertex insert/delete/move** (the lifecycle rules below); derive each
  opening's segment `{p1,p2}` from the polygon for rendering/reconciliation. Deterministic; mirror
  `gridlineParse.ts` test style.
- **Lifecycle rules (pin these — easy to handwave):**
  | Parent-room event | Opening tags |
  |---|---|
  | Status/milestone change | untouched (orthogonal data) |
  | Polygon vertex moved | tag rides it (index-referenced) |
  | Vertex/edge inserted or removed | re-index tags; an opening whose edge is removed is dropped + a `trace_event` logs it |
  | Room deleted | tags cascade with the row; reconciliation re-runs (a shared opening loses that neighbor) |
  | Room re-traced | old tags retire (provenance kept); re-tag on new geometry |
- **Approval gate:** ⛔ migration adds `opening_edges` to `units` — SQL via `create-migration`, **STOP** for
  approval. Reflect in `database.types.ts` + `domain.ts` (new `isOpeningEdgeArray` guard; narrow at the
  query boundary). No RLS change (rides `units`).
- **Exit:** typecheck + test + build green · opening-edge add/remove/re-index unit-tested (incl. vertex
  insert/delete) · live `dev:3010`: trace a room tagging interior + exterior passages, reload redraws them,
  edit-after works, delete the test room leaves prod clean · `verify-feature` → stop.

### Phase 4b — reconciliation: derive canonical openings + connectivity (pure logic, no capture)
- **Scope:** a **pure, unit-tested** function `reconcileOpenings(unitsWithOpeningEdges, opts)` →
  `{ openings:[{ id, segment, type, neighborUnitIds[], sourceEdges[], confidence, flagged? }], adjacency }`.
  It **never mutates the raw tags.** Consumed at export; optionally materialized to a **derived**
  `sheet_openings` table later (only when connectivity/door-object features need a queryable store — not in
  4b).
- **The cross-wall match (because we trace INNER faces, the two sides of a doorway are parallel and offset
  by the wall thickness — a coincidence/tolerance test is WRONG).** Two opening edges are the same physical
  opening iff **all** hold:
  1. **Parallel** — orientation within `angleTol` (~5–10°).
  2. **Facing** — the offset between them is ~perpendicular to their direction (separated *across* the wall,
     not *along* it).
  3. **Projection overlap** — projected onto the wall direction, spans overlap ≥ `overlapFrac` (~0.5–0.6).
  4. **Separation within a bounded wall-thickness band** — perpendicular gap within `[minWall, maxWall]`
     (NOT a snapping tolerance). The AND of these four is what prevents false merges.
  - **Strengtheners:** (a) if sheet **scale** (MW.1) is known, express the band in **real inches** for
    precision; else a conservative band + the other three criteria still constrain it. (b) **Wall-material
    check** — confirm wall vectors actually sit *between* the two edges (a real wall separates them), which
    kills false matches across open boundaries.
- **Backstop (never guess destructively):** high-confidence pairs auto-merge; **ambiguous pairs emit a
  `flagged` candidate for human confirm** (surfaced in 4c), not a silent merge; an edge that matches nothing
  stays a valid **one-neighbor opening** (exterior door, or an untraced neighbor) — nothing dropped or
  invented. **Type conflict** (one side `door`, other `cased_opening`) → flagged with a deterministic
  tiebreak, recorded.
- **Approval gate:** none (pure logic + export; no schema, no capture). Materializing a derived table, if/when
  done, is its own gated migration.
- **Exit:** `pytest`/vitest green with fixtures for: thin-wall pair, thick-wall pair (offset), exterior
  singleton, misaligned-no-match, two-doors-same-wall (projection separates them), type-conflict-flag,
  no-scale fallback · `verify-feature` → stop.

### Phase 4c — review-DoD integration (the sign-off that a sheet is clean training data)
- **Scope:** extend `WorkbenchReviewTable` + its definition-of-done (`dod`) so openings + completeness are
  part of `draft → ready_for_review → reviewed`:
  - **Openings indicator per row** — passage count per location (spot a room missing its openings).
  - **DoD checks gating "Mark reviewed":** (1) **all `flagged` reconciliation candidates resolved** (4b
    conflicts/ambiguous matches); (2) **completeness flag set** (below).
  - **Completeness flag** — a **per-sheet** `fully_traced` boolean (the training-eligibility gate from the
    corpus-completeness discussion). It declares "every room AND every floor passage on this sheet is
    traced" → the sheet is a clean, exhaustively-labeled training example. Partial/product-use sheets stay
    `false` and are **excluded from the training export** (so normal team usage never poisons the corpus).
    This flag governs export eligibility broadly, not just openings.
- **Openings stay OUT of the field-progress status table** — they're geometry metadata, not tracked
  locations. The review DoD is their only product surface.
- **Approval gate:** ⛔ migration adds `fully_traced` (+ any flag-resolution state) to `sheets`/
  `workbench_sheets` — SQL via `create-migration`, **STOP** for approval. Reflect in types.
- **Exit:** typecheck + test + build green · DoD-check pure logic unit-tested · live `dev:3010`: a sheet
  with an unresolved flagged opening and `fully_traced=false` **cannot** be marked reviewed; resolving the
  flag + setting completeness unlocks it · training export excludes a `fully_traced=false` sheet ·
  `verify-feature` → stop.

### Phase 4d — door-OBJECT capture (DEFERRED / optional — build only when door-detection is a goal)
- **Scope:** the door-symbol layer that edge-tags can't give (leaf/swing/type/count). UX: **enable tool →
  click an existing opening (this anchors it) → draw a box/mask around the door symbol → set
  `door_type`/`swing`.** Clicking the opening first makes the association an explicit human link (no
  geometric guessing). Door-object = **child of the opening entity**, populating reserved nullable fields
  `{ opening_id, geometry, door_type, swing?, door_number?, method, source, review_status }`; **cascades**
  with its opening.
- **Ranks BELOW the free CAD path:** Phase 3.5's `A-Door`/`A-Door-Jamb` layer extraction gives door symbols
  **free on layered sheets**, auto-associating to opening entities by location. The manual box tool is for
  **layerless sheets** / when a door-detection model is wanted. **Optional, never a per-trace requirement.**
- Out of scope here; spec'd so the hook exists.

## Deferred / explicitly NOT in Phase 4
- **Auto-close rooms** from walls + openings — the manual trace already closes rooms; openings are the
  *input* to a future auto-closer (gated on layered/opening coverage being worth it).
- **A machine-proposal layer for openings** — Phase 4 is human-tagged; a detector can fill suggestions later
  (provenance already supports `ai_suggested`).
- **Windows / glazing** — separate wall-feature layer, free from CAD `A-Glaz` (Phase 3.5).
- **Door-installation status tracking** (door hung, hardware set) — that's a door-schedule *product* feature,
  not training data. Different decision entirely.

## Hard guardrails (AGENTS.md)
- **§2:** all tool/overlay/in-progress state in `useWorkbenchStore` (Zustand), never `useState`/`useEffect`
  for data; never touch the `pendingChanges` offline queue; opening writes ride the existing **unit**
  Query mutation + provenance, not raw inserts. Opening capture is **online-only**.
- **§4/§6:** reflect `opening_edges` (and `fully_traced`) in `database.types.ts` + derive in `domain.ts`;
  narrow the JSONB at the query boundary (`isOpeningEdgeArray`), no `Json` in props.
- **§3:** Konva overlay isolation; never recolor/mutate `mapDisplayStatuses`.
- **§5:** no class instances in the Query cache; raw JSON only.
- **§7:** no backend in 4a/4c (frontend-pure over the canvas + the unit write). 4b is pure TS (could also run
  in the export pipeline). 4d's CAD-layer association rides Phase 3.5's backend.
- **Capture invariant (M1):** openings ride the unit's `method`/`source`/`review_status`/`spec_version` +
  `trace_events`. Do NOT invent a second capture path.
- ⛔ **Migration gates:** 4a (`units.opening_edges`) and 4c (`sheets.fully_traced`) — SQL via
  `create-migration`, STOP for approval, apply to prod only on go-ahead.

## Verification commands
```
npm --prefix sitepulse-next run typecheck
npm --prefix sitepulse-next run test      # one file: run test -- src/utils/openingEdges.test.ts
npm --prefix sitepulse-next run build
```
- Lint is NOT a gate. No E2E — verify via live `dev:3010` click-through. Vitest globals OFF.
- On approval of each slice: fast-forward `main`. After 4c, draft the **Phase 5 (detail callouts)** kickoff —
  or **Phase 3.5 (CAD-layer extraction)** if the owner reprioritizes (it supersedes hand-capture on layered
  sheets and feeds 4d for free).

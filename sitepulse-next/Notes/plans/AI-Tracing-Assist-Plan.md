# AI Tracing Assist — cold-start auto-tracing for the workbench (self-contained build plan)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: `docs/ai-tracing-pipeline-plan.md` (Milestone 2) + `docs/ANNOTATION_SPEC.md`.
> Milestone 1 (training-data capture) is DONE + live on prod — this builds on it.

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) + the parent specs above.
2. Re-read the files named below fresh — do not trust line numbers; they drift.
3. Build the phases in order. Verify after each (§ Verification commands).
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2
   sentence plain-English summary; explain jargon in passing; keep it short.

## Goal
When this is done, a workbench user can open a drawing, click **“Auto-trace sheet,”**
and the app proposes the rooms on that sheet automatically — drawing the polygons
and pre-filling each name from the PDF’s own text. The user reviews the proposals
on screen and **accepts, tweaks, or rejects each one**; accepted rooms become real
locations, and every accept/edit/reject is recorded as training data through the
capture layer already shipped in Milestone 1. The headline win: tracing a sheet
goes from “draw every room from scratch” to “correct a first draft,” at **zero
per-sheet cost** for the geometric path (no GPU, no AI bill).

## Out of scope / deferred
- **SAM click-to-segment** (the paid, Replicate-hosted AI for irregular rooms the
  geometric detector misses). Deferred by owner decision — ship the free path first,
  add SAM later only if geometric coverage proves insufficient. Gets its own kickoff.
- **A trained custom model** (Milestone 3) — this milestone produces the *assist*
  that speeds up building the training corpus; the model that learns from it is later.
- **Batch / background processing** — proposals run inline, per-sheet, on demand
  (no job queue; that decision is locked in the parent plan).
- **Offline support for proposals** — Auto-trace is an online-only action; it never
  touches the `pendingChanges` offline queue.

## Locked product decisions (from the owner)
- **Proposals live on screen until accepted.** Un-accepted proposals are NOT written
  to the DB — only accepted ones become `units`. Rejects log a `reject_suggestion`
  event but persist nothing. Keeps the location list / corpus counts clean; re-running
  the (free) detector is the “undo” for a lost session.
- **SAM deferred** (see Out of scope).
- **Naming is text-layer-first; AI typing is a thin paid layer.** Names come free from
  the PDF text layer (Phase 1–2). Claude vision only *suggests the type* (role/subtype),
  Sonnet by default, and only in Phase 4 — it never produces geometry.
- **Build profile:** solo tracer + solo dev, hundreds of sheets, ~$150/mo cap, owned
  PDFs, custom model as the long-term goal. Favor the free/geometric path; keep it lean.
- **Commercial-licensing hard rule:** only Apache/MIT/BSD libraries. Shapely (BSD) is
  the geometric engine. No CC-BY-NC / GPL / AGPL models or datasets, ever.

## Data model
- **New table `sheet_text`** (Phase 1) — a 1:1 cache of a sheet’s extracted text words,
  mirroring `sheet_vectors` exactly (cache table keyed by `sheet_id`, JSONB payload,
  write-through). Stores `[{ text, pctX, pctY }]` (word + centroid in the same percent
  space as `polygon_coordinates` and `sheet_vectors`). RLS mirrors `sheet_vectors`.
  ⛔ **Migration — present the SQL via the `create-migration` skill and STOP for
  approval before applying. Never touch production data without the owner’s go-ahead.**
- **No other schema changes.** Accepted proposals are written through the EXISTING
  `useCreateWorkbenchLabel` path, which already carries the Milestone-1 provenance
  columns (`method`/`source`/`suggested_polygon`/`suggested_label`/`review_status`/
  `spec_version`) and emits `trace_events`. Reuse it — do NOT add a parallel write path.
- **Reads:** `sheet_vectors` (existing snapping cache) for wall geometry; `sheet_text`
  (new) for names; `sheets` for the converted-preview dimensions / scale.

## Build-on inventory (read these fresh before using)
**Frontend (reuse, do not fork):**
- `src/hooks/useWorkbenchActions.ts` — `useCreateWorkbenchLabel` already accepts
  `method`/`source`/`suggestedPolygon`/`suggestedLabel`/`modelVersion`/`durationMs`.
  The accept path passes these; this is the whole point of Milestone 1. Do not bypass it.
- `src/utils/traceCapture.ts` — `recordTraceEvent` (for `reject_suggestion`),
  `TraceMethod`/`TraceSource`, `labelSnapshotFromUnit`. Reuse verbatim.
- `src/components/workbench/WorkbenchTracer.tsx` + `WorkbenchTracerToolbar.tsx` — where
  the “Auto-trace sheet” action and the proposal-overlay state mount.
- `src/components/FloorplanCanvas.tsx` — the shared canvas; proposals render as a
  distinct overlay layer. Respect §3 (no recolor of `mapDisplayStatuses`; native-event
  isolation for HTML overlays).
- `src/store/useWorkbenchStore.ts` — floating UI state belongs here (proposal list,
  active-proposal index), per AGENTS.md §2. NOT `useState`/`useEffect`.
- `src/utils/geometry.ts` — `getSnappedCoordinate` for snapping an edited proposal vertex.
- `src/hooks/useSnappingVectors.ts` — the `sheet_vectors` read pattern to copy for `sheet_text`.

**Backend (reuse the established patterns — AGENTS.md §7):**
- `sitepulse-backend/main.py` — `get_current_user` (ES256/JWKS auth dep),
  `verify_sheet_access`, `asyncio.to_thread(...)` for CPU work, `extract_vectors_from_pdf`
  + its `map_point()` PDF→percent transform (reuse for text extraction so words land in
  the SAME percent space), the `sheet_vectors` write-through endpoint + `backfill_vectors.py`
  one-off script (the model for a `sheet_text` backfill).

## Pure logic to extract + unit-test
This is where correctness lives — keep it framework-free and deterministic (pass inputs
in; never call `Date.now()`/network inside pure fns).
- **Backend (pytest, `sitepulse-backend/tests/`):**
  - Text extraction: PDF page words → `[{text, pctX, pctY}]` via `map_point` (test the
    percent mapping with a tiny fixture, mirroring how vectors are tested).
  - Geometric room proposal (Phase 2), broken into testable units: segment cleanup /
    snap-round (`shapely.set_precision`), doorway-gap closing, `polygonize(unary_union())`,
    sliver/área filtering, simplify, percent-convert. Test on hand-built segment sets
    (a clean rectangle, an L-room, a room with a door gap, a donut/void).
  - Interior-text naming: point-in-polygon match of words → candidate `unit_number`
    (test a word inside vs. outside vs. on the boundary).
- **Frontend (vitest, co-located `.test.ts`):**
  - Proposal → `CreateWorkbenchLabelInput` mapping on accept (method=`geometric`,
    source=`ai_accepted` vs `ai_edited` when the user changed geometry/name, and the
    frozen `suggestedPolygon`/`suggestedLabel` are the ORIGINAL proposal).
  - Any percent-geometry helpers used by the overlay (e.g. proposal bounding box).

## Sub-phasing (ship + verify each)

### Phase 1 — `sheet_text` extraction + cache (backend)
- **Scope:** New `sheet_text` cache table; a `/extract-text/{sheet_id}` endpoint that
  runs PyMuPDF `page.get_text("words")`, maps each word through the existing `map_point`
  transform into `{text, pctX, pctY}`, and write-through-caches it (mirror the
  `sheet_vectors` endpoint). A `backfill_text.py` one-off script modeled on
  `backfill_vectors.py`. pytest for the percent mapping + empty-text (scanned PDF) path.
- **Approval gates:** ⛔ **DB migration** — generate the `sheet_text` SQL via the
  `create-migration` skill, show the exact SQL, and **STOP** for owner approval before
  applying. Mirror `sheet_vectors` RLS. Never touch production data without go-ahead.
- **Exit criteria:** typecheck (frontend types if any) + `pytest -q` green · pure text
  mapping unit-tested · endpoint returns located words for a vector sample sheet and an
  empty list for a scanned one · close with the `verify-feature` skill (DoD → stop; do
  not commit/push until the owner says “Approved”).

### Phase 2 — geometric room proposal (backend)
- **Scope:** Add **Shapely (BSD)** to `requirements.txt`. New `/propose-rooms/{sheet_id}`
  endpoint: read `sheet_vectors` (+ `sheet_text` for names) → snap-round → close doorway
  gaps → `polygonize(unary_union(segments))` → drop slivers → simplify → convert to
  percent polygons → attach an interior-text name + a confidence score. Returns
  `[{ polygon: PercentPoint[], name: string|null, confidence: number }]`. Headless — no
  UI yet. Heavy pytest coverage of the pure geometry (see § Pure logic).
- **Approval gates:** new dependency (Shapely) — call out the license (BSD) in the PR.
  No migration. No production data writes.
- **Exit criteria:** `pytest -q` green · geometry unit-tested on rectangle / L-room /
  door-gap / donut fixtures · endpoint returns sensible rooms on a real clean sheet ·
  `verify-feature` → stop.

### Phase 3 — “Auto-trace sheet” overlay UI (frontend) — the headline
- **Scope:** A toolbar action in `WorkbenchTracerToolbar` → calls `/propose-rooms` →
  stores proposals in `useWorkbenchStore` → renders them as a **distinct suggested-overlay
  layer** on `FloorplanCanvas`. Per-proposal **accept / edit / reject**: accept writes a
  `units` row via the EXISTING `useCreateWorkbenchLabel` (method=`geometric`,
  source=`ai_accepted`/`ai_edited`, frozen `suggestedPolygon`/`suggestedLabel`); reject
  calls `recordTraceEvent({ eventType: 'reject_suggestion', ... })` and persists nothing.
  Proposals are **client-side only** (owner decision) — cleared on accept/reject/leave.
- **Approval gates:** none (no schema, no external API). Respect AGENTS.md §2 (proposal
  state in Zustand, not `useState`/`useEffect`) and §3 (overlay isolation; don’t recolor
  `mapDisplayStatuses`).
- **Exit criteria:** typecheck + test + build green · accept/edit/reject mapping
  unit-tested · **live `npm run dev:3010` click-through**: auto-trace a real sheet, accept
  some, edit one, reject one; confirm accepted rooms persist with correct provenance and a
  `trace_events` row, rejects persist nothing · `verify-feature` → stop.

### Phase 4 — Claude-vision type suggestion (backend + thin frontend wire)
- **Scope:** A `/suggest-types` endpoint (Anthropic API, **Sonnet** default; Opus only
  for dense sheets) that takes a room crop/context + the taxonomy and returns a suggested
  `top_level_role` + subtype via **Structured Outputs** (strict JSON). The overlay shows
  the suggestion as a pre-fill the user confirms; geometry and name are untouched (text
  layer already named it). Vision **never** produces polygons.
- **Approval gates:** ⛔ needs `ANTHROPIC_API_KEY` in the backend env (owner provisions).
  Cost is a few dollars total at this volume; note expected per-sheet cost in the PR.
- **Exit criteria:** `pytest -q` green (mock the API) + frontend typecheck/test/build ·
  a real sample of ~10 sheets reviewed for type-suggestion quality · `verify-feature` → stop.

## Hard guardrails (AGENTS.md — do not violate)
- **§2:** proposal/overlay state goes in `useWorkbenchStore` (Zustand), never `useState`/
  `useEffect` for data; never touch the `pendingChanges` offline queue; accepted writes go
  through the existing Query mutation hooks, not raw inserts.
- **§4 / §6:** any schema change (the `sheet_text` table) must be reflected in
  `database.types.ts` (Tables block) and derived in `domain.ts`; narrow JSONB at the query
  boundary (no `Json` in props); derive types from `database.types.ts`, never hand-duplicate.
- **§3:** overlays use native-event isolation; never recolor `mapDisplayStatuses`.
- **§5:** `sheet_text` follows the `sheet_vectors` write-through cache pattern; don’t store
  class instances in Query cache.
- **§7:** backend endpoints use `Depends(get_current_user)` + `verify_sheet_access` +
  `asyncio.to_thread`; PyJWT only; no debug file writes; 25s client timeouts stay.
- **Capture invariant (Milestone 1):** accept = the existing `useCreateWorkbenchLabel`
  with `method`/`source`/`suggested_*`; reject = `recordTraceEvent('reject_suggestion')`.
  Do NOT invent a second capture path — the whole pipeline depends on one.

## Open decisions
- **Door-gap closing strategy** (extend wall stubs vs. insert door-closing segments vs.
  morphological close on a raster fallback) — resolve empirically in Phase 2 against real
  sheets; `polygonize_full` dangles are the diagnostic. Not a blocker to start.
- **Confidence score definition** for proposals (e.g. closed-polygon area vs. dangle
  count) — settle in Phase 2; it only drives overlay sort/emphasis in Phase 3.

## Verification commands (exit-criteria gate)
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck   # tsc --noEmit (primary gate)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test         # vitest (one file: run test -- src/utils/foo.test.ts)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build        # next build (after editing live components)
python -m pytest -q   # from sitepulse-backend/ (after backend changes)
```
- **Lint is NOT a gate** (~1850 pre-existing problems) — verify with typecheck + test + build.
- **No E2E** — UI/canvas verification is a live `npm run dev:3010` click-through (port 3010).
- Vitest globals OFF: import `{ describe, it, expect, vi }` from `'vitest'`; co-locate tests.

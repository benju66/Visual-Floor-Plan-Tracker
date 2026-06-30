# AI Tracing Assist — verified-capture workbench (self-contained build plan)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: `docs/ai-tracing-pipeline-plan.md` (Milestone 2 + the 2026-06 feasibility findings) + `docs/ANNOTATION_SPEC.md`.
> Milestone 1 (training-data capture) is DONE + live on prod — this builds on it.

> **⚠️ This plan was revised 2026-06 after a feasibility test on 3 real sheets (projects A/B/C).**
> The original framing led with a **geometric whole-sheet auto-detector** ("Auto-trace sheet"). That test
> showed automatic **room-closing is the brittle bottleneck** — walls isolate fine, but rooms leak through
> door/window gaps (~16 of ~40 recovered, parameter-sensitive), and the wall "signature" differs per project
> (A = medium-black; B = heavy any-color; C = heavy-black), so hand-tuned geometric rules don't generalize.
> **Decision: geometric auto-detect is DEFERRED.** The bootstrap is now **manual tracing on the existing
> snapping engine + a set of fast, human-verified capture tools** that produce clean, multi-task training data.
> See `docs/ai-tracing-pipeline-plan.md` → "Feasibility findings" for the full evidence.

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) + the parent specs above.
2. Re-read the files named below fresh — do not trust line numbers; they drift.
3. Build the phases in order. Verify after each (§ Verification commands).
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2
   sentence plain-English summary; explain jargon in passing; keep it short.

## Goal
When this is done, a workbench user traces rooms with the **existing snapping engine** while the app does the
typing for them: each room's **name auto-fills** from the PDF's own text layer, and a set of **fast,
human-verified capture tools** record the rest of the sheet's structure — **sheet title block (incl. the
architect/firm), gridlines, door/window openings, and detail callouts**. The app *proposes*; the human
*confirms or nudges*. Every confirmed mark is written through the Milestone-1 capture layer as clean training
data. The headline win is twofold: tracing goes from "type every name" to "confirm a first draft," and each
sheet yields a **multi-task** dataset (rooms + names + grid + openings) that makes the eventual model (M3)
better — not just a pile of polygons.

## Why verified capture (not raw extraction)
A raw auto-extraction is fine as a *feature* but weak as *training data* — it's unverified. A
**human-confirmed** extraction is ground truth. So every cheap extraction below is "app proposes → human
confirms/overrides," with an **"accept all"** fast path so a clean sheet is one click, not twenty
confirmations. The only cost is per-sheet time; we manage it by (a) making the auto-detect good enough that
confirmation is a glance, and (b) **tiering** which tools run on every sheet vs. a subset (see § Capture tiers).

## Out of scope / deferred
- **Geometric whole-sheet room proposal** (the original Phase 2 — `polygonize`/door-gap closing). Deferred per
  the feasibility findings. If revisited, the **vector** `shapely.polygonize` path is untested and *might* beat
  the raster attempt that failed — but it still needs per-project wall isolation, so treat it as a research
  spike, not the bootstrap. Lives now as the last phase, gated on need.
- **SAM click-to-segment** (paid, Replicate-hosted, for irregular rooms). Deferred by owner; ship the free path
  first. Gets its own kickoff.
- **A trained custom model** (Milestone 3) — this milestone builds the *assist* that grows the corpus; the
  model that learns from it is later. The model is also the "fully adaptive" version of § Calibration.
- **Batch / background processing** — proposals run inline, per-sheet, on demand (no job queue; locked in parent plan).
- **Offline support for proposals** — auto-extract/auto-name are online-only actions; they never touch the
  `pendingChanges` offline queue.

## Locked product decisions (from the owner)
- **Bootstrap = manual trace + verified capture**, not geometric auto-detect (see ⚠️ above).
- **App proposes, human confirms.** Every extraction is reviewable/overridable; nothing auto-commits. An
  "accept all" bulk-confirm keeps clean sheets fast.
- **Naming is text-layer-first; AI typing is a thin paid layer.** Names come free from the PDF text layer.
  Claude vision only *suggests the type* (role/subtype), Sonnet by default, and only as a late phase — it never
  produces geometry.
- **Capture the architect/firm per drawing.** Drawing style clusters by firm (the A/B/C variance is really a
  per-firm-template variance). Firm is a stratification key for train/test splits (test on an unseen firm) and
  the key for the per-set calibration profile. It comes from the title block — captured by that tool, not a
  separate step.
- **Capture tiers (manage solo-tracer time):**
  | Tier | Tools | Cadence |
  |---|---|---|
  | Core | Rooms + auto-names | Every sheet |
  | Cheap & organizing | Sheet title block (number/name/**firm**), gridlines | Every sheet (fast verify) |
  | Seed-the-detector | Door/window openings | A subset of sheets |
  | Passive / later | Detail callouts | Auto-extract; verify only if/when it becomes a product |
- **Build profile:** solo tracer + solo dev, hundreds of sheets, ~$150/mo cap, owned PDFs, custom model the
  long-term goal. Favor the free path; keep it lean.
- **Commercial-licensing hard rule:** only Apache/MIT/BSD libraries. Shapely (BSD) if geometric is ever
  revisited. No CC-BY-NC / GPL / AGPL models or datasets, ever.

## Annotation tools (the heart of this milestone)
All follow the same shape: the backend extracts a **proposal** deterministically from the existing
vector/text layers; the frontend renders it as a **distinct suggested overlay**; the human
**accepts / edits / rejects**; accepts write through a capture path with Milestone-1 provenance
(`method`/`source`/`suggested_*`/`review_status`/`spec_version`) and emit `trace_events`.

1. **Room name auto-fill (core).** On finishing a manually-traced room polygon, point-in-polygon-match the
   interior `sheet_text` words → pre-fill `unit_number` + map the room word to a taxonomy type
   (KITCHEN→program, MECH→support, SALES/OFFICE→program, COOLER/FREEZER/STOCK→support, CORRIDOR/LOBBY→common, …)
   via `locationTaxonomy.ts`. User confirms/edits. `source='ai_suggested'` on the name; `ai_accepted`/`ai_edited`
   on confirm. *Commercial wrinkle (verified on LaSalle/Crew):* spaces carry **name + space number**
   ("417 WOMEN", "OFFICE 110") plus **separate door numbers** ("105A", door-schedule tags). Capture name+number;
   use font size + pattern to avoid mistaking door tags for the space number.
2. **Sheet title block (every sheet).** Drag a box over the title block; app pre-reads **sheet number**
   (e.g. "A-201"), **sheet name** ("SECOND FLOOR PLAN"), and **architect/firm** from `sheet_text` inside the
   box; user confirms/fixes. Organizes the corpus and supplies the firm stratification key + calibration key.
   *Firm heuristic:* the proprietary/copyright **notice reliably names the firm** (verified: LaSalle →
   "…written permission of **RSP Architects**") — parse it as the pre-fill. **Title-block position varies by
   firm** (Aldi/Crew ≠ LaSalle), which is exactly why this is a human box-drag, not an auto-locate.
3. **Gridlines (every sheet) — two-part annotation.** (a) Box the bubble label (app pre-reads "A"/"B"/"1"/"2"
   from `sheet_text`); (b) drag the axis line across the grid line (app snaps to the long straight vector it
   already detected). One grid annotation = `{ label, line(percent endpoints), axis: 'h'|'v' }`. Confirming
   grids also feeds calibration (grid lineweight/color → subtractable noise for snapping).
4. **Openings as tagged room-boundary edges (revised design — see the Phase 4 kickoff).** While tracing,
   the human marks a **floor-level passage** by tagging the polygon **edge** that crosses it: drop a jamb
   node, hold a key, click the other jamb → that edge is an opening (`door | cased_opening | overhead |
   pass_through`), shown in a distinct color; keep tracing. Openings ride the **unit** write/provenance
   (not a separate floating-line table). **Windows are NOT tagged** (above the sill → not on the floor
   boundary; they come free from CAD `A-Glaz`). Canonical openings + a room-connectivity graph are
   **derived** by reconciliation (cross-wall pairing of the two inner-face edges); door-*objects*
   (swing/type/count) are a separate, optional, anchored layer. Captured during the trace = near-free; feeds
   room-closing + connectivity now and door-object detection later.
5. **Detail callouts (passive/later).** Auto-extract circular reference bubbles ("4/A-501") from text + circle
   vectors into a cache. A cross-sheet navigation graph — valuable as a product feature, low synergy with the
   room model. Store now; build verify-UI only if/when it's prioritized.
6. **Opportunistic CAD-layer extraction (when present — jackpot path).** Verified on the Aldi sheet: some
   firms publish AIA-standard OCG layers, and `page.get_drawings(extended=True)` tags **every** vector path with
   its `layer`. When a sheet exposes layers named `A-Wall*` / `A-Door*` / `A-Glaz` / `S-Cols` / grid, extract
   walls, doors, windows, columns, and gridlines **directly per layer** — near-perfect geometry, free, and the
   *best* training labels (machine-exact; human just verifies). This **supersedes the geometric fallback for
   layered sheets** and even revives room-closing (walls + door layer → seal gaps at known doors). It is
   **opportunistic / firm-dependent** — A/B/C, LaSalle, and Crew expose no layers, so detect layer presence and
   fall back to manual + calibration when absent. Record layer-presence in the `drawing_set_profile`.

## Smart layer — per-set calibration (built from verification, not ML)
The verification actions above *produce* the calibration for free. Store a small **per-set profile keyed by
firm/project** (`drawing_set_profile`) that:
- seeds from the first verified sheet of a set (wall lineweight/color range observed while tracing; grid
  lineweight/color from confirmed gridlines; scale from MW.1);
- tunes snapping / highlight / auto-name on the *rest* of the set (e.g. subtract confirmed grid lineweight from
  wall candidates — directly fixes the Project-A "heavy lines are grids, not walls" confusion);
- surfaces gentle guidance ("this set draws walls in gray — snapping tuned for it").
Build the **minimal** version first (store a few observed parameters + apply to snapping), not an auto-learning
system. The fully-adaptive version is the trained model (M3); this profile is the bridge and later a model feature.

## Data model
All new tables: cache/annotation tables keyed by `sheet_id` (or `project_id`/firm for the profile), JSONB
payload in the same **percent space** as `polygon_coordinates`/`sheet_vectors`, RLS mirroring `sheet_vectors`
(read = authenticated member; write = owner/admin/pm). ⛔ **Every migration: present the SQL via the
`create-migration` skill and STOP for owner approval before applying. Never touch production data without go-ahead.**
- **`sheet_text`** (Phase 1) — 1:1 cache of extracted text words `[{ text, pctX, pctY }]`, mirroring
  `sheet_vectors` (write-through). Feeds naming + title block + grid labels.
- **Sheet metadata** — `sheet_number`, `sheet_name`, `architect_firm` (+ the title-block bbox + provenance).
  Prefer **columns on the existing `sheets` table** over a new table if `sheets` is the natural home; otherwise
  a `sheet_metadata` 1:1 table. Decide by reading `sheets` first.
- **`sheet_gridlines`** — `[{ label, p1, p2, axis }]` per sheet (verified).
- **`units.opening_edges`** — `[{ edgeIndex, type }]` per room (raw truth, rides the unit write/provenance).
  Canonical openings + connectivity are **derived** by reconciliation; a `sheet_openings` *derived* table is
  optional/later (only when connectivity/door-object features need a queryable store).
- **`sheet_callouts`** — `[{ ref, sheet_target, detail_num, pctX, pctY }]` per sheet (passive extract).
- **`drawing_set_profile`** — keyed by firm/project: observed wall/grid lineweight+color ranges, scale, notes.
- **Accepted rooms** still write through the EXISTING `useCreateWorkbenchLabel` path (Milestone-1 provenance) —
  do NOT add a parallel write path for rooms.
- **Reads:** `sheet_vectors` (wall geometry/snapping), `sheet_text` (names/labels), `sheets` (preview dims/scale).

## Build-on inventory (read these fresh before using)
**Frontend (reuse, do not fork):**
- `src/hooks/useWorkbenchActions.ts` — `useCreateWorkbenchLabel` already accepts
  `method`/`source`/`suggestedPolygon`/`suggestedLabel`/`modelVersion`/`durationMs`. The accept path passes
  these; this is the whole point of Milestone 1. Do not bypass it.
- `src/utils/traceCapture.ts` — `recordTraceEvent` (for `reject_suggestion`), `TraceMethod`/`TraceSource`,
  `labelSnapshotFromUnit`. Reuse verbatim.
- `src/components/workbench/WorkbenchTracer.tsx` + `WorkbenchTracerToolbar.tsx` — where the new tools and
  proposal-overlay state mount.
- `src/components/workbench/NewDrawingModal.tsx` — drawing intake; the architect/firm field surfaces here too
  (manual entry fallback when the title block isn't auto-read).
- `src/components/FloorplanCanvas.tsx` — shared canvas; proposals/overlays render as a distinct layer. Respect
  §3 (no recolor of `mapDisplayStatuses`; native-event isolation for HTML overlays).
- `src/store/useWorkbenchStore.ts` — all floating tool/overlay state belongs here (active tool, proposal list,
  active-proposal index), per AGENTS.md §2. NOT `useState`/`useEffect`.
- `src/utils/geometry.ts` — `getSnappedCoordinate` for snapping edited vertices / grid + opening lines.
- `src/hooks/useSnappingVectors.ts` — the `sheet_vectors` read pattern to copy for `sheet_text` and the other caches.

**Backend (reuse the established patterns — AGENTS.md §7):**
- `sitepulse-backend/main.py` — `get_current_user` (ES256/JWKS auth dep), `verify_sheet_access`,
  `asyncio.to_thread(...)` for CPU work, `extract_vectors_from_pdf` + its `map_point()` PDF→percent transform
  (reuse for ALL extraction so words/lines land in the SAME percent space), the `sheet_vectors` write-through
  endpoint + `backfill_vectors.py` one-off script (the model for the new backfills).

## Pure logic to extract + unit-test
Keep correctness framework-free and deterministic (pass inputs in; never call `Date.now()`/network in pure fns).
- **Backend (pytest, `sitepulse-backend/tests/`):**
  - Text extraction: PDF words → `[{text, pctX, pctY}]` via `map_point` (tiny fixture, mirror vector tests).
  - Title-block parse: given words + a bbox, pick sheet number / name / firm (test the field heuristics).
  - Grid label/line pairing: word-in-bubble + nearest long axis vector → `{label, line, axis}`.
  - Interior-text naming: point-in-polygon match of words → candidate `unit_number` (inside / outside / boundary).
  - Callout parse: "4/A-501" → `{detail_num, sheet_target}`.
- **Frontend (vitest, co-located `.test.ts`):**
  - Proposal → `CreateWorkbenchLabelInput` mapping on accept (method=`text_prefill`/`geometric`,
    `source=ai_accepted` vs `ai_edited`; frozen `suggestedPolygon`/`suggestedLabel` = the ORIGINAL proposal).
  - Opening/grid line percent-geometry helpers; "accept all" bulk-confirm mapping.

## Sub-phasing (ship + verify each)

### Phase 1 — `sheet_text` extraction + cache (backend) — foundation
- **Scope:** `sheet_text` cache table; `/extract-text/{sheet_id}` endpoint running PyMuPDF
  `page.get_text("words")` → `map_point` → `{text, pctX, pctY}`, write-through cached (mirror the
  `sheet_vectors` endpoint). `backfill_text.py` modeled on `backfill_vectors.py`. pytest for the percent mapping
  + empty-text (scanned PDF) path → flag for OCR later (off critical path).
- **Approval gates:** ⛔ DB migration via `create-migration` skill, show SQL, STOP for approval. Mirror
  `sheet_vectors` RLS.
- **Exit:** typecheck + `pytest -q` green · mapping unit-tested · endpoint returns located words for a vector
  sheet, empty list for a scanned one · `verify-feature` → stop.

### Phase 2 — room name auto-fill on manual trace (frontend) — the headline bootstrap
- **Scope:** On finishing a traced room, read `sheet_text`, point-in-polygon match interior words, pre-fill
  `unit_number` + suggest taxonomy type via `locationTaxonomy.ts`. User confirms/edits in the existing popover;
  accept writes through `useCreateWorkbenchLabel` with `source='ai_suggested'→ai_accepted/ai_edited` and frozen
  `suggested_label`. No new write path.
- **Approval gates:** none (no schema beyond Phase 1; no external API).
- **Exit:** typecheck + test + build green · name-match + accept-mapping unit-tested · live `dev:3010`
  click-through: trace a real room, name pre-fills, accept/edit both recorded · `verify-feature` → stop.

### Phase 3 — verified-capture tools + calibration seed (backend + frontend)
- **Scope:** The proposal→overlay→accept/edit/reject framework on `FloorplanCanvas` (state in
  `useWorkbenchStore`), plus the tools: **sheet title block** (number/name/**firm**), **gridlines** (bubble box
  + axis line), with an **"accept all"** bulk-confirm. Backend extract endpoints for each (deterministic from
  `sheet_text`/`sheet_vectors`). Seed the **minimal `drawing_set_profile`** from confirmed grids + observed wall
  attributes, keyed by firm/project; apply it to snapping/highlight on subsequent sheets in the set.
- **Approval gates:** ⛔ migrations for sheet metadata (+columns-vs-table decision), `sheet_gridlines`,
  `drawing_set_profile` — SQL via `create-migration`, STOP for approval each. Reflect in `database.types.ts` +
  `domain.ts` (§4/§6); narrow JSONB at the query boundary.
- **Exit:** typecheck + test + build · field/grid/accept-all mapping unit-tested · live click-through: open a
  sheet, confirm title block (firm captured), confirm a few gridlines, "accept all", confirm calibration tunes
  the next sheet · `verify-feature` → stop.

### Phase 3.5 — opportunistic CAD-layer extraction (backend; jackpot path, layered sheets only)
- **Scope:** New `/extract-layers/{sheet_id}` endpoint using `page.get_drawings(extended=True)` — every path is
  tagged with its OCG `layer` (verified on Aldi). Detect layer presence; when names match `A-Wall*` / `A-Door*` /
  `A-Glaz` / `S-Cols` / grid, group paths per layer → emit pre-populated **walls / doors / windows / columns /
  gridlines** in percent space as high-confidence suggestions into the existing overlay/accept framework
  (machine-exact geometry; human just verifies). Record `has_cad_layers` + the layer→element mapping in
  `drawing_set_profile`. **Falls back to manual + calibration when no layers exist** (A/B/C, LaSalle, Crew).
  Because doors come as their own layer here, this is also the one path that can **auto-close rooms** (walls +
  door openings → seal gaps) — wire that only if layered sheets prove common enough to be worth it.
- **Approval gates:** none beyond reusing the overlay framework (reads only; no new table — reuses
  `sheet_gridlines`/`sheet_openings` + the room write path). New endpoint only.
- **Exit:** `pytest -q` green · per-layer grouping + name-matching unit-tested on a layered fixture · live
  click-through on Aldi: walls/doors/grid pre-populate from layers and verify cleanly; a layerless sheet falls
  back gracefully · `verify-feature` → stop.

### Phase 4 — openings as tagged room-boundary edges (full design in the Phase 4 kickoff)
Built as **4a → 4b → 4c** (4d deferred). See `Notes/handoff/2026-06-25 - AI Tracing Assist Phase 4 Kickoff.md`.
- **4a — inline opening-edge capture:** `units.opening_edges = [{ edgeIndex, type }]` (floor passages only,
  NOT windows); tag edges during/after tracing; rides the unit write + M1 provenance; lifecycle rules for
  polygon edits/delete. ⛔ migration (`units.opening_edges`).
- **4b — reconciliation (pure logic):** derive canonical openings + connectivity by the **four-criterion
  cross-wall pairing** (parallel + facing + projection-overlap + bounded wall-thickness separation), with
  scale/wall-material strengtheners and a **confidence + flag** backstop (never alters raw tags). No schema.
- **4c — review-DoD integration:** `WorkbenchReviewTable` gains an openings indicator, a "resolve flagged
  openings" check, and the per-sheet **`fully_traced` completeness flag** (training-eligibility gate;
  excludes partial sheets from the export). ⛔ migration (`sheets.fully_traced`).
- **4d — door-OBJECT capture (deferred/optional):** click-opening → draw box; child of the opening;
  below the free CAD `A-Door` path. Build only when door-detection is a goal.
- **Exit (per slice):** typecheck + test + build · pure-logic unit-tested (edge re-indexing; the reconciliation
  pairing fixtures incl. thick-wall offset, exterior singleton, two-doors-same-wall, type-conflict) · live
  `dev:3010` click-through · `verify-feature` → stop.

### Phase 5 — detail callouts (passive extract)
- **Scope:** Backend extract of reference bubbles ("4/A-501") from text + circle vectors → `sheet_callouts`
  cache. No verify-UI yet (passive). pytest for the ref parse.
- **Approval gates:** ⛔ migration for `sheet_callouts`.
- **Exit:** `pytest -q` green · ref-parse unit-tested · endpoint returns located callouts on a real sheet · stop.

### Phase 6 — Claude-vision type suggestion (backend + thin frontend wire)
- **Scope:** `/suggest-types` (Anthropic API, **Sonnet** default; Opus only for dense sheets) — room
  crop/context + taxonomy → suggested `top_level_role` + subtype via **Structured Outputs** (strict JSON). Shown
  as a pre-fill the user confirms; geometry + name untouched. Vision **never** produces polygons.
- **Approval gates:** ⛔ `ANTHROPIC_API_KEY` in backend env (owner provisions). Note per-sheet cost in the PR.
- **Exit:** `pytest -q` green (mock the API) + frontend typecheck/test/build · ~10 sheets reviewed for
  type-suggestion quality · `verify-feature` → stop.

### Phase 7 (DEFERRED — gated on need) — geometric room proposal
- The original auto-detector. Only build if manual tracing proves too slow at scale AND a research spike shows
  the **vector** `shapely.polygonize` + door-gap-closing path beats the failed raster attempt on real sheets.
  Per-project wall isolation (driven by `drawing_set_profile`) is the prerequisite either way. `polygonize_full`
  dangles = built-in QA. Treat as a spike, not a commitment.

## Hard guardrails (AGENTS.md — do not violate)
- **§2:** all tool/overlay/proposal state in `useWorkbenchStore` (Zustand), never `useState`/`useEffect` for
  data; never touch the `pendingChanges` offline queue; accepted writes go through Query mutation hooks, not raw inserts.
- **§4 / §6:** every new table/column reflected in `database.types.ts` (Tables block) and derived in `domain.ts`;
  narrow JSONB at the query boundary (no `Json` in props); derive types from `database.types.ts`, never hand-duplicate.
- **§3:** overlays use native-event isolation; never recolor `mapDisplayStatuses`.
- **§5:** new caches follow the `sheet_vectors` write-through pattern; don't store class instances in Query cache.
- **§7:** backend endpoints use `Depends(get_current_user)` + `verify_sheet_access` + `asyncio.to_thread`;
  PyJWT only; no debug file writes; 25s client timeouts stay.
- **Capture invariant (Milestone 1):** accept = a capture path with `method`/`source`/`suggested_*`;
  reject = `recordTraceEvent('reject_suggestion')`. Rooms reuse `useCreateWorkbenchLabel`. Do NOT invent a
  second room-capture path — the whole pipeline depends on one.

## Open decisions
- **Sheet metadata: columns on `sheets` vs. a new `sheet_metadata` table** — decide after reading `sheets`.
- **Calibration scope: per-project vs. per-firm** — firm is the more general key, but a project may mix firms;
  start per-project, key by firm where known. Settle in Phase 3.
- **Opening cadence / completeness** — *resolved:* the per-sheet `fully_traced` flag in the review DoD (4c)
  is the signal; openings are gated by it (tag all passages on a sheet you mark complete), and partial sheets
  are excluded from the training export rather than poisoning it.
- **Sample coverage to validate assumptions** — we've only tested 3 vector, likely-multifamily sheets from a few
  firms. Before hardening: get a **scanned/raster** sheet (tests OCR fallback), a **different building type**
  (tests taxonomy/naming), and a **fourth firm** (tests style-variance). Only chase samples representative of
  real workload.

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

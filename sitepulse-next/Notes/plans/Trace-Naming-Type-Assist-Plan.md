# Trace Naming & Type Assist — better room-name + type guesses that learn from you (self-contained build plan)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: `sitepulse-next/Notes/plans/AI-Tracing-Assist-Plan.md` (this is a refinement of that plan's **Phase 2 — room-name auto-fill**; geometry stays 100% hand-traced).

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) + the parent AI-Tracing-Assist plan.
2. Re-read the files named below **fresh** — do not trust line numbers; they drift.
3. Build the phases in order. Verify after each phase (§ verification commands).
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence
   plain-English summary; explain jargon in passing; keep it short.

## Goal
When you trace/draw a room — **in the workbench AND on the main project map** — the name popup
pre-fills a **clean** name (the room's name + number, without square-footage notes, dimensions, or
door tags), and the type list pre-selects the **right type** — including types you've aliased
(e.g. "Unit" → "Dwelling Unit") and housing types the current guesser ignores entirely. On top of
that, the system **gets better the more you trace**: it learns which words are real room names and
which name goes with which type, from the rooms you've already confirmed across all your projects.
It stays fully deterministic — **no LLM, no model training** — and the geometry is still 100%
hand-traced; only the **name and type** are assisted.

The naming "brain" (the pure matchers + the learned vocabulary) is **surface-agnostic** — Phases 1–3
build it once via `buildRoomSuggestion`; Phase 4 wires that same brain onto the project-map draw flow.

## Out of scope / deferred
- **Auto-detecting room *shapes*** (geometric/SAM/vision room detection). That is the parent
  AI-Tracing pipeline's later model/dataset work, not this plan.
- **A learned ML model.** Everything here is rules + a plain frequency table. No training infra.
- **New milestone/applicability behavior.** `unit_type` applicability is untouched (AGENTS.md §4).
- **Changing the training-data capture format** (`trace_events`, `units.suggested_label`/`source`).
  We keep it working; we do not redesign it.

## Locked product decisions (from the owner)
- **Naming convention is fixed: "Name + Number"** (e.g. "OFFICE 110" / "110 OFFICE"). Lean on it.
- **Font-size signal (lever B) is IN the final product, but sequenced LAST** (Phase 3). Ship the
  frontend-only wins first; only invest in backend re-processing if names still need it.
- **Learning is company-wide** (across all the owner's projects), not per-project. Tracing happens
  in an office, so online-only is acceptable — it degrades to "no learning" if offline / the lookup
  fails, exactly like today's `useSheetText` degrades to "no auto-fill".
- **Extend the assist to the main project map (Phase 4), and map-drawn rooms ALSO capture training
  data.** The owner draws/names locations on the project map too, not just the workbench; those rooms
  should get the same auto-fill AND record the same suggested-vs-final provenance (`trace_events` +
  `units.suggested_label`/`source`) so naming anywhere sharpens the learning.

## Data model
- **Reads, no schema change in Phases 1–2.**
  - `sheet_text.text` (JSONB) — cached PDF words `{ text, pctX, pctY }`, loaded by `useSheetText`.
  - `subtypes` (the global governed dictionary, incl. `aliases JSONB`), loaded by `useSubtypes`.
  - `units` — confirmed rooms carry `unit_number`, `subtype_id`, `top_level_role`. The current
    project's units are already in memory in the tracer; the **company-wide** vocabulary (Phase 2)
    reads `unit_number, subtype_id, top_level_role` for every project the user is a member of.
- **Phase 3 (lever B) is a JSON *shape* change, NOT DDL.** `sheet_text.text` is already JSONB, so
  adding a per-word height field is a payload change + re-extraction of existing rows — **no
  migration, no approval gate.** The `TextWord` guard must tolerate the new optional field, and
  old cached rows (no height) must still work.
- ⚠️ **1000-row cap (memory):** a Supabase REST `SELECT` returns ≤1000 rows/request. The
  company-wide units query in Phase 2 **must paginate** (reuse the established `fetchAllIn` /
  `paginateAll` pattern) or it will silently learn from only the first 1000 rooms.

## Build-on inventory (read these fresh before using)
REUSE — do not fork:
- `src/utils/roomSuggestion.ts` — **the single entry point** `buildRoomSuggestion(polygon, words,
  subtypes)`; also `suggestionToPick`, `suggestedLabelFromSuggestion`, `deriveSuggestionSource`,
  `ROOM_TEXT_MODEL_VERSION`. Every phase threads through here.
- `src/utils/roomNameMatch.ts` — `matchRoomName` (lever A lives here). Pure.
- `src/utils/locationTaxonomy.ts` — `suggestTaxonomyFromText` + `ROOM_KEYWORD_TO_SUBTYPE`
  (lever D lives here). Pure. `SEED_SUBTYPES` for role lookup.
- `src/utils/subtypes.ts` — `rankSubtypes` / `matchRank` (the alias-aware matcher the manual Type
  Picker already uses — **reuse this ranking for D1** instead of writing a new matcher).
- `src/hooks/useSheetText.ts`, `src/hooks/useSubtypes.ts` — the warm-cached read hooks + their
  graceful-degradation pattern (copy it for the new vocabulary hook).
- `src/components/workbench/WorkbenchTracer.tsx` — wires it together: `useSubtypes()` (L~137),
  `useSheetText()` (L~142), `buildRoomSuggestion(...)` on trace-close (L~188), `suggestionToPick`
  (L~612), and the create path that freezes `suggestedLabel` + derives `source` (L~474). `units` is
  in scope here (used by openings overlays) — the vocabulary hook plugs in alongside.
- `src/utils/traceCapture.ts` — provenance + `trace_events`. **Keep working**; do not change shape.
- **Project-map surface (Phase 4 only):** `src/app/project/[projectId]/page.jsx`
  (`onPolygonComplete={handlePolygonComplete}`, the location-naming modal that already receives
  `subtypes` + `recentSubtypeIdsFromUnits`), `src/hooks/useMapActions.ts` (the `createUnit`
  path — `unit_number`/`polygon_coordinates`/`subtype_id`/`unit_type`), and `FloorplanCanvas.tsx` /
  `src/components/canvas/DraftPolygon.tsx` (the draw flow). This surface does **not** yet call
  `buildRoomSuggestion`/`useSheetText` — that is exactly what Phase 4 adds.

## Pure logic to extract + unit-test (this is where correctness lives)
All framework-free, deterministic, in `src/utils/*.ts` with co-located `*.test.ts`:
- **Phase 1 / A:** strengthen `matchRoomName` — number-token + adjacent-name isolation, noise
  filters (SF, dimensions, door/equipment tags), centroid line-limiting. Pure.
- **Phase 1 / D1:** a name→subtype matcher that scans the **live dictionary names + aliases**
  (reusing `matchRank` from `subtypes.ts`), with `ROOM_KEYWORD_TO_SUBTYPE` kept only as a fallback
  seed. Resolves to a live `subtype_id` + its role.
- **Phase 2 / C+D2:** `buildNamingVocabulary(units)` → a plain-JSON frequency model
  (`{ nameTokenCounts, nameToSubtype }`) — **never a `Map`/`Set`** (AGENTS.md §6 IDB rule). Plus the
  scoring fns that let the vocabulary (a) keep/drop ambiguous name tokens and (b) propose a type
  from confirmed name→`subtype_id` frequency. Pass any data IN; no `Date.now()`, no DB.

## Sub-phasing (ship + verify each)

### Phase 1 — Smarter deterministic rules (levers A + D1)
- **Scope:** Frontend-only, no backend, works on existing sheets **immediately**.
  - **A (name):** rewrite `matchRoomName` to use the "Name + Number" convention — find the
    room-number token, keep it + the adjacent alphabetic name word(s) on the same/nearest line,
    and drop noise: square footage (`250 SF`, `S.F.`), dimensions (`12'-6"`, feet/inch marks),
    door/equipment tags, and far-away text. Prefer the 1–2 lines nearest the polygon centroid over
    joining *every* interior word.
  - **D1 (type):** make `suggestTaxonomyFromText` (or a new sibling consumed by
    `buildRoomSuggestion`) consult the **live `subtypes` dictionary + aliases** — reuse `matchRank`
    from `subtypes.ts` so "Unit" finds "Dwelling Unit" and housing types stop being invisible. Keep
    `ROOM_KEYWORD_TO_SUBTYPE` as a fallback seed for sheets whose dictionary is sparse.
  - Bump `ROOM_TEXT_MODEL_VERSION` → `text-prefill-v2` (the file documents this: bump when matching
    logic changes materially, so old/new suggestions stay distinguishable at training time).
- **Approval gates:** none (no DB, no RLS, no migration, no push). Standard "don't commit/push
  until Approved".
- **Exit criteria:** typecheck + test + build green · new/extended unit tests for `matchRoomName`
  and the alias-aware type match · live `dev:3010` click-through tracing a few rooms (incl. a
  housing "Unit" and a noisy room with SF/dimensions) · close with `verify-feature`.

### Phase 2 — Learns from your corrections, company-wide (levers C + D2)
- **Scope:**
  - New pure `buildNamingVocabulary(units)` → frequency model (plain JSON).
  - New warm-cached hook `useNamingVocabulary()` that fetches confirmed rooms **across all the
    user's projects** (`unit_number, subtype_id, top_level_role`), **paginated** (1000-row cap),
    degrading to an empty vocabulary on error/offline (mirror `useSheetText`).
  - Thread an optional `vocabulary` arg into `buildRoomSuggestion`: (C) use name-token frequency to
    keep real name words and drop tokens never seen as names; (D2) when the dictionary/keyword guess
    is weak, propose the type most frequently paired with this name in your history.
  - Bump `ROOM_TEXT_MODEL_VERSION` → `text-prefill-v3`.
- **Approval gates:** none expected — **no migration** if the vocabulary is built client-side from
  paginated `units` reads. ⛔ **If** you decide a server-side aggregation RPC/view is needed for
  performance, that is DDL → present the SQL via the `create-migration` skill and **STOP for owner
  approval** (default to the no-migration client path first).
- **Exit criteria:** typecheck + test + build green · unit tests for `buildNamingVocabulary` (incl.
  empty/garbage input → empty model, and that it never emits a `Map`/`Set`) and the vocabulary-aware
  scoring · live `dev:3010` check that confirming several "X Unit" rooms makes the next one guess
  "Dwelling Unit" · close with `verify-feature`.

### Phase 3 — Font-size signal (lever B) — *do only if Phases 1–2 aren't enough*
- **Scope:** the strongest single "which text is the name" signal — "the biggest text in the room".
  - Backend `extract_text_from_pdf` (`sitepulse-backend/main.py`): keep each word's normalized
    **height** (`(y1 - y0)`) alongside the center point.
  - Frontend: `TextWord` gains an **optional** size field; `isTextWordArray` (`domain.ts`) tolerates
    it (old rows without it still valid); `matchRoomName` prefers the largest-text line when size is
    present and behaves exactly as Phase 1 when it's absent.
  - **Re-extract existing sheets** so cached `sheet_text` rows gain the size (reuse
    `sitepulse-backend/backfill_text.py`).
  - Bump `ROOM_TEXT_MODEL_VERSION` → `text-prefill-v4`.
- **Approval gates:** ⛔ re-running extraction/backfill touches stored data for every existing
  sheet — present the backfill plan and **get owner go-ahead before running it against real data**
  (memory: never run write probes against production rows blindly). No DDL (JSON shape change).
- **Exit criteria:** typecheck + test + build green · backend test/extraction sanity on a sample PDF
  · `matchRoomName` tests cover size-present and size-absent paths · live `dev:3010` check on a
  re-extracted sheet · close with `verify-feature`.

### Phase 4 — Extend the assist to the main project map (draw flow) + capture
- **Scope:** wire the finished naming brain onto the project-map draw/name path — **pure wiring of
  Phases 1–3, no new logic**.
  - Load the active sheet's cached text on the map via `useSheetText` (already exists) and run the
    same `buildRoomSuggestion(polygon, words, subtypes, vocabulary)` when a polygon completes
    (`handlePolygonComplete`).
  - Pre-fill the map's existing location-naming modal: name (`newUnitName`) + type
    (`initialSubtypeId`/pick) from the suggestion, so the owner confirms/edits instead of typing
    from scratch. Reuse the existing `subtypes` + recents already passed to that modal.
  - **Capture training data** (owner decision): on save via `useMapActions.createUnit`, thread the
    same provenance the workbench does — `method:'manual'`, `source` = `ai_accepted`/`ai_edited`
    (via `deriveSuggestionSource`), frozen `suggested_label` (`suggestedLabelFromSuggestion`), and
    `model_version` — plus the `trace_events` row (`recordTraceEvent`), best-effort so it never
    blocks a save. Mirror the workbench create path in `useWorkbenchActions.ts` so the two stay in
    lockstep.
  - **Leakage-safe grouping:** set the `trace_events.group_key` consistently (per `docs/ANNOTATION_SPEC.md`
    §5) so map-drawn rooms group correctly in the corpus — decide the key at build time (likely the
    sheet id, matching the workbench).
- **Approval gates:** none expected (no DB migration — `trace_events`/`units` columns already exist).
  ⛔ Do **not** weaken `status_logs`/`units` write rules (AGENTS.md §2) — reuse the existing
  `createUnit` mutation; don't add a parallel insert path.
- **Exit criteria:** typecheck + test + build green · live `dev:3010` click-through: draw a room on
  the **project map**, confirm name + type pre-fill, save, and verify a `trace_events` row + the
  unit's `source`/`suggested_label` landed (same as the workbench) · close with `verify-feature`.

## Hard guardrails (AGENTS.md — do not violate)
- **§6 JSONB narrowing:** narrow every new query at the boundary (the vocabulary read must narrow,
  no raw `Json` into props). **IDB serialization:** the vocabulary model and anything entering
  TanStack Query cache must be plain JSON — **no `Map`/`Set`/class instances**.
- **§9 testing:** co-locate `*.test.ts`; import `{ describe, it, expect, vi }` from `'vitest'`
  (globals are OFF). Pure matchers/vocabulary are the load-bearing tests.
- **Geometry stays hand-traced** — `method` stays `'manual'`; assist lives only on the **name/type**
  (`source`). Do not touch the polygon/openings paths.
- **Keep training capture intact:** `trace_events` writes, the frozen `suggested_label`, and the
  `ai_accepted`/`ai_edited` derivation (`deriveSuggestionSource`) must keep working. **Bump
  `ROOM_TEXT_MODEL_VERSION` each phase** so suggestions stay distinguishable at training time.
- **Degrade silently:** a failed/empty vocabulary or text load must never block or break a trace —
  fall back to the rule-only suggestion (or no suggestion), exactly like today.
- **Offline-first:** don't add a blocking online dependency to the trace flow; the company-wide
  vocabulary is best-effort/online-only and cached warm.

## Open decisions
- **Phase 2 data source:** client-side paginated `units` read (default, no migration) vs. a
  server-side aggregation RPC (faster at scale, but DDL + approval gate). Resolve at the start of
  Phase 2 based on how many confirmed rooms exist — start with the client path.
- **Whether Phase 3 is needed at all:** decide after living with Phases 1–2. It's planned, not
  promised.

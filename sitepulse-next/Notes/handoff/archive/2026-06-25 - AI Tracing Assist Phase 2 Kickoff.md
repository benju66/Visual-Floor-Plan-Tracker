# Kickoff — AI Tracing Assist, Phase 2: room-name auto-fill on manual trace

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of AI Tracing Assist** (the headline bootstrap: when a user finishes tracing a room by hand, auto-fill its name/number from the sheet's cached PDF text and suggest a taxonomy type — the human confirms or edits in the existing popover). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-25 - AI Tracing Assist Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/AI-Tracing-Assist-Plan.md` (Phase 2 + Annotation tool #1 + Build-on inventory + Pure logic to unit-test)
> - `sitepulse-next/AGENTS.md`
>
> Work on branch `claude/ai-location-tracing-pipeline-ip709o` (Phase 1 is merged to `main`; branch == `main`). Build **only Phase 2**. ✅ **No DB migration and no external API in this phase** (the cache + types already shipped in Phase 1) — so no approval gate, but still: don't commit or push until I say "Approved." Verify with the live `dev:3010` click-through, then close with the `verify-feature` skill.

---

## Context for the session

### What Phase 1 already shipped (you build on this — don't rebuild it)
- **`sheet_text`** cache table (live on prod) + **`/extract-text/{sheet_id}`** backend endpoint that
  returns/caches `[{ text, pctX, pctY }]` — each PDF word and its position in the **same percent space**
  as `units.polygon_coordinates` / `sheet_vectors`. Backfilled for the existing sheets (16 of 19 have words;
  3 have no stored original PDF; none is a scanned/empty sheet yet).
- Types: `SheetText` / `SheetTextInsert` in `domain.ts` (kept as the raw Row — Phase 2 is the consuming
  phase, so **you** add the narrowing). `sheet_text` is in `database.types.ts`.
- The Milestone-1 capture plumbing is **already wired**: `useCreateWorkbenchLabel` accepts
  `method` / `source` / `suggestedLabel`, sets `review_status='unreviewed'` when `source !== 'human'`, and
  emits `trace_events`. **Do not add a parallel room-write path — this is the one.**

### What this phase delivers (plain English)
Today a tracer draws a room polygon and then types its name/number. This phase makes the app *propose* that
name: after the polygon closes, it reads the words that fall **inside** the polygon from `sheet_text`, picks
the room's name/number, maps the room word to a taxonomy type, and pre-fills the existing naming popover. The
user just confirms (or tweaks). Confirm/edit are both recorded as training signal. The geometry is still 100%
hand-drawn — only the **name** is assisted.

### Required reading (in order)
1. `sitepulse-next/AGENTS.md` — esp. §2 (all tool/overlay/proposal state in `useWorkbenchStore`, never
   `useState`/`useEffect` for data; accepted writes go through the Query mutation hooks, never the offline
   `pendingChanges` queue), §3 (canvas/overlay native-event isolation; never recolor `mapDisplayStatuses`),
   §6 (narrow JSONB at the query boundary — no `Json` in props), §9 (vitest conventions: globals OFF,
   co-located, import from `'vitest'`).
2. `sitepulse-next/Notes/plans/AI-Tracing-Assist-Plan.md` — **Phase 2**, **Annotation tool #1 (room name
   auto-fill)** incl. the *commercial wrinkle* (name + space number + separate door numbers), the **Build-on
   inventory**, and **Pure logic to extract + unit-test** (frontend vitest items).
3. Parent specs: `docs/ai-tracing-pipeline-plan.md` + `docs/ANNOTATION_SPEC.md` (the provenance contract).

### Re-read these real files before editing (don't trust line numbers — they drift)
- `src/hooks/useSnappingVectors.ts` — the `sheet_vectors` read pattern (cache-first → backend fallback +
  write-through). **Copy it for a new `useSheetText` hook** that reads `sheet_text` → falls back to
  `/extract-text/{sheet_id}`. Return raw JSON; **narrow `text` to `{text,pctX,pctY}[]` at the query
  boundary** (add an `isTextWordArray` guard in `domain.ts` — Phase 1 deliberately deferred it to you).
- `src/hooks/useWorkbenchActions.ts` — `CreateWorkbenchLabelInput` (`method` / `source` / `suggestedLabel`)
  and `useCreateWorkbenchLabel` (defaults `method='manual'` / `source='human'`; `review_status` derives from
  `source`). The accept path passes the suggestion provenance through here.
- `src/utils/traceCapture.ts` — `TraceMethod` / `TraceSource`, `labelSnapshotFromUnit`, `deriveEditSource`,
  `recordTraceEvent` (use `'reject_suggestion'` on reject). `LabelSnapshot` is the frozen-proposal shape.
- `src/utils/locationTaxonomy.ts` — map the matched room word → `top_level_role` + `subtype_id`
  (KITCHEN→program, MECH→support, etc.). It is the taxonomy source of truth.
- `src/utils/geometry.ts` — reuse/extend for point-in-polygon (check what's already there before adding).
- `src/components/workbench/WorkbenchTracer.tsx` + `WorkbenchTracerToolbar.tsx` — where the trace finishes and
  the naming popover mounts. `src/store/useWorkbenchStore.ts` — where the proposal/suggestion state lives.

### Scope — build ONLY this
1. **`useSheetText(sheetId)` read hook** — mirror `useSnappingVectors`: cache-first read of `sheet_text`,
   fallback to `/extract-text/{sheet_id}` with write-through. Narrow the JSONB at the query boundary
   (`isTextWordArray` guard, added to `domain.ts`). Return plain JSON (IDB-serializable — §6/§5).
2. **Pure name-match logic (vitest-first)** — given a closed polygon + the sheet's words, return the candidate
   `unit_number` (+ matched word for taxonomy). Point-in-polygon over interior words; pick the room
   name/number; handle the **commercial wrinkle** (a space carries *name + space number* like "417 WOMEN",
   plus *separate door tags* like "105A"). Keep it framework-free and deterministic — pass words/polygon in,
   no `Date.now()`/network. Unit-test inside / outside / boundary + the door-tag case.
3. **Taxonomy suggestion** — map the matched room word → `top_level_role` (+ `subtype_id` when confident) via
   `locationTaxonomy.ts`. Unit-test the mapping.
4. **Wire into the trace-finish flow** — on polygon close, run the match, **pre-fill the existing naming
   popover** with the suggested number + type as an editable draft (proposal state in `useWorkbenchStore`, not
   `useState`). The user confirms / edits / clears.
5. **Accept / edit / reject mapping (vitest-first)** — accept → `useCreateWorkbenchLabel` with
   **`method='manual'`** (the geometry is hand-traced — see Decisions), **`source='ai_suggested'`** that
   becomes **`ai_accepted`** (confirmed unchanged) or **`ai_edited`** (user changed the name), and a **frozen
   `suggestedLabel`** = the ORIGINAL proposal (never the edited value). Reject (user clears the suggestion and
   types their own / dismisses) → `recordTraceEvent('reject_suggestion')`. No new write path.

### Out of scope (later phases — do NOT build here)
- Title block, gridlines, openings, callouts, CAD-layer extraction, calibration → Phases 3+.
- Claude-vision type suggestion → Phase 6. Phase 2's type suggestion is the **free taxonomy keyword map**, not an LLM.
- Batch/background processing; offline support for proposals (auto-name is online-only — never touch
  `pendingChanges`).
- OCR for scanned sheets (empty `sheet_text`) — out of scope; just degrade gracefully (no suggestion).

### Decisions already settled (so you don't re-litigate them)
- **`method='manual'`, not `text_prefill`.** `method` describes how the GEOMETRY originated; here it's
  hand-traced. The AI assist lives entirely in **`source`** (`ai_suggested`→`ai_accepted`/`ai_edited`) on the
  NAME. `TRACE_METHODS` has no `text_prefill` and shouldn't grow one for this — the geometry is genuinely manual.
- **No schema change for the name match.** Match purely on the cached `{text, pctX, pctY}` + the polygon.

### Open design point — flag, don't silently solve
- **Door-tag disambiguation may want font size, which `sheet_text` does NOT store.** Phase 1 cached only
  `{text, pctX, pctY}` (from `get_text("words")`, which has no font size). The plan's wrinkle suggests "font
  size + pattern" to avoid mistaking a door tag ("105A") for the space number. **Start with position/pattern
  heuristics only** (e.g. centrality in the polygon, numeric-vs-alphanumeric pattern, proximity to the room
  name word) — they likely suffice. **If** font size proves necessary, that's a `sheet_text` shape extension
  = a **gated migration + re-extract/backfill** (switch extraction to `get_text("dict")`/`rawdict` spans):
  surface it to the owner as its own decision; do **not** quietly change the Phase-1 cache shape.

### Exit criteria (Definition of Done → then stop)
- `npm run typecheck` green · `npm run test` green (new vitest: name-match inside/outside/boundary + door-tag;
  taxonomy mapping; accept→`ai_accepted`/`ai_edited` mapping with frozen `suggestedLabel`; reject mapping) ·
  `npm run build` green (you're editing live components).
- **Live `dev:3010` click-through** (the real gate — no E2E): open a workbench sheet that has cached text,
  trace a real room, confirm the name pre-fills, **accept** one (recorded `ai_accepted`) and **edit** another
  (recorded `ai_edited`), and confirm a sheet with empty/no text degrades to no-suggestion without error.
- Close with the **`verify-feature`** skill (run its DoD checklist), then STOP.
- **Do not commit or push until the owner says "Approved."** On approval, merge to `main` (fast-forward) to
  deploy, then draft the Phase 3 kickoff (verified-capture tools: title block + gridlines + calibration seed —
  note Phase 3 reintroduces approval-gated migrations) and paste its launch prompt in chat.

### Guardrails specific to this phase (AGENTS.md)
- **§2:** suggestion/proposal state lives in `useWorkbenchStore` (Zustand), never `useState`/`useEffect` for
  data. Accepts go through `useCreateWorkbenchLabel` (a Query mutation), never a raw insert, never the
  `pendingChanges` offline queue.
- **§5/§6:** `useSheetText` returns IDB-serializable JSON (no class instances in Query cache); narrow the
  `text` JSONB at the query boundary — no `Json` in component props.
- **§3:** any suggested-name overlay on the canvas uses native-event isolation; never recolor `mapDisplayStatuses`.
- **Capture invariant (M1):** accept = `useCreateWorkbenchLabel` with `method`/`source`/frozen `suggestedLabel`;
  reject = `recordTraceEvent('reject_suggestion')`. The frozen `suggestedLabel` is the ORIGINAL proposal — the
  before-vs-final delta is the whole training signal; capture it at write, never reconstruct it.

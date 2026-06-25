# Kickoff — AI Tracing Assist, Phase 3: verified-capture tools (title block + gridlines) + calibration seed

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3 of AI Tracing Assist** (verified-capture tools: a box-drag **sheet title block** reader that captures the sheet number/name + **architect/firm**, and a two-part **gridline** annotator, both "app proposes → human confirms / edits / accept-all"; plus a minimal per-set **calibration profile** seeded from what the human confirms). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-25 - AI Tracing Assist Phase 3 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/AI-Tracing-Assist-Plan.md` (Phase 3 + Annotation tools #2/#3 + the *Smart layer — per-set calibration* + Data model + Build-on inventory)
> - `sitepulse-next/AGENTS.md`
>
> Work on branch `claude/ai-location-tracing-pipeline-ip709o` (Phases 1+2 are merged to `main`; branch == `main`). Build Phase 3 **one sub-slice at a time** (3a → 3b → 3c below). ⛔ **This phase REINTRODUCES approval-gated DB migrations** — present each migration's SQL via the `create-migration` skill and **STOP for owner approval before applying**. Don't commit or push until I say "Approved." Verify each slice with the live `dev:3010` click-through, then close with the `verify-feature` skill.

---

## Context for the session

### Where we are (don't rebuild this)
- **Milestone 1 capture** is live: `units` provenance cols + append-only `trace_events` + `useCreateWorkbenchLabel`/`useUpdateWorkbenchLabel` provenance wiring. Reuse it; never fork a second capture path.
- **Phase 1** shipped the `sheet_text` write-through cache + `/extract-text/{sheet_id}` backend endpoint (`[{text,pctX,pctY}]` in the same percent space as `sheet_vectors`/`polygon_coordinates`). 16/19 prod sheets have words.
- **Phase 2** shipped room-name auto-fill on manual trace. It established the patterns you copy here:
  - **`useSheetText(sheetId)`** (`src/hooks/useSheetText.ts`) — cache-first read of `sheet_text`, narrows JSONB at the query boundary (`isTextWordArray` in `domain.ts`). **Reuse it** — title block + grid labels both read `sheet_text`.
  - **Pure parse logic, vitest-first** (`src/utils/roomNameMatch.ts`, `roomSuggestion.ts`) — point-in-polygon over `sheet_text`, framework-free, deterministic. Copy this shape for the title-block field parse + grid label/line pairing.
  - **Suggestion/proposal state in `useWorkbenchStore`** (`labelSuggestion`), accept→`useCreateWorkbenchLabel`, dismiss→`recordTraceEvent('reject_suggestion')`. The accept/edit/reject + frozen-original-proposal contract is the template for every tool here.
  - **`isPointInPolygon`** is now in `src/utils/geometry.ts`; `getSnappedCoordinate` already snaps a dragged point to the nearest long vector — reuse it for the grid axis line.

### What this phase delivers (plain English)
Two fast capture tools that organize the corpus and seed a per-building "calibration" so later sheets trace better:
1. **Sheet title block** — the user drags a box over the title block; the app reads the **sheet number** ("A-201"), **sheet name** ("SECOND FLOOR PLAN"), and the **architect/firm** from the text inside the box (the copyright/"written permission of …" notice reliably names the firm). The user confirms/fixes. Firm is the key that groups the corpus and keys calibration.
2. **Gridlines** — two-part: (a) box a bubble label (app reads "A"/"1" from `sheet_text`); (b) drag the axis line across the grid line (app snaps to the long straight vector). One grid = `{ label, p1, p2, axis:'h'|'v' }`. An **"accept all"** bulk-confirm keeps a clean sheet to a couple of clicks.
3. **Calibration seed** — a minimal `drawing_set_profile` keyed by firm/project, seeded from confirmed grids + wall attributes observed while tracing, applied to nudge snapping/highlight on the rest of the set. Build the **minimal** version (store a few observed params + apply), not an auto-learning system.

The geometry is human-drawn/confirmed throughout; the app only proposes. Every confirmed mark is training data with M1 provenance.

### Required reading (in order)
1. `AGENTS.md` — §2 (proposal/overlay state in `useWorkbenchStore`, never `useState`/`useEffect` for data; accepts via Query mutation hooks, never `pendingChanges`), §3 (canvas native-event isolation; never recolor `mapDisplayStatuses`), §4/§6 (every new table/column in `database.types.ts` + derived in `domain.ts`; **narrow JSONB at the query boundary**), §5 (write-through cache pattern), §7 (backend auth/`verify_sheet_access`/`asyncio.to_thread`).
2. `AI-Tracing-Assist-Plan.md` — **Phase 3**, **Annotation tools #2 (title block) + #3 (gridlines)**, the **Smart layer — per-set calibration** section, the **Data model** section (esp. the *sheet metadata: columns-on-`sheets` vs new table* open decision), and **Build-on inventory**.

### Re-read these real files before editing (line numbers drift)
- `src/hooks/useSheetText.ts` + `src/hooks/useSnappingVectors.ts` — the cache-first read pattern; title-block/grid parse reads BOTH (`sheet_text` for labels, `sheet_vectors` for the snapped axis line).
- `src/components/FloorplanCanvas.tsx` — the shared canvas; proposals/overlays render as a **distinct layer** with native-event isolation (§3). This is the bigger lift — a box-drag tool and an axis-line tool.
- `src/components/workbench/WorkbenchTracer.tsx` + `WorkbenchTracerToolbar.tsx` — where the new tools + overlay state mount.
- `src/store/useWorkbenchStore.ts` — add the tool-mode + proposal-list + active-proposal state here (mirror `labelSuggestion`).
- `src/components/workbench/NewDrawingModal.tsx` — the architect/firm field also surfaces here (manual fallback when the title block isn't read).
- The `sheets` table shape (read it via `database.types.ts` + a quick prod `list_tables`) — decide **columns-on-`sheets` vs a `sheet_metadata` 1:1 table** for sheet number/name/firm BEFORE writing the migration.

## Recommended sub-slicing (ship + verify + get approval each)
Phase 3 is large (3 migrations + a new overlay framework + backend). Build it as three independently-shippable slices, each its own approval gate — same cadence as the Phase 8a–8d workbench slices.

- **3a — Sheet title block + metadata.** The proposal→overlay→accept/edit framework on `FloorplanCanvas` (minimum: a box-drag tool), the pure title-block field parse (number/name/**firm**) over `sheet_text`, and the metadata write. ⛔ **Migration:** sheet metadata (decide *columns-on-`sheets`* vs `sheet_metadata` first). Exit: parse unit-tested (number/name/firm heuristics incl. the copyright-notice firm case); live click-through reads a real title block; firm captured.
- **3b — Gridlines + "accept all".** The two-part grid annotator (bubble box → label; axis drag → snapped line via `getSnappedCoordinate`), the `{label,p1,p2,axis}` shape, and bulk-confirm. ⛔ **Migration:** `sheet_gridlines` (RLS mirrors `sheet_vectors`). Exit: label/line pairing + accept-all mapping unit-tested; live click-through confirms a few grids + "accept all".
- **3c — Calibration seed.** Minimal `drawing_set_profile` keyed by firm/project, seeded from confirmed grids + observed wall attributes, applied to snapping/highlight on the next sheet in the set. ⛔ **Migration:** `drawing_set_profile`. Exit: profile read/seed/apply unit-tested; live click-through shows the next sheet tuned.

## Decisions to settle early (flag, don't silently solve)
- **Sheet metadata home — columns on `sheets` vs a `sheet_metadata` 1:1 table.** Decide by reading `sheets` first (plan § open decision). Surface your recommendation + the SQL before applying.
- **Parse location — frontend-pure vs backend endpoint.** Phase 2 did the whole match **client-side** over the cached `sheet_text`. Title-block + grid-label parse are likewise pure over `sheet_text`/`sheet_vectors` the client already loads, so a backend endpoint may be **unnecessary** (less infra, same result). The plan mentions backend extract endpoints; recommend the frontend-pure path unless something needs the server, and flag it.
- **Calibration scope — per-project vs per-firm.** Firm is the more general key but a project can mix firms; start per-project, key by firm where known (plan § open decision). Settle in 3c.
- **Door-tag/font-size carryover:** still no font size in `sheet_text` (Phase 1 cached `get_text("words")`). If any Phase-3 parse genuinely needs it, that's a **gated `sheet_text` shape extension** (re-extract via `get_text("dict")`), not a quiet change — surface it.

## Hard guardrails (AGENTS.md)
- **§2:** all tool/overlay/proposal state in `useWorkbenchStore`; accepts via the Query mutation hooks; never touch `pendingChanges`.
- **§3:** overlays use native-event isolation (`useRef` + native listener, `overscroll-contain`); never recolor `mapDisplayStatuses`.
- **§4/§6:** every new table/column in `database.types.ts` (hand-maintained — see [[schema-types-drift]]) + derived in `domain.ts`; **narrow every new JSONB at the query boundary** (add guards like `isTextWordArray`); no `Json` in props.
- **§5:** new caches follow the `sheet_vectors`/`sheet_text` write-through pattern; no class instances in Query cache.
- **§7:** any new backend endpoint uses `Depends(get_current_user)` + `verify_sheet_access` + `asyncio.to_thread`; PyJWT only; no debug file writes; 25s timeouts stay.
- **Capture invariant (M1):** confirmed marks write through a capture path with `method`/`source`/`suggested_*`; reject → `recordTraceEvent('reject_suggestion')`. Reuse the existing paths; don't invent new ones.

## Exit criteria (per slice → then stop)
- `npm run typecheck` green · `npm run test` green (new vitest for that slice's pure parse/mapping) · `npm run build` green (live components edited).
- ⛔ **Each migration:** SQL via `create-migration`, STOP for owner approval, apply, then reflect in `database.types.ts` + `domain.ts`.
- **Live `dev:3010` click-through** (the real gate) for that slice's tool. (Note: Claude's automated click-through needs the Chrome extension connected; if it's down, the owner runs the manual trace.)
- Close with the **`verify-feature`** skill, then STOP. **Do not commit or push until the owner says "Approved."** On approval, fast-forward `main` to deploy, then draft the next slice's (or Phase 3.5's) kickoff and paste its launch prompt.

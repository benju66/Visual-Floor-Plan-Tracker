# Kickoff — AI Tracing Assist, Phase 3c: calibration seed (`drawing_set_profile`)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3c of AI Tracing Assist** (the **calibration seed**: a minimal per-set `drawing_set_profile` that observes a set's drawing style — grid vs wall **lineweight/color** + scale — from already-confirmed captures, keyed by **architect firm**, and gently tunes snapping on the *rest* of the set; the bridge to the eventual model). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-25 - AI Tracing Assist Phase 3c Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/AI-Tracing-Assist-Plan.md` (§ "Smart layer — per-set calibration", Phase 3 scope, Data model → `drawing_set_profile`, Open decisions)
> - `sitepulse-next/AGENTS.md`
>
> Work on branch `claude/ai-location-tracing-pipeline-ip709o` (Phase 3b is merged to `main`; branch == `main`). ⛔ **This slice has an approval-gated DB migration** (`drawing_set_profile`) AND likely a **backend change** (extending vector extraction to carry stroke attributes) — present each via the `create-migration` skill and **STOP for owner approval before applying**. Don't commit or push until I say "Approved." Verify with `pytest` (backend) + the live `dev:3010` click-through, then close with the `verify-feature` skill.

---

## Context for the session

### Where we are (don't rebuild this — 3a + 3b shipped)
The verified-capture framework is live: proposal → overlay → confirm on the shared canvas, banking M1 provenance.
- **Phase 3a** (merged): `sheet_metadata` 1:1 table + the title-block reader. Captures `sheet_number` / `sheet_name` / **`architect_firm`** — and **the firm is the calibration key this phase uses.**
- **Phase 3b** (merged, commit `cf37a1a`): `sheet_gridlines` 1:1 table + the two-part gridline annotator (box bubble → read label; drag axis → snap to vector; "accept all"). Confirmed grids carry **geometry only** (`{label, p1, p2, axis}`) — **not lineweight/color** (see the decision below).
- Reuse verbatim: `capture_box`/`capture_line` ToolModes, `CaptureBoxOverlay`/`CaptureLineOverlay`/`GridlineOverlay`, the `useSheet*` cache-first read + upsert hook shape, the `useWorkbenchStore` floating-state cluster, the pure-util + vitest pattern (`gridlineParse.ts`), and the M1 provenance columns.

### What this slice delivers (plain English)
Each set of drawings (a firm's template) is drawn in a consistent style. Today the snapping engine is one-size-fits-all, which is why Project-A's heavy grid lines get mistaken for walls. Phase 3c stores a tiny **per-firm profile** of what we've already observed — the grid line's weight/color (from confirmed gridlines), the wall weight/color range (observed while tracing), and the scale — then uses it to **gently tune snapping/highlight on the next sheets in the same set** (e.g. "this firm draws walls gray and grids heavy — down-weight heavy lines as grid candidates"). It is the **minimal** bridge described in the plan, not an auto-learning system; the fully-adaptive version is the trained model (M3).

### The load-bearing prerequisite — FLAG THIS FIRST
The headline win ("subtract confirmed grid lineweight from wall candidates") needs **per-vector stroke attributes** (width + color). **The current vector pipeline carries geometry only** — `useSnappingVectors` / `sheet_vectors` store `{ start, end }` percent points with **no width/color**, and `sheet_gridlines` stores grid geometry, not attributes. PyMuPDF's `page.get_drawings()` *does* expose per-path `width` / `color` / `fill`, so it's extractable — but `extract_vectors_from_pdf` currently discards them.
- **Decision (settle before building):** does 3c **extend the backend vector extraction to carry `{width, color}` per line** (a real backend + `sheet_vectors` shape change + backfill — the faithful path), or ship a **geometry-only minimal profile** first (firm key + grid axis/spacing stats + scale, applied as a gentle snapping-strength nudge) and defer attribute-based subtraction to 3c-b? **Recommendation: phase it** — 3c-a = backend stroke-attribute extraction + the `drawing_set_profile` table seeded from grid-vs-wall weights; 3c-b = apply the profile to snapping/highlight. Surface this before writing any migration.

## Decisions to settle early (flag, don't silently solve)
- **Profile key — per-firm vs per-project.** Plan open decision: "start per-project, key by firm where known." Workbench drawings are heterogeneous and the container is a single hidden project, so **per-`architect_firm`** (from `sheet_metadata`) is the natural key, with a per-sheet fallback when firm is unknown. Recommend keying by `architect_firm` (nullable FK-less text key, like the corpus stratification key). Flag if `sheets`/project is the better home.
- **`drawing_set_profile` shape.** Recommend a small table keyed by `architect_firm` (TEXT) with JSONB `observed` = `{ grid: {width, color}, wall: {width_range, colors}, scale, notes }` + M1-style provenance + `sample_sheet_ids`. One row per firm; upserted as sheets are confirmed. Surface the SQL.
- **What to actually apply, and how gently.** The minimal apply: feed the profile into `getSnappedCoordinate` / the candidate filter so heavy lines matching the confirmed grid weight are **down-weighted as wall candidates** (not removed), plus a one-line "snapping tuned for this set" hint. Keep it reversible + obviously-off by default if no profile exists. Do NOT build an auto-learning loop.
- **Where the seed reads from.** Grid weight = match confirmed `sheet_gridlines` endpoints to the nearest extracted vectors and read their width/color. Wall weight = observed while tracing (sample the vectors under accepted room polygons) OR a coarse modal lineweight. Scale = from the drawing-scale/calibration workstream (`[[drawing-scale-calibration]]`, Phase 1 migration applied; reuse if present). Keep the seed math pure + unit-tested.

### Re-read these real files before editing (line numbers drift)
- `sitepulse-backend/main.py` — `extract_vectors_from_pdf` + its `map_point` PDF→percent transform; the `/extract-vectors` endpoint + `sheet_vectors` write-through; `backfill_vectors.py` (the model for any attribute backfill). AGENTS.md §7 rules (auth dep, `asyncio.to_thread`, 25s timeouts, no debug file writes).
- `src/hooks/useSnappingVectors.ts` + `src/utils/geometry.ts` (`getSnappedCoordinate`) — where attributes would ride and where calibration tunes snapping.
- `src/hooks/useSheetGridlines.ts` + `src/hooks/useSheetMetadata.ts` — the confirmed grids + the firm key this phase consumes.
- `src/types/domain.ts` + `database.types.ts` — add `drawing_set_profile` (+ any `sheet_vectors` attribute reshape); narrow new JSONB at the query boundary with a guard.
- `src/store/useWorkbenchStore.ts` — any floating UI for the calibration hint.

## Hard guardrails (AGENTS.md) — same as 3a/3b
- §2 state in `useWorkbenchStore`; reads/writes via Query hooks; never `pendingChanges`.
- §3 overlays in the Konva overlay Layer with native-event isolation; never recolor `mapDisplayStatuses`.
- §4/§6 `drawing_set_profile` (+ any `sheet_vectors` change) in `database.types.ts` + derived in `domain.ts`; narrow new JSONB at the query boundary with a new guard.
- §5 caches follow the `sheet_vectors` write-through pattern; raw JSON only in the Query cache (no class instances).
- §7 backend: `Depends(get_current_user)` + `verify_sheet_access` + `asyncio.to_thread`; PyJWT only; no debug file writes; keep the 25s client timeouts. Reuse `map_point` so attributes land in the SAME percent space.

## Exit criteria (then stop)
- `npm run typecheck` green · `npm run test` green (new vitest: the pure seed math + any accept/apply mapping) · `npm run build` green · if the backend changed, `pytest -q` green (extraction-attribute mapping unit-tested on a tiny fixture).
- ⛔ **Migration(s):** `drawing_set_profile` (and any `sheet_vectors` attribute reshape) SQL via `create-migration`, STOP for owner approval, apply, then reflect in `database.types.ts` + `domain.ts`. Backend change presented + approved before deploy.
- **Live `dev:3010` click-through** (the real gate): confirm grids/title block on sheet 1 of a set → a profile is seeded for the firm; open sheet 2 of the same firm → snapping is observably tuned (or the gentle hint shows) and nothing regresses on a firm with no profile.
- Close with `verify-feature`, then STOP. **Do not commit or push until the owner says "Approved."** On approval, fast-forward `main`, then draft the **Phase 4** (door/window openings) kickoff and paste its launch prompt.

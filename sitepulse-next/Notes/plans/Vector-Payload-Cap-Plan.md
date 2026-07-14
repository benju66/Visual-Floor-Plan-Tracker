# Vector Payload Cap — dense drawings always fit the snapping cache (self-contained build plan)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent context: memory note `vector-cache-write-timeout` (2026-07-14 re-investigation); no parent Notes/ plan — this is a standalone one-phase fix.

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants — §5 vector engine, §7 backend rules, §9 backend testing) — yes, even though this is a backend-only change.
2. Re-read the files named below fresh — do not trust line numbers; they drift.
3. This plan is ONE phase. Build it, verify (§ verify), then stop.
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence plain-English summary; explain jargon in passing; keep it short.

## Goal
When this is done, no floor-plan drawing — no matter how dense its linework — can silently fail to cache its wall-snapping data. Today, a pathologically dense sheet (~66k line segments) produces a payload too big to save within the database's 8-second write limit, so the save silently fails and every future visit re-extracts slowly. After this fix, the extraction output is capped: sheets over the cap keep only their longest segments (real walls), dropping the shortest noise (dimension ticks, hatching), and the stored coordinates are rounded — so the payload always fits. Normal sheets are byte-for-byte unaffected.

## Background (why this is safe and sufficient — verified 2026-07-14)
- The 8s limit is the **database-side `statement_timeout`** on the `authenticated`/`authenticator` Postgres roles (confirmed live on prod). It is NOT in repo code — do not hunt for it there, and do not try to change it (raising a global DB timeout to accommodate one write path is the wrong trade).
- Empirical evidence (2026-06-18, the OP III Level 1 sheet): 66,524 lines ≈ 5.9 MB failed at 8s even rounded; trimming sub-5pt noise → 35,726 lines / 3.2 MB wrote in 7.4s. Sheets at 19k–43k lines write fine routinely (prod today: largest cached rows are 66,524 lines — manually backfilled — then 43,095, all healthy).
- The existing filters (curve/lineweight rejection, `MIN_SEGMENT_PTS = 1.0`, dedupe) shipped 2026-06-09 (`f81cd5c`) — BEFORE the failure was confirmed, so they are necessary but not sufficient. This plan adds the missing last piece.
- Detection is already live: failed cache writes log `[WARN] sheet_vectors cache write failed for {sheet_id}: ...` to Render logs (`e1a6401`, 2026-07-13).

## Out of scope / deferred
- **No re-cache/backfill of existing prod rows.** All dense sheets are currently cached and snapping works; per the standing rule (never verify/touch prod write paths against existing rows), leave them alone. New uploads, re-attaches, and legacy cache-miss fallbacks get the cap automatically.
- **No change to `MIN_SEGMENT_PTS = 1.0`** for normal sheets — the 1pt floor is correct for typical drawings; the cap only engages on pathological ones.
- **No DB migration, no RLS change, no timeout change, no frontend change.** The frontend write-through (`useSnappingVectors.ts` / `useProjectQueries.ts`) writes whatever the backend returns, so it is capped for free.
- The naming-popover hardening discussed in the same session is a separate mini-task, not part of this plan.

## Locked product decisions (from the owner, 2026-07-14)
1. **One phase, as small as possible** — owner asked explicitly for the minimum phasing.
2. **Cap strategy: keep the longest N segments** when a sheet exceeds the cap (drop shortest first — they are dimension ticks/hatching, not walls). Deterministic: sort by true length descending, tie-break by original index; output preserves original order.
3. **Cap default 40,000 lines**, overridable via env var `VECTOR_CAP_LINES` (mirrors the `MAX_UPLOAD_MB` env pattern in §7). Why 40k: prod sheets ≤43k write fine routinely, and the one timed datapoint (35.7k → 7.4s) says stay comfortably below the 8s cliff; 45k would cut it too close.
4. **Store rounded coordinates (5 decimals).** Free ~33% payload shrink, lossless at drawing scale (~0.03px on a 10k-px sheet). Today rounding exists ONLY in the dedupe key; the stored floats are full precision — fix that.
5. When the cap engages, **log it** (`[INFO] vector payload capped: kept 40000 of 66524 lines`) so Render logs show it happened.

## Data model
Reads/writes only the existing `sheet_vectors` table (`sheet_id` PK → `sheets`, `vectors` JSONB = array of `{start:{pctX,pctY}, end:{pctX,pctY}}`). No schema change. No `status_logs`/offline-queue involvement — this is the §5 snapping cache, written server-side (3 sites in `main.py`) and via the frontend write-through.

## Build-on inventory (read these fresh before using)
- `sitepulse-backend/main.py` — `extract_vectors_from_pdf` (near `MIN_SEGMENT_PTS`, currently ~line 575): THE function to change. Its return value feeds all three backend cache writes (`/upload-and-convert` pre-extraction, `/attach-original` pre-extraction, `/extract-vectors/{sheet_id}` write-through) AND the API response the frontend caches — so capping here covers every path. Do not duplicate the cap at call sites.
- `sitepulse-backend/tests/test_text_extraction.py` — the testing model to mirror: build a tiny in-memory PDF with `fitz` (`doc.new_page(width=…, height=…)` + draw shapes), run the extractor, assert on the output. Hermetic, no network.
- `sitepulse-backend/tests/conftest.py` (repo root `conftest.py` for the backend) — sets hermetic `SUPABASE_*` env vars before `main` imports; new tests inherit this for free by living in `tests/`.
- Env-var config pattern: `MAX_UPLOAD_MB` in `main.py` — copy its style for `VECTOR_CAP_LINES`.

## Pure logic to extract + unit-test
One framework-free function in `main.py` (backend has no utils/ split; module-level like `read_upload_capped`):

```python
def cap_vector_payload(lines, width, height, cap):
    """If len(lines) <= cap, return lines unchanged (same object is fine).
    Else keep the `cap` longest segments — length measured in PDF points
    (pct deltas * page dims, aspect-correct like the MIN_SEGMENT_PTS filter) —
    tie-broken by original index, and return them in original order."""
```
- Takes everything it needs as arguments (no I/O, no globals except the constant default) → directly unit-testable with synthetic dicts, no PDFs needed.
- `extract_vectors_from_pdf` calls it as its final step and also applies decision 4 (append the ROUNDED coords to `clean_lines` — the same 5-decimal rounding already computed for the dedupe key, keeping original start→end orientation, not the sorted key order).

## Sub-phasing (ship + verify each)
### Phase 1 — the cap (the whole feature)
- **Scope:** `sitepulse-backend/main.py` (add `VECTOR_CAP_LINES` env-configurable constant + `cap_vector_payload`; call it at the end of `extract_vectors_from_pdf`; store rounded coords; `[INFO]` log when the cap engages) + new `sitepulse-backend/tests/test_vector_extraction.py`. Nothing else.
- **Tests (mirror `test_text_extraction.py` style):**
  - Pure-helper tests with synthetic line dicts: under-cap passthrough (unchanged), over-cap keeps exactly the longest `cap` in original order, deterministic tie-break, aspect-correctness (a segment long in Y on a tall page beats a segment long in X measured naively).
  - One integration test through `extract_vectors_from_pdf` with a tiny in-memory fitz PDF: draw a handful of long "walls" + more short "ticks" than a small cap (pass/patch a small cap for the test), assert only walls survive, coords are 5-decimal rounded, and the existing dedupe/curve/lineweight behavior still holds for a normal under-cap page.
- **Optional empirical check (recommended, READ-ONLY):** download the known dense sheet's original PDF from the public `floorplans` bucket (`originals/<sheet_id>.pdf` for one of the 66,524-line sheets, e.g. `fd66ff07-2bdd-4ab7-8e40-c4120f027d7e`), run the NEW extractor locally (root `venv`), and report final line count + JSON byte size to the owner. ⛔ **Absolutely no prod writes** — do not upsert the result anywhere (standing no-live-write-probes rule).
- **Approval gates:** ⛔ no migrations/RLS/queue involvement, so the only gate is the standard one — do not commit or push until the owner says "Approved" (a push to main auto-deploys the backend on Render).
- **Exit criteria:** `python -m pytest -q` green from `sitepulse-backend/` (all suites, not just the new file) · pure helper unit-tested · no frontend diff (typecheck/build not required; running them is harmless) · close with the `verify-feature` skill → stop. After the owner approves + pushes: confirm the Render deploy goes healthy and the next dense upload (whenever it happens) shows either a clean cache write or the `[INFO] capped` line instead of the `[WARN]` failure.

## Hard guardrails (AGENTS.md — do not violate)
- §7 backend rules: no network call in auth; keep every endpoint's `except HTTPException: raise` branch; generic 500 details only (never echo internals); stdout logging only (no debug file writes); do NOT touch the `SafeClientOptions` 25s client timeouts (they are unrelated to the 8s DB statement timeout and exist for Render's 30s deadline).
- Storage writes stay overwrite-in-place (`upsert: "true"`) — this plan shouldn't touch them at all.
- All three `sheet_vectors` upserts stay non-fatal try/except WITH their existing log lines — do not remove the `[WARN]` logging (it is the detection layer).
- Backend tests stay hermetic (in-memory fitz PDFs, no network); `pytest.ini` collection scope unchanged.
- No frontend edits. If you find yourself in `sitepulse-next/src`, stop — you've left the scope.

## Open decisions
None — all five decisions above are locked. If the empirical check shows 40k still produces a payload the owner is uneasy about (>~4 MB), report the numbers and ask before lowering the default; do not silently change it.

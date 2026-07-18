# Backend Structure — split main.py into core + routers, zero behavior change (self-contained build plan)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: W4 of the 2026-07-15 code review backlog (W1 Guardrails shipped 2026-07-16/17: CI exists, `tests/test_authorization.py` pins the verify helpers, `fitz` handles use `with` blocks).

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` §7–§9 (CRITICAL backend invariants) in full.
2. Re-read `sitepulse-backend/main.py` and every file in `sitepulse-backend/tests/` fresh — do not trust line numbers below; they drift.
3. Build the sub-phases in order. Verify after each slice (§ verify).
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence plain-English summary; explain jargon in passing; keep it short.

## Goal
The backend's one 1,086-line file becomes a small set of focused modules — configuration, database client, login/permission checks, PDF helpers, the pure vector/text extraction math, and one file per route group — with **zero change in behavior**: same URLs, same responses, same permissions, same deploy command. For the owner this changes nothing visibly today; it makes every future backend change smaller, safer to review, and impossible to tangle with unrelated code. The maintenance scripts also stop needing production credentials just to import a math function.

## Out of scope / deferred
- Any behavior, schema, RLS, or dependency change. The ONE sanctioned behavior-adjacent edit is the W1-deferred internal cleanup of the verify helpers' error plumbing (same status codes, pinned by tests — see Phase 1).
- New endpoints, request/response shape changes, performance work (e.g. collapsing `verify_sheet_access`'s two queries into one) — future lanes.
- Frontend work of any kind (W2/W3 own it).
- Renaming routes or the `main:app` entrypoint — locked (Dockerfile CMD + Render start command).

## Locked product decisions (from the owner)
- W4 ordering approved 2026-07-17 (backend split before W2/W3 — freshest test context, closes the backend lane).
- Split is **structure-only**; CI (from W1-P2) is the merge gate; Render keeps auto-deploying `main`.
- One router move per commit, with that router's tests updated **in the same commit** (the workstream's core rule — see § The seam rule).

## Data model
None. No tables, columns, RPCs, or policies are touched. All Supabase access moves file-to-file verbatim.

## Build-on inventory (read these fresh before using)

**Current `main.py` section map (verified 2026-07-17, 1,086 lines — re-derive before editing):**
- ~1–35 imports · `SafeClientOptions` (§7 — keep verbatim) · `FRONTEND_URL`
- ~36–62 env/config + supabase client construction
- ~63–102 `lifespan` startup validation (§7 — keep) · `app = FastAPI(...)` + CORS · `GET /` health
- ~104–145 JWKS `_jwk_client` · `get_current_user` (§7 auth pattern — keep verbatim)
- ~147–198 `verify_sheet_access` / `verify_project_admin` (string-sentinel plumbing — Phase 1 cleans this)
- ~200–220 pydantic models (`PointData`, `PolygonData`, `ExportRequest`)
- ~222–320 shared helpers: `STORAGE_CACHE_SECONDS`, `read_upload_capped`, `MAX_RENDER_PIXELS`/`PREVIEW_ZOOM`/`preview_matrix`, `download_original_pdf`, `content_disposition_attachment`, `bump_pdf_version`, `hex_to_rgb`
- ~322–476 upload routes: `POST /upload-floorplan/{sheet_id}`, `POST /attach-original/{sheet_id}`
- ~478–587 storage routes: `DELETE /sheet-storage/{sheet_id}`, `DELETE /project/{project_id}`
- ~589–744 extraction library: `MIN_SEGMENT_PTS`, `VECTOR_CAP_LINES`, `cap_vector_payload`, `extract_vectors_from_pdf`, `extract_text_from_pdf` (pure fitz — no supabase)
- ~746–818 extraction routes: `GET /extract-vectors/{sheet_id}`, `GET /extract-text/{sheet_id}`
- ~820–1086 `POST /export-pdf/{sheet_id}` + legend renderer

**Test-seam inventory (verified 2026-07-17 — the load-bearing list; re-grep `monkeypatch` before each move):**
- `test_backend_safety.py`: patches `main.verify_sheet_access`, `main.verify_project_admin`, `main.supabase`, `main.MAX_UPLOAD_BYTES`
- `test_error_hygiene.py`: patches `main.verify_sheet_access` (+ one more setattr ~line 60 — re-read to identify its target)
- `test_authorization.py`: patches `main.supabase` (runs the REAL verify helpers — this is the pin that makes Phase 1's cleanup safe)
- `test_vector_extraction.py`: patches `main.VECTOR_CAP_LINES`
- `test_auth.py`: patches the `_jwk_client` seam (~line 37 — re-read)
- `test_endpoints.py`: no patches (missing-bearer gate)
- `conftest.py` sets hermetic `SUPABASE_*` env BEFORE importing `main` — the new modules must keep working under those fakes and must not add import-time network calls.

**Entrypoint + deploy truth:** Dockerfile `CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}` — `main.py` must keep exporting `app`. CI (`.github/workflows/ci.yml` backend job) runs `pytest` from `sitepulse-backend/` on Python 3.11.

**Scripts to repoint:** `backfill_vectors.py` (`from main import extract_vectors_from_pdf`), `backfill_text.py` (`from main import extract_text_from_pdf`) — after Phase 1 they import from `core.extraction` instead, so running a script no longer constructs the real supabase client at import. `sweep_storage_orphans.py` doesn't import main — leave it.

**Duplication to consolidate during Phase 2 (verified):** the vector extract-and-upsert block appears 3× (upload route, attach route, extract-vectors route) → one `cache_sheet_vectors(sheet_id, pdf_bytes)` helper; the preview-PNG render+upload block appears 2× (upload, attach) → one `render_and_store_preview(doc_or_page, sheet_id)` helper. Both helpers belong in `core/sheet_assets.py` (they mix fitz + supabase — NOT in the pure `core/extraction.py`).

## The seam rule (the whole workstream in one paragraph)
Handlers must reference shared state **via module-attribute lookup, never import-time binding**: `from core import supabase_client as db` … `db.supabase.table(...)`, `from core import auth` … `await auth.verify_sheet_access(...)`, `from core import config` … `config.MAX_UPLOAD_BYTES` / `config.VECTOR_CAP_LINES` inside the function body. NEVER `from core.supabase_client import supabase` or `from core.config import MAX_UPLOAD_BYTES` in a router — that binds the value at import and silently detaches every monkeypatch. Each patched name gets exactly ONE canonical home, and each commit that moves code updates its tests to patch that home **in the same commit**. After every commit: `python -m pytest -q` must be green (47+ tests) — a test that passes while patching a dead seam is worse than a failing one, so when moving a test's patch, first make it fail (patch the new home before moving the code, watch it break), then move the code and watch it pass.

## Target layout
```
main.py                  # app assembly ONLY: FastAPI(), lifespan, CORS, GET / health, include_router ×4
core/__init__.py
core/config.py           # env loads, FRONTEND_URL/origins, MAX_UPLOAD_*, MAX_RENDER_PIXELS, PREVIEW_ZOOM,
                         # STORAGE_CACHE_SECONDS, VECTOR_CAP_LINES, MIN_SEGMENT_PTS
core/supabase_client.py  # SafeClientOptions, supabase, download_original_pdf, bump_pdf_version
core/auth.py             # _jwk_client, security, get_current_user, verify_sheet_access, verify_project_admin
core/pdf.py              # read_upload_capped, preview_matrix, hex_to_rgb, content_disposition_attachment
core/extraction.py       # cap_vector_payload, extract_vectors_from_pdf, extract_text_from_pdf — pure fitz, NO supabase import
core/sheet_assets.py     # (Phase 2) cache_sheet_vectors, render_and_store_preview — fitz + supabase composites
core/models.py           # PointData, PolygonData, ExportRequest
routers/__init__.py
routers/uploads.py       # /upload-floorplan, /attach-original
routers/storage.py       # /sheet-storage, /project
routers/extraction.py    # /extract-vectors, /extract-text
routers/export.py        # /export-pdf + legend renderer
```
`lifespan` stays in `main.py` (it validates the client the app actually serves with). Route paths carry no prefix changes — `APIRouter()` with full paths, `include_router` with no prefix.

## Pure logic to extract + unit-test
No NEW pure logic — `core/extraction.py` is a relocation of already-tested functions (`test_vector_extraction.py`, `test_text_extraction.py` follow it). The two Phase-2 consolidation helpers get behavior pinned by the existing route tests plus one direct test each if trivially cheap.

## Sub-phasing (ship + verify each)

### Phase 1 — `core/` modules + verify-helper cleanup (routes stay in main.py)
- **Scope:**
  1. Create `core/` with `config.py`, `supabase_client.py`, `auth.py`, `pdf.py`, `extraction.py`, `models.py` — code moved VERBATIM (imports adjusted only). `main.py` keeps every route, referencing the moved names per § The seam rule.
  2. **The one sanctioned cleanup:** while relocating the verify helpers into `core/auth.py`, replace the string-sentinel plumbing (inner fn returns magic strings; caller string-compares to pick 404/403) with `HTTPException` raised directly inside the threaded function (`HTTPException` propagates cleanly out of `asyncio.to_thread`). Same status codes, same messages — `tests/test_authorization.py` is the behavior pin; run it before AND after.
  3. Update every test patch to its new canonical home (`core.auth.verify_sheet_access`, `core.supabase_client.supabase`, `core.config.MAX_UPLOAD_BYTES`, `core.config.VECTOR_CAP_LINES`, the `core.auth._jwk_client` seam), using the fail-first ritual from § The seam rule. `test_endpoints.py` needs no changes.
  4. Repoint `backfill_vectors.py` / `backfill_text.py` to `from core.extraction import ...`; sanity-check that importing `core.extraction` alone needs no env vars.
- **Approval gates:** ⛔ none beyond standing rules (branch off main, PR through CI, no merge until "Approved"). No schema/RLS/behavior change (the cleanup is internal, test-pinned).
- **Exit criteria:** `python -m pytest -q` green (all 47+, including unchanged `test_authorization.py` behavior) · CI green on the PR · `python -c "import core.extraction"` succeeds with NO env vars set · grep proves no test still patches a `main.*` name that moved · close with verify-feature.

### Phase 2 — `routers/` modules (main.py becomes assembly-only)
- **Scope:** four commits, ONE router per commit, each commit = move routes verbatim + repoint that router's test patches + pytest green:
  1. `routers/uploads.py` — while moving, consolidate the two preview-render blocks into `core/sheet_assets.py:render_and_store_preview` and the upload/attach vector blocks into `cache_sheet_vectors` (log strings may unify; behavior identical).
  2. `routers/storage.py` — keep the §7-pinned delete ordering byte-for-byte.
  3. `routers/extraction.py` — third `cache_sheet_vectors` call site replaces its inline block.
  4. `routers/export.py` — the ~270-line export + legend renderer; largest cut-paste, no logic edits.
  Then shrink `main.py` to assembly (FastAPI + lifespan + CORS + health + 4 `include_router`) and update the AGENTS.md §7 file references (`sitepulse-backend/main.py` → the new module homes) + the repo-root CLAUDE.md line if needed.
- **Approval gates:** ⛔ none beyond standing rules. Route paths/response shapes byte-identical — if any test needs a behavioral edit to pass, STOP: that's a regression, not a seam update.
- **Exit criteria:** pytest green after EVERY commit (not just the last) · CI green on the PR · `uvicorn main:app` boots locally (or via the dev restart script) and `GET /` health returns ok · one live end-to-end upload through dev:3010 + local backend :8001 (exercises uploads router + sheet_assets helpers + storage write) · post-merge: watch the Render deploy go live and hit `/` health · close with verify-feature.

## Hard guardrails (AGENTS.md §7–§9 — do not violate)
- `uvicorn main:app` stays the entrypoint; route paths and response shapes are byte-identical; the health route stays public.
- Keep verbatim: `get_current_user` local-JWKS verification (no network auth calls, no HS256 fallback), `SafeClientOptions` + 25s timeouts, `lifespan` startup validation, `read_upload_capped`, `preview_matrix` clamp, upsert-in-place storage writes, delete-project ordering, the corrupt-PDF 400 branches (W1-P3), `with fitz.open(...)` blocks, and the per-route `except HTTPException: raise` tails — every one is test-pinned; moves only.
- Generic 500 details only — no `str(e)` to clients. No debug file writes. No dependency changes (`requirements.txt` untouched; §8 pins stay).
- `core/extraction.py` must never import supabase (that independence is the point — scripts and tests import it env-free).
- The seam rule (§ above) on every moved name; no test may keep patching a `main.*` name whose code moved.
- No frontend edits. Lint is not a gate.

## Verification commands (the exit-criteria gate)
Backend: `python -m pytest -q` from `sitepulse-backend/` (venv active). Boot check: `scripts/restart-dev.ps1` (never orphan the uvicorn reloader on Windows — repo memory). Frontend triple only if something frontend-visible changed (it should NOT in this workstream):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
⚠️ dev:3010 runs against PROD Supabase (DevDbBanner) — live checks read/upload to a throwaway test sheet only; never probe prod write paths against real rows (standing rule).

## Open decisions
- None blocking. If Phase 2's consolidation helpers turn out to need behavior-visible changes (e.g. differing log strings matter to some consumer), keep the inline blocks and note it — consolidation is a bonus, not the goal.

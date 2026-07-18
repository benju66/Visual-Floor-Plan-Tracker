# Kickoff — Backend Structure, Phase 2: routers/ modules (main.py becomes assembly-only)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of Backend Structure** (move the routes out of `sitepulse-backend/main.py` into `routers/` — one router per commit, zero behavior change). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-18 - Backend Structure Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Backend-Structure-Plan.md` (Phase 2 + § The seam rule)
> - `sitepulse-next/AGENTS.md` §7–§9
>
> Branch off `main`, PR through CI. Build **only Phase 2**. ⛔ ONE router per commit, that router's tests repointed in the same commit — pytest green after every commit. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
Phase 1 (PR #15) moved the backend's non-route layers into `core/`; main.py still holds all 7 routes (~650 lines). This phase moves the routes into four small `routers/` files and shrinks main.py to pure assembly (FastAPI app + lifespan + CORS + health + 4 `include_router` calls). Along the way, two blocks that are copy-pasted 2–3× (vector extract-and-cache, preview-PNG render-and-store) collapse into one helper each. Nothing changes for users.

## Scope (per the plan's Phase 2 — four commits, in this order)
1. `routers/uploads.py` — `/upload-floorplan`, `/attach-original`. While moving, consolidate the two preview-render blocks into `core/sheet_assets.py:render_and_store_preview` and the two inline vector blocks into `cache_sheet_vectors` (fitz + supabase composites — NOT in the pure `core/extraction.py`; log strings may unify, behavior identical).
2. `routers/storage.py` — `/sheet-storage`, `/project`. Keep the §7-pinned delete ordering byte-for-byte.
3. `routers/extraction.py` — `/extract-vectors`, `/extract-text`. Third `cache_sheet_vectors` call site replaces its inline block.
4. `routers/export.py` — `/export-pdf` + the ~270-line legend renderer; largest cut-paste, no logic edits.
Then shrink `main.py` to assembly and update AGENTS.md §7 file references (`sitepulse-backend/main.py` → the new module homes) + the repo-root CLAUDE.md line if needed.

## Guardrails
- **The seam rule holds in every router:** `from core import auth` … `await auth.verify_sheet_access(...)`; `from core import supabase_client as db` … `db.supabase`; `from core import config` … `config.STORAGE_CACHE_SECONDS` — NEVER `from core.x import name` for anything a test patches. Phase 1 already put every patch on its canonical `core.*` home, so router moves should need few or no test edits — if a test needs a behavioral edit to pass, STOP: that's a regression.
- `APIRouter()` with FULL paths, `include_router` with no prefix — route paths and response shapes byte-identical. `uvicorn main:app` stays the entrypoint; health stays public in main.py.
- Keep verbatim (test-pinned, AGENTS §7): upsert-in-place storage writes, delete-project ordering, corrupt-PDF 400 branches, `with fitz.open(...)`, `except HTTPException: raise` tails, generic-500 details.
- If the consolidation helpers would need any behavior-visible change, keep the inline blocks and note it — consolidation is a bonus, not the goal (plan § Open decisions).
- No schema/RLS/dependency/frontend changes. Lint is not a gate.

## Exit criteria (Definition of Done)
- `python -m pytest -q` green from `sitepulse-backend/` after EVERY commit (not just the last).
- CI green on the PR.
- Local boot: `uvicorn main:app` starts and `GET /` health responds (no `--reload` orphans; use a throwaway port or `scripts/restart-dev.ps1`).
- One live end-to-end upload through dev:3010 + local backend :8001 (exercises uploads router + sheet_assets helpers + storage write) — ⚠️ dev:3010 points at PROD Supabase: use a throwaway test sheet only, never probe real rows.
- AGENTS.md §7 references updated to the new module homes.
- Close with the **verify-feature** skill, present the diff summary, then **STOP — no merge until the owner says "Approved."** After approval + merge, watch the Render deploy and hit `/` health.

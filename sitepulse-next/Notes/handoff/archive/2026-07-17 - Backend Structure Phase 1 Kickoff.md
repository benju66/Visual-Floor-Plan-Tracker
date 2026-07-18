# Kickoff — Backend Structure, Phase 1: core/ modules + verify-helper cleanup

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Backend Structure** (extract `core/` modules from `sitepulse-backend/main.py` — routes stay put; zero behavior change except the test-pinned verify-helper plumbing cleanup). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-17 - Backend Structure Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Backend-Structure-Plan.md` (Phase 1 + § The seam rule)
> - `sitepulse-next/AGENTS.md` §7–§9
>
> Branch off `main`, PR through CI. Build **only Phase 1**. ⛔ Every moved name keeps ONE patchable seam and its tests move in the same commit — pytest green after every commit. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
The backend is one 1,086-line file. This phase moves the non-route layers — configuration, the database client, login/permission checks, PDF helpers, and the pure extraction math — into a `core/` package, leaving every route in place. Nothing changes for users. The one cleanup riding along: the two permission-check helpers currently pass errors around as magic strings and string-compare them to pick 403 vs 404; they'll raise the proper errors directly instead — safe now because W1-P3's `test_authorization.py` pins their exact behavior.

## Scope
1. Create `core/` per the plan's § Target layout: `config.py`, `supabase_client.py`, `auth.py`, `pdf.py`, `extraction.py`, `models.py`. Code moves VERBATIM (only imports adjust). `main.py` keeps `app`, `lifespan`, CORS, health, and ALL routes.
2. **The seam rule is the phase.** Handlers reference moved names via module-attribute lookup (`from core import config` … `config.MAX_UPLOAD_BYTES` inside the function; `from core import supabase_client as db` … `db.supabase`; `from core import auth` … `await auth.verify_sheet_access(...)`) — never `from core.x import name` for anything a test patches. The patch inventory to migrate (re-grep `monkeypatch` first; the plan lists file-by-file): `main.supabase` → `core.supabase_client.supabase`; `main.verify_sheet_access`/`main.verify_project_admin` → `core.auth.*`; `main.MAX_UPLOAD_BYTES`/`main.VECTOR_CAP_LINES` → `core.config.*`; the `_jwk_client` seam in `test_auth.py` → `core.auth._jwk_client`. Use the fail-first ritual: repoint the test's patch target, watch it fail, move the code, watch it pass.
3. Verify-helper cleanup in `core/auth.py`: raise `HTTPException(404/403, ...)` directly inside the threaded `check_access` functions (exceptions propagate out of `asyncio.to_thread`); delete the string comparisons. Same codes, same messages — run `tests/test_authorization.py` before and after; it must pass unmodified except its patch path.
4. Repoint `backfill_vectors.py` and `backfill_text.py` to `from core.extraction import ...`. `core/extraction.py` must import NO supabase and require NO env vars (`python -c "import core.extraction"` with a clean env is part of the exit gate).

## Guardrails
- ⛔ No schema/RLS/dependency/route changes. Response shapes byte-identical. If a test needs a behavioral edit (beyond its patch path) to pass — STOP, that's a regression.
- Keep verbatim (all test-pinned, AGENTS §7): local-JWKS `get_current_user`, `SafeClientOptions` + 25s timeouts, `lifespan` validation (stays in main.py), `read_upload_capped`, `preview_matrix`, upsert-in-place storage, corrupt-PDF 400 branches, `with fitz.open(...)`, `except HTTPException: raise` tails.
- `conftest.py` sets fake `SUPABASE_*` env before import — the new modules must behave identically under those fakes; no import-time network calls.
- No frontend edits at all. Lint is not a gate.

## Exit criteria (Definition of Done)
- `python -m pytest -q` green from `sitepulse-backend/` (all 47+ tests) — after EVERY commit, not just the last.
- CI green on the PR (backend job; frontend job trivially green — no frontend diff).
- Grep proof: no test patches a `main.*` name whose code moved; `core.extraction` imports env-free.
- Local boot check: backend starts (`scripts/restart-dev.ps1`; never orphan the uvicorn reloader) and `GET /` health responds.
- Close with the **verify-feature** skill, present the diff summary, then **STOP — no merge until the owner says "Approved."** After approval + merge, watch the Render deploy and hit `/` health (⚠️ dev:3010 points at PROD Supabase — no live-write probes).

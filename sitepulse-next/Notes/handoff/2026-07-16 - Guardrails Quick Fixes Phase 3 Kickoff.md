# Kickoff — Guardrails & Quick Fixes, Phase 3: Backend safety batch (tests first)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3 of Guardrails & Quick Fixes** (backend safety — tests first, then the corrupt-PDF 400 fix + fitz context managers). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-16 - Guardrails Quick Fixes Phase 3 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Guardrails-Quick-Fixes-Plan.md` (Phase 3)
> - `sitepulse-next/AGENTS.md` §7 (backend rules — LOAD-BEARING)
>
> Branch off `main`. Build **only Phase 3**, in the listed order (tests pin current behavior BEFORE any fix). ⛔ No schema/RLS changes; no route-path/response-shape/auth-semantics changes (other than the new 400). Keep every §7 invariant. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
The backend's permission-check helpers (`verify_sheet_access`, `verify_project_admin`) are the gate that decides who can touch a sheet or delete a project — and they have ZERO real test coverage (every other test stubs them out). This phase pins their behavior with real tests FIRST, then makes two safe fixes: a corrupt PDF upload should say "not a valid PDF" (400) instead of "server error, try again" (500), and every PyMuPDF document should close on error paths (context managers) so a bad upload can't leak a handle. Tests-first is deliberate: the existing suite becomes the regression net before anything changes.

## Scope — in this exact order (each step green before the next)
1. **Authz tests FIRST (pin current behavior, no code change yet):** new `sitepulse-backend/tests/test_authorization.py` driving the REAL helpers (no stubs) via the `_FakeSupabase` recorder pattern from `tests/test_backend_safety.py`:
   - sheet routes: missing sheet → 404; caller not a member → 403; member → passes.
   - `delete_project`: non-member → 403; member with only `pm`/`superintendent`/`viewer` → 403; `owner` or `admin` → proceeds (the `roles & {"owner","admin"}` set logic).
   This is the biggest untested risk in the backend — pin it before touching anything.
2. **Corrupt-PDF → 400:** add `except fitz.FileDataError: raise HTTPException(400, "The file is not a valid PDF.")` to BOTH upload routes (`upload_and_convert_floorplan` ~322, `attach_original_pdf` ~403), and narrow the upload route's broad `except ValueError` so no library `ValueError` text can echo to a client (validate `page_number` explicitly / raise `HTTPException(400, …)` at the check site ~339). Pin in `tests/test_error_hygiene.py`: junk bytes named `.pdf` → 400 with the friendly message, not 500.
3. **fitz context managers:** convert every `fitz.open(...)` in `main.py` to `with fitz.open(...) as doc:` (upload ×2 docs, attach preview-regen, both extract functions, export) so handles close on error paths. Behavior-preserving; the existing suite (+ the new tests) is the regression net.
4. *(Optional, only if steps 1–3 are green and time allows)*: replace the string-sentinel error plumbing in the two verify helpers with direct `HTTPException` raises inside the threaded fn. If skipped, note it for W4's router split.

## Guardrails (AGENTS §7 — do not violate)
- ⛔ No schema/RLS/grants/migrations. No route-path, response-shape, or auth-semantics changes — the ONLY new client-visible behavior is corrupt-PDF 500→400.
- Keep every §7 invariant: `Depends(get_current_user)` local-JWT verification untouched; the per-route `except HTTPException: raise` tails are LOAD-BEARING (a 403/404 must not re-emit as 500); `read_upload_capped`, `preview_matrix`, upsert-in-place storage writes, and the delete-project ordering stay exactly as pinned by `test_backend_safety.py`.
- Generic 500 details only — never echo `str(e)` to the client. Step 2 CLOSES the last gap (the broad `except ValueError`); don't open new ones.
- Do NOT invent new test harnesses: reuse `_FakeSupabase` (`test_backend_safety.py`) + the `conftest.py` hermetic env. Import `pytest`/helpers as the existing tests do.
- No frontend changes expected. `requests` stays removed (P1); don't touch §8 pins.

## Exit criteria (Definition of Done)
- `python -m pytest -q` green from `sitepulse-backend/` with the new `test_authorization.py` + the corrupt-PDF pins (the CI backend job will run these too on the PR).
- Frontend triple untouched-but-green (no frontend edits expected).
- Quick live check: a real PDF upload via dev:3010 + local backend still succeeds; a renamed `.txt`/junk `.pdf` → friendly 400 surfaces in the UI (not a 500). ⚠️ dev:3010 is wired to PROD Supabase — a real upload writes a real sheet, so prefer verifying the 400 path (junk file, rejected before any write) and lean on the tests for the happy path.
- Close with the **verify-feature** skill, present the diff + green pytest (and, once pushed, the green CI run), then **STOP — no commit/push until the owner says "Approved."**

# Guardrails & Quick Fixes — close the 4 known bugs, add CI, harden backend tests (self-contained build plan)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: none — this is W1 of the 2026-07-15 four-agent code review backlog (the Security Hardening workstream, same review, already shipped).

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) in full.
2. Re-read the files named below fresh — do not trust line numbers; they drift.
3. Build the sub-phases in order. Verify after each slice (§ verify).
4. Keep the owner (product owner, not a developer) in the loop: lead with a
   1–2 sentence plain-English summary; explain jargon in passing; keep it short.

## Goal
When this is done: the four known small bugs are fixed (the quick status popup no longer shows stale selections; the upload response and its type tell the truth; a corrupt PDF upload says "not a valid PDF" instead of "server error, try again"; the duplicated snapping-vector hook is gone); a fresh clone actually starts (complete `.env.example` files + corrected README); the repo stops carrying dead weight (unused packages, a committed generated 1.2 MB file, a scratch script); and — the big one — every push to GitHub automatically runs the full test suites (CI), so nothing ships to Vercel/Render with failing tests again. Phase 3 also gives the backend's permission-check helpers their first real tests.

## Out of scope / deferred
- JS→TS conversion of any file (W2). Phase 1 edits `QuickStatusModal.jsx` in place — do NOT rename it.
- All structural refactors (W3: queryKeys sweep, useProjectQueries split, etc.) and the backend router split (W4). Phase 3 hardens `main.py` in place without moving anything.
- Branch protection rules on GitHub (making CI a required check) — optional owner action after Phase 2 proves stable; note it, don't configure it.
- Tests for `MobileSwipeDeck`/`useProjectActions` — separate `write-tests` sessions.
- The README's placeholder hero screenshot — owner content, leave it.

## Locked product decisions (from the owner)
- W1 grouping approved 2026-07-15: bugs+housekeeping / CI / backend safety as three phases, in that order (CI isolated on purpose — if a test is flaky under CI, that discovery shouldn't be mixed with code changes).
- No schema/RLS changes anywhere in W1.
- Fixes are behavior-minimal: fix the bug, don't redesign the surface.

## Data model
None. No tables, columns, RPCs, or policies change. The only DB-adjacent edit is deleting a redundant client-side `sheets.base_image_url` write the backend already performs authoritatively.

## Build-on inventory (read these fresh before using)
**Phase 1 (frontend + one backend line):**
- `sitepulse-next/src/components/QuickStatusModal.jsx` — missing the resync effect; `QuickActivityModal.jsx` lines ~6–8 have the exact pattern to mirror (`useEffect` re-seeding local state, keyed on the identity props + `isOpen`). Both are mounted permanently in `app/project/[projectId]/page.tsx` with the `if (!isOpen) return null` guard inside — that's why `useState(initial)` alone goes stale.
- `sitepulse-backend/main.py` `upload_and_convert_floorplan` — returns `{"status", "image_url", "tile_manifest_url": None}`; it already writes `sheets.base_image_url` itself (the authoritative write, ~line 372). `tile_manifest_url` is vestigial (§5 AGENTS: the tile path was removed; nothing reads it).
- The two dead client write-backs: `sitepulse-next/src/hooks/useProjectActions.ts` (~line 108: destructures `base_image_url` from `uploadFloorplanService` — which the response never contains — then `.update({ base_image_url })`) and `src/hooks/useWorkbenchActions.ts` (~lines 139–151, same pattern). `src/services/api.ts` `UploadFloorplanResult` declares the lie (`base_image_url: string`).
- Snapping dedupe: canonical hook = `src/hooks/useSnappingVectors.ts` (takes `sheetId: string | null`, returns `{ vectors, isLoading, error, hasVectors }` — note: NO `isFetching` yet; has its own test). Duplicate = `useSnappingVectors` + `SnappingVectorLine` inside `src/hooks/useProjectQueries.ts` (~lines 355–434; same `queryKeys.snappingVectors` cache key, `lineData: any`, plus a retry-once-on-`Failed to fetch` policy the canonical copy lacks). Consumers of the duplicate — both use ONLY `isFetching` for a spinner: `app/project/[projectId]/page.tsx` (import line ~18, use ~246) and `components/workbench/WorkbenchTracer.tsx` (import ~17, use ~141). `WorkbenchTracer.test.tsx` (~line 89) mocks the duplicate **via the `useProjectQueries` module path** — the mock must move with the import. `FloorplanCanvas.test.tsx` already mocks the canonical path.
- Housekeeping targets (all verified 2026-07-15): `qs` in `sitepulse-next/package.json` (zero imports in src); `requests==2.33.1` in `sitepulse-backend/requirements.txt` (unused; the supabase stack is httpx-based — do NOT touch the AGENTS §8 pinned transitive deps `rich`/`cachetools`/`tenacity`); tracked generated `sitepulse-next/public/pdf.worker.min.mjs` (the `postinstall` + `prebuild` scripts in package.json copy it from `node_modules/pdfjs-dist`, so untracking is safe for Vercel and local); tracked scratch `sitepulse-backend/test_fitz.py` (pytest.ini and .dockerignore already exclude it); AGENTS.md §4 says `project_type` "(1 of 8)" — actual is 9 (see `src/utils/locationTaxonomy.ts`).
- Env-var ground truth for the `.env.example` files (grep-verified 2026-07-15):
  - Frontend reads: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server routes only), `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_PROCORE_CLIENT_ID`, `PROCORE_CLIENT_SECRET`, `PROCORE_ALLOWED_EMAIL_DOMAINS` (fail-closed if unset; Procore trio optional for non-SSO dev).
  - Backend reads: `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_JWT_SECRET` (legacy startup check only — verification is JWKS/ES256), `FRONTEND_URL` (code default is already `http://localhost:3010`), optional `MAX_UPLOAD_MB` (80), `VECTOR_CAP_LINES` (40000).
  - ⚠️ `sitepulse-next/.gitignore` has `.env*` — add `!.env.example` there or the new file silently won't commit. The root `.gitignore` already has the negation.
- README truth to fix: prerequisites say Node v18+ (Next 16 needs ≥20 — say 20+), frontend `npm run dev` on :3000 (real convention: `npm run dev:3010` on :3010), backend `uvicorn main:app --reload` on :8000 with `FRONTEND_URL=:3000` (real convention: port 8001, `FRONTEND_URL=http://localhost:3010`, and frontend `.env.local` sets `NEXT_PUBLIC_API_URL=http://127.0.0.1:8001`); frontend env list omits `SUPABASE_SERVICE_ROLE_KEY` (without it, creating a project from the dashboard fails) and the Procore trio; backend list omits the optional `MAX_UPLOAD_MB`/`VECTOR_CAP_LINES`. Point both env sections at the new `.env.example` files.

**Phase 2 (CI):**
- There is no `.github/` directory at all. Both Vercel (frontend) and Render (backend) auto-deploy from `main`.
- Frontend checks (from `sitepulse-next/package.json`): `npm ci` (postinstall copies the pdf worker — works headless), `npm run typecheck`, `npm run test` (vitest run). `npm run build` is optional in CI — Vercel builds anyway; include it only if the job stays under ~10 min.
- Backend checks: Python 3.11 (matches `sitepulse-backend/Dockerfile` `FROM python:3.11-slim`), `pip install -r requirements.txt -r requirements-dev.txt`, `python -m pytest -q` from `sitepulse-backend/`. The suite is hermetic — `conftest.py` sets fake `SUPABASE_*` env vars before `main` imports; **no repository secrets are needed**.
- Lint is NOT a check (~1850 pre-existing problems — AGENTS/repo memory).

**Phase 3 (backend, in place):**
- `sitepulse-backend/main.py`: `verify_sheet_access` (~147) and `verify_project_admin` (~168) — the string-sentinel plumbing (inner fn returns magic strings, caller string-compares to pick 404/403) may be simplified to raising `HTTPException` directly inside the threaded fn *if* tests pin behavior first; otherwise leave plumbing, just test it.
- The two upload routes (`upload_and_convert_floorplan` ~322, `attach_original_pdf` ~403): filename-only `.pdf` validation; corrupt bytes hit `fitz.open(stream=...)` → `fitz.FileDataError` (a `RuntimeError` subclass) → falls to generic 500. Also `upload` has a broad `except ValueError → 400 str(ve)` intended only for the page-number check (~339) — the last place a raw exception string reaches a client.
- `fitz` document lifecycle: `process_upload` (`doc`, `single_page_doc`), `process_attach` preview-regen `doc`, `extract_vectors_from_pdf`, `extract_text_from_pdf`, and the export route close docs only on happy paths (or never). PyMuPDF supports `with fitz.open(...) as doc:`.
- Test patterns to reuse (do NOT invent new harnesses): `tests/test_backend_safety.py` `_FakeSupabase` recorder + `monkeypatch.setattr(main, ...)`; `tests/test_error_hygiene.py` for status-code manners; `conftest.py` hermetic env. AGENTS §7's per-route `except HTTPException: raise` tails are LOAD-BEARING — never remove them.

## Pure logic to extract + unit-test
Nothing new — this workstream is deliberately extraction-free (extractions belong to W3/W4). The testing work is: extend the canonical `useSnappingVectors.test.tsx` if its return shape gains `isFetching`; new backend tests in `tests/` (Phase 3) + a response-contract pin for the upload route (Phase 1).

## Sub-phasing (ship + verify each)

### Phase 1 — Bug batch + housekeeping
- **Scope (bugs):**
  1. `QuickStatusModal.jsx`: add the resync `useEffect` mirroring `QuickActivityModal` — re-seed `selectedState` from `currentStatus` and reset `startDate`/`endDate` to `''`, keyed on `[currentStatus, unitId, isOpen]`. Keep `.jsx`; no other changes.
  2. Upload contract: backend adds `"base_image_url": public_url` to the upload response and drops the vestigial `"tile_manifest_url"` key (one line each, + a response-contract test pin in `tests/`); frontend DELETES the two redundant `.update({ base_image_url })` write-backs in `useProjectActions.ts` and `useWorkbenchActions.ts` (the backend write is authoritative — keep the surrounding invalidations and orphan-cleanup logic intact) and fixes `UploadFloorplanResult` in `services/api.ts` to the real shape (`{ status: string; image_url: string; base_image_url: string }`).
  3. Snapping dedupe: add `isFetching` to the canonical `useSnappingVectors.ts` return; port the duplicate's retry-once-on-`Failed to fetch` policy into it (superset behavior, no regression); delete the duplicate hook + its `SnappingVectorLine` from `useProjectQueries.ts`; repoint `page.tsx` and `WorkbenchTracer.tsx` imports to `@/hooks/useSnappingVectors`; move the `WorkbenchTracer.test.tsx` mock to the new module path.
- **Scope (housekeeping):** `.env.example` in both apps (every var above, comments, secrets left blank) + `!.env.example` in `sitepulse-next/.gitignore`; README fixes (Node 20+, ports 3010/8001, complete env lists pointing at the .env.example files); `npm uninstall qs`; remove `requests` from `requirements.txt`; `git rm --cached sitepulse-next/public/pdf.worker.min.mjs` + gitignore it (`sitepulse-next/.gitignore`: `/public/pdf.worker.min.mjs`); `git rm sitepulse-backend/test_fitz.py`; AGENTS §4 "(1 of 8)" → "(1 of 9)".
- **Approval gates:** ⛔ none beyond the standing rule (present the diff; no commit/push until "Approved"). The backend response change is additive — old clients unaffected.
- **Exit criteria:** typecheck + test + build green (frontend) · `python -m pytest -q` green (backend) · live dev:3010 click-through: open the quick status popup on one location, close, open on another — selections reset; upload a new level PDF end-to-end (needs the local backend on :8001) and confirm the sheet renders · close with verify-feature.

### Phase 2 — CI
- **Scope:** one workflow file, `.github/workflows/ci.yml`, two independent jobs, triggered on `push` to `main` and on all `pull_request`:
  - `frontend`: ubuntu-latest, Node 22 (`actions/setup-node` with npm cache, `cache-dependency-path: sitepulse-next/package-lock.json`), `npm ci` + `npm run typecheck` + `npm run test`, `working-directory: sitepulse-next`. Add `npm run build` only if total stays reasonable.
  - `backend`: ubuntu-latest, Python 3.11 (`actions/setup-python` with pip cache), `pip install -r requirements.txt -r requirements-dev.txt` + `python -m pytest -q`, `working-directory: sitepulse-backend`.
  - No secrets, no deploy steps — checks only (Vercel/Render keep owning deploys). Path filters are deliberately OMITTED in v1 (a docs-only push costing a few CI minutes is fine; correctness first).
- **Approval gates:** ⛔ none technical. Note to the owner after merge: optionally enable GitHub branch protection to make these checks blocking — their call, not part of this phase.
- **Exit criteria:** both jobs green on the PR/branch run in GitHub Actions (this phase's verification IS the live run — push the branch and watch it) · a deliberate local check that the commands match package.json/pytest reality before pushing · close with verify-feature.

### Phase 3 — Backend safety batch (tests first, then fixes)
- **Scope, in order:**
  1. **Authz tests FIRST (pin current behavior):** new `tests/test_authorization.py` using the `_FakeSupabase` recorder — through the real helpers (no stubs): sheet routes with a missing sheet → 404; caller not a member → 403; member → passes. `delete_project`: non-member → 403; member with only `pm`/`superintendent`/`viewer` → 403; `owner` or `admin` → proceeds (the `roles & {"owner", "admin"}` set logic).
  2. **Corrupt-PDF 400:** add `except fitz.FileDataError: raise HTTPException(400, "The file is not a valid PDF.")` to both upload routes, and narrow the upload route's broad `except ValueError` (validate `page_number` explicitly / raise `HTTPException(400, ...)` at the check site so no library `ValueError` text can echo to a client). Pin both in `tests/test_error_hygiene.py` (junk bytes named `.pdf` → 400 with the friendly message, not 500).
  3. **`fitz` context managers:** convert every `fitz.open(...)` in `main.py` to `with` blocks (upload ×2 docs, attach preview-regen, both extract functions, export) so handles close on error paths. Behavior-preserving; the existing suite is the regression net.
  4. *(Optional, only if time allows and tests from step 1 are green first)*: replace the string-sentinel error plumbing in the two verify helpers with direct `HTTPException` raises inside the threaded fn. If skipped, note it for W4.
- **Approval gates:** ⛔ none beyond standing rules. No route paths, response shapes (other than the new 400), or auth semantics change.
- **Exit criteria:** `python -m pytest -q` green with the new tests · frontend triple untouched-but-green (no frontend edits expected) · quick live check: upload a real PDF via dev:3010 + local backend still succeeds; upload a renamed `.txt` → friendly 400 surfaces in the UI · close with verify-feature.

## Hard guardrails (AGENTS.md — do not violate)
- **No schema/RLS/grants changes anywhere.** No migration files.
- Backend §7 invariants: keep `Depends(get_current_user)` local-JWT verification untouched; keep the per-route `except HTTPException: raise` tails; keep `read_upload_capped`, `preview_matrix`, upsert-in-place storage writes, and the delete-project ordering exactly as pinned by `test_backend_safety.py`; generic 500 details only (never echo `str(e)` — Phase 3 step 2 *closes* the last gap, don't open new ones).
- §8: do not touch `rich`/`cachetools`/`tenacity`/`pyiceberg` pins; do not pin `starlette`; `requests` is the ONLY dependency removal.
- §5/§6: the snapping hook keeps returning raw JSON arrays (never an RBush instance into the Query cache); `useCanvasSnapping.ts` stays the RBush home. The dedupe must not change the `queryKeys.snappingVectors` key shape (a persisted IDB cache exists in the field).
- §2: nothing here touches `pendingChanges`, the offline queue, `upsert_status_log`, or any status write path. QuickStatusModal's fix is local component state only — `onCommit` flow unchanged.
- Keep `.js`/`.jsx` files as-is (no renames — W2 owns conversion); Vitest imports from `'vitest'` (globals OFF); lint is not a gate.

## Verification commands (the exit-criteria gate)
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
Backend: `python -m pytest -q` from `sitepulse-backend/` (venv active; `pip install -r requirements-dev.txt` if pytest missing). Live click-throughs via `npm run dev:3010` (port 3010, not 3000); local backend on :8001 (`scripts/restart-dev.ps1` — never orphan the uvicorn reloader on Windows).

## Open decisions
- None blocking. Two deliberately-deferred notes: (1) branch protection (making CI required) = owner's optional follow-up after Phase 2; (2) if Phase 3 step 4 (sentinel-plumbing cleanup) is skipped, carry it to W4's router split.

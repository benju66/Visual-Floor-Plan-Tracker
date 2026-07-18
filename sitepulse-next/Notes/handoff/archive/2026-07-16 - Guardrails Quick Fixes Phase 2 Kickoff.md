# Kickoff — Guardrails & Quick Fixes, Phase 2: CI

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of Guardrails & Quick Fixes** (add CI — one GitHub Actions workflow, no code changes). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-16 - Guardrails Quick Fixes Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Guardrails-Quick-Fixes-Plan.md` (Phase 2)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 2**. ⛔ No product-code changes, no schema/RLS changes, no `.js`/`.jsx` renames. The workflow must match `package.json`/`pytest` reality exactly. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
Right now nothing runs the test suites before code ships — every push to `main` auto-deploys to Vercel (frontend) and Render (backend) with zero gate, so a broken test can reach production. Phase 2 adds one GitHub Actions workflow that runs the full frontend + backend checks on every push to `main` and every pull request. It's deliberately isolated from code changes (Phase 1's bugs, Phase 3's backend work) so that if a test turns out to be flaky under CI, that discovery isn't tangled up with a behavior change.

## Scope — one file
`.github/workflows/ci.yml` (there is NO `.github/` directory yet — this creates it), two independent jobs, triggered on `push` to `main` and on all `pull_request`:
- **`frontend`** — `ubuntu-latest`, `working-directory: sitepulse-next`, Node 22 (`actions/setup-node` with npm cache, `cache-dependency-path: sitepulse-next/package-lock.json`):
  - `npm ci` (the `postinstall` copies the pdf worker from `pdfjs-dist` — works headless)
  - `npm run typecheck`
  - `npm run test` (vitest run)
  - `npm run build` — include ONLY if the whole job stays under ~10 min (Vercel builds anyway; optional).
- **`backend`** — `ubuntu-latest`, `working-directory: sitepulse-backend`, Python 3.11 (`actions/setup-python` with pip cache; matches the `Dockerfile` `FROM python:3.11-slim`):
  - `pip install -r requirements.txt -r requirements-dev.txt`
  - `python -m pytest -q`
- **No secrets, no deploy steps.** The pytest suite is hermetic (`conftest.py` sets fake `SUPABASE_*` before importing `main`) and the frontend checks don't need env. Vercel/Render keep owning deploys.
- Path filters are deliberately OMITTED in v1 (a docs-only push costing a few CI minutes is fine; correctness first).

## Guardrails
- ⛔ No product-code changes at all — this is one new YAML file. No schema/RLS/migrations, no `.js`/`.jsx` renames.
- **Lint is NOT a CI check** — the repo carries ~1850 pre-existing lint problems (AGENTS/repo memory). Do not add a lint job.
- Before pushing, do a deliberate local check that every command in the workflow matches `package.json` scripts + the pytest invocation exactly (typecheck/test/build script names; `requirements-dev.txt` exists; `python -m pytest -q` from `sitepulse-backend/`).
- Pin action versions to a major (e.g. `actions/checkout@v4`, `actions/setup-node@v4`, `actions/setup-python@v5`).

## Exit criteria (Definition of Done)
- **This phase's verification IS the live run:** push the branch and confirm BOTH jobs go green in GitHub Actions (frontend typecheck+test[+build], backend pytest). That's the proof the commands match reality.
- No repository secrets required; no deploy step present.
- Close with the **verify-feature** skill, present the result (link/paste the green run), then **STOP — no commit/push until the owner says "Approved."**
- Note to owner after merge: optionally enable GitHub **branch protection** to make these checks blocking (their call — not part of this phase). Deferred from the plan: if Phase 3's sentinel-plumbing cleanup is skipped, it carries to W4's router split.

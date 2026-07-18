# Visual Floor Plan Tracker — Repo Map

This file is a directory map for orienting a fresh session at the repo root. It intentionally does not duplicate architecture rules — those live in the nested docs below and load automatically the moment a tool touches a file in that folder.

## Active code
- **sitepulse-next/** — the live Next.js app (frontend). Read `sitepulse-next/CLAUDE.md` (imports `AGENTS.md`) before changing anything here — it has the load-bearing rules (state management, offline sync, canvas engine, TypeScript guardrails, testing conventions).
- **sitepulse-backend/** — the live FastAPI backend (Python): `main.py` (assembly) + `core/` (non-route layers) + `routers/` (routes). No local CLAUDE.md; its conventions (auth, Supabase client config, the module/seam layout, dependency notes) are documented in `sitepulse-next/AGENTS.md` §7-8.

## Planning & workflow docs
- **sitepulse-next/Notes/plans/** — long-form multi-phase workstream plans (`<Workstream>-Plan.md`).
- **sitepulse-next/Notes/handoff/** — dated per-phase kickoff docs (`YYYY-MM-DD - <Workstream> Phase N Kickoff.md`); closed phases move to `handoff/archive/`.
- **docs/** (repo root) — product/data specs (annotation spec, location-labeling standard, cost-code catalog) — cross-cutting standards, not implementation notes.
- Phases are typically opened with the `plan-phases` skill and closed with the `verify-feature` skill. Skills in `.agent/skills/` (tracked in git) codify this repo's own workflow — most apply across both `sitepulse-next` and `sitepulse-backend` (e.g. `verify-feature`, `create-migration`, `write-tests`, `deep-review`, `map-feature-context`); a couple are frontend-only (`js-to-ts-conversion`, `add-data-hook`).

## Other
- **README.md** — stack overview and local dev setup.
- **artifacts/**, **design-mockups/** — generated analysis output / standalone HTML feature previews.
- **venv/** — local Python virtualenv for the backend; not tracked in git.

Update this file only when the top-level shape of the repo changes (a project added/removed, Notes/docs reorganized) — it's a map, not a status log.

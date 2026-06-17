# Kickoff — Location Labeling Workbench, Phase 4: Workbench shell (route + hidden container + library list + dashboard hiding)

> Paste-ready prompt + context for a fresh Claude Code session. Self-contained: read this, then the files it names, then build.
> **⚠️ DEPENDS ON PHASE 3.** Do not start until Phase 3 (the workbench schema migration: `projects.kind`, `workbench_sheets`, `units` label flags) is **applied and merged** — this phase reads/writes those columns. If `projects.kind` / `workbench_sheets` don't exist yet, stop and build Phase 3 first (`… Phase 3 Kickoff.md`).
> Phases 1 + 2 are DONE (project-type picker; taxonomy correction — 9 project types live).

## What you're building
**Phase 4 of the Location Labeling Workbench plan** — the first *visible* workbench surface, but still empty. A new **full-page "Drawing Library" route**, opened from a **privileged-gated button** on the Projects Dashboard. Behind it: a single hidden **"workbench container"** project (a `projects` row with `kind='workbench'`) is bootstrapped server-side if it doesn't exist yet, and the library lists the workbench drawings under it (initially none). Critically, this phase also **hides the workbench container from the normal Projects Dashboard** so it never pollutes the live project list. **No PDF upload, no tracing, no status/schedule/sync UI** — just the shell + the contamination guard.

## Required reading (in order, fresh — do not trust line numbers)
1. `sitepulse-next/AGENTS.md` — Especially **§0** (talk to the owner in plain English), **§2** (data fetching via the established **TanStack Query hooks** — never `useState`/`useEffect` for DB data; global UI state in Zustand; do NOT break the offline mutation queue / `pendingChanges`; RLS posture), **§4** (Location Taxonomy), **§6** (TS guardrails: new files `.ts`/`.tsx`, derive types from `database.types.ts`, no `any`).
2. `sitepulse-next/Notes/plans/Location-Labeling-Workbench-Plan.md` — the plan-of-record. Read **§ Locked product decisions** (esp. **1** "hidden workbench container, not separate tables" + **2** "new full-page surface, privileged-gated"), **§ Data model → "The load-bearing coupling — DO NOT break it"**, **§ Build-on inventory**, and **Phase 4** in full. (Phases 5+ are NOT in scope.)
3. The **Phase 3 kickoff/migration** (now applied) so you know the exact `projects.kind` + `workbench_sheets` shape you're querying, and the derived `WorkbenchSheet` type in `src/types/domain.ts`.

## Files this phase touches
- **NEW** `src/app/workbench/page.tsx` — the full-page Drawing Library route (`"use client"`). Privileged-gated; renders the (empty) list of workbench drawings. **A modal can't host this** (Phase 6 mounts a zoom/pan canvas here later) — it must be its own route.
- **NEW** dedicated **filter-applying hooks** (e.g. `src/hooks/useWorkbench.ts`): `useWorkbenchContainer()` (find/return the single `kind='workbench'` project) and `useWorkbenchSheets()` (the container's `sheets` joined to `workbench_sheets` metadata). These **always** scope to the container — they are the only sanctioned way to read workbench data. Follow the pattern of `src/hooks/useProjectQueries.ts` (`useSheets`, `useUnits`).
- **NEW** a server route to **bootstrap the container** — mirror `src/app/api/projects/route.js`: create a `projects` row with `kind='workbench'` (+ the owner `project_members` row) **only if none exists** (lazy-create on first privileged visit — the plan's default). Use the **service-role key, server-side only**, exactly like `api/projects`. Do NOT widen RLS to do this from the client.
- `src/app/dashboard/page.jsx` — (a) add the privileged-gated **"Drawing Library"** entry button (reuse the existing `adminProjects` signal / a `useCurrentUserRole`-style check that's already used to show "Global Settings"); (b) **contamination guard:** the project-list query must **exclude `kind='workbench'`**. The current query is `project_members → projects(*)`; filter the workbench container out (filter on the embedded resource, or post-filter the result) so it never shows as a normal project.

## How it should behave
- The "Drawing Library" button shows **only for privileged users** (owner/admin/pm) — same gating signal as Global Settings.
- Opening it lands on `/workbench`; on first visit the container is lazily created server-side; the library renders **empty** with no status/schedule/bulk/sync controls anywhere.
- The workbench container **never** appears in the Projects Dashboard grid.

## Guardrails (must not violate)
- **Contamination guard is load-bearing** — `kind='workbench'` must be excluded from the dashboard and every "all projects" surface; route all workbench reads through the dedicated filter-applying hooks. A workbench row must never enter a live-project view or `progressAnalytics`.
- **Container bootstrap is server-side only** (service-role key, like `api/projects`). Do NOT create it from the client and do NOT widen RLS.
- **No backend (`main.py`) changes.** **No `status_logs` / `status_audit_log` / offline-queue code.** Never mount the field/status/schedule/bulk/sync UI in the workbench.
- **Types:** derive from `database.types.ts` (`WorkbenchSheet` already in `domain.ts` from Phase 3); no hand-written table shapes; no `any`; new files `.ts`/`.tsx`.
- **Data fetching via TanStack hooks** (§2) — no `useState`/`useEffect` DB fetching; global UI state (e.g. any workbench modal/toggle) in a Zustand store with an explicit interface.

## Verify before closing (exit criteria)
Run with the absolute `--prefix` (cwd persists in Bash; a stray `cd` prompts):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
Then a **live `npm run dev:3010`** (from `sitepulse-next/`, port 3010) click-through:
- A privileged user sees the **Drawing Library** button on the dashboard and opens `/workbench`.
- The workbench container does **NOT** appear in the Projects Dashboard list (create/verify it's hidden).
- The library renders (empty) and shows **no** status/schedule/sync controls.

Close the phase with the **verify-feature** skill (Definition of Done → stop). **Do not commit or push until the owner says "Approved."**

## Scope discipline
This session builds **only Phase 4** — the shell, the hidden container + its server bootstrap, the empty library list, and the dashboard exclusion. Do **NOT** build PDF ingest / per-sheet metadata capture (Phase 5), the tracing canvas (Phase 6), or the standard-enforcing labeling UX (Phase 7) — separate gated sessions.

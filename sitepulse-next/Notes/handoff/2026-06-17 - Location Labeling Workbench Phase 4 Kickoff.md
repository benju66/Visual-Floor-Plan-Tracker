# Kickoff — Location Labeling Workbench, Phase 4: Workbench shell (route + hidden container + library list + dashboard hiding)

> Paste-ready prompt + context for a fresh Claude Code session. Self-contained: read this, then the files it names, then build.
> **✅ PHASE 3 IS DONE.** The workbench schema migration (`projects.kind`, `workbench_sheets` + RLS, `units.spans_levels`/`level_note`/`has_void`) is **applied to prod and merged to `main`** (merge `7d3b176`, 2026-06-17). `WorkbenchSheet` + `WorkbenchSheetInsert` are derived in `src/types/domain.ts`. The columns this phase reads/writes exist now — sanity-check with a quick `grep WorkbenchSheet src/types/domain.ts` if unsure.
> Phases 1, 2, 3 are DONE (project-type picker; taxonomy correction — 9 project types live; workbench schema). **Branch off `main`** — it is current and now also carries the Manage + Gantt workspaces. Small reviewable commits; `typecheck` + `test` before each. Do NOT commit/push until the owner says "Approved."

## What you're building
**Phase 4 of the Location Labeling Workbench plan** — the first *visible* workbench surface, but still empty. A new **full-page "Drawing Library" route**, opened from a **privileged-gated button** on the Projects Dashboard. Behind it: a single hidden **"workbench container"** project (a `projects` row with `kind='workbench'`) is bootstrapped server-side if it doesn't exist yet, and the library lists the workbench drawings under it (initially none). Critically, this phase also **hides the workbench container from the normal Projects Dashboard** so it never pollutes the live project list. **No PDF upload, no tracing, no status/schedule/sync UI** — just the shell + the contamination guard.

## Required reading (in order, fresh — do not trust line numbers)
1. `sitepulse-next/AGENTS.md` — Especially **§0** (talk to the owner in plain English), **§2** (data fetching via the established **TanStack Query hooks** — never `useState`/`useEffect` for DB data; global UI state in Zustand; do NOT break the offline mutation queue / `pendingChanges`; RLS posture), **§4** (Location Taxonomy), **§6** (TS guardrails: new files `.ts`/`.tsx`, derive types from `database.types.ts`, no `any`).
2. `sitepulse-next/Notes/plans/Location-Labeling-Workbench-Plan.md` — the plan-of-record. Read **§ Locked product decisions** (esp. **1** "hidden workbench container, not separate tables" + **2** "new full-page surface, privileged-gated"), **§ Data model → "The load-bearing coupling — DO NOT break it"**, **§ Build-on inventory**, and **Phase 4** in full. (Phases 5+ are NOT in scope.)
3. The **Phase 3 migration** `sitepulse-next/supabase/migrations/20260617_workbench_schema.sql` (applied + merged) so you know the exact `projects.kind` + `workbench_sheets` shape (incl. RLS) you're querying, and the derived `WorkbenchSheet` type in `src/types/domain.ts`.

## Files this phase touches
- **NEW** `src/app/workbench/page.tsx` — the full-page Drawing Library route (`"use client"`). Privileged-gated; renders the (empty) list of workbench drawings. **A modal can't host this** (Phase 6 mounts a zoom/pan canvas here later) — it must be its own route.
- **NEW** dedicated **filter-applying hooks** (e.g. `src/hooks/useWorkbench.ts`): `useWorkbenchContainer()` (find/return the single `kind='workbench'` project) and `useWorkbenchSheets()` (the container's `sheets` joined to `workbench_sheets` metadata). These **always** scope to the container — they are the only sanctioned way to read workbench data. Follow the pattern of `src/hooks/useProjectQueries.ts` (`useSheets`, `useUnits`).
- **NEW** a server route to **bootstrap the container** — mirror `src/app/api/projects/route.js`: create a `projects` row with `kind='workbench'` (+ a `project_members` row for the creating user — mirror `api/projects`, which assigns role **`'admin'`**; that satisfies the privileged-write RLS on `workbench_sheets`/`sheets`/`units`) **only if none exists** (lazy-create on first privileged visit — the plan's default). Use the **service-role key, server-side only**, exactly like `api/projects`. Do NOT widen RLS to do this from the client. (Note: `api/projects` does a plain `.insert` — it does NOT use the `create_new_project` RPC, which would assign `'owner'`; mirror the route, not the RPC.)
- `src/app/dashboard/page.jsx` — (a) add the **admin-gated** **"Drawing Library"** entry button — **reuse the existing `adminProjects` signal verbatim** (`adminProjects.length > 0`, where `adminProjects = projects.filter(p => p.role === 'admin')`), the same **admin-only** gate the "Global Settings" button already uses. Do NOT use `useCurrentUserRole` for this — it is project-scoped (needs a single `projectId`) and is not used on the dashboard. (b) **contamination guard:** the project-list query must **exclude `kind='workbench'`**. That query is a **legacy `useState`/`useEffect` fetch** — `supabase.from('project_members').select('role, projects(*)')`. **Post-filter the result in JS** (`data.filter(r => r.projects && r.projects.kind !== 'workbench')`) **before** the existing `created_at` sort: a plain PostgREST filter on the embedded `projects` resource only *nulls* the embedded object (you'd need `projects!inner(*)` to actually drop the row), and the sort dereferences `r.projects.created_at`, so an un-filtered/nulled row would throw. Just add the filter — do NOT rewrite the fetch to TanStack Query.

## How it should behave
- The "Drawing Library" button shows **only for admins** (`adminProjects.length > 0`) — the same **admin-only** gate as Global Settings. (The plan text said "owner/admin/pm"; the owner chose to reuse the existing admin-only signal as-is — 2026-06-17. RLS writes are still open to owner/admin/pm; this only governs button *visibility*.)
- Opening it lands on `/workbench`; on first visit the container is lazily created server-side; the library renders **empty** with no status/schedule/bulk/sync controls anywhere.
- The workbench container **never** appears in the Projects Dashboard grid.

## Guardrails (must not violate)
- **Contamination guard is load-bearing** — `kind='workbench'` must be excluded from the dashboard and every "all projects" surface; route all workbench reads through the dedicated filter-applying hooks. A workbench row must never enter a live-project view or `progressAnalytics`.
- **Container bootstrap is server-side only** (service-role key, like `api/projects`). Do NOT create it from the client and do NOT widen RLS.
- **No backend (`main.py`) changes.** **No `status_logs` / `status_audit_log` / offline-queue code.** Never mount the field/status/schedule/bulk/sync UI in the workbench.
- **Types:** derive from `database.types.ts` (`WorkbenchSheet` already in `domain.ts` from Phase 3); no hand-written table shapes; no `any`; new files `.ts`/`.tsx`.
- **Data fetching via TanStack hooks** (§2) — the **new** workbench read hooks (`useWorkbench.ts`) use TanStack Query and need **new entries in `src/types/queryKeys.ts`**, following `useProjectQueries.ts`; no `useState`/`useEffect` for new DB reads. **Exception (not scope creep):** the dashboard's project-list fetch is *already* a legacy `useState`/`useEffect` query — the contamination guard only *adds a filter* to it; do not convert it to TanStack Query. Global UI state (e.g. any workbench modal/toggle) in a Zustand store with an explicit interface.

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

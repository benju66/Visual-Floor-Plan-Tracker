# Kickoff — Location Labeling Workbench, Phase 1: Project-type on the New Project popup

> Paste-ready prompt + context for a fresh Claude Code session. Self-contained: read this, then the files it names, then build.

## What you're building
**Phase 1 of the Location Labeling Workbench plan** — the smallest, safest slice, with **no database changes**. Add a **project-type picker** to the "New Project" modal so a project's type can be set at creation (today it can only be set later, in Settings → Data). Optional/nullable. This is a self-contained UI + API-route change.

## Required reading (in order, fresh — do not trust line numbers)
1. `sitepulse-next/AGENTS.md` — architecture + invariants. Especially §0 (how to talk to the owner: plain-English first), §2 (data-fetching via TanStack hooks; offline queue untouched), §4 (Location Taxonomy), §6 (TS guardrails: new files `.ts`/`.tsx`, derive types from `database.types.ts`, no `any`).
2. `sitepulse-next/Notes/plans/Location-Labeling-Workbench-Plan.md` — the plan-of-record. Read **§ Locked product decisions**, **§ Data model**, and **Phase 1** in full. (Phases 2+ are NOT in scope for this session.)

## Files this phase touches
- `src/app/dashboard/page.jsx` — the New Project modal (the `isModalOpen` block; `newProjectName` state; `handleCreateProject`). Add a `newProjectType` state + a `<select>` directly **below the Project Name field**.
- `src/app/api/projects/route.js` — currently inserts `{ name, procore_project_id? }`. Add `project_type` to `insertData` (`project_type: project_type ?? null`); read it from the request body.
- `src/components/SettingsMenu.tsx` — **reference only**: copy the existing `project_type` `<select>` styling/markup from the `activeTab === 'data'` block (it maps over `PROJECT_TYPES` from `@/utils/locationTaxonomy`). Reuse the same component/styling; don't reinvent it.
- `src/utils/locationTaxonomy.ts` — **reference only**: `PROJECT_TYPES` is the canonical list. The picker maps over it, so it will auto-update to 9 types after Phase 2 — no rework here.

## How it should behave
- The picker is **optional** ("— Not set —" default → sends `null`). Creating a project without a type must still work exactly as today.
- Thread the chosen type: modal state → `handleCreateProject` → the `fetch('/api/projects')` POST body → `route.js` `insertData`.
- `projects.project_type` **already exists** in the DB with a CHECK constraint (∈ the 8 current types or null) — so **no migration**, and an out-of-range value would be rejected by the DB. The `<select>` only offers `PROJECT_TYPES`, so this is safe.

## Guardrails (must not violate)
- **No DB migration, no backend (`main.py`) changes, no status/offline-queue changes.** Pure frontend + the one Next.js API route.
- New/changed code stays type-clean; if you touch types, derive from `database.types.ts`; no `any`. (`route.js` / `page.jsx` are existing JS — keep them JS; don't introduce `any` in new TS.)
- Don't disturb the Procore-link path already in the modal/route (`procore_project_id`).

## Verify before closing (exit criteria)
Run with the absolute `--prefix` (cwd persists in Bash; a stray `cd` prompts):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
Then a **live `npm run dev:3010`** (from `sitepulse-next/`, port 3010) click-through:
- Create a project **with** a type → lands on the project → Settings → Data shows that type.
- Create a project **without** a type → still works (type is null).

Close the phase with the **verify-feature** skill (Definition of Done → stop). **Do not commit or push until the owner says "Approved."**

## Scope discipline
This session builds **only Phase 1**. Do not start the taxonomy-correction migration (Phase 2) or any workbench surface — those are separate, gated sessions.

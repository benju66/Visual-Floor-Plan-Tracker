# Location Taxonomy Foundation — Phase 3 Kickoff Prompt (taxonomy pickers in UI)

> Paste-to-launch: a fresh Claude Code session should read this file top-to-bottom and follow it.
> Plan of record: `sitepulse-next/Notes/plans/Location-Taxonomy-Foundation-Plan.md` (Phase 3 section).
> Phases 1 + 2 are shipped, committed, and **merged to `main`**; the DB migration is **LIVE on production**.
> This phase is **UI + data-layer** (lightweight A2). No DB migration. No hard approval gates — but it is the first phase that lets users *write* the new taxonomy, so it has live click-through exit criteria.

---

You are implementing **Phase 3 of the Location Taxonomy Foundation — the taxonomy
pickers** in the create-location flow and the Manage list. The plan of record is
`sitepulse-next/Notes/plans/Location-Taxonomy-Foundation-Plan.md` — read its
**Phase 3**, **Build-on inventory**, and **Hard guardrails** sections first.

## Where things stand (don't re-derive)
- **Phase 1 (committed `232af33`, on `main`):** `src/utils/locationTaxonomy.ts` — `CANONICAL_ROLES`, `PROJECT_TYPES`, `SEED_SUBTYPES`, `PENDING_SUBTYPE_NAME = "Other (pending)"`, `mapLegacyUnitType`, `subtypesForProjectType`, `roleLabel`, `ROLE_DISPLAY_LABELS` (+ tests).
- **Phase 2 (committed `f95cdc3`, on `main`; migration LIVE on prod):** `subtypes` table (global governed dictionary, 71 rows = 70 seeds + the `Other (pending)` sentinel), `projects.project_type`, `units.top_level_role`, `units.subtype_id` (FK → subtypes, `ON DELETE SET NULL`). Types are already wired: `domain.ts` exports `Subtype`, re-exports `ProjectType`/`TopLevelRole`, and has JSONB guards `isStringArray` / `isProjectTypeArray`. **`unit_type` is KEPT** (applicability keys on it).
- **Backfill reality (matters for the pickers/queue):** existing 153 units all have a `top_level_role`; the 108 `Apartment Unit`s point at `Dwelling Unit`, but the 45 `Common Area`/`Back of House` units have **`subtype_id = NULL`** (role known, sub-type unassigned — owner-approved). The **review queue is `top_level_role IS NOT NULL AND subtype_id IS NULL`** (Phase 4 builds the queue UI; don't fabricate a sentinel-pointer here). The 5 existing projects have **`project_type = NULL`**.

## Read before writing any code (in this order)
1. `sitepulse-next/AGENTS.md` — CRITICAL invariants. Note §2 (online mutations vs the `pendingChanges` offline queue — taxonomy edits are **online-first**), §4 (the new Location Taxonomy invariant note), §6 (TS guardrails, JSONB narrowing, no `any`).
2. `docs/location-labeling-standard.md` §5 (the three axes + §5.5 governance / `Other (pending)`).
3. The plan's **Phase 3** + **Build-on inventory** sections.
4. `.agent/skills/add-data-hook/SKILL.md` — follow it for the new `useSubtypes` read hook + the minimal "propose pending sub-type" write.
5. Re-read **FRESH** (line numbers drift): `src/components/UnitNamingPopover.jsx`; `src/hooks/useMapActions.ts` (`handlePolygonComplete`, `saveNewUnitFromPopover`); `src/app/project/[projectId]/page.jsx` (it passes `projectUnitTypes={project?.unit_types || [...]}` — thread `project_type` similarly); `src/components/manage/RowActionsMenu.tsx` (the Manage "Change type" path); `src/hooks/useProjectQueries.ts` (`useUpdateUnitFields` — the online write to reuse); `src/components/SettingsMenu.tsx` (today's per-project `unit_types` palette UI; candidate home for the project-type picker); `src/utils/locationTaxonomy.ts`; `src/types/domain.ts`.

## Phase 3 scope
1. **Create-location flow.** Replace the single free-string `<select>` in `UnitNamingPopover.jsx` with **role + sub-type pickers**: sub-types ordered via `subtypesForProjectType(projectType, dict)`, role rendered via `roleLabel(role, projectType)`. Persist `top_level_role` + `subtype_id` in `saveNewUnitFromPopover`/`useMapActions`, and **keep setting `unit_type` = the chosen sub-type's canonical name** (applicability back-compat — do NOT drop it). Thread `project_type` through `page.jsx` to the popover.
2. **"Other (pending)" option** (standard §5.5, non-blocking): when nothing fits, the user picks a top-level role + types a short proposed name/note; this writes a `status='pending'` sub-type row with `proposed_note` and points the unit at it. Never block the save.
3. **Manage list.** Extend `RowActionsMenu` "Change type" to the same role + sub-type picker, writing via the online `useUpdateUnitFields` path.
4. **Project-type picker** (resolves the plan's open decision — existing projects are `project_type = NULL`): add a small picker (in `SettingsMenu` / project settings) to set a project's `project_type` (1 of 8, via `useUpdateProject`-style online write). The sub-type pickers must **degrade gracefully when `project_type` is null** — show the full dictionary unordered (or nudge "set a project type for better ordering"); never crash or block.
5. **Data layer (new, online-first):** add a `useSubtypes` **read** hook (TanStack Query; narrow `aliases`/`default_project_types` at the query boundary with `isStringArray`/`isProjectTypeArray` — no raw `Json` into props), and a minimal **"propose pending sub-type"** write (insert `status='pending'`). The fuller admin writes (set status / alias) are **Phase 4** — don't build them here.

## Owner decisions to apply (already settled)
- **Friendly role labels (presentation-only).** Make `roleLabel`'s canonical fallback user-facing, NOT the raw internal words: `program → "Primary Spaces"`, `common → "Common Areas"`, `support → "Back of House"` (leave `other → "Other"`). Keep the existing `Housing and Hotel → program = "Units"` override. Edit the fallback map in `locationTaxonomy.ts` (today `CANONICAL_ROLE_TITLE` returns title-case "Program" etc.). **Stored/exported values stay the canonical `program`/`common`/`support`/`other`** — labels are display-only, never persisted.
- **Sub-types are global, never restricted by project type** — `subtypesForProjectType` only orders (defaults first); all sub-types remain selectable.
- **`project_type` stays nullable** — don't backfill/guess it; the picker sets it per project.

## Hard guardrails (AGENTS.md / plan — do not violate)
- **Online-first, NOT the offline queue.** Taxonomy edits use the existing online `useUpdateUnitFields` path. Do **NOT** route them through the `pendingChanges` `useState`/IDB queue (`useFieldData.ts` / `pendingChangesStore.ts`) or touch its key format / `hasRehydrated` guard.
- **Keep `unit_type`** (applicability via `applies_to_unit_types` / `getAppliesTo`). New/edited units set `unit_type` = chosen sub-type name so N/A keeps matching.
- **`status_logs` untouched** — no new writes there; this is `units`/`subtypes` only.
- **`subtypes` RLS:** writes are privileged-role only (`owner`/`admin`/`pm`). Proposing an `Other (pending)` sub-type is an insert → only privileged members can do it; handle a non-privileged user gracefully (the current testers are `admin`/`pm`, so this is mostly forward-proofing). **Never widen to `anon`.**
- **Types:** narrow new JSONB at the query boundary; derive from `domain.ts`; **no `any`**. New UI state (picker open, filters) → a Zustand store with an explicit interface (`useHydratedStore` for any persisted prefs).
- **Don't fork** `progressAnalytics` / `bottleneck` / the established hooks. Reuse `useUpdateUnitFields`; add new dictionary hooks in the same pattern.

## Open decisions to surface (don't silently pick)
- **Where the project-type picker lives** (SettingsMenu vs a project header/settings affordance) — recommend, show the owner, let them choose.
- **Empty-dictionary-ordering UX** when `project_type` is null (full list unordered vs a "set project type" nudge) — pick a sensible default, mention it.
- Carried open items (unchanged, don't block): Restaurant `Kitchen = Program`; `Housing and Hotel` as one type. Surface only if the owner asks.

## Branch
**Continue on `claude/polygon-drawing-performance-n976r3`** — the Manage workspace (`src/components/manage/`, incl. `RowActionsMenu`) that Phase 3 extends lives there as **uncommitted WIP and is NOT on `main`**. A fresh branch off `main` would lack it. The branch also carries parallel WIP (Manage / Gantt-schedule); make **small, taxonomy-scoped commits** and stage only the files you touch (don't sweep in unrelated WIP). Do not push to `main` until the owner approves.

## Exit criteria — then STOP at the phase boundary
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
All green, **plus a live `npm run dev:3010` click-through** (port 3010, not 3000): trace a new location → pick role + sub-type → save and confirm `top_level_role`/`subtype_id`/`unit_type` persist; tag `Other (pending)` with a note and confirm a `status='pending'` sub-type appears; change a type from the Manage list; set a project's `project_type` and confirm pick-list ordering changes. Add/extend tests for any new pure logic (e.g. the `roleLabel` friendly fallbacks) and the `useSubtypes` JSONB narrowing. Close with the **verify-feature** skill (Definition of Done → stop). **Do NOT commit/push until the owner says "Approved,"** and do NOT start Phase 4 (the dictionary admin + review-queue UI) in this session.

## Communication
The owner is the product owner, not a developer — lead with a 1–2 sentence plain-English summary, explain jargon in passing, keep it short, and frame choices as decisions with trade-offs.

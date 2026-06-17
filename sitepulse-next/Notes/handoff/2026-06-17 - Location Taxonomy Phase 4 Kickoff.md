# Location Taxonomy Foundation — Phase 4 Kickoff Prompt (dictionary admin + review queue)

> Paste-to-launch: a fresh Claude Code session should read this file top-to-bottom and follow it.
> Plan of record: `sitepulse-next/Notes/plans/Location-Taxonomy-Foundation-Plan.md` (**Phase 4** section + **Governance scope**).
> Phases 1 + 2 are shipped and merged to `main`; the DB migration is **LIVE on production**. **Phase 3 (pickers) is implemented and owner-verified** on branch `claude/polygon-drawing-performance-n976r3` (not yet on `main`).
> This is the **final phase of this plan** (lightweight governance). It is **UI + data-layer**, online-first, **no DB migration**, no hard approval gates beyond RLS.

---

You are implementing **Phase 4 of the Location Taxonomy Foundation — the minimal
dictionary admin + pending review queue**. Read the plan of record's **Phase 4**,
**Governance scope**, **Build-on inventory**, and **Hard guardrails** sections first.

## Where things stand (don't re-derive)
- **Phase 1 (on `main`):** `src/utils/locationTaxonomy.ts` — `CANONICAL_ROLES`, `PROJECT_TYPES`, `SEED_SUBTYPES`, `mapLegacyUnitType`, `subtypesForProjectType`, `roleLabel`. Friendly fallbacks **already applied**: `program → "Primary Spaces"`, `common → "Common Areas"`, `support → "Back of House"`, `other → "Other"` (Housing-and-Hotel `program → "Units"` override kept). Stored/exported values stay the canonical `program`/`common`/`support`/`other`.
- **Phase 2 (on `main`; migration LIVE on prod):** the global governed `subtypes` table — `id, name (UNIQUE), top_level_role, status ('active'|'pending'|'deprecated'), aliases (JSONB), default_project_types (JSONB), proposed_note, created_by, created_at`. Plus `projects.project_type`, `units.top_level_role`, `units.subtype_id`. **RLS: read = any authenticated member; write = `owner`/`admin`/`pm` only; never `anon`.** Domain types `Subtype`/`ProjectType`/`TopLevelRole` + guards `isStringArray`/`isProjectTypeArray` live in `domain.ts`.
- **Phase 3 (on this branch, owner-verified, NOT yet on `main`) — BUILD ON THIS, don't recreate:**
  - `src/utils/subtypes.ts` (+ `subtypes.test.ts`) — pure helpers: `narrowSubtypeRow` (JSONB narrowing at the query boundary), `taxonomyResultToUnitFields`, `orderedSubtypesByRole`, and the `TaxonomyResult` / `TaxonomyUnitFields` types.
  - `src/hooks/useSubtypes.ts` — **`useSubtypes()` (read) ALREADY EXISTS** and **`useProposePendingSubtype()` (insert `status='pending'`) ALREADY EXISTS**. Phase 4 **adds the fuller admin writes here** — do not duplicate the read hook or the propose hook.
  - `src/components/TaxonomyPicker.tsx` — the shared role+sub-type picker (reuse it anywhere you need "pick a sub-type").
  - `queryKeys.subtypes()` = `['subtypes']` (in `src/types/queryKeys.ts`).
- **Live pending data already exists:** Phase 3's "Other (pending)" flow writes real `status='pending'` rows with `proposed_note`, so the review queue will have genuine entries on day one.

## Read before writing any code (in this order)
1. `sitepulse-next/AGENTS.md` — §2 (online mutations vs the `pendingChanges` offline queue — taxonomy edits are **online-first**), §4 (the Location Taxonomy invariant note, incl. the two "review" meanings below), §6 (TS guardrails, JSONB narrowing, no `any`).
2. The plan's **Phase 4** + **Governance scope** + **Build-on inventory**.
3. `.agent/skills/add-data-hook/SKILL.md` — follow it for the new write hooks.
4. Re-read **FRESH** (line numbers drift): `src/hooks/useSubtypes.ts`, `src/utils/subtypes.ts`, `src/components/TaxonomyPicker.tsx`, `src/components/SettingsMenu.tsx` (the **Data tab** already hosts the project-type picker + the per-project "Location Types" list — the dictionary admin is a natural sibling there), `src/types/domain.ts`, `src/utils/locationTaxonomy.ts`.

## Two distinct "review" concepts — DO NOT conflate
1. **Pending sub-TYPES** (`subtypes.status = 'pending'`) — dictionary entries proposed via Phase 3's "Other (pending)". **This is Phase 4's review queue.** From each: promote to `active`, alias to an existing canonical sub-type, or `deprecate`.
2. **Units needing a sub-type** (`units.top_level_role IS NOT NULL AND units.subtype_id IS NULL`) — legacy backfilled rows (role known, sub-type unassigned; see AGENTS.md §4). Assigning these is a **unit-level bulk action (Manage-workspace territory), NOT dictionary admin.** **Out of scope here** — surface it as a recommendation to defer, don't build it.

## Phase 4 scope
1. **Dictionary admin surface** (recommend **SettingsMenu → Data tab**, sibling to "Project Type" + "Location Types"; vs a dedicated panel — show the owner): list sub-types (group by role via `roleLabel`, filter by status); **add** a sub-type (name + canonical role + default project types); **set status** (active/pending/deprecated); **set an alias → canonical** (append to `aliases[]`).
2. **Pending review queue:** list `status='pending'` sub-types with their `proposed_note`; per item — **promote to active**, **alias to an existing sub-type**, or **deprecate**.
3. **Data layer (new writes, online-first, privileged-role per RLS):** add `useUpsertSubtype` / `useSetSubtypeStatus` / `useAddSubtypeAlias` to `src/hooks/useSubtypes.ts`, following the existing TanStack Query mutation pattern (optimistic update where sensible + invalidate `queryKeys.subtypes()`). Reuse `narrowSubtypeRow` at the boundary. Handle the `name` UNIQUE collision gracefully (reuse Phase 3's `23505` pattern).
4. **New UI state** (admin filters, the item being aliased) → a Zustand store with an explicit interface (AGENTS §6); `useHydratedStore` only for any persisted prefs.

## Owner decisions to apply (already settled)
- **Revisit the seed sub-type list — Phase 4 is its home.** During the Phase-3 click-through the owner flagged the sub-type list may need curation. The admin UI must make it easy to **add a missing sub-type, retire (deprecate) one, and alias synonyms — without code.** (Structural seed *renames* still happen in `locationTaxonomy.ts`; ongoing curation happens in-app.) While building the admin list, do a short "anything to fix right now?" pass with the owner.
- **RLS unchanged** — writes are `owner`/`admin`/`pm` only. A non-privileged user: hide/disable admin controls and turn a denied write into a friendly message. **Never widen to `anon`.**
- **Canonical vs display** — `top_level_role` is the stored canonical; render via `roleLabel`. An alias maps an alias *name* → an existing canonical sub-type; it never changes a stored role.

## Hard guardrails (AGENTS.md / plan — do not violate)
- **Online-first**, reuse the TanStack Query hook pattern; **NOT** the `pendingChanges` offline queue (`useFieldData.ts` / `pendingChangesStore.ts`).
- **Additive only / no migration** — the `subtypes` table already exists; do not alter schema.
- **`status_logs` untouched** — taxonomy lives on `subtypes`/`units`/`projects`.
- **Types** — narrow JSONB at the query boundary (reuse `narrowSubtypeRow`); derive from `domain.ts`; **no `any`**.
- **`name` is UNIQUE** — adding a duplicate must fail gracefully, never crash.
- **Verify with typecheck + test + build** — whole-repo lint is NOT a gate (~1850 pre-existing problems).

## Open decisions to surface (don't silently pick)
- **Where the admin lives** — SettingsMenu Data tab vs a dedicated lightweight panel. Recommend, show the owner.
- **Alias UX** — free-type the alias name vs pick an existing sub-type to merge into. Pick a sensible default, mention it.
- **Concept #2 (units with role but no sub-type)** — note where it would live (Manage bulk-assign) and recommend deferring; don't build it here.

## Branch
Continue on **`claude/polygon-drawing-performance-n976r3`** (Phase 3 + the Manage/Gantt WIP live here; Phase 3 is not yet on `main`). The branch interleaves parallel WIP — stage your **new** dictionary-admin files + only the specific files you edit; don't sweep unrelated WIP. Do not push to `main` until the owner approves.

## Exit criteria — then STOP at the phase boundary
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
All green, **plus a live `npm run dev:3010` click-through**: add a sub-type; set a status; alias one name to another; confirm a Phase-3 "Other (pending)" item appears in the review queue and can be **promoted to active**; confirm the new sub-type then shows in the trace/Manage pickers. Add/extend tests for any new pure logic and the new hooks' JSONB narrowing. Close with the **verify-feature** skill (Definition of Done → stop).

**This is the final phase of this plan.** On completion, the Location Taxonomy Foundation (Workstream A1 + lightweight A2) is done — note the deferred items for a future plan: brief **A3** (decoupled workbench shell), **A4** (standard-enforcing labeling UX), **A5** (clean export), **Workstream B** (tracing accelerators), and the **AI phases**. Do NOT push to `main` until the owner says "Approved."

## Communication
The owner is the product owner, not a developer — lead with a 1–2 sentence plain-English summary, explain jargon in passing, keep it short, and frame choices as decisions with trade-offs.

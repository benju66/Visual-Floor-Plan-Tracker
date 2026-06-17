# Location Taxonomy Foundation — project_type + role + governed sub-type dictionary (self-contained build plan)

> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: `docs/initiative-brief.md` (the initiative) + `docs/location-labeling-standard.md` §5 / §5.7 (the *how to label* + target data model).
> Sibling workstream: `sitepulse-next/Notes/Locations-Status-Management-Plan.md` (the Manage workspace this plan extends — do not duplicate it).
>
> Scope note: this plan delivers the brief's **Workstream A — Phase A1 (data-model foundation)**
> plus a **lightweight A2** (pickers + minimal dictionary admin). It deliberately STOPS before
> the brief's A3 (decoupled workbench shell), A4 (labeling UX), A5 (export), Workstream B
> (accelerators), and Phases 6/7 (AI). This plan also satisfies the brief §3 Phase-0 deliverable
> (gap analysis + recommended phased plan) — its gap analysis lives in **§ Data model** below, so
> there is no separate `docs/workbench-findings.md` to produce.

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants), then `docs/location-labeling-standard.md` §5 + §5.7, then `docs/initiative-brief.md`.
2. Re-read the files named below **fresh** — do not trust line numbers; they drift.
3. Build the phases in order. Verify after each (§ Verification commands).
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence plain-English summary; explain jargon in passing; keep it short; frame choices as decisions with trade-offs.
5. Work on branch **`claude/polygon-drawing-performance-n976r3`** (designated in brief §2), small reviewable commits, typecheck + test before each. Do not push to `main`.

## Goal
When this is done, a "location" (the app's `units` table) carries a **stable, canonical
taxonomy** instead of a free-typed string: every project has a **project type** (1 of 8), every
location has a **top-level role** (1 of 4 — `program` / `common` / `support` / `other`) and an
optional **sub-type** chosen from a single **global governed dictionary** (never free-typed). When
tracing or editing a location, the user picks a role + sub-type from a pick-list scoped by project
type; if nothing fits they tag **"Other (pending)"** with a short note, which lands in a **review
queue** the owner can later turn into a real sub-type. A minimal admin screen lets the owner add a
sub-type, set its status, or alias one name to another — without raw SQL. Existing locations are
migrated cleanly and the live status / offline-sync flows are untouched.

## Out of scope / deferred (named, so nothing is silently dropped)
- **Decoupled labeling workbench shell** (ingest historical PDFs, "drawing library" separate from live projects) → brief **A3**, a later plan.
- **Standard-enforcing labeling UX** (interior-face guidance, §9 definition-of-done checklist, second-person review state, auto-increment naming) → brief **A4**.
- **Clean corpus export** (model-ready, versioned) → brief **A5**.
- **Tracing accelerators** (fill-room-from-walls, grid stamp) → brief **Workstream B**.
- **Full propose → approve → alias governance**: an in-app *proposal entity*, an *approver role/permission*, and a multi-user approve/alias UI → later phase (build once there are multiple labelers + real tracing volume). This plan ships the *lightweight* version only (see § Governance scope).
- **Per-project label-remap UI** (letting the owner customize how a canonical role renders in a given project). This plan *designs for it* (display labels are presentation-only) and ships labels as code constants; making them owner-editable is a later phase. **Schema stays clean so it's trivial to add** (a future `project_type_role_labels` table — no migration needed now).
- **Retiring the `unit_type` column.** It stays (applicability depends on it — see § Data model). Re-pointing applicability to `subtype_id`/role and dropping `unit_type` is a later, separate pass.

## Locked product decisions (from the owner)
1. **Scope = data-model foundation first.** Ship A1 (Phases 1–2 here) before any UI. Then the lightweight A2 (Phases 3–4). Do **not** build the workbench shell in this plan.
2. **`top_level_role` is a STABLE CANONICAL value** — `program` / `common` / `support` / `other`. This is what trains the AI and what gets exported. It must **never change per project**.
3. **Display labels are a separate, presentation-only layer.** The same canonical role may render differently per project type (e.g. `program` shows as "Units" in a Housing-and-Hotel project). Never store or export a display label in place of the canonical value.
4. **Governance is lightweight** (see § Governance scope) — pick-list + non-blocking "Other (pending)" with a required note, a queryable review queue, schema-ready `status`/`aliases[]`, and a minimal admin screen. No proposal entity / approver role yet.
5. **Keep the `units` table name** (assumed default, owner not objecting): "location" is the product-facing term; renaming the table is large churn for no functional gain.
6. **Taxonomy edits are online-first** (assumed default): they use the same online mutation path the Manage workspace already uses for field edits (`useUpdateUnitFields`), not the offline `pendingChanges` queue. Offline durability is generalized once, later, with the rest of the field/delete/schedule edits (per the Manage plan's Phase 4).

## Data model

### Current state (ground truth — verified against `src/types/database.types.ts`)
- `projects`: `id, name, unit_types (Json — a per-project free-string palette), procore_project_id, created_at`. **No `project_type`.**
- `units` (the "location"): `id, sheet_id, unit_number, unit_type (string | null), computed_area, polygon_coordinates, icon_offset_x/y, walk_sequence, assigned_to, created_at`. **No `top_level_role`, no `subtype_id`.**
- **No `subtypes` table.**
- Domain types in `src/types/domain.ts` are *derived* from `database.types.ts` (`Database['public']['Tables']['<t>']['Row']`). `Project`, `Unit`, `UnitInsert` are there.

### Gap vs. target (standard §5.7)
| Target | Today | This plan adds |
|---|---|---|
| `projects.project_type` ∈ 8 | absent | nullable `TEXT` + `CHECK` (8 values or null) |
| `locations.top_level_role` ∈ 4 | absent | nullable `TEXT` + `CHECK` (`program`/`common`/`support`/`other`) |
| `subtypes` dictionary | absent | new table (`name`, `top_level_role`, `status`, `aliases[]`, `default_project_types[]`, `proposed_note`) |
| `locations.subtype_id` → dict | absent | nullable `UUID REFERENCES subtypes(id)` |
| migrate `unit_type` → role + sub-type | free strings | additive backfill (keep `unit_type`) |

### The load-bearing coupling — DO NOT break it
`project_milestones.applies_to_unit_types` (a JSONB array of **`unit_type` strings**, read via
`getAppliesTo()` in `domain.ts`) drives **milestone applicability (N/A)**. If the migration renames
or drops `unit_type`, applicability silently breaks. Therefore the migration is **purely additive +
backfill**: add `top_level_role` and `subtype_id`, **keep `unit_type` intact**. During Phase 3, new
locations continue to set `unit_type` (= the chosen sub-type's canonical name) so applicability keeps
matching until a later pass re-points it.

### `status_logs` is untouched
No schema change to `status_logs` / `status_audit_log`. Writes stay on `upsert_status_log` /
`.upsert({ onConflict: 'unit_id,track,milestone' })` — never `.insert()`. The taxonomy lives on
`projects` / `units` / `subtypes`, entirely outside the status pipeline.

### `subtypes` table shape (target — confirm exact DDL in Phase 2 via the create-migration skill)
- `id UUID PK`
- `name TEXT NOT NULL UNIQUE` — the canonical sub-type name (e.g. `Dwelling Unit`)
- `top_level_role TEXT NOT NULL CHECK (top_level_role IN ('program','common','support','other'))`
- `status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','deprecated'))`
- `aliases JSONB NOT NULL DEFAULT '[]'` — alias-name → canonical mapping (e.g. `Salon Suite` → `Salon Studio`)
- `default_project_types JSONB NOT NULL DEFAULT '[]'` — pick-list scoping (which project types surface it first)
- `proposed_note TEXT` — the "what is it" note captured when a labeler tags **Other (pending)**
- `created_by UUID`, `created_at TIMESTAMPTZ DEFAULT now()`
- **RLS:** readable by any authenticated member (it is a global dictionary); **writes restricted to privileged roles** (`owner`/`admin`/`pm`) mirroring the status_logs membership pattern. Do **not** grant write to `anon`. (Open decision — see § Open decisions — whether lightweight admin write should be any-authenticated; default = privileged.)

## Build-on inventory (read these fresh before using)
- **`src/types/domain.ts`** — derive `Subtype`, and union types `ProjectType` / `TopLevelRole`, from the regenerated `database.types.ts`. Never hand-write a table shape. Add JSONB guards for `aliases` / `default_project_types` (model on `isPercentPointArray`).
- **`.agent/skills/create-migration/SKILL.md`** — the migration is built to this checklist (inspect → SQL → apply → regenerate types → wire hooks → document + verify → **gate**).
- **`supabase/migrations/20260610_milestone_applicability.sql`** — the style template: idempotent, guarded `DO $$` blocks, `units→sheets→project_members` RLS, `CHECK ... NOT VALID` then `VALIDATE`.
- **`src/components/UnitNamingPopover.jsx`** + **`src/hooks/useMapActions.ts`** (`handlePolygonComplete`, `saveNewUnitFromPopover`) + **`src/app/project/[projectId]/page.jsx`** (passes `projectUnitTypes={project?.unit_types || [...]}`) — the create flow Phase 3 extends.
- **`src/components/manage/RowActionsMenu.tsx`** + **`src/hooks/useProjectQueries.ts`** `useUpdateUnitFields` — the Manage "Change type" path Phase 3 extends; the online mutation pattern Phase 4's dictionary hooks follow.
- **`src/components/SettingsMenu.tsx`** — where the per-project `unit_types` palette is managed today; candidate home for the Phase 4 dictionary admin screen.
- **Do NOT fork:** `progressAnalytics`, `bottleneck`, the `pendingChanges` offline queue (`useFieldData.ts` / `pendingChangesStore.ts`), or the established TanStack Query hooks. Taxonomy edits reuse the online `useUpdateUnitFields` path; new dictionary reads/writes are new hooks following the same pattern.

## Pure logic to extract + unit-test
`src/utils/locationTaxonomy.ts` (+ `locationTaxonomy.test.ts`) — framework-free, deterministic, no `Date.now()` inside (pass any timestamps in):
- `CANONICAL_ROLES` (the 4) and `PROJECT_TYPES` (the 8) as `const` unions.
- `SEED_SUBTYPES` — the §5.4 dictionary (name → canonical role + default project types). Universal Common/Support + per-project-type Program seeds.
- `ROLE_DISPLAY_LABELS` — per-project-type presentation map (e.g. `Housing and Hotel` → `program: "Units"`); `roleLabel(role, projectType)` resolves it, defaulting to the canonical title-case when no override.
- `subtypesForProjectType(projectType, dict)` — orders the pick-list (defaults first, all allowed; never restricts).
- `mapLegacyUnitType(unitType): { role, subtypeName }` — the **migration mapping** (`Apartment Unit`→`program`/`Dwelling Unit`; `Back of House`→`support`/specific; `Common Area`→`common`/…; `Other`/unknown→`other`/`Other (pending)`). The Phase-2 SQL backfill mirrors this table exactly.
- Tests: every seed sub-type maps to a valid canonical role; `mapLegacyUnitType` covers the known palette + the unknown→`other (pending)` fallback; `roleLabel` returns the override where defined and the canonical fallback otherwise.

## Sub-phasing (ship + verify each)

### Phase 1 — Taxonomy constants + mapping logic (pure, no DB, no UI)
- **Scope:** create `src/utils/locationTaxonomy.ts` + test (everything in § Pure logic). Nothing else imports it yet. Smallest safe slice; de-risks the migration because the backfill mapping is unit-tested before it touches data.
- **Approval gates:** none (no DB, no live components).
- **Exit criteria:** typecheck + test green; the mapping + label tables reviewed by the owner (they encode product decisions). Close with the verify-feature skill (Definition of Done → stop).

### Phase 2 — DB migration: project_type + role + subtypes + backfill  ⛔ APPROVAL GATE
- **Scope:** one migration file `supabase/migrations/<today>_location_taxonomy.sql` built to the create-migration skill: additive `projects.project_type`, `units.top_level_role`, `units.subtype_id`, the `subtypes` table (shape above) + its RLS, seed `subtypes` from `SEED_SUBTYPES`, and a **backfill** of `top_level_role` + `subtype_id` from existing `unit_type` (mirrors `mapLegacyUnitType`). Then regenerate `database.types.ts` and derive `Subtype`/`ProjectType`/`TopLevelRole` + JSONB guards in `domain.ts`.
- **Approval gates:**
  - ⛔ **DDL** — present the full SQL and **STOP**; apply (Supabase MCP/CLI, dev/branch first) only after explicit owner approval (create-migration Gate).
  - ⛔ **Backfill is data-touching** — the `UPDATE` over existing `units` is a distinct destructive-class step: take a backup / run on a branch first, show row counts, get explicit go-ahead before applying to production data. (Per § no-live-write-probes: never trial-write against real rows.)
  - ⛔ Keep `unit_type` — do not drop/rename (applicability depends on it).
- **Exit criteria:** typecheck green (proves regenerated + derived types line up); migration applied on a dev/branch DB with seed + backfill verified by query; existing app still runs (no regressions in status/applicability). Close with verify-feature; **do not commit/push until owner says "Approved."**

### Phase 3 — Taxonomy pickers in create + Manage UI (lightweight A2, online-first)
- **Scope:** replace the single free-string `<select>` in `UnitNamingPopover.jsx` with **role + sub-type pickers** (sub-types scoped via `subtypesForProjectType`, role rendered via `roleLabel`); thread `project_type` through `page.jsx`. Persist `top_level_role` + `subtype_id` in `saveNewUnitFromPopover`/`useMapActions` (and keep setting `unit_type` = chosen sub-type name for applicability back-compat). Add the **"Other (pending)"** option: requires a short note/proposed name, writes a `status='pending'` sub-type with `proposed_note` — non-blocking. Extend the Manage `RowActionsMenu` "Change type" to the same picker.
- **Approval gates:** ⛔ none structural, but it writes the new columns via the online `useUpdateUnitFields` path — do **not** route through the `pendingChanges` offline queue.
- **Exit criteria:** typecheck + test + build green; **live `npm run dev:3010` click-through** (trace a location → pick role+sub-type → save; tag Other (pending) with a note; change a type from the Manage list). Close with verify-feature.

### Phase 4 — Minimal dictionary admin + pending review queue (lightweight governance)
- **Scope:** a small admin surface (in `SettingsMenu` or a dedicated lightweight panel): list sub-types; **add** a sub-type (name + canonical role + default project types); **set status** (active/pending/deprecated); **set an alias → canonical** (append to `aliases[]`). Plus a **review queue**: list `status='pending'` sub-types with their `proposed_note`, and from there mark active / alias / deprecate. New hooks `useSubtypes` (read) + `useUpsertSubtype` / `useSetSubtypeStatus` / `useAddSubtypeAlias` (writes, privileged-role per RLS) following the existing TanStack Query hook pattern. Any new UI state (filters) → a Zustand store with an explicit interface (`useHydratedStore` for persisted prefs).
- **Approval gates:** ⛔ none beyond RLS (writes are privileged-role; do not widen to `anon`).
- **Exit criteria:** typecheck + test + build green; live click-through (add a sub-type, alias one name to another, a pending item appears in the queue and can be promoted). Close with verify-feature.

## Hard guardrails (AGENTS.md / brief — do not violate)
- **Additive migration only** — keep `unit_type`; never drop/rename it (applicability via `applies_to_unit_types` / `getAppliesTo` keys on it).
- **`status_logs` untouched** — no new uniqueness rule, no `.insert()`, `upsert_status_log` stays `SECURITY INVOKER`; don't widen role lists or re-grant to `anon`.
- **`pendingChanges` stays local `useState`** and is **not** used for taxonomy edits (online-first); don't touch the IDB key format or `hasRehydrated` guard.
- **Types:** new table/columns → `database.types.ts` (Tables block) → derive in `domain.ts`; narrow new JSONB (`aliases`, `default_project_types`) at the query boundary with a guard; no `any`.
- **Canonical vs display:** store/export only the canonical role string; display labels are presentation-only constants — never persisted in place of the canonical value.
- **Don't disturb live-project flows** (brief §2): status tracking, offline sync, existing canvas write paths keep working. New `subtypes` RLS writes restricted to privileged roles.
- **Verify with typecheck + test + build** — whole-repo lint is NOT a gate (~1850 pre-existing problems).

## Verification commands (the exit-criteria gate)
Run npm with an absolute `--prefix` (Bash cwd persists; a stray `cd` triggers a prompt):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck   # tsc --noEmit (primary gate)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test         # vitest (target one file: ... run test -- src/utils/locationTaxonomy.test.ts)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build        # next build (after editing live components — Phases 3–4)
```
Live UI/canvas verification: `npm run dev:3010` from `sitepulse-next/` (port 3010, not 3000). Vitest globals are OFF — import `{ describe, it, expect, vi }` from `'vitest'`; co-locate `foo.test.ts` next to `foo.ts`.

## Open decisions (resolve in the noted phase)
- **Existing projects have no `project_type`.** Phase 2: backfill `null` and prompt the owner to set it per project, or infer? Default: leave `null`, surface a picker. (Resolve before Phase 3 pickers, which scope by project type.)
- **Lightweight-admin write RLS:** privileged roles (`owner`/`admin`/`pm`) vs any authenticated. Default = privileged. Confirm in Phase 2.
- **Three standard open items** (brief §9 / standard Appendix B) — Restaurant `Kitchen = Program`; "Housing and Hotel" as one project type; holes/two-level locations. These shape the seed dictionary but don't block A1; confirm with the owner while reviewing `SEED_SUBTYPES` in Phase 1.
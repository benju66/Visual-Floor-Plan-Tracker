# Location Taxonomy Foundation — Phase 2 Kickoff Prompt (DB migration)

> Paste-to-launch: a fresh Claude Code session should read this file top-to-bottom and follow it.
> Plan of record: `sitepulse-next/Notes/plans/Location-Taxonomy-Foundation-Plan.md` (Phase 2 section).
> Phase 1 is shipped + committed (`232af33`); this phase is the additive DB migration and has ⛔ APPROVAL GATES.

---

You are implementing **Phase 2 of the Location Taxonomy Foundation — the DB
migration**. ⛔ This phase has hard APPROVAL GATES: you present SQL and STOP; you
do not apply anything (and never touch production data) until the owner
explicitly approves. The plan of record is
`sitepulse-next/Notes/plans/Location-Taxonomy-Foundation-Plan.md` — read it in full
first (especially the **Phase 2**, **Data model**, and **Hard guardrails**
sections).

Phase 1 is already shipped and committed (`232af33` on branch
`claude/polygon-drawing-performance-n976r3`): `src/utils/locationTaxonomy.ts`
(`CANONICAL_ROLES`, `PROJECT_TYPES`, `SEED_SUBTYPES`, `PENDING_SUBTYPE_NAME =
"Other (pending)"`, `mapLegacyUnitType`, `subtypesForProjectType`, `roleLabel`)
plus its tests. **The Phase-2 SQL seed + backfill must MIRROR that file exactly**
— read it as the source of truth, do not re-derive the lists.

## Read before writing any SQL (in this order)
1. `sitepulse-next/AGENTS.md` — CRITICAL invariants (§2 status_logs idempotency /
   pendingChanges / RLS posture; §4 best practices; §6 TS guardrails).
2. `docs/location-labeling-standard.md` §5 + §5.7 (taxonomy + target data model).
3. `docs/initiative-brief.md` §2 (guardrails — do not disturb live-project flows).
4. `.agent/skills/create-migration/SKILL.md` — build the migration to this
   checklist (inspect → SQL → STOP for approval → apply dev/branch → regenerate
   types → wire/derive → document + verify → gate).
5. The committed Phase 1 file `src/utils/locationTaxonomy.ts`.
6. The style template: the existing milestone-applicability migration in
   `sitepulse-next/supabase/migrations/` (idempotent, guarded `DO $$` blocks,
   `units→sheets→project_members` RLS, `CHECK ... NOT VALID` then `VALIDATE`).

Then re-read **FRESH** (line numbers drift): `src/types/database.types.ts`
(projects, units, subtypes-absent), `src/types/domain.ts`,
`src/utils/applicability.ts` (why `unit_type` must NOT be dropped).

## Phase 2 scope (one migration file, additive only)
File: `sitepulse-next/supabase/migrations/<today>_location_taxonomy.sql`
- `projects.project_type` — nullable `TEXT` + `CHECK` (the 8 values or null).
- `units.top_level_role` — nullable `TEXT` + `CHECK` (program/common/support/other).
- `units.subtype_id` — nullable `UUID REFERENCES subtypes(id)`.
- `subtypes` table (shape per plan §"subtypes table shape"): `id`, `name UNIQUE`,
  `top_level_role` (CHECK), `status` (active/pending/deprecated, default active),
  `aliases JSONB default '[]'`, `default_project_types JSONB default '[]'`,
  `proposed_note`, `created_by`, `created_at`. **RLS:** read = any authenticated
  project member; write = privileged roles only (`owner`/`admin`/`pm`), mirroring
  the status_logs membership pattern. **NEVER grant write to `anon`.**
- Seed `subtypes` from `SEED_SUBTYPES`, PLUS the `"Other (pending)"` sentinel as
  its own row (`top_level_role` 'other', `status` 'pending').
- Backfill `units.top_level_role` + `units.subtype_id` from existing `unit_type`,
  mirroring `mapLegacyUnitType` exactly. **KEEP `unit_type` intact.**
- After apply: regenerate `src/types/database.types.ts` (Tables block for the new
  table + columns) and derive `Subtype`/`ProjectType`/`TopLevelRole` in
  `domain.ts`; add JSONB guards for `aliases` + `default_project_types` modeled on
  `isPercentPointArray`. No `any`.

## Hard guardrails (AGENTS.md / brief — do not violate)
- **Additive only** — keep `unit_type`; never drop/rename it (milestone
  applicability via `applies_to_unit_types` / `getAppliesTo` keys on it; dropping
  it silently breaks N/A).
- **status_logs untouched** — no `.insert()`; `upsert_status_log` stays
  `SECURITY INVOKER`; do not re-grant `EXECUTE` to `anon`; do not drop `'owner'`
  from role lists.
- **subtypes RLS** writes = privileged only; never `anon`.
- New table/columns → `database.types.ts` → derive in `domain.ts`; narrow new
  JSONB at the query boundary; no `any`.
- Store/export only the canonical role string; display labels stay
  presentation-only (a Phase 3 concern, not this migration).
- `pendingChanges` stays local `useState` — do not touch.
- Verify with **typecheck + test + build**; whole-repo lint is NOT a gate
  (~1850 pre-existing problems).

## ⛔ APPROVAL GATES — this is the point of Phase 2
- **DDL gate:** present the FULL SQL and **STOP**. Apply only after explicit owner
  approval, on a Supabase **dev/branch DB FIRST** (Supabase MCP/CLI), never
  straight to prod.
- **Backfill is data-touching** (distinct destructive-class step): run on a
  branch/backup first, show **row counts before/after**, get explicit go-ahead
  before any production `UPDATE`. Per the no-live-write-probes rule, **NEVER
  trial-write against real rows** to "test" the path.
- **Keep `unit_type`** — confirm it is untouched.

## Open decisions to surface (don't silently pick)
- Existing projects have no `project_type` → default is **leave null** + surface
  a picker later (resolve before Phase 3).
- Lightweight-admin write RLS → default **privileged** (`owner`/`admin`/`pm`),
  confirm.
- Carried Phase-1 decisions (already settled, no change): `Other (pending)` seeds
  with status `pending`; shared `Lab` is one entry; `Kitchen`=Program and
  Housing-and-Hotel-as-one-type stay as flagged open items. The friendly
  role-label fallbacks (Primary Spaces / Common Areas / Back of House; Housing &
  Hotel → "Units") are a **Phase 3 UI** concern, NOT this migration.

## Branch
Continue on `claude/polygon-drawing-performance-n976r3`, small commits. Do not
push to `main`.

## Exit criteria — then STOP at the phase boundary
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
```
`typecheck` green (proves regenerated + derived types line up); migration applied
on a dev/branch DB with seed + backfill **verified by query (row counts)**;
existing app still runs (no status/applicability regressions). Close with the
`verify-feature` skill (Definition of Done → stop). **Do NOT commit/push until the
owner says "Approved,"** and do NOT start Phase 3 (the UI pickers) in this session.

## Communication
The owner is the product owner, not a developer — lead with a 1–2 sentence
plain-English summary, explain jargon in passing, keep it short, frame choices as
decisions with trade-offs.

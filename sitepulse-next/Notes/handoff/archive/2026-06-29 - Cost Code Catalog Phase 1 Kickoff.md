# Kickoff — Cost Code Catalog, Phase 1: schema foundation (cost_codes table + milestone FK)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of the Cost Code Catalog** (the global `cost_codes` table + a nullable
> `project_milestones.cost_code_id` FK — schema only, no UI). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-29 - Cost Code Catalog Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Cost-Code-Catalog-Plan.md` (Phase 1 + Data model)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 1**. ⛔ This phase is a **DB migration with a hard approval gate**:
> author the SQL via the `create-migration` skill, present the **full SQL, and STOP** — do not apply it,
> and never touch production data, until I say go. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## What Phase 1 is
The first slice of the Cost Code Catalog workstream: lay the **schema foundation only**. No hooks, no UI —
those are Phases 2–4. You are creating one new global table and adding one nullable column to milestones,
then making the TypeScript types aware of them.

This supports the bigger goal (see the plan's § Goal): a company-wide cost-code library that tags milestones
with standardized CSI codes, so production data is normalized in estimator-standard language. Phase 1 just
builds the table it all sits on.

## Required reading (in full, before editing)
1. `sitepulse-next/AGENTS.md` — especially §2 (RLS posture: write = owner/admin/pm, never `anon`),
   §4 (schema-change workflow: new tables → `database.types.ts` → derive in `domain.ts`; and the `subtypes`
   RLS shape to mirror), §6 (derive types from `database.types.ts`, never hand-write a table shape).
2. `sitepulse-next/Notes/plans/Cost-Code-Catalog-Plan.md` — the whole plan, but Phase 1 + § Data model are
   load-bearing. Note the deliberately-deferred items (no dollars; sub-link deferred).
3. The real schema to mirror: `sitepulse-next/supabase/migrations/20260616_location_taxonomy.sql` (the
   `subtypes` table + its RLS policies) and `20260623_project_contacts.sql` (the additive/isolated migration
   posture). **Re-read these fresh** — copy their exact idempotency + `pg_policies` guard style.

## Scope (build exactly this, nothing more)
- **New table `cost_codes`** (global; columns per the plan's § Data model): `id`, `code` (UNIQUE NOT NULL),
  `description`, `code_type`, `division`, `section`, `status` (default `'active'`), `created_at`.
  Plain TEXT for `code_type`/`status` (no CHECK enums). Indexes on `division` and `section`.
- **RLS on `cost_codes`** mirroring `subtypes`: read = any authenticated member; write =
  `owner`/`admin`/`pm`; **never `anon`.** Wrap `auth.uid()` in a scalar sub-select per the rls-perf pattern
  used by the recent migrations.
- **Add `project_milestones.cost_code_id`** — nullable `uuid` FK → `cost_codes(id)` `ON DELETE SET NULL`,
  indexed. Additive + nullable; existing rows read NULL; the live app is unaffected.
- **Types:** after the migration is approved + applied, regenerate `src/types/database.types.ts`, derive
  `export type CostCode = Database['public']['Tables']['cost_codes']['Row'];` in `src/types/domain.ts`, and
  add `costCodes()` to `src/types/queryKeys.ts` (mirror `subtypes()`). No hooks, no components.

## ⛔ Approval gate (do not blow past)
This phase changes the database. **Author the migration via the `create-migration` skill, print the full
SQL, and STOP.** Do not apply it to any database, and do not touch production data, until the owner
explicitly approves. The migration must be **idempotent** (`CREATE TABLE/INDEX IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`, `pg_policies` existence checks) and safe to re-run.

## Exit criteria (Definition of Done → then stop)
- Migration SQL presented and **approved** by the owner, then applied.
- `database.types.ts` regenerated; `CostCode` derived in `domain.ts`; `queryKeys.costCodes()` added.
- Gates green (run with the absolute prefix so a stray `cd` doesn't prompt):
  - `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck`
  - `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build`
  - (`run test` — no new tests this phase, but it must stay green.)
- Close with the `verify-feature` skill (Definition of Done → stop). **Do not commit or push until the owner
  says "Approved."** Lint is not a gate (~1850 pre-existing problems); verify with typecheck + build.

## Out of scope for Phase 1
Hooks, the importer parser, the manager UI, the milestone picker — all later phases. No subcontractor link
(that's deferred to the subcontractor-attribution workstream). No dollars/budgets, ever, in this workstream.

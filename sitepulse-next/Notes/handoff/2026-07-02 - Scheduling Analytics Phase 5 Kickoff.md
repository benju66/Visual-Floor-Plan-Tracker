# Kickoff — Scheduling Analytics (Slice B), Phase 5: cost codes + subcontractor assignment

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 5 of Scheduling Analytics (Slice B)** (cost codes + subcontractor assignment — the identity layer that Phase 6 production rates read). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-02 - Scheduling Analytics Phase 5 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Scheduling-Analytics-Slice-B-Plan.md` (Phase 5 + Data model + Hard guardrails)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 5**. This phase has **⛔ TWO DB migrations** — additive + idempotent, guarded RLS, **no `anon` grants**, `COMMENT ON`. **Present the SQL and STOP for approval before applying either one.** Resolve the **company-identity shape** (open decision) with me at the start. **Consider splitting 5a (cost codes) / 5b (subcontractor).** Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## What this is (plain English)
Right now an activity is just a name on a schedule. This phase gives each activity two pieces of
identity that make the analytics real: a **cost code** (CSI MasterFormat — the standard construction
accounting code) and a **subcontractor** (which company does the work). Once activities carry those,
Phase 6 can say "drywall is running 420 SF/week" or "this sub is 3 weeks behind across your jobs."
Nothing here is analytics yet — it's the *assignment surface* the analytics will read.

## Where Phase 4 left off (done + on the branch)
- Phase 4 (make-ready + date-ripple) is COMMITTED on `feat/scheduling-analytics-phase-4`
  (`911052c`) — pure logic `src/utils/activityReadiness.ts` + `src/utils/dateRipple.ts`, a floor-plan
  Make-Ready color mode, a Gantt blocked badge, and the date-ripple confirm-then-write. **Confirm it's
  merged to `main` before branching** (ask the owner if unsure).
- No schema was touched in Phase 4. This phase is the first Slice B migration.

## Critical ground-truth facts (verify fresh)
- `activity_dictionary.cost_code_id UUID` **already exists as a reserved slot** (no FK/table yet — the
  migration comment says "RESERVED for Slice B"). Phase 5 creates `cost_codes` and adds the FK.
- `project_contacts.company` is **project-scoped only** — there is no global/tenant-wide vendor identity
  yet. Benchmarking (Phase 6) needs cross-project identity, so the sub must resolve to a **tenant-wide**
  record, not a per-project string. **This is the open decision below — resolve it first.**
- Cost-code + sub are assigned at the **project-activity** level (`activities` row): a GC uses different
  subs per job. Per-area sub override is explicitly deferred.
- `units.computed_area` is the SF quantity denominator (already live from the Scale work) — not needed
  to WRITE here, but it's why cost codes matter.

## Required reading (in order)
1. `sitepulse-next/AGENTS.md` — §2 (RLS posture: privileged writes = `owner`/`admin`/`pm`, **never
   `anon`**; `SECURITY INVOKER`), §4 (migration + `database.types.ts`/`domain.ts` discipline;
   Activity Dictionary section — the governed-dictionary pattern to MIRROR), §6 (types / JSONB narrowing).
2. `sitepulse-next/Notes/plans/Scheduling-Analytics-Slice-B-Plan.md` — **Phase 5** scope, the **Data
   model** block (exact `cost_codes` shape), **Hard guardrails**, and **Open decisions**.
3. Read fresh, as the patterns to copy (do NOT fork):
   - `src/utils/locationTaxonomy.ts` + `src/hooks/useSubtypes.ts` + the `subtypes` migration — the
     canonical **governed global dictionary** pattern (status/aliases/RLS). `cost_codes` mirrors it.
   - `src/utils/activityDictionary.ts` + `src/hooks/useActivityDictionary.ts` — the scheduling twin,
     already mirroring `subtypes`; `cost_code_id` lives on `activity_dictionary`.
   - `src/components/GlobalSettingsModal.jsx` + `src/app/dashboard/page.jsx` — the global/cross-project
     settings home where the **cost-code dictionary manager** goes (memory `global-vs-project-settings`).
   - `src/components/schedule/ActivityManagerPanel.tsx` — the Schedule-view activity editor where the
     **cost-code + sub pickers** attach (the FS-predecessor picker is the layout precedent).
   - `src/components/ProjectContacts*` / `project_contacts` — the existing company/contact surface, in
     case the company identity promotes from it.

## Scope (only this)
1. **⛔ Migration A — `cost_codes` (global table):** `id`, `code`, `description`, `division`,
   `unit_of_measure` (default `'SF'`), `status` (`active`/`deprecated`), `sort_order`, timestamps;
   **UNIQUE on `lower(code)`** (idempotent import). RLS read = member / write = `owner`·`admin`·`pm` /
   **never `anon`** (copy `subtypes`). Add FK `activity_dictionary.cost_code_id → cost_codes(id) ON
   DELETE SET NULL`. `COMMENT ON`. **Present SQL + STOP.**
2. **⛔ Migration B — company identity + `activities.subcontractor_id`:** resolve the shape first (open
   decision). Add `activities.subcontractor_id UUID null` (FK → the resolved company table, `ON DELETE
   SET NULL`). RLS mirrors the privileged-write pattern. `COMMENT ON`. **Present SQL + STOP.**
3. **Types:** add both tables to `src/types/database.types.ts` (Tables + the new FK); derive
   `CostCode` / `Company` (or the resolved name) in `src/types/domain.ts` via
   `Database['public']['Tables']['<t>']['Row']`. Narrow any JSONB at the query boundary.
4. **Hooks:** `useCostCodes` (+ CRUD/import) mirroring `useSubtypes`/`useActivityDictionary`; a company
   hook; extend the activity update path to set `cost_code_id` (on the dictionary entry) + `subcontractor_id`
   (on the activity). Online-first (schedule authoring — never the offline queue).
5. **Manager UI:** cost-code dictionary tab in `GlobalSettingsModal` (import/edit/deprecate, **idempotent
   CSV/paste seed** of CSI MasterFormat — re-import makes no dupes). **Cost-code + sub pickers** in the
   Schedule-view activity editor. Privileged writes; reads = member.

## Guardrails
- **⛔ Two migrations — present SQL + STOP for each.** Additive + idempotent (`IF NOT EXISTS`,
  `CREATE OR REPLACE`), guarded RLS, **no `anon` grants**, `COMMENT ON`. Never touch prod data without go-ahead.
- **Mirror `subtypes`/`activity_dictionary` — do NOT fork** the governed-dictionary pattern.
- Idempotent code import: UNIQUE on `lower(code)`; re-seeding the same CSI list adds nothing.
- **No status writes**, no analytics yet, no critical-path/float. This is identity/assignment only.
- **Benchmarking is private per-GC** — the company identity must be tenant-wide but never pooled across tenants.
- Types derive from `database.types.ts`; no `Json` into props; keep `database.types.ts` + `domain.ts` in sync
  with the migration in the SAME change.

## Open decisions (resolve at the START with the owner)
- **Company identity shape** — promote `project_contacts.company` into a global `companies` record, OR a
  fresh lightweight `companies` dictionary? Benchmarking needs cross-project identity. **Ask before Migration B.**
- **CSI MasterFormat seed depth** — full division list vs. the owner's actual code list. **Get the owner's
  list**; the seed should be idempotent either way.

## Exit criteria (Definition of Done)
- `typecheck` + `test` + `build` green (absolute-prefix commands in the plan's Verification section).
- New hooks/utils have unit tests (idempotent import → no dupes; alias/code resolution if any pure logic).
- Live `dev:3010`: seed codes (re-import = no dupes), assign a code + a sub to an activity, reload →
  persists. Un-coded activities stay clean (no fake identity).
- Both migrations applied only after **explicit approval**; `database.types.ts` + `domain.ts` reflect them.
- Close with the **`verify-feature`** skill (Definition of Done → STOP). **Do not commit or push until the
  owner says "Approved."** Then draft the Phase 6 (production rates + forward analytics) kickoff and hand off.
- **Consider splitting 5a (cost codes + dictionary manager + assign) / 5b (company identity + sub assign)**
  if one session gets large — an extra kickoff is cheap.

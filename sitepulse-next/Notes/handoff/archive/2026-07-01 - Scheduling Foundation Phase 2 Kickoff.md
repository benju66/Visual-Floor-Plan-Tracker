# Kickoff — Scheduling Foundation (Slice A), Phase 2: Global governed activity dictionary

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of Scheduling Foundation (Slice A)** — the **global, company-wide governed activity dictionary** (so "MEP Rough-In" and "Rough-Ins" resolve to the same thing across projects). It mirrors the existing global `subtypes` dictionary. Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-01 - Scheduling Foundation Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Scheduling-Foundation-Slice-A-Plan.md` (Phase 2 + Data model "After Phase 2" + Hard guardrails)
> - `sitepulse-next/AGENTS.md` (§4 Location Taxonomy / `subtypes` pattern, §2 RLS posture, §6 types + JSONB narrowing)
>
> Branch off `main`. ⛔ This phase adds a **new global table + RLS** (and an additive nullable FK on `activities`). Present the full SQL and **STOP** before applying anything; mirror the `subtypes` RLS exactly (read = any member, write = owner/admin/pm, **never `anon`**). Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Where Phase 1 left us (read before starting)
Phase 1 shipped to prod + main (`main == 5a7cd1a`, migration `20260701_activity_model.sql`, name `activity_model`
in the Supabase migration history of prod `pmccdxmuszuykawvlphj`). The schema is now:
- **`activities`** (was `project_milestones`): `id, project_id, sequence_order, name, color, track, type`
  (`'task'`|`'milestone'`), `applies_to_unit_types`, `created_at`. **Project-scoped** — each project has its
  own activity rows (50 on prod today).
- `status_logs` keys by **`activity_id`** (`UNIQUE(unit_id, activity_id)`); the frontend uses
  **boundary translation** — reads join `activities(name)` and synthesize a display-only `StatusLog.milestone`
  name; writes carry `activity_id`. `Milestone`/`MilestoneOverride` remain **deprecated domain aliases**
  (`src/types/domain.ts`) — you may keep using them; don't churn a mass identifier rename.
- `activity_applicability_overrides` (was `milestone_applicability_overrides`), keyed by `activity_id`.

Phase 2 does NOT change any of that. It adds a **global layer above** the project-scoped activities.

## What this phase is (plain English)
Today each project types its own activity names by hand, so the same real-world step is spelled a dozen
ways across projects ("MEP Rough-In", "Rough-Ins", "MEP Rough-ins Completed"). This phase adds a **shared,
company-wide dictionary** of canonical activities — each with **aliases** (so all those spellings map to one
thing), a **type** (task/milestone), a **project-type scope** (which kinds of projects it applies to), and a
**governance status** (active / pending / deprecated). A project activity can then **point at** a dictionary
entry (like a location's sub-type points at the global `subtypes` dictionary). Governance is **non-blocking**:
a user who needs a word that isn't in the dictionary yet can add it as **`Other (pending)`** and keep working;
an admin promotes it later. This is the exact pattern already shipped for **location sub-types**
(`20260616_location_taxonomy.sql` + `src/utils/locationTaxonomy.ts`) — **copy it, don't reinvent it.**

## Required reading (in order)
1. `sitepulse-next/AGENTS.md` — **§4** (Location Taxonomy: the global `subtypes` dictionary — governed
   `status` active/pending/deprecated, `aliases`, `default_project_types`, `Other (pending)` sentinel; RLS
   read = any authenticated member, write = `owner`/`admin`/`pm` only, never `anon`; the `units.subtype_id`
   nullable-FK + the review-queue backfill posture — **all directly mirrored here**), **§2** (RLS posture),
   **§6** (types hand-maintained; JSONB narrowing at the query boundary — `isStringArray`,
   `isProjectTypeArray` already exist and are reusable).
2. `sitepulse-next/Notes/plans/Scheduling-Foundation-Slice-A-Plan.md` — the **Phase 2** section, the **Data
   model** "After Phase 2 (global governed dictionary — mirrors `subtypes`)" block, and **Hard guardrails**.
3. `sitepulse-next/supabase/migrations/20260616_location_taxonomy.sql` — the **template migration**: the
   `subtypes` table shape + RLS policies + `Other (pending)` seed + `units.subtype_id` FK. Copy its structure.
4. `src/utils/locationTaxonomy.ts` + `src/types/domain.ts` (`Subtype`, `isStringArray`, `isProjectTypeArray`)
   + `src/hooks/useSubtypes.ts` — the pure helpers, domain type, JSONB guards, and query-hook shape to mirror.
5. The `create-migration` skill (`.agent/skills/create-migration/SKILL.md`) — migration workflow + gate.

## Verify the live schema FIRST (confirm; don't trust this doc)
Before writing SQL, query prod (`pmccdxmuszuykawvlphj`) to pin the exact current shapes to mirror:
- `subtypes` — full column list + **exact types** of `aliases` / `default_project_types` (they are **JSONB**
  narrowed via guards, NOT native `text[]` — confirm and match). Its `status` values + any CHECK.
- The `subtypes` **RLS policies** (`select … from pg_policies where tablename='subtypes'`) — copy the
  membership/privileged shapes verbatim (read = member, write = `owner`/`admin`/`pm`, never `anon`).
- `activities` — confirm the Phase-1 shape (id/name/color/track/type/…); confirm **no** `dictionary_id` yet.
- Confirm `activity_dictionary` does **not** already exist.
- The **distinct `(track, name, type)` activity rows** currently in prod (`select distinct track, name, type
  from activities order by track, name;`) — this is the candidate **seed set** for the dictionary + the
  bootstrap-mapping decision (see Open decisions).

## Scope (only this phase)
1. ⛔ **Migration** (`supabase/migrations/<YYYYMMDD>_activity_dictionary.sql`) — additive; present SQL + STOP:
   - **NEW global `activity_dictionary`** (cross-project, governed) — mirror `subtypes` columns/types:
     `id uuid pk`, `name text not null`, `track text` (scope), `type text not null default 'task'`
     (`'task'`|`'milestone'` CHECK), `status text not null default 'active'`
     (`'active'`|`'pending'`|`'deprecated'` CHECK), `aliases` (JSONB — match `subtypes.aliases`),
     `default_project_types` (JSONB — match `subtypes.default_project_types`), **reserved
     `cost_code_id uuid null`** (Slice B fills it — add the column, no FK/table yet), `created_at`/`updated_at`.
     **RLS: read = any authenticated member, write = `owner`/`admin`/`pm`, never `anon`** (copy `subtypes`).
     Seed an **`Other (pending)`** sentinel row. `COMMENT ON`.
   - **`activities.dictionary_id uuid null → activity_dictionary(id) ON DELETE SET NULL`** (additive,
     nullable — like `units.subtype_id → subtypes`). Existing project activities start `NULL` (review queue).
   - **Project-override table** for global defaults — mirror the applicability-override pattern
     (see Open decisions: build now vs defer; the plan lists it, but it may be deferrable if project-specific
     bits already live on `activities`).
2. `src/utils/activityDictionary.ts` (pure, framework-free, no `Date.now()`): alias resolution /
   canonicalization + `default_project_types` filtering — **mirror `locationTaxonomy.ts` helpers** — **+ tests**.
3. Query hooks (`useActivityDictionary` etc.: read = member, writes = privileged — mirror `useSubtypes.ts`) +
   wire the activity editor (today the milestone tab in `SettingsMenu.tsx`; it MOVES to the Schedule view in
   Phase 3 — don't move it now) to **pick a dictionary activity by name OR alias**, with a **non-blocking
   add-custom / propose** path (`Other (pending)`). Derive domain types from the Row; narrow JSONB at the
   query boundary (reuse `isStringArray`/`isProjectTypeArray`); no `Json` into props.

## ⛔ Approval gate (hard stop)
Present the **exact SQL** (full migration) and **STOP** before applying. This adds a new global table + RLS +
an FK. Mirror `subtypes` RLS **exactly** — read = any authenticated member, write = `owner`/`admin`/`pm`,
**never `anon`**; keep the privileged-role list `('owner','admin','pm')` intact. Additive + idempotent
(`create table if not exists`, guarded policies, `add column if not exists`), `COMMENT ON`. Apply to prod only
on explicit "Approved" (this one is additive/nullable, so unlike Phase 1 it is **not** deploy-coupled — the
live app ignores the new table/column until the editor reads it; still gate the SQL).

## Exit criteria (Definition of Done)
- `typecheck` + `test` + `build` all green (`npm --prefix "…/sitepulse-next" run typecheck|test|build`).
- Live (`npm run dev:3010`): in the activity editor, **pick a dictionary activity by an alias**; **add a
  custom activity without being blocked** (lands as `Other (pending)`).
- `subtypes`-shaped RLS holds (read = member, write = privileged, never `anon`); governance is non-blocking.
- Close with the **`verify-feature`** skill (Definition of Done → STOP). **Do not commit/push until owner says
  "Approved."** Then draft the **Phase 3 kickoff** (consolidated Schedule view + light dependencies) + hand off.

## Guardrails
- **Mirror `subtypes`, don't reinvent** — same governed-dictionary shape, same RLS, same `Other (pending)`
  sentinel, same JSONB guards. Divergence from that pattern is a smell.
- **Additive only** — `activities.dictionary_id` is nullable; the status pipeline (`status_logs`/`activity_id`
  slot key, `upsert_status_log`, audit trigger) is **untouched**. Don't re-open the Phase-1 invariants.
- **No `anon` grants**; keep the `('owner','admin','pm')` write-role list; `create_new_project` assigns
  `'owner'` (§2) — never drop it.
- Types: regenerate/hand-maintain `database.types.ts`, derive domain types from the Row, narrow JSONB at the
  query boundary; no `Json` into props (§6). Keep Query-cache values JSON-serializable.
- Don't touch the Look-Ahead (`src/lookahead/`). Don't move the Settings activity editor into the Schedule
  view (that's Phase 3). Don't fork `progressAnalytics`/`activityDictionary`.

## Open decisions to resolve at migration time
- **Seed / bootstrap mapping:** seed the dictionary from the existing distinct prod activity names (a nice
  head-start) and set matching `activities.dictionary_id`, OR ship the dictionary empty (+ `Other (pending)`)
  and let users adopt it? Mirror the taxonomy backfill posture (legacy rows → review queue). Leaning: seed
  from distinct `(track, name, type)` + leave `dictionary_id` NULL (a review queue: `dictionary_id IS NULL`),
  not auto-linked. Confirm with owner.
- **`aliases` / `default_project_types` storage:** match `subtypes` exactly (JSONB + `isStringArray` /
  `isProjectTypeArray`) rather than native `text[]` — confirm the live `subtypes` types first.
- **Project-override table:** build now (mirror `activity_applicability_overrides`) or defer? Project-specific
  bits (sequence_order, color, local label override) already live on `activities`; a separate global-default
  override table may be deferrable to when a concrete override need appears. Decide at start.
- **`track` global vs project:** is `track` a property of the global dictionary entry, or purely a
  project-local grouping on `activities`? Leaning: dictionary carries a default `track`/scope, `activities`
  may override locally. Confirm.

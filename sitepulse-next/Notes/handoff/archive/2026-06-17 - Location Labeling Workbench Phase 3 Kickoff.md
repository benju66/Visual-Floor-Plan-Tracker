# Kickoff — Location Labeling Workbench, Phase 3: Workbench schema migration (container flag + sidecar + label flags)

> Paste-ready prompt + context for a fresh Claude Code session. Self-contained: read this, then the files it names, then build.
> **Phases 1 + 2 are DONE** (project-type picker shipped; taxonomy-correction migration applied to prod — `project_type` is now **9 values**, Kitchen/Prep are `support`). This session does **only Phase 3**.

## What you're building
**Phase 3 of the Location Labeling Workbench plan** — the database foundation for the workbench, and **nothing visible yet**. One **additive, nullable, idempotent** migration plus the matching TypeScript types. It adds: (1) a `projects.kind` flag that marks a project row as a hidden "workbench" container (vs. a normal `'live'` project); (2) a `workbench_sheets` sidecar table holding per-drawing metadata; (3) three nullable label flags on `units` (`spans_levels`, `level_note`, `has_void`). No UI, no routes, no backend, no data backfill. The live app must be completely unaffected (every new column is nullable/defaulted and unread by existing UI).

This is a **⛔ DDL (schema-change) phase with a hard approval gate** — see Guardrails.

## Required reading (in order, fresh — do not trust line numbers)
1. `sitepulse-next/AGENTS.md` — architecture + invariants. Especially **§2** (RLS posture: write = `owner`/`admin`/`pm`, never `anon`; offline queue / `status_logs` untouched), **§4** (Location Taxonomy: `unit_type` is KEPT; `units.top_level_role` is the single source of truth for role; `subtypes` RLS pattern), **§6** (TS guardrails: regenerate `database.types.ts` → derive in `domain.ts`; never hand-write a table shape; narrow JSONB at the query boundary; no `any`; new files `.ts`/`.tsx`), **§7** (backend auth — do **NOT** touch; the workbench reuses the sheet-scoped endpoints unchanged).
2. `sitepulse-next/Notes/plans/Location-Labeling-Workbench-Plan.md` — the plan-of-record. Read **§ Locked product decisions**, **§ Data model** (esp. **"New schema this plan adds → Migration B"**), and **Phase 3** in full. (Phases 4+ are NOT in scope.)
3. The **`create-migration`** skill (`.agent/skills/create-migration/SKILL.md`) — the migration checklist + gate (inspect → write idempotent SQL → apply → regenerate/derive types → verify).
4. Style templates — read fresh before writing SQL:
   - `sitepulse-next/supabase/migrations/20260616_location_taxonomy.sql` — the idempotent/guarded `DO $$` pattern, `CHECK … NOT VALID` then `VALIDATE`, and the `units → sheets → project_members` RLS membership pattern to **mirror** for `workbench_sheets`.
   - `sitepulse-next/supabase/migrations/20260617_taxonomy_correction.sql` — most recent migration; confirms `project_type` is now the **9-value** list.

## Files this phase touches
- **NEW** `sitepulse-next/supabase/migrations/<YYYYMMDD>_workbench_schema.sql` — Migration B (below). Date-prefix with the session's date (e.g. `20260617_workbench_schema.sql`; multiple same-date files are fine).
- `src/types/database.types.ts` — **regenerate** (Supabase MCP `generate_typescript_types`, or hand-edit carefully — note this file is hand-maintained and drifts from live, so diff it against the live schema after generating). Adds the `workbench_sheets` table block, `projects.kind`, and the three new `units` columns.
- `src/types/domain.ts` — derive `WorkbenchSheet` Row/Insert from `Database['public']['Tables']['workbench_sheets']`; extend the `Unit` domain type with the three new nullable flags. No new JSONB columns are expected here (so no new type guard), but confirm and narrow at the boundary if any appear.

## Migration B — exact shape (additive, nullable, idempotent; mirrors the plan)
- `projects.kind TEXT NOT NULL DEFAULT 'live' CHECK (kind IN ('live','workbench'))` — the hidden-container marker. **Indexed** (`idx_projects_kind`). Existing rows default to `'live'` (no backfill needed).
- **`workbench_sheets`** sidecar (1:1 with a workbench drawing; keeps the shared `sheets` table clean):
  - `sheet_id UUID PRIMARY KEY REFERENCES sheets(id) ON DELETE CASCADE`
  - `sheet_project_type TEXT` — per-drawing type (workbench drawings are heterogeneous, unlike a live project's single type). **CHECK ∈ the 9 project types OR NULL** (mirror `PROJECT_TYPES` in `src/utils/locationTaxonomy.ts` — `Commercial, Educational, Government, Healthcare, Hotel, Housing, Industrial, Restaurant, Workplace`).
  - `level_label TEXT`, `source_sheet_number TEXT`
  - `vector_quality TEXT CHECK (vector_quality IN ('clean','scanned') OR vector_quality IS NULL)`
  - `is_partial BOOLEAN NOT NULL DEFAULT false`
  - `review_state TEXT NOT NULL DEFAULT 'draft' CHECK (review_state IN ('draft','ready_for_review','reviewed'))`
  - `reviewed_by UUID`, `reviewed_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ DEFAULT now()`
  - **RLS** mirrors the units/sheets membership pattern: a user may read/write a `workbench_sheets` row iff they are a member of the parent **sheet's project** (`workbench_sheets → sheets → project_members`). Write gated to `owner`/`admin`/`pm`; **never grant `anon`**. (Scale lives on `sheets` — reuse the existing scale tooling; do not duplicate it here.)
- **`units`** additive nullable label flags (metadata belongs with the label, like `computed_area`): `spans_levels BOOLEAN`, `level_note TEXT`, `has_void BOOLEAN`. Unused by live UI.

## Guardrails (must not violate)
- **⛔ DDL APPROVAL GATE — present the full SQL and STOP.** Do not apply anything until the owner gives an explicit go-ahead. There is **no separate dev branch** on this Supabase project (`Visual-Floor-Plan-Tracker`, ref `pmccdxmuszuykawvlphj`); the owner approves the apply target. The migration is **additive + nullable only — no backfill of existing rows** (defaults handle it), so it is prod-safe, but it is still gated. Show what each statement does before running. Apply via Supabase MCP `apply_migration` (records it in migration history) and verify with read-back queries.
- **No backend (`main.py`) changes** — the sheet-scoped `verify_sheet_access` / JWKS-ES256 auth path stays exactly as-is (AGENTS.md §7). This is *why* workbench sheets hang off a real container project.
- **`status_logs` / `status_audit_log` / offline queue untouched.** `unit_type` is **kept**.
- **`workbench_sheets` RLS never grants `anon`**; mirror the `subtypes`/units membership policies (privileged write).
- **Types:** regenerate `database.types.ts` → derive in `domain.ts`; never hand-write a table shape; no `any`; narrow any new JSONB at the query boundary (none expected).

## Verify before closing (exit criteria)
Run with the absolute `--prefix` (cwd persists in Bash; a stray `cd` prompts):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
- **typecheck green** — proves the regenerated `database.types.ts` and the derived `domain.ts` types line up.
- **Migration applied + verified by query** (after owner approval): `projects.kind` exists, defaults `'live'`, all existing rows `'live'`; `workbench_sheets` table + RLS policies present; the three `units` columns exist and are nullable.
- **Existing app unaffected** — new columns nullable/defaulted and unread by live UI; `dev:3010` still loads the dashboard + a project normally. (No new UI to click through this phase; a quick smoke-load is enough.)

Close the phase with the **verify-feature** skill (Definition of Done → stop). **Do not commit or push until the owner says "Approved."**

## Scope discipline
This session builds **only Phase 3** — the schema migration + matching types. Do **NOT** build the workbench route/shell, the hidden-container bootstrap, the library list, the dashboard `kind='workbench'` exclusion, PDF ingest, or any tracing — those are Phases 4–7, separate gated sessions.

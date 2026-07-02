# TASK: Create a Supabase Migration (SitePulse)

Use this for any database schema change — new table, column, RPC, trigger, constraint, or index. The frontend's type safety and offline-sync integrity both depend on doing this in the right order. Ground everything in `sitepulse-next/AGENTS.md` (§2, §6). Stop and ask before running any destructive step.

**Step 1: Inspect before changing**
Use the Supabase MCP `list_tables` (and `list_migrations`) to understand the current schema. Read the existing SQL in `sitepulse-next/supabase/migrations/` to match naming and style. Confirm whether the change touches `status_logs` / `status_audit_log` — those have special rules (below).

**Step 2: Write the migration SQL**
Create a new file in `sitepulse-next/supabase/migrations/` named `YYYYMMDD_short_description.sql` (date-prefixed, matching existing files).
* Make it **idempotent where practical** (`create table if not exists`, `create or replace function`, guarded `alter table ... add column if not exists`).
* **`status_logs` is slot-unique:** preserve `UNIQUE(unit_id, activity_id)` (the stable slot key since `20260701_activity_model.sql`). Current-state writes go through the `upsert_status_log` RPC (with its Last-Write-Wins `client_timestamp` guard) or `.upsert({ onConflict: 'unit_id,activity_id' })` — never plain `INSERT`. Do not add a competing uniqueness rule, and never re-add a name-keyed constraint.
* **History is append-only** in `status_audit_log` via a trigger — never write to it directly; never make history queries read from `status_logs`.
* If a step is **destructive** (dedup, drop, backfill), call it out explicitly and require a backup first. The existing `status_logs` dedup is the cautionary example.

**Step 3: Apply it**
* Preferred: Supabase CLI for local/branch testing, then apply to the project. Or the Supabase MCP `apply_migration` (remote — apply carefully; confirm cost/impact first).
* Never edit a table directly in the dashboard without a corresponding migration file — the file is the source of truth.

**Step 4: Regenerate and derive types (REQUIRED)**
This is the step that keeps the frontend honest — do not skip it.
* Regenerate `src/types/database.types.ts` (Supabase MCP `generate_typescript_types`, or the CLI). New tables go in the `Tables` block; new RPCs in the `Functions` block.
* Derive domain types in `src/types/domain.ts` from the generated types — `Database['public']['Tables']['<table>']['Row']`. **Never hand-write a type that duplicates a table shape.**
* For new JSONB columns, add a runtime type guard in `domain.ts` (like `isPercentPointArray`) and narrow at the query boundary inside `queryFn` — do not let `Json` propagate into props.

**Step 5: Wire up the data layer**
* Update the relevant TanStack Query hook(s) in `src/hooks/` to select/mutate the new shape. Keep cache values JSON-serializable (no class instances).
* If you added an RPC for writes, route mutations through it; do not bypass it with `.insert()`.

**Step 6: Document and verify**
* Add a row to the migrations table in the root `README.md` describing the migration and flagging any destructive step.
* If the change introduces a new invariant or pattern, update the relevant section of `AGENTS.md`.
* Verify: `npm run typecheck` passes (proves the generated/derived types line up), plus a test for any new guard or sync path (see the `write-tests` skill).

**Gate:** Present the migration file, the type changes, and the verification results. Do not commit or apply to production data until explicitly approved.

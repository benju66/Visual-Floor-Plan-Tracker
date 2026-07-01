# Kickoff — Scheduling Foundation (Slice A), Phase 0: backfill the scale-columns migration

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 0 of Scheduling Foundation (Slice A)** (backfill the missing `sheets` scale-columns migration — a no-op against prod, for repo reproducibility). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-01 - Scheduling Foundation Phase 0 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Scheduling-Foundation-Slice-A-Plan.md` (Phase 0)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 0**. ⛔ This phase writes a DB migration file: **present the exact SQL and STOP before applying anything; verify it is a no-op against the live schema; never touch production data without my explicit go-ahead.** Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## What this phase is (plain English)
The `sheets` table already has scale/calibration columns **live in production** (`scale_units_per_px`,
`scale_unit`, `scale_calibration`, plus legacy `scale_ratio`/`scale_preset`), but there is **no
migration file for them** in `supabase/migrations/` — they were applied by hand during earlier scale
work. This phase writes that missing migration so the schema can be rebuilt from the repo. It is a
**pure housekeeping / reproducibility fix — no behavior change, a no-op against the live database.**

It is deliberately the first, smallest phase: it also exercises the SQL-approval gate before Phase 1's
much larger `status_logs` migration.

## Required reading (in order)
1. `sitepulse-next/AGENTS.md` — §2 (migrations, RLS posture, status_logs rules — not touched here, but
   know them), §6 (types are hand-maintained).
2. `sitepulse-next/Notes/plans/Scheduling-Foundation-Slice-A-Plan.md` — the plan-of-record; **Phase 0**
   section + the "Data model" and "Hard guardrails" sections.
3. `sitepulse-next/Notes/plans/Scheduling-Activities-Master-Plan.md` — the parent roadmap (context).
4. The `create-migration` skill (for the migration workflow + approval gate).

## Scope (only this)
1. **Verify the live schema first.** Query the actual `sheets` scale columns and their exact types /
   nullability / defaults, e.g.:
   `select column_name, data_type, is_nullable, column_default from information_schema.columns
    where table_name = 'sheets' and column_name like 'scale_%';`
   The migration must reflect what is actually live — not a guess.
2. **Write** `sitepulse-next/supabase/migrations/<YYYYMMDD>_sheets_scale_columns.sql` that adds those
   columns **idempotently** (`ALTER TABLE sheets ADD COLUMN IF NOT EXISTS ...`), matching the live
   types/defaults exactly, with `COMMENT ON` lines. Because the columns already exist, applying it must
   be a **verified no-op**.
3. No code changes, no `database.types.ts` changes (the columns are already in the types).

## ⛔ Approval gate (hard stop)
- Present the **exact SQL** and **STOP**. Do not apply it, and do not run any DDL against production,
  until the owner explicitly approves. Confirm in the message that it is a no-op (columns already live).

## Exit criteria (Definition of Done)
- The SQL is confirmed to match the live schema and to be a no-op (idempotent `IF NOT EXISTS`).
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green
  (no code changed, but confirm nothing broke).
- Close the phase with the **`verify-feature`** skill (Definition of Done → STOP). **Do not commit or
  push until the owner says "Approved."**
- Then (per the post-approval ritual) draft the **Phase 1 kickoff** and hand off with a short chat prompt.

## Guardrails
- Additive + idempotent only; **no `anon` grants**; do not alter RLS. No `status_logs` / RPC changes in
  this phase.
- This is a no-op — if the live query shows the columns are somehow **absent or a different shape than
  expected**, STOP and tell the owner before writing anything.

# Kickoff — Terminology Sweep Follow-up: audit-column migration + legacy wire-key removal

## ▶ Launch prompt (paste this to start a fresh session)
> Perform the **Terminology Sweep follow-up**: (A) a small migration renaming the last data-layer
> remnant `status_audit_log.milestone` → `activity_name` (+ re-key the audit trigger) and simplify the
> two frontend read hooks that currently map it; (B) drop the legacy `active_milestones` key from the
> export payload — ONLY after confirming the renamed backend is live on Render. Read these in full,
> then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-02 - Terminology Sweep Follow-up (audit column + legacy wire key) Kickoff.md` (this file)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. ⛔ SQL-approval gate: show me the migration before applying anything to prod.
> Verify by typecheck + test + build + a live history/timeline check (Unit History modal + dashboard
> velocity chart) showing identical behavior. Don't commit or push until I say "Approved."

---

> Context for the session.

## Precondition
The **Terminology Sweep branch (`feat/terminology-sweep-milestone-to-activity`, commits 9b8d32c +
f0af559) must be MERGED TO MAIN and deployed** (Vercel + Render) before starting this. Part B
additionally requires confirming the Render backend deploy that reads `active_activities` is live.

## Part A — rename the last data-layer remnant (small ⛔ migration)
The sweep left exactly one `milestone` name in the data layer, by design (the sweep was forbidden to
touch schema): **`status_audit_log.milestone`** — the activity-NAME snapshot the audit trigger writes
on every status change.

- **Migration** (`YYYYMMDD_audit_activity_name.sql`): `ALTER TABLE status_audit_log RENAME COLUMN
  milestone TO activity_name;` + recreate the audit trigger function to write the new column name.
  Idempotent-guard per the create-migration skill; the trigger is on prod's live write path, so test
  on a throwaway Supabase branch first (the Phase-1 migration caught 2 real bugs that way).
- **Frontend simplification** (after the column is live): in `useProjectQueries.ts`,
  `useUnitHistory` and `useStatusHistory` currently map `r.milestone → activityName` at the query
  boundary — repoint their SELECT/mapping to `activity_name`. Update the hand-maintained
  `database.types.ts` `status_audit_log` block (`milestone` → `activity_name`).
- **Keep:** the pendingChangesStore legacy-key rehydration shim and the `delete safeData.milestone`
  strips in the write paths — those guard the offline queue, not the audit table. (Optional: they can
  be retired in a later cleanup once the owner confirms no pre-rename offline queues exist anywhere.)

## Part B — drop the legacy export wire key (frontend one-liner)
`page.jsx` sends BOTH `active_activities` and legacy `active_milestones` in the /export
`legend_data` (dual-compat for the deploy-skew window). Once the Render backend that prefers
`active_activities` is confirmed live, delete the legacy line (it is commented in place) — and
optionally the backend's fallback read too.

## Guardrails
- ⛔ Owner approves the SQL before it touches prod (`pmccdxmuszuykawvlphj`).
- The audit table is **append-only history** — never rewrite existing rows' contents; this is a
  column RENAME only (metadata, instant), plus the trigger re-key.
- Do NOT touch `status_logs`, `upsert_status_log`, RLS, or the offline queue.
- No live-write probes against prod rows (standing rule).

## Exit criteria
- Migration applied to prod (post-⛔), trigger verified: one manual status change on a sandbox
  project appends an audit row with `activity_name` populated.
- `npm run typecheck` / `test` / `build` — clean.
- Live check: Unit History modal timeline + dashboard Completion Velocity render identically
  (both read the audit table).
- Grep proof: no `milestone` left in `useUnitHistory`/`useStatusHistory`/`database.types.ts`'s
  audit block; if Part B ran, none in the export payload either.
- Close with `verify-feature`; **don't commit/push until the owner says "Approved."**

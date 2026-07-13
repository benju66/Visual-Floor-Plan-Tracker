# Kickoff — Status Sequencing & Auto-Advance Data-Integrity Fix, Phase 5 (FINAL): ⛔ DB safety-net — `upsert_status_log` preserves omitted fields

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 5 (FINAL) of the Status Sequencing & Auto-Advance Data-Integrity Fix** — the ⛔ database backstop: a NEW dated migration that makes `upsert_status_log` **preserve** a field when its JSON key is **absent** (vs. **clear** it to NULL only when the key is present but an empty string), so no current or future caller can silently wipe a column by omitting it. This is a **schema/DDL change → owner sign-off gated**: present the exact SQL and **STOP** — do NOT apply it to prod (or run `apply_migration`) until I say "Approved to apply." Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-10 - Status Sequencing Data Integrity Phase 5 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Status-Sequencing-Data-Integrity-Plan.md` (esp. **Phase 5**, **Data model** → the absent-vs-empty rule, **Hard guardrails**, **Out of scope** → clear-status path)
> - `sitepulse-next/AGENTS.md` (§2 status-write / `upsert_status_log` **SECURITY INVOKER** / grants / LWW / slot key invariants; §4 "Database Schema Changes" → types + migrations home; §7-8 backend if relevant)
> - `sitepulse-next/supabase/migrations/20260711_status_logs_actual_start.sql` — the **current** `upsert_status_log` body (copy it verbatim into the new migration; change ONLY the `DO UPDATE SET` expressions).
> - `sitepulse-next/src/hooks/useProjectQueries.ts` — `useUpdateStatus` (drops a null `logged_date` → key becomes ABSENT), `useClearStatus`/`clearStatusMutation` (omits all date fields), `useBulkUpdateStatus` (`.upsert` path — does NOT use the RPC). **These are the callers that today rely on "absent = clear" — reconcile them.**
> - `sitepulse-next/src/hooks/useMapActions.ts` — `commitUnitActivity` `newLogData` (Phase 3 now passes explicit values for the dates; the auto-advance `nextLogData` omits `logged_date`/`actual_start_date`) so you can confirm what each caller sends.
>
> Use the **`create-migration` skill** to author a NEW dated migration (never edit an applied one in place). Keep `upsert_status_log` **SECURITY INVOKER**, same `search_path`, same grants (anon **never** granted), the same LWW `client_timestamp` guard, and `ON CONFLICT (unit_id, activity_id)` **exactly** as today — change only the field-preservation SET expressions. **Present the full SQL + the caller-reconciliation findings and STOP for sign-off before applying.** Close with `verify-feature`. This phase **closes the workstream**.

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
Phases 1–4 fixed the *app* so it stops wiping other activities' saved dates/state. Phase 5 adds a **database-level backstop**: right now, if any save leaves a field out of its payload, the `upsert_status_log` function **erases** that column. We change it so a **left-out field keeps its existing value** — only an **explicit clear** (sending an empty value) blanks it. That way, even a future bit of code that forgets to include a field can't silently destroy data. It needs a schema change, so it's **your call before it goes live.**

## The mechanism (read the real RPC fresh — do not trust line numbers)
The current body (`20260711_status_logs_actual_start.sql`) writes every column from the payload via:
```sql
NULLIF(log_data->>'logged_date','')::date            -- in VALUES
...
logged_date = EXCLUDED.logged_date                    -- in DO UPDATE SET
```
`log_data->>'key'` returns **NULL for an absent key AND for a JSON null**, and `NULLIF(value,'')` maps an **empty string** to NULL too. So today **absent OR empty → NULL**, and `DO UPDATE SET logged_date = EXCLUDED.logged_date` writes that NULL → **any caller that omits a field wipes it.** (The `.upsert()` bulk path is different — it only sends the columns it names, so it's already safe; Phase 5 does **not** touch it.)

**The fix — distinguish absent from empty using the jsonb key-exists operator `?`.** Only the `DO UPDATE SET` for each preservable field changes; the INSERT/VALUES stay as-is (a brand-new row has nothing to preserve, so absent → NULL is already correct there):
```sql
-- Preserve on absent key; clear on present-but-empty; set on present value.
logged_date = CASE WHEN log_data ? 'logged_date'
                   THEN EXCLUDED.logged_date          -- present: NULLIF gives value, or NULL for ''
                   ELSE status_logs.logged_date END   -- absent: keep what's stored
```
Apply the same `CASE WHEN log_data ? '<field>' THEN EXCLUDED.<field> ELSE status_logs.<field> END` to the **preservable nullable fields**: `planned_start_date`, `planned_end_date`, `logged_date`, `actual_start_date`. **Decide in-phase** whether to extend it to `status_color` (NOT NULL, `COALESCE(...,'')` default — a future caller omitting it would blank the color; defensively guarding it is reasonable but optional). **Do NOT** wrap `client_timestamp` (it's the LWW guard and is always passed) or `temporal_state`/`track` (NOT NULL, always passed, sensible COALESCE defaults).

## ⚠ The load-bearing risk — two callers TODAY rely on "absent = clear" (reconcile these, or you'll silently break clears)
Flipping absent→preserve changes behavior for any caller that clears a field by **omitting** it. There are two, and **the Vitest suite will NOT catch a regression here** (SQL isn't exercised in Vitest — the Phase-3 explicit-clear test only asserts the payload key is absent, not the DB result). Read and reconcile:

1. **`useUpdateStatus` drops a null `logged_date`** (`useProjectQueries.ts`: `if (safeData.logged_date === null) delete safeData.logged_date;`). So an explicit clear (`loggedDate: ''` → `null` → **deleted** → absent key) clears **only because absent=clear today**. After Phase 5, absent=preserve → that clear would **stop working**. **Reconcile:** for a genuine clear, send an **empty string `''`** (present-but-empty) instead of dropping the key — so the RPC's "present empty → NULL" path fires. Confirm the Phase-3 explicit-clear scenario still clears end-to-end (and update its test's intent if the payload shape changes: `''` present, not key-absent).
2. **`clearStatusMutation` / `useClearStatus`** sends a minimal payload (`unit_id, track, activity_id, temporal_state:'none', client_timestamp`) that **omits every date field**. Today clearing to Not Started **wipes** those dates (absent→NULL); after Phase 5 they'd be **preserved** on the existing row. **Decide the intended semantic:** should clearing a slot to 'none' blank its dates (then send explicit `''` for the ones it should clear) or keep them? The plan scopes clear-status as "confirm Phase 5's change doesn't break it," so at minimum make the outcome **intentional and documented**, not an accident of the RPC flip.

**Also confirm (should be safe, verify anyway):** the auto-advance `nextLogData` (`commitUnitActivity`) omits `logged_date`/`actual_start_date`, but it only ever targets a **`none`** slot (Phase 1), so there's no prior date to preserve — NULL either way. The Phase-1/2/3 primary writes pass **explicit** values for all four dates (Phase 3 preserves them in the payload), so they're unaffected by absent=preserve.

## Required reading (fresh — do not trust line numbers)
- `Status-Sequencing-Data-Integrity-Plan.md` → **Phase 5**, **Data model** (absent-key vs empty-string), **Hard guardrails** (RPC posture), **Out of scope** (clear-status path).
- `supabase/migrations/20260711_status_logs_actual_start.sql` — copy this body verbatim; it already documents the SECURITY INVOKER / search_path / LWW / grants invariants to preserve.
- `src/hooks/useProjectQueries.ts` — `useUpdateStatus`, `useClearStatus`, `useBulkUpdateStatus`.
- `src/hooks/useMapActions.ts` — `commitUnitActivity` (`newLogData` explicit values; `nextLogData` omissions), `handleApplyBulkStatus` (bulk `.upsert`, not the RPC).
- `.agent/skills/create-migration` — the migration authoring workflow (new dated file, idempotent, types synced).

## Scope (build only this)
1. **NEW dated migration** (`create-migration` skill) that `CREATE OR REPLACE`s `upsert_status_log`: copy the current body verbatim, change **only** the `DO UPDATE SET` expressions to `CASE WHEN log_data ? '<field>' THEN EXCLUDED.<field> ELSE status_logs.<field> END` for the four date fields (+ status_color if you decide to). Keep everything else byte-for-byte: SECURITY INVOKER, `SET search_path`, the INSERT/VALUES with `NULLIF(...,'')`, the LWW `WHERE EXCLUDED.client_timestamp > ... OR ... IS NULL`, `ON CONFLICT (unit_id, activity_id)`, `RETURNING * INTO result`, the null-result re-select, and the implicit grants (`CREATE OR REPLACE` preserves them; do NOT re-grant `anon`). Idempotent + wrapped in the runner's transaction.
2. **Caller reconciliation** (the section above): make `useUpdateStatus`'s explicit clear send `''` (present-empty) not absent; decide + document `clearStatusMutation`'s date semantics. Update/extend the Phase-3 explicit-clear test to match the new payload contract; add a caller-contract assertion where feasible.
3. **Types:** `upsert_status_log`'s signature is unchanged (`jsonb → status_logs`), so `database.types.ts` likely needs no edit — confirm it already reflects the function; regenerate/adjust only if drifted (§4).
4. **Do NOT** change Phases 1–4 logic, the bulk `.upsert` path, RLS/grants, the slot key, or the LWW guard.

## Preserve / guardrails (AGENTS.md — do not violate)
- `upsert_status_log` stays **SECURITY INVOKER**, same `search_path`, same grants — **anon is never granted EXECUTE** (re-granting it re-opens unauthenticated status writes). Same LWW `client_timestamp` guard. Same `ON CONFLICT (unit_id, activity_id)`. Never `.insert()` for `status_logs`.
- **Never edit an applied migration in place** — new dated file only. Migration lives in `sitepulse-next/supabase/migrations/`; update the root `README.md` migration table.
- SQL isn't unit-testable in Vitest — rely on a careful review, the migration's idempotency, and caller-contract tests where feasible. **A manual re-test of the Phase 1–3 scenarios must still hold with the new RPC.**

## Exit criteria (present + STOP for sign-off; then `verify-feature`)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` / `run test` / `run build` all green (any caller-reconciliation code changes covered by tests).
- **Present the full migration SQL + the caller-reconciliation findings/decisions, and STOP.** Do NOT `apply_migration` / touch prod data until the owner says "Approved to apply." ⛔ DB migration / DDL gate. ⛔ RLS/grants unchanged.
- After owner approval to apply: apply the migration to prod, manually re-verify the Phase 1–3 scenarios (never-downgrade, planned-date-edit preserves `logged_date`, explicit clear still clears) hold with the new RPC, and confirm the clear paths behave as decided.
- **This closes the workstream.** In the final write-up, also resolve the parked P2 recommendation: whether to add an AGENTS.md §2 note that the never-downgrade rule lives in one pure `planAutoAdvance` shared by single + bulk.

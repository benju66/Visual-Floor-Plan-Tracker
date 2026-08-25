-- ============================================================
-- upsert_status_log: extend PRESERVE-ON-ABSENT to temporal_state + track.
--
-- Closes the last two unguarded columns in the DO UPDATE SET clause. This is a
-- HARDENING change, not a bug fix for a live defect: 20260712_status_logs_
-- preserve_omitted_fields.sql left these two `= EXCLUDED.x` DELIBERATELY, on the
-- documented reasoning that they are NOT NULL columns "always passed by every
-- caller". That reasoning is still true of every caller today — this migration
-- changes NO current behavior. What it removes is the unenforced invariant.
--
-- Why remove it. The INSERT VALUES list defaults an absent key:
--     COALESCE(log_data->>'temporal_state', 'none')
--     COALESCE(log_data->>'track',          'Production')
-- so on a CONFLICT, a payload that omits temporal_state makes EXCLUDED.temporal_state
-- = 'none', and the unguarded `temporal_state = EXCLUDED.temporal_state` writes that
-- 'none' straight over a stored 'completed'. The location silently reverts to
-- not-started, with the LWW guard happily accepting it because the client_timestamp
-- is newer. Same shape for track ('Production').
--
-- Reproduced before writing this (against a temp-table replica of the clause, inside
-- a rolled-back transaction): seeded 'completed' + '#10b981' + a planned date, then
-- replayed the clause with a payload omitting all three. The two GUARDED columns
-- (status_color, planned_start_date) preserved correctly; temporal_state was wiped
-- to 'none'. The guard is the only thing separating the two outcomes.
--
-- That is the exact failure mode the Phase 5 migration was written to eliminate for
-- the other five columns, and this function is the single choke point every status
-- write in the product passes through — so the invariant is worth enforcing in the
-- database rather than in the discipline of every future caller.
--
-- Semantics, identical to the other five preservable columns:
--   * key ABSENT   ( log_data ? 'field' is false ) -> PRESERVE the stored value.
--   * key PRESENT, empty ('' or JSON null)         -> COALESCE default ('none' /
--                                                     'Production'), preserving the
--                                                     NOT NULL contract.
--   * key PRESENT, with a value                     -> SET that value.
--
-- NOT NULL safety: both branches are non-null by construction. The write branch is
-- EXCLUDED.x, which the VALUES list already wrapped in COALESCE(..., <default>); the
-- preserve branch is the existing non-null stored value. Mirrors how status_color
-- was handled in Phase 5.
--
-- Everything else is copied VERBATIM from 20260712_status_logs_preserve_omitted_fields.sql:
--   * Posture — (implicit-default) SECURITY INVOKER [no SECURITY DEFINER], same
--     SET search_path, same grants: CREATE OR REPLACE preserves the existing
--     postgres/authenticated/service_role EXECUTE grants; anon is NOT granted and is
--     NOT added here (AGENTS.md §2 RLS posture).
--   * The Last-Write-Wins client_timestamp guard (the WHERE clause) — unchanged.
--   * The slot key ON CONFLICT (unit_id, activity_id) — unchanged.
--   * The INSERT / VALUES list — a brand-new row has nothing to preserve, so the
--     COALESCE defaults are already correct on INSERT; left byte-for-byte.
--   * The null-result re-select after an LWW rejection — unchanged.
--
-- No caller reconciliation is needed: every current caller sends both keys, so every
-- current write takes the PRESENT branch and behaves exactly as before.
--
-- IDEMPOTENT / re-runnable: CREATE OR REPLACE FUNCTION.
-- ATOMIC: the Supabase migration runner wraps this file in one transaction.
-- NON-DESTRUCTIVE: touches no existing row — it only changes how FUTURE writes merge.
-- ============================================================

CREATE OR REPLACE FUNCTION upsert_status_log(log_data jsonb)
RETURNS status_logs
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  result status_logs;
BEGIN
  INSERT INTO status_logs (
    unit_id, activity_id, status_color, temporal_state, track,
    planned_start_date, planned_end_date, logged_date, actual_start_date, client_timestamp
  ) VALUES (
    (log_data->>'unit_id')::uuid,
    (log_data->>'activity_id')::uuid,
    COALESCE(log_data->>'status_color', ''),
    COALESCE(log_data->>'temporal_state', 'none'),
    COALESCE(log_data->>'track', 'Production'),
    NULLIF(log_data->>'planned_start_date','')::date,
    NULLIF(log_data->>'planned_end_date','')::date,
    NULLIF(log_data->>'logged_date','')::date,
    NULLIF(log_data->>'actual_start_date','')::date,
    NULLIF(log_data->>'client_timestamp','')::timestamptz
  )
  ON CONFLICT (unit_id, activity_id) DO UPDATE SET
    -- PRESERVE-ON-ABSENT: keep the stored value when the caller OMITS the key; write
    -- EXCLUDED (the value, or the COALESCE default for a present '' / null) only when
    -- the key is PRESENT. All seven preservable columns now follow one rule.
    status_color       = CASE WHEN log_data ? 'status_color'
                              THEN EXCLUDED.status_color
                              ELSE status_logs.status_color END,
    -- NEW (this migration): temporal_state + track join the guarded set. Previously
    -- `= EXCLUDED.x`, which turned an omitted key into a silent reset to the COALESCE
    -- default ('none' / 'Production') over whatever was stored.
    temporal_state     = CASE WHEN log_data ? 'temporal_state'
                              THEN EXCLUDED.temporal_state
                              ELSE status_logs.temporal_state END,
    track              = CASE WHEN log_data ? 'track'
                              THEN EXCLUDED.track
                              ELSE status_logs.track END,
    planned_start_date = CASE WHEN log_data ? 'planned_start_date'
                              THEN EXCLUDED.planned_start_date
                              ELSE status_logs.planned_start_date END,
    planned_end_date   = CASE WHEN log_data ? 'planned_end_date'
                              THEN EXCLUDED.planned_end_date
                              ELSE status_logs.planned_end_date END,
    logged_date        = CASE WHEN log_data ? 'logged_date'
                              THEN EXCLUDED.logged_date
                              ELSE status_logs.logged_date END,
    actual_start_date  = CASE WHEN log_data ? 'actual_start_date'
                              THEN EXCLUDED.actual_start_date
                              ELSE status_logs.actual_start_date END,
    client_timestamp   = EXCLUDED.client_timestamp
  WHERE EXCLUDED.client_timestamp > status_logs.client_timestamp
     OR status_logs.client_timestamp IS NULL
  RETURNING * INTO result;

  -- If the LWW guard rejected the update (stale timestamp), RETURNING yields
  -- 0 rows → result is NULL. Return the existing (newer) row so the client
  -- always gets data.
  IF result IS NULL THEN
    SELECT * INTO result FROM status_logs
    WHERE unit_id     = (log_data->>'unit_id')::uuid
      AND activity_id = (log_data->>'activity_id')::uuid;
  END IF;

  RETURN result;
END;
$function$;

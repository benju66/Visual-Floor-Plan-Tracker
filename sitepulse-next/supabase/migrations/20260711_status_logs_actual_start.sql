-- ============================================================
-- Actual-Dates Capture, Phase 1 — status_logs.actual_start_date
--
-- Adds a nullable ACTUAL-START date to status_logs so the team can TYPE the real
-- start date at the computer (the field "ongoing" tap is unreliable — supers
-- batch-log; subs move unseen). Entered value becomes the trusted source for the
-- per-activity actuals/variances; it does NOT replace planned dates or logged_date
-- (logged_date remains the actual COMPLETION).
--
-- Scope: ADD one nullable column + extend upsert_status_log to carry it. That is
-- all. NOT touched (by design):
--   * status_logs slot key — still UNIQUE(unit_id, activity_id).
--   * upsert_status_log posture — stays SECURITY INVOKER (no SECURITY DEFINER),
--     same search_path, same Last-Write-Wins client_timestamp guard, same grants
--     (CREATE OR REPLACE preserves postgres/authenticated/service_role EXECUTE;
--     anon is NOT granted and is not added here — AGENTS.md §2 RLS posture).
--   * RLS — the existing status_logs membership policies already govern the new
--     column (no column-level policy in this schema); no policy change.
--   * status_audit_log / fn_status_log_audit trigger — its INSERT uses an EXPLICIT
--     column list, so adding a status_logs column does NOT break it. Recording the
--     actual-start in the audit timeline is DEFERRED to the future master-schedule
--     phase (display reads the current status_logs row).
--
-- IDEMPOTENT / re-runnable: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
-- ATOMIC: the Supabase migration runner wraps this file in one transaction.
-- ============================================================

-- ------------------------------------------------------------
-- STEP 1: the column (additive, nullable — no backfill, no default).
-- ------------------------------------------------------------
ALTER TABLE status_logs
  ADD COLUMN IF NOT EXISTS actual_start_date DATE;

COMMENT ON COLUMN status_logs.actual_start_date IS
  'Manually-entered actual start date (Actual-Dates Capture P1). Nullable; when set, '
  'it is the trusted source for the per-activity actual-duration / start-variance. '
  'Distinct from logged_date (actual completion).';

-- ------------------------------------------------------------
-- STEP 2: upsert_status_log — carry actual_start_date through.
--   Current body copied VERBATIM (SECURITY INVOKER, search_path, LWW guard,
--   ON CONFLICT (unit_id, activity_id)); the ONLY change is actual_start_date
--   added to the INSERT column list, the VALUES list, and the DO UPDATE SET.
--   Parsed date-only via NULLIF(...,'')::date, so an empty string / absent key
--   CLEARS it (client passes '' to clear).
-- ------------------------------------------------------------
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
    status_color       = EXCLUDED.status_color,
    temporal_state     = EXCLUDED.temporal_state,
    track              = EXCLUDED.track,
    planned_start_date = EXCLUDED.planned_start_date,
    planned_end_date   = EXCLUDED.planned_end_date,
    logged_date        = EXCLUDED.logged_date,
    actual_start_date  = EXCLUDED.actual_start_date,
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

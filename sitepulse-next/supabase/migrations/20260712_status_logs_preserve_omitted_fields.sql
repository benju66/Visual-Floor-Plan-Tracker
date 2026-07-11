-- ============================================================
-- Status Sequencing & Auto-Advance Data-Integrity Fix, Phase 5 (FINAL) —
-- upsert_status_log PRESERVES an omitted field instead of wiping it.
--
-- The database backstop for the whole workstream. Until now the RPC rebuilt EVERY
-- column from its JSON payload, so ANY caller that left a field OUT of the payload
-- silently NULLed that column (absent OR empty both resolved to NULL via
-- NULLIF(...,''), and DO UPDATE SET x = EXCLUDED.x then wrote that NULL). Phases 1-4
-- fixed the APP so it stops omitting fields it means to keep; this makes the DB
-- itself safe for every current AND future caller, by distinguishing an ABSENT JSON
-- key from a PRESENT-but-empty one:
--
--   * key ABSENT   ( log_data ? 'field'  is false ) -> PRESERVE the stored value.
--   * key PRESENT, empty ('' or JSON null)          -> CLEAR to NULL (explicit clear).
--   * key PRESENT, with a value                      -> SET that value.
--
-- The jsonb key-exists operator `?` is the whole mechanism: it is TRUE for a present
-- key even when its value is JSON null, and FALSE only when the key is truly absent —
-- so "clear" (send the key as null/'') and "preserve" (omit the key) are now distinct.
--
-- ONLY the DO UPDATE SET expressions change, and only for the preservable fields:
--   planned_start_date, planned_end_date, logged_date, actual_start_date, status_color.
-- Everything else is copied VERBATIM from 20260711_status_logs_actual_start.sql:
--   * Posture — (implicit-default) SECURITY INVOKER [no SECURITY DEFINER], same
--     SET search_path, same grants: CREATE OR REPLACE preserves the existing
--     postgres/authenticated/service_role EXECUTE grants; anon is NOT granted and is
--     NOT added here (AGENTS.md §2 RLS posture — re-granting anon would re-open
--     unauthenticated status writes).
--   * The Last-Write-Wins client_timestamp guard (the WHERE clause) — unchanged.
--   * The slot key ON CONFLICT (unit_id, activity_id) — unchanged.
--   * The INSERT / VALUES list with NULLIF(...,'') — a brand-new row has nothing to
--     preserve, so absent -> NULL is already correct on INSERT; left byte-for-byte.
--   * temporal_state / track / client_timestamp in DO UPDATE SET — always passed by
--     every caller (NOT NULL columns with sensible COALESCE defaults), so they stay
--     `= EXCLUDED.x` and are deliberately NOT wrapped.
--   * The null-result re-select after an LWW rejection — unchanged.
--
-- Caller reconciliation (shipped in the SAME change set so no existing clear breaks):
--   * useUpdateStatus no longer DROPS a null logged_date — it sends it PRESENT (null),
--     so an explicit "clear the completion date" still clears (present -> NULL) instead
--     of becoming absent (which would now preserve). commitUnitActivity always sends
--     every field explicitly, so the single-write behavior is unchanged.
--   * useClearStatus now sends explicit-empty status_color + all four dates, so
--     "clear to Not Started" stays a FULL reset (a 'none' slot must not keep a stale
--     color or planned/completion/actual-start date) rather than relying on the old
--     absent=clear accident.
--   * the auto-advance side-write (nextLogData) now sends explicit-null logged_date +
--     actual_start_date, so a freshly teed-up 'planned' slot lands clean regardless of
--     any stale value on the row it hits.
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
    -- PRESERVE-ON-ABSENT (Phase 5): keep the stored value when the caller OMITS the
    -- key; write EXCLUDED (the value, or NULL for a present '' / null) only when the
    -- key is PRESENT. status_color stays NOT NULL: EXCLUDED is COALESCE(...,'') and the
    -- preserve branch is the existing non-null value.
    status_color       = CASE WHEN log_data ? 'status_color'
                              THEN EXCLUDED.status_color
                              ELSE status_logs.status_color END,
    temporal_state     = EXCLUDED.temporal_state,
    track              = EXCLUDED.track,
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

-- ============================================================
-- Terminology Sweep follow-up: rename the LAST data-layer remnant
--   status_audit_log.milestone  ->  status_audit_log.activity_name
-- and re-key the audit trigger to write the new column name.
--
-- Background: the milestone->activity code/UI sweep (20260701_activity_model +
-- the code sweep) deliberately left schema alone, so this one column — the
-- point-in-time activity-NAME snapshot the audit trigger writes on every status
-- change — kept its legacy name. This migration finishes that rename.
--
-- SAFETY:
--  * status_audit_log is APPEND-ONLY history. This is a metadata-only column
--    RENAME (instant, no row contents change) plus a trigger-function re-key.
--  * The two indexes on this table key on (unit_id, track) and
--    (unit_id, temporal_state, logged_date) — neither references this column,
--    so the rename leaves them intact.
--  * fn_status_log_audit is the ONLY DB object that references this column
--    (verified: no other function, no view). status_logs / upsert_status_log /
--    RLS / the offline queue are untouched.
--  * Apply in lockstep with the matching frontend deploy: the useUnitHistory /
--    useStatusHistory read hooks select `activity_name` after this.
--
-- Guarded + idempotent; safe to re-run.
-- ============================================================

-- STEP 1: Rename the column. Guarded so a re-run (activity_name already present)
-- is a clean no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='status_audit_log'
                AND column_name='milestone')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='status_audit_log'
                AND column_name='activity_name') THEN
    ALTER TABLE status_audit_log RENAME COLUMN milestone TO activity_name;
  END IF;
END $$;

-- STEP 2: Re-key the audit trigger fn to write `activity_name` (was `milestone`).
-- Body is otherwise byte-for-byte the current 20260701_activity_model.sql
-- version (verified against prod, no drift): it looks up the activity's CURRENT
-- name from `activities`, and keeps the SECURITY DEFINER + search_path posture
-- unchanged.
CREATE OR REPLACE FUNCTION fn_status_log_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_name text;
BEGIN
  SELECT name INTO v_name FROM activities WHERE id = NEW.activity_id;
  INSERT INTO status_audit_log (
    unit_id, activity_id, activity_name, status_color, temporal_state, track,
    planned_start_date, planned_end_date, logged_date,
    client_timestamp, changed_at
  ) VALUES (
    NEW.unit_id, NEW.activity_id, COALESCE(v_name, ''),
    NEW.status_color, NEW.temporal_state, NEW.track,
    NEW.planned_start_date, NEW.planned_end_date, NEW.logged_date,
    NEW.client_timestamp::timestamptz,
    NOW()
  );
  RETURN NEW;
END;
$function$;

-- Trigger definition unchanged (AFTER INSERT OR UPDATE); re-assert idempotently.
DROP TRIGGER IF EXISTS trg_status_log_audit ON status_logs;
CREATE TRIGGER trg_status_log_audit
  AFTER INSERT OR UPDATE ON status_logs
  FOR EACH ROW EXECUTE FUNCTION fn_status_log_audit();

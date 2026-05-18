-- ============================================================
-- Migration: Status Logs Idempotency & Audit Trail
-- Purpose: Eliminate offline queue sync data bloat by making
--          status_logs slot-unique (one row per unit/track/milestone)
--          and creating an append-only audit log for full history.
--
-- IDEMPOTENT: Safe to re-run. Every step is guarded.
-- ============================================================

-- ============================================================
-- STEP 1: Deduplicate existing rows — keep latest per slot
-- CAUTION: This is destructive on first run. Back up status_logs first.
-- On re-run: constraint already enforces uniqueness, so 0 rows deleted.
-- ============================================================
DELETE FROM status_logs
WHERE id NOT IN (
  SELECT DISTINCT ON (unit_id, track, milestone) id
  FROM status_logs
  ORDER BY unit_id, track, milestone,
           COALESCE(client_timestamp::timestamptz, created_at::timestamptz) DESC NULLS LAST
);

-- ============================================================
-- STEP 2: Add slot-unique constraint (guarded)
-- Ensures only one current-state row per (unit_id, track, milestone).
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'status_logs_slot_unique'
  ) THEN
    ALTER TABLE status_logs
      ADD CONSTRAINT status_logs_slot_unique
      UNIQUE (unit_id, track, milestone);
  END IF;
END
$$;

-- ============================================================
-- STEP 3: Create status_audit_log (append-only history table)
-- Every state change is recorded here via trigger.
-- user_id is nullable now; will auto-populate once client
-- passes authenticated user through the RPC payload.
-- ============================================================
CREATE TABLE IF NOT EXISTS status_audit_log (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id            UUID REFERENCES units(id) ON DELETE CASCADE,
  milestone          TEXT NOT NULL,
  status_color       TEXT NOT NULL DEFAULT '',
  temporal_state     TEXT NOT NULL DEFAULT 'none',
  track              TEXT NOT NULL DEFAULT 'Production',
  planned_start_date DATE,
  planned_end_date   DATE,
  logged_date        DATE,
  client_timestamp   TIMESTAMPTZ,
  user_id            UUID,
  changed_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Index for useUnitHistory queries (full timeline per unit)
CREATE INDEX IF NOT EXISTS idx_audit_log_unit_track
  ON status_audit_log (unit_id, track);

-- Partial index for useStatusHistory queries (completed milestones only)
CREATE INDEX IF NOT EXISTS idx_audit_log_completed
  ON status_audit_log (unit_id, temporal_state, logged_date)
  WHERE temporal_state = 'completed' AND logged_date IS NOT NULL;

-- ============================================================
-- STEP 3b: RLS for status_audit_log (guarded)
-- Must mirror the status_logs policy so authenticated users
-- can read audit history. Writes are trigger-only (SECURITY DEFINER).
-- ============================================================
ALTER TABLE status_audit_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'status_audit_log'
      AND policyname = 'Authenticated users can read audit logs'
  ) THEN
    CREATE POLICY "Authenticated users can read audit logs"
      ON status_audit_log FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END
$$;

-- ============================================================
-- STEP 4: Trigger — auto-append to audit log on every write
-- Fires on both INSERT (first slot write) and UPDATE (upserts).
-- NOTE: auth.uid() is NOT available inside SECURITY DEFINER
-- trigger functions invoked via RPC. user_id left NULL for now.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_status_log_audit()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO status_audit_log (
    unit_id, milestone, status_color, temporal_state, track,
    planned_start_date, planned_end_date, logged_date,
    client_timestamp, changed_at
  ) VALUES (
    NEW.unit_id, NEW.milestone, NEW.status_color, NEW.temporal_state, NEW.track,
    NEW.planned_start_date, NEW.planned_end_date, NEW.logged_date,
    NEW.client_timestamp::timestamptz,
    NOW()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop-and-recreate trigger (triggers don't support CREATE OR REPLACE)
DROP TRIGGER IF EXISTS trg_status_log_audit ON status_logs;
CREATE TRIGGER trg_status_log_audit
  AFTER INSERT OR UPDATE ON status_logs
  FOR EACH ROW EXECUTE FUNCTION fn_status_log_audit();

-- ============================================================
-- STEP 5: Upsert RPC with Last-Write-Wins timestamp guard
-- - First write to a slot: INSERT succeeds normally.
-- - Re-sync of same event: ON CONFLICT fires, LWW guard
--   rejects stale timestamps, returns existing row.
-- - Newer update: ON CONFLICT fires, row updated.
-- ============================================================
CREATE OR REPLACE FUNCTION upsert_status_log(log_data jsonb)
RETURNS status_logs AS $$
DECLARE
  result status_logs;
BEGIN
  INSERT INTO status_logs (
    unit_id, milestone, status_color, temporal_state, track,
    planned_start_date, planned_end_date, logged_date, client_timestamp
  ) VALUES (
    (log_data->>'unit_id')::uuid,
    (log_data->>'milestone'),
    COALESCE(log_data->>'status_color', ''),
    COALESCE(log_data->>'temporal_state', 'none'),
    COALESCE(log_data->>'track', 'Production'),
    NULLIF(log_data->>'planned_start_date','')::date,
    NULLIF(log_data->>'planned_end_date','')::date,
    NULLIF(log_data->>'logged_date','')::date,
    NULLIF(log_data->>'client_timestamp','')::timestamptz
  )
  ON CONFLICT (unit_id, track, milestone) DO UPDATE SET
    status_color       = EXCLUDED.status_color,
    temporal_state     = EXCLUDED.temporal_state,
    planned_start_date = EXCLUDED.planned_start_date,
    planned_end_date   = EXCLUDED.planned_end_date,
    logged_date        = EXCLUDED.logged_date,
    client_timestamp   = EXCLUDED.client_timestamp
  WHERE EXCLUDED.client_timestamp > status_logs.client_timestamp
     OR status_logs.client_timestamp IS NULL
  RETURNING * INTO result;

  -- If LWW guard rejected the update (stale timestamp),
  -- RETURNING yields 0 rows → result is NULL.
  -- Return the existing (newer) row so client always gets data.
  IF result IS NULL THEN
    SELECT * INTO result FROM status_logs
    WHERE unit_id = (log_data->>'unit_id')::uuid
      AND track = COALESCE(log_data->>'track', 'Production')
      AND milestone = (log_data->>'milestone');
  END IF;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

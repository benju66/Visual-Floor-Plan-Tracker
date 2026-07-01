-- ============================================================
-- Migration: Activity model — rename milestones→activities, stable IDs, type flag
--            (Scheduling Foundation, Slice A, Phase 1 / 1a)
--
-- WHAT & WHY (plain English):
--   Today a location's progress row (status_logs) is keyed to a milestone's
--   NAME (a mutable TEXT string). Rename the milestone and its history orphans.
--   This migration fixes that fragility: it renames "milestones" to
--   "activities" everywhere (schema included), and RE-KEYS progress + history
--   from the mutable name to the activity's STABLE id. It also adds a `type`
--   flag distinguishing a durational `task` from a zero-duration `milestone`
--   marker. Behavior is otherwise identical — this changes NAMES + KEYS, not
--   features. It is the keystone of Slice A.
--
--   See: Notes/plans/Scheduling-Foundation-Slice-A-Plan.md (Phase 1, Data model,
--        Hard guardrails),
--        Notes/handoff/2026-07-01 - Scheduling Foundation Phase 1 Kickoff.md.
--
-- ⚠️ DESTRUCTIVE (rename + re-key). Take a backup / confirm a point-in-time
--    recovery window before applying. The name→id conversions for status_logs
--    and status_audit_log were dry-run against prod pmccdxmuszuykawvlphj on
--    2026-07-01 and are 100% lossless:
--      * status_logs:      2301/2301 rows map to an activity by
--                          (project_id, track, name); 0 unmatched; 0 collisions
--                          on the new (unit_id, activity_id) slot key.
--      * status_audit_log: 1799/1799 rows map; 0 unmatched.
--      * project_milestones: (project_id, track, name) is UNIQUE (the match key);
--                          (project_id, name) alone is NOT (1 dup) — hence the
--                          conversion joins on track+name, never name alone.
--      * sheets.milestone_schedules: 0 populated rows (nothing to convert).
--
-- INVARIANTS PRESERVED (AGENTS.md §2):
--   * status_logs stays slot-unique & upsert-only. The slot key changes from
--     (unit_id, track, milestone-name) to (unit_id, activity_id); the
--     upsert_status_log RPC keeps SECURITY INVOKER, its Last-Write-Wins
--     client_timestamp guard, its search_path, and its existing grants
--     (postgres/authenticated/service_role — NEVER anon). No plain INSERT path
--     is introduced.
--   * status_audit_log stays append-only, trigger-written, SECURITY DEFINER.
--     It gains activity_id (the stable link) but KEEPS `milestone` as a
--     point-in-time NAME SNAPSHOT so history survives a later activity delete
--     (activity_id → NULL via ON DELETE SET NULL, name text remains). History
--     reads keep working unchanged.
--
-- IDEMPOTENT / re-runnable: every step is guarded (rename only if the old name
--   still exists; backfill only NULL keys; DROP ... IF EXISTS; guarded
--   constraints/policies), so a partial re-run converges without error.
--
-- ATOMIC: the Supabase migration runner wraps this file in a single
--   transaction (matching every other migration in this repo — no explicit
--   BEGIN/COMMIT), so any failure rolls the whole re-key back.
-- ============================================================

-- ============================================================
-- STEP 1: Rename project_milestones → activities (+ its type column,
--          pkey, index, FK, and RLS policy labels).
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='project_milestones')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='activities') THEN
    ALTER TABLE project_milestones RENAME TO activities;
  END IF;
END $$;

-- type flag: durational 'task' vs zero-duration 'milestone' marker.
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'task';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='activities_type_check') THEN
    ALTER TABLE activities
      ADD CONSTRAINT activities_type_check CHECK (type IN ('task','milestone'));
  END IF;
END $$;

-- Cosmetic catalog renames (metadata-only; no data touched) so nothing on the
-- activities table still reads "milestone".
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='project_milestones_pkey') THEN
    ALTER TABLE activities RENAME CONSTRAINT project_milestones_pkey TO activities_pkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='project_milestones_project_id_fkey') THEN
    ALTER TABLE activities RENAME CONSTRAINT project_milestones_project_id_fkey TO activities_project_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relkind='i' AND relname='idx_project_milestones_project_id') THEN
    ALTER INDEX idx_project_milestones_project_id RENAME TO idx_activities_project_id;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='activities' AND policyname='Users can view assigned milestones') THEN
    ALTER POLICY "Users can view assigned milestones" ON activities RENAME TO "Users can view assigned activities";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='activities' AND policyname='Privileged members can insert milestones') THEN
    ALTER POLICY "Privileged members can insert milestones" ON activities RENAME TO "Privileged members can insert activities";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='activities' AND policyname='Privileged members can update milestones') THEN
    ALTER POLICY "Privileged members can update milestones" ON activities RENAME TO "Privileged members can update activities";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='activities' AND policyname='Privileged members can delete milestones') THEN
    ALTER POLICY "Privileged members can delete milestones" ON activities RENAME TO "Privileged members can delete activities";
  END IF;
END $$;

-- ============================================================
-- STEP 2: status_logs — re-key from milestone NAME to activity_id.
--   Add activity_id, backfill by (project_id, track, name), enforce NOT NULL,
--   add the FK, swap the slot-unique constraint to (unit_id, activity_id),
--   then drop the old milestone TEXT column.
-- ============================================================
ALTER TABLE status_logs
  ADD COLUMN IF NOT EXISTS activity_id UUID;

-- Suppress the audit trigger during the backfill UPDATE below — otherwise each
-- re-keyed row would fire AFTER UPDATE and append a spurious, migration-timestamped
-- "status changed" entry to status_audit_log (doubling every location's history).
-- STEP 4 drops + recreates the trigger (enabled), so this is scoped to the backfill.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgname='trg_status_log_audit' AND tgrelid='public.status_logs'::regclass) THEN
    ALTER TABLE status_logs DISABLE TRIGGER trg_status_log_audit;
  END IF;
END $$;

-- Backfill (only while the legacy name column still exists; only NULL keys).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='status_logs' AND column_name='milestone') THEN
    -- Match conditions on the UPDATE target (sl) live in WHERE, not in the FROM
    -- join's ON clause — Postgres forbids referencing the target table there.
    UPDATE status_logs sl
       SET activity_id = a.id
      FROM units u
      JOIN sheets s   ON s.id = u.sheet_id
      JOIN activities a ON a.project_id = s.project_id
     WHERE sl.unit_id     = u.id
       AND a.track        = sl.track
       AND a.name         = sl.milestone
       AND sl.activity_id IS NULL;
  END IF;
END $$;

-- Enforce NOT NULL once every row is mapped (verified 0 unmatched).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM status_logs WHERE activity_id IS NULL) THEN
    ALTER TABLE status_logs ALTER COLUMN activity_id SET NOT NULL;
  ELSE
    RAISE EXCEPTION 'status_logs has % rows with NULL activity_id after backfill — aborting re-key',
      (SELECT count(*) FROM status_logs WHERE activity_id IS NULL);
  END IF;
END $$;

-- FK to activities. CASCADE: deleting an activity removes its current-state
-- rows (meaningless without the activity); history is preserved in the audit
-- log (see STEP 3). Mirrors the applicability-overrides ON DELETE CASCADE.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='status_logs_activity_id_fkey') THEN
    ALTER TABLE status_logs
      ADD CONSTRAINT status_logs_activity_id_fkey
      FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Swap the slot-unique constraint: (unit_id, track, milestone) → (unit_id, activity_id).
-- Verified 0 collisions on the new key. track is retained as a denormalized
-- display/grouping column but no longer participates in the slot identity.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='status_logs_slot_unique') THEN
    -- only drop the OLD (3-column) form; leave a correct one in place on re-run
    IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='status_logs_slot_unique')
       = 'UNIQUE (unit_id, track, milestone)' THEN
      ALTER TABLE status_logs DROP CONSTRAINT status_logs_slot_unique;
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='status_logs_slot_unique') THEN
    ALTER TABLE status_logs
      ADD CONSTRAINT status_logs_slot_unique UNIQUE (unit_id, activity_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_status_logs_activity ON status_logs (activity_id);

-- ============================================================
-- STEP 3: status_audit_log — add the stable activity_id link, backfill it, and
--   KEEP `milestone` as a point-in-time name snapshot (append-only history).
-- ============================================================
ALTER TABLE status_audit_log
  ADD COLUMN IF NOT EXISTS activity_id UUID;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='status_audit_log' AND column_name='milestone') THEN
    -- Match conditions on the UPDATE target (al) live in WHERE, not the FROM join ON.
    UPDATE status_audit_log al
       SET activity_id = a.id
      FROM units u
      JOIN sheets s   ON s.id = u.sheet_id
      JOIN activities a ON a.project_id = s.project_id
     WHERE al.unit_id     = u.id
       AND a.track        = al.track
       AND a.name         = al.milestone
       AND al.activity_id IS NULL;
  END IF;
END $$;

-- Nullable + ON DELETE SET NULL: history rows survive a later activity delete
-- (the FK nulls, the `milestone` name snapshot remains readable).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='status_audit_log_activity_id_fkey') THEN
    ALTER TABLE status_audit_log
      ADD CONSTRAINT status_audit_log_activity_id_fkey
      FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_log_activity ON status_audit_log (activity_id);

-- ============================================================
-- STEP 4: Rewrite the audit trigger fn to write activity_id + a name snapshot
--   looked up from activities (status_logs no longer carries the name).
--   Keeps SECURITY DEFINER + search_path (posture unchanged).
-- ============================================================
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
    unit_id, activity_id, milestone, status_color, temporal_state, track,
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

-- ============================================================
-- STEP 5: Drop the legacy status_logs.milestone name column (now re-keyed).
-- ============================================================
ALTER TABLE status_logs DROP COLUMN IF EXISTS milestone;

-- ============================================================
-- STEP 6: Rewrite upsert_status_log to key on activity_id.
--   Unchanged: SECURITY INVOKER (no SECURITY DEFINER), search_path, the LWW
--   client_timestamp guard, upsert-only semantics, and existing grants
--   (CREATE OR REPLACE preserves the postgres/authenticated/service_role
--   EXECUTE grants — anon is NOT granted and is not added here).
--   Changed: the slot key milestone-name → activity_id.
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
    planned_start_date, planned_end_date, logged_date, client_timestamp
  ) VALUES (
    (log_data->>'unit_id')::uuid,
    (log_data->>'activity_id')::uuid,
    COALESCE(log_data->>'status_color', ''),
    COALESCE(log_data->>'temporal_state', 'none'),
    COALESCE(log_data->>'track', 'Production'),
    NULLIF(log_data->>'planned_start_date','')::date,
    NULLIF(log_data->>'planned_end_date','')::date,
    NULLIF(log_data->>'logged_date','')::date,
    NULLIF(log_data->>'client_timestamp','')::timestamptz
  )
  ON CONFLICT (unit_id, activity_id) DO UPDATE SET
    status_color       = EXCLUDED.status_color,
    temporal_state     = EXCLUDED.temporal_state,
    track              = EXCLUDED.track,
    planned_start_date = EXCLUDED.planned_start_date,
    planned_end_date   = EXCLUDED.planned_end_date,
    logged_date        = EXCLUDED.logged_date,
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

-- ============================================================
-- STEP 7: milestone_applicability_overrides → activity_applicability_overrides
--   (already id-keyed: rename table + milestone_id → activity_id + its FK,
--   unique constraint, and index; RLS policy labels don't mention milestone).
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='milestone_applicability_overrides')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='activity_applicability_overrides') THEN
    ALTER TABLE milestone_applicability_overrides RENAME TO activity_applicability_overrides;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='activity_applicability_overrides'
                AND column_name='milestone_id') THEN
    ALTER TABLE activity_applicability_overrides RENAME COLUMN milestone_id TO activity_id;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='milestone_applicability_overrides_pkey') THEN
    ALTER TABLE activity_applicability_overrides
      RENAME CONSTRAINT milestone_applicability_overrides_pkey TO activity_applicability_overrides_pkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='milestone_applicability_overrides_milestone_id_fkey') THEN
    ALTER TABLE activity_applicability_overrides
      RENAME CONSTRAINT milestone_applicability_overrides_milestone_id_fkey TO activity_applicability_overrides_activity_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='milestone_applicability_overrides_unit_id_fkey') THEN
    ALTER TABLE activity_applicability_overrides
      RENAME CONSTRAINT milestone_applicability_overrides_unit_id_fkey TO activity_applicability_overrides_unit_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='milestone_applicability_overrides_milestone_id_unit_id_key') THEN
    ALTER TABLE activity_applicability_overrides
      RENAME CONSTRAINT milestone_applicability_overrides_milestone_id_unit_id_key TO activity_applicability_overrides_activity_id_unit_id_key;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relkind='i' AND relname='idx_milestone_overrides_milestone') THEN
    ALTER INDEX idx_milestone_overrides_milestone RENAME TO idx_activity_overrides_activity;
  END IF;
END $$;

-- ============================================================
-- STEP 8: sheets.milestone_schedules → activity_schedules (empty column;
--   JSON keys become activity_ids once the feature is used again).
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='sheets' AND column_name='milestone_schedules')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='sheets' AND column_name='activity_schedules') THEN
    ALTER TABLE sheets RENAME COLUMN milestone_schedules TO activity_schedules;
  END IF;
END $$;

-- ============================================================
-- STEP 9: Documentation comments (idempotent; catalog metadata only).
-- ============================================================
COMMENT ON TABLE  activities IS
  'Project activity definitions (formerly project_milestones). Stable id is the '
  'identity that status_logs.activity_id / status_audit_log.activity_id key to, '
  'so renaming an activity never orphans its history.';
COMMENT ON COLUMN activities.type IS
  'Activity kind: ''task'' (durational work) or ''milestone'' (zero-duration marker). Default ''task''.';
COMMENT ON COLUMN status_logs.activity_id IS
  'FK → activities(id). The slot key is UNIQUE(unit_id, activity_id); track is '
  'retained as denormalized display/grouping only, not part of the slot identity.';
COMMENT ON COLUMN status_audit_log.activity_id IS
  'FK → activities(id), ON DELETE SET NULL. The `milestone` column is retained '
  'as the point-in-time activity NAME snapshot so append-only history survives a '
  'later activity delete.';
COMMENT ON COLUMN status_audit_log.milestone IS
  'Point-in-time activity name snapshot at write time (append-only history). See activity_id for the stable link.';
COMMENT ON TABLE  activity_applicability_overrides IS
  'Per-unit activity applicability overrides (formerly milestone_applicability_overrides). Keyed by activity_id.';
COMMENT ON COLUMN sheets.activity_schedules IS
  'JSONB planned-date map (formerly milestone_schedules). Keys are activity_ids. Default {}.';

-- ============================================================
-- VERIFICATION (run after applying; read-only — NOT part of the migration):
--
--   -- activities exists; project_milestones gone; type present:
--   SELECT count(*) FROM activities;                       -- expect 50
--   SELECT DISTINCT type FROM activities;                  -- expect 'task'
--
--   -- status_logs re-keyed, name column gone, slot on (unit_id, activity_id):
--   SELECT count(*) FROM status_logs WHERE activity_id IS NULL;  -- expect 0
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conname='status_logs_slot_unique';             -- UNIQUE (unit_id, activity_id)
--   SELECT 1 FROM information_schema.columns
--     WHERE table_name='status_logs' AND column_name='milestone';  -- 0 rows
--
--   -- audit re-keyed but name snapshot retained:
--   SELECT count(*) FILTER (WHERE activity_id IS NULL) AS unmatched,
--          count(*) FILTER (WHERE milestone IS NULL)   AS lost_names
--     FROM status_audit_log;                              -- 0, 0
--
--   -- RPC still SECURITY INVOKER, search_path set, anon NOT granted:
--   SELECT prosecdef, proconfig FROM pg_proc WHERE proname='upsert_status_log'; -- f, {search_path=...}
--
--   -- renames landed:
--   SELECT 1 FROM information_schema.columns
--     WHERE table_name='activity_applicability_overrides' AND column_name='activity_id'; -- 1 row
--   SELECT 1 FROM information_schema.columns
--     WHERE table_name='sheets' AND column_name='activity_schedules';           -- 1 row
-- ============================================================

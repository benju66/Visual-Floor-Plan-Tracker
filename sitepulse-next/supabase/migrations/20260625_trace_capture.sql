-- ============================================================
-- Migration: Trace Capture (AI Tracing Pipeline — Thin Capture, M1)
-- Purpose: Lay the no-regret DATA FOUNDATION so that every room a user
--          traces — by hand or (soon) with AI assistance — is captured as
--          model-ready training data WITH the human correction signal.
--          See: docs/ai-tracing-pipeline-plan.md (M1.1/M1.2/M1.3),
--               docs/ANNOTATION_SPEC.md (v1).
--
-- THREE additive changes, none of which alter existing app behavior:
--   STEP 1  units            — nullable provenance columns (per-location
--                              durable snapshot of where the geometry/label
--                              came from + the frozen machine proposal).
--   STEP 2  workbench_sheets — one nullable column `source_building`, the
--                              leakage-safe grouping tag for train/test folds.
--   STEP 3  trace_events     — NEW append-only log table (one row per traced
--                              action), the rich correction-signal stream.
--
-- ADDITIVE + SAFE. STEP 1/2 only ADD nullable columns (existing rows read
-- NULL, existing writes are unaffected). STEP 3 adds a brand-new isolated
-- table that nothing existing reads or writes. Mirrors the posture of
-- 20260623_project_contacts.sql.
--
-- IDEMPOTENT: safe to re-run. Every step is guarded (ADD COLUMN IF NOT EXISTS,
-- CREATE TABLE/INDEX IF NOT EXISTS, pg_policies existence checks).
-- ============================================================

-- ============================================================
-- STEP 1: units provenance columns (per AGENTS.md §4 — additive to units).
--   method          how the GEOMETRY originated:
--                   'manual'|'geometric'|'sam'|'vision_llm'|'imported'.
--   source          provenance of the FINAL accepted value:
--                   'human'|'ai_suggested'|'ai_accepted'|'ai_edited'.
--   model_version   id of the model/engine that produced a suggestion (NULL = manual).
--   suggested_polygon / suggested_label  the FROZEN original machine proposal,
--                   preserved even after a human edits the live values. This
--                   before-vs-final pair is the correction signal — it cannot
--                   be reconstructed after the fact, so it is captured at write.
--   review_status   'unreviewed' (proposal not yet confirmed) | 'confirmed'.
--   spec_version    annotation-spec version this row was traced under (see
--                   docs/ANNOTATION_SPEC.md). NULL on legacy rows.
-- Plain TEXT (no CHECK enums) — matches the location-taxonomy convention so a
-- new method/source never requires a migration. Allowed values are documented
-- in ANNOTATION_SPEC.md, not enforced in the DB.
-- ============================================================
ALTER TABLE units ADD COLUMN IF NOT EXISTS method            TEXT;
ALTER TABLE units ADD COLUMN IF NOT EXISTS source            TEXT;
ALTER TABLE units ADD COLUMN IF NOT EXISTS model_version     TEXT;
ALTER TABLE units ADD COLUMN IF NOT EXISTS suggested_polygon JSONB;
ALTER TABLE units ADD COLUMN IF NOT EXISTS suggested_label   JSONB;
ALTER TABLE units ADD COLUMN IF NOT EXISTS review_status     TEXT;
ALTER TABLE units ADD COLUMN IF NOT EXISTS spec_version      TEXT;

-- Review queue for machine proposals awaiting human sign-off. Partial index
-- keeps it tiny — it only holds rows actually pending review.
CREATE INDEX IF NOT EXISTS idx_units_review_pending
  ON units (sheet_id)
  WHERE review_status = 'unreviewed';

-- ============================================================
-- STEP 2: workbench_sheets.source_building — leakage-safe grouping tag.
--   Free-text id of the physical building/project a sheet came from. Sheets
--   from the same building share drafting style and MUST stay in the same
--   train/test fold; this is the grouping key. NULL = ungrouped (a one-off
--   sheet groups by its own id at export time). Optional field in the New
--   Drawing modal — never blocks an upload.
-- ============================================================
ALTER TABLE workbench_sheets ADD COLUMN IF NOT EXISTS source_building TEXT;

-- ============================================================
-- STEP 3: trace_events — append-only log of every traced action.
--   sheet_id     FK to sheets(id) ON DELETE CASCADE — scopes the row for RLS
--                and cleans up if a sheet is ever hard-deleted.
--   unit_id      FK to units(id) ON DELETE SET NULL — the log SURVIVES unit
--                deletion (a delete is itself a training-relevant event), so
--                we null the link rather than cascade away the history.
--   event_type   'create'|'update_geometry'|'update_label'|'delete'|
--                'accept_suggestion'|'reject_suggestion'.
--   method       origin of the geometry/label for this action (see STEP 1).
--   source       provenance of the value after this action (see STEP 1).
--   before_*/after_*  geometry + label snapshots bracketing the action; the
--                before-vs-after delta is the per-action correction signal.
--   model_version id of the model that produced a suggestion, if any.
--   duration_ms  wall-clock time the user spent on this action — the metric
--                that proves whether assist actually speeds tracing up.
--   group_key    leakage grouping snapshot at event time (source_building or
--                sheet id); denormalized so an exported event is self-contained.
--   spec_version annotation-spec version (NOT NULL, defaults to 'v1').
--   created_by   auth.uid() at write time (DEFAULT). Nullable.
--   created_at   write timestamp.
-- Plain TEXT for the categorical columns, same rationale as STEP 1.
-- ============================================================
CREATE TABLE IF NOT EXISTS trace_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id      UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  unit_id       UUID REFERENCES units(id) ON DELETE SET NULL,
  event_type    TEXT NOT NULL,
  method        TEXT,
  source        TEXT,
  before_polygon JSONB,
  after_polygon  JSONB,
  before_label   JSONB,
  after_label    JSONB,
  model_version TEXT,
  duration_ms   INTEGER,
  group_key     TEXT,
  spec_version  TEXT NOT NULL DEFAULT 'v1',
  created_by    UUID DEFAULT auth.uid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes: per-sheet replay, per-unit history, and chronological export.
CREATE INDEX IF NOT EXISTS idx_trace_events_sheet   ON trace_events (sheet_id);
CREATE INDEX IF NOT EXISTS idx_trace_events_unit    ON trace_events (unit_id);
CREATE INDEX IF NOT EXISTS idx_trace_events_created ON trace_events (created_at);

-- ============================================================
-- STEP 3 RLS: trace_events is APPEND-ONLY.
-- Scoped via the sheet → project → project_members hop (workbench sheets hang
-- off a project like any other sheet).
--   READ   = any authenticated member of the owning project.
--   INSERT = any authenticated member, and only as themselves
--            (created_by = auth.uid()) — the tracer logs their own actions.
--   UPDATE / DELETE = NO POLICY ON PURPOSE. With RLS enabled and no policy,
--            these are denied for all authenticated users, which is exactly
--            the append-only / immutable-audit guarantee. (The service role
--            bypasses RLS for any future maintenance.)
-- NEVER granted to `anon`. auth.uid() wrapped in a scalar sub-select per the
-- rls_perf init-plan optimization, matching project_contacts.
-- ============================================================
ALTER TABLE trace_events ENABLE ROW LEVEL SECURITY;

-- READ: any authenticated member of the project that owns the sheet
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'trace_events'
      AND policyname = 'Members can view trace_events'
  ) THEN
    CREATE POLICY "Members can view trace_events"
      ON trace_events FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM sheets s
          JOIN project_members pm ON pm.project_id = s.project_id
          WHERE s.id = trace_events.sheet_id
            AND pm.user_id = (SELECT auth.uid())
        )
      );
  END IF;
END
$$;

-- INSERT: any authenticated member, only as themselves
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'trace_events'
      AND policyname = 'Members can insert trace_events'
  ) THEN
    CREATE POLICY "Members can insert trace_events"
      ON trace_events FOR INSERT
      TO authenticated
      WITH CHECK (
        created_by = (SELECT auth.uid())
        AND EXISTS (
          SELECT 1
          FROM sheets s
          JOIN project_members pm ON pm.project_id = s.project_id
          WHERE s.id = trace_events.sheet_id
            AND pm.user_id = (SELECT auth.uid())
        )
      );
  END IF;
END
$$;

-- (Deliberately NO update/delete policy — append-only. See header.)

-- ============================================================
-- VERIFICATION (run after applying; read-only — NOT part of the migration):
--
--   -- new units columns exist:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='units'
--       AND column_name IN ('method','source','model_version',
--                           'suggested_polygon','suggested_label',
--                           'review_status','spec_version');
--
--   -- workbench_sheets.source_building exists:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='workbench_sheets' AND column_name='source_building';
--
--   -- trace_events table + RLS + the 2 policies (no update/delete):
--   SELECT to_regclass('public.trace_events');                        -- expect public.trace_events
--   SELECT relrowsecurity FROM pg_class WHERE relname='trace_events';  -- expect true
--   SELECT policyname, cmd FROM pg_policies
--     WHERE tablename='trace_events' ORDER BY cmd;                     -- expect SELECT + INSERT only
--
--   -- FKs (sheet CASCADE, unit SET NULL):
--   SELECT conname, confdeltype FROM pg_constraint
--     WHERE conrelid='trace_events'::regclass AND contype='f';
-- ============================================================

-- ============================================================
-- Migration: sheets scale/calibration columns (backfill — Scheduling Foundation, Slice A, Phase 0)
-- Purpose: Reproducibility ONLY. The `sheets` scale/calibration columns are
--          ALREADY LIVE in production — they were applied by hand during the
--          Scale/Measure work (Scale/Measure Phases 1-4, merged) and never got a
--          migration file. This file backfills that missing migration so the
--          schema can be rebuilt from the repo. It is a **verified no-op against
--          production**: every column already exists, so every ADD COLUMN IF NOT
--          EXISTS is skipped and no table row is touched.
--          See: Notes/plans/Scheduling-Foundation-Slice-A-Plan.md (Phase 0),
--               Notes/plans/Scheduling-Activities-Master-Plan.md (Slice A, Phase 0),
--               Notes/handoff/2026-07-01 - Scheduling Foundation Phase 0 Kickoff.md.
--
-- WHAT THESE COLUMNS ARE (all NULLABLE — a sheet may be un-scaled):
--   scale_ratio         DOUBLE PRECISION DEFAULT 1.0     — legacy scalar scale factor.
--   scale_preset        TEXT DEFAULT 'custom'            — legacy named preset ("1/8in=1ft", "custom", ...).
--   scale_units_per_px  NUMERIC                          — real-world units per base-image pixel
--                                                          (the current source of truth for area/measure math).
--   scale_unit          TEXT                             — the unit label for scale_units_per_px (e.g. "ft", "in").
--   scale_calibration   JSONB                            — the calibration line the user drew
--                                                          (endpoints in percent space + known real length).
--
-- The five column definitions below match the LIVE schema EXACTLY (verified via
-- information_schema.columns on prod pmccdxmuszuykawvlphj on 2026-07-01):
-- types, nullability, and defaults are reproduced verbatim so a fresh rebuild
-- from the repo yields the identical shape.
--
-- ADDITIVE + IDEMPOTENT. Every step is guarded with ADD COLUMN IF NOT EXISTS, so
-- on prod (columns present) this applies as a no-op — nothing added, no row
-- rewritten, no default backfilled. The only effect of (re-)running is attaching
-- the documentation COMMENT ON lines below, which is pure catalog metadata and
-- touches zero table data.
--
-- RLS: NONE NEEDED / UNCHANGED. `sheets` already carries its membership RLS
-- policies; adding columns does not require a policy change and none is added,
-- widened, or granted to anon. No status_logs / status_audit_log / RPC / trigger
-- is touched. Mirrors the additive-column posture of
-- 20260629_project_ai_training_optout.sql and 20260626_workbench_fully_traced.sql.
-- ============================================================

-- ============================================================
-- STEP 1: the five scale/calibration columns (all guarded, all nullable).
-- ============================================================
ALTER TABLE sheets
  ADD COLUMN IF NOT EXISTS scale_ratio        DOUBLE PRECISION DEFAULT 1.0;

ALTER TABLE sheets
  ADD COLUMN IF NOT EXISTS scale_preset       TEXT DEFAULT 'custom';

ALTER TABLE sheets
  ADD COLUMN IF NOT EXISTS scale_units_per_px NUMERIC;

ALTER TABLE sheets
  ADD COLUMN IF NOT EXISTS scale_unit         TEXT;

ALTER TABLE sheets
  ADD COLUMN IF NOT EXISTS scale_calibration  JSONB;

-- ============================================================
-- STEP 2: documentation comments (idempotent; pure catalog metadata).
-- ============================================================
COMMENT ON COLUMN sheets.scale_ratio IS
  'Legacy scalar scale factor for the sheet. Superseded for area/measure math by '
  'scale_units_per_px; retained for backward compatibility. Nullable, default 1.0.';

COMMENT ON COLUMN sheets.scale_preset IS
  'Legacy named scale preset (e.g. "1/8in=1ft", "custom"). Superseded by the '
  'scale_units_per_px calibration; retained for backward compatibility. '
  'Nullable, default ''custom''.';

COMMENT ON COLUMN sheets.scale_units_per_px IS
  'Real-world units per base-image pixel — the current source of truth for '
  'converting sheet geometry to real areas/lengths (computed_area in SF, the '
  'measuring tool). NULL when the sheet is un-scaled.';

COMMENT ON COLUMN sheets.scale_unit IS
  'Unit label for scale_units_per_px (e.g. "ft", "in"). NULL when un-scaled.';

COMMENT ON COLUMN sheets.scale_calibration IS
  'JSONB record of the calibration line the user drew to set the scale: line '
  'endpoints in percent space plus the known real-world length. NULL when un-scaled.';

-- ============================================================
-- VERIFICATION (run after applying; read-only — NOT part of the migration):
--
--   -- the five columns exist with the expected types / nullability / defaults:
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--     WHERE table_name = 'sheets' AND column_name LIKE 'scale_%'
--     ORDER BY ordinal_position;
--   -- expect:
--   --   scale_ratio        | double precision | YES | 1.0
--   --   scale_preset       | text             | YES | 'custom'::text
--   --   scale_units_per_px | numeric          | YES | (null)
--   --   scale_unit         | text             | YES | (null)
--   --   scale_calibration  | jsonb            | YES | (null)
--
--   -- no-op proof: existing data is untouched (ratio/preset on every row; the
--   -- newer three only on calibrated sheets):
--   SELECT count(*) AS total,
--          count(scale_units_per_px) AS calibrated
--     FROM sheets;
-- ============================================================

-- =====================================================================
-- Migration: Drawing scale & calibration columns on `sheets`
-- Purpose:   Let a drawing carry a clean, correct real-world scale set from the
--            canvas (calibration line of known length, or an architectural-preset
--            estimate). The canonical value is LINEAR feet-per-base-image-pixel,
--            from which area = pixelArea × value² and length = pixelDist × value.
--            See:
--              - sitepulse-next/Notes/plans/Drawing-Scale-Calibration-Plan.md
--              - sitepulse-next/src/utils/scale.ts (the math that consumes these)
--
--            Replaces the dimensionally-wrong legacy area math (pixelArea ×
--            scale_ratio applied a LINEAR factor to an AREA). The legacy
--            `scale_ratio` / `scale_preset` columns are KEPT for back-compat /
--            the preset dropdown, but area math no longer trusts `scale_ratio`.
--
-- ADDITIVE + NULLABLE ONLY: adds three nullable columns to `sheets`. No backfill
--   (existing drawings stay NULL = un-scaled; labels still save area-less, exactly
--   as before). Existing `units.computed_area` values are left untouched — a later
--   phase adds an explicit, user-triggered "Recalculate areas" action.
--
--     scale_units_per_px  numeric  -- canonical: real FEET per base-image pixel
--     scale_unit          text     -- 'ft' in v1 (future-proofs metric)
--     scale_calibration   jsonb    -- provenance/re-edit: {p1,p2,length,unit,source,preset,at}
--
-- RLS: UNCHANGED. The existing `sheets` membership policies cover the new columns.
--   No policy is added, widened, or granted to anon.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS. Safe to re-run.
-- =====================================================================

ALTER TABLE public.sheets
  ADD COLUMN IF NOT EXISTS scale_units_per_px numeric,
  ADD COLUMN IF NOT EXISTS scale_unit text,
  ADD COLUMN IF NOT EXISTS scale_calibration jsonb;

COMMENT ON COLUMN public.sheets.scale_units_per_px IS
  'Canonical drawing scale: real-world FEET per base-image pixel (linear). area = pixelArea × value²; length = pixelDist × value. NULL = un-scaled. Set by calibration (exact) or preset (estimate). See sitepulse-next/src/utils/scale.ts.';

COMMENT ON COLUMN public.sheets.scale_unit IS
  'Unit of scale_units_per_px / computed areas. ''ft'' in v1; reserved for future metric support. NULL ⇒ feet.';

COMMENT ON COLUMN public.sheets.scale_calibration IS
  'Scale provenance + re-edit support (JSONB): {p1,p2 (percent-space endpoints), length, unit:''ft'', source:''calibration''|''preset'', preset, at:ISO}. Narrow with isScaleCalibration() in src/types/domain.ts.';

-- =====================================================================
-- VERIFICATION (read-only — run manually, do not commit uncommented)
-- =====================================================================
-- 1) Columns exist and are nullable:
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'sheets'
--     AND column_name IN ('scale_units_per_px','scale_unit','scale_calibration');
--
-- 2) Existing rows are NULL (no backfill):
-- SELECT count(*) AS total,
--        count(scale_units_per_px) AS scaled
--   FROM public.sheets;

-- =====================================================================
-- Migration: Labeling-standard version stamping on labels
-- Purpose:   Record which version of docs/location-labeling-standard.md each
--            label was created under, so the training corpus stays internally
--            consistent as the rulebook evolves. See:
--              - docs/location-labeling-standard.md §10 "Change control"
--                ("a silent rule change mid-corpus quietly degrades a model;
--                 old labels stay valid under the version they were made")
--              - sitepulse-next/Notes/plans/Fill-From-Walls-Accelerator-Plan.md
--                (Phase V)
--
-- ADDITIVE + NULLABLE ONLY: adds one nullable TEXT column to `units`. No
--   backfill (existing rows stay NULL — they predate version stamping, which is
--   honest). The status/sync pipeline and the live app are untouched (the
--   column is unread by existing UI). Workbench label creation
--   (useCreateWorkbenchLabel) stamps it going forward from the
--   LABELING_STANDARD_VERSION constant in src/utils/locationTaxonomy.ts.
--
-- RLS: UNCHANGED. The existing `units` membership policies cover the new column.
--   No policy is added, widened, or granted to anon.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS. Safe to re-run.
-- =====================================================================

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS standard_version text;

COMMENT ON COLUMN public.units.standard_version IS
  'Version of the location-labeling standard this label was created under (e.g. ''0.2''). NULL = pre-versioning. Stamped at create time only; edits preserve the original version. See docs/location-labeling-standard.md §10.';

-- =====================================================================
-- VERIFICATION (read-only — run manually, do not commit uncommented)
-- =====================================================================
-- 1) Column exists and is nullable:
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'units'
--     AND column_name = 'standard_version';
--
-- 2) Existing rows are NULL (no backfill), new workbench labels carry a version:
-- SELECT standard_version, count(*) FROM public.units GROUP BY standard_version;

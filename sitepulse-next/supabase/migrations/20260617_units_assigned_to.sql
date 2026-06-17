-- ============================================================
-- Migration: units.assigned_to (location assignee)
-- Purpose: Add the missing `units.assigned_to` column. The assignee
--          feature already reads/writes it — single + bulk "assign to
--          user" in FieldStatusTable, the UnitInspector assignee display,
--          and filter-by-assignee in locationFilters — but the column was
--          never created in the live DB, so assignee writes were failing.
--          `database.types.ts` already declares `units.assigned_to:
--          string | null`; this reconciles the live schema to the code.
-- Class:   Purely additive. Nullable, no backfill, no default — zero risk
--          to existing rows. unit_type / status_logs / taxonomy untouched.
--          No FK (matches the app's other loose user-id columns).
-- ============================================================

ALTER TABLE units ADD COLUMN IF NOT EXISTS assigned_to uuid;

-- Keep filter-by-assignee (locationFilters) fast.
CREATE INDEX IF NOT EXISTS idx_units_assigned_to ON units (assigned_to);

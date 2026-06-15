# SitePulse Supabase Database Schema

> **AI INSTRUCTIONS:** Use this schema when writing Supabase queries, hooks, or backend logic. Do not guess table columns; refer to this map. This represents the CURRENT state of the database.

## 1. projects
- `id` (UUID, Primary Key)
- `name` (TEXT, Not Null)
- `unit_types` (JSONB, Default '["Apartment Unit", "Common Area", "Back of House", "Commercial Space", "Other"]') 
- `procore_project_id` (TEXT) -- Linked Procore Project ID for SSO deep-linking
- `created_at` (TIMESTAMPTZ)

## 2. sheets
- `id` (UUID, Primary Key)
- `project_id` (UUID, Foreign Key -> projects.id)
- `sequence_order` (INTEGER, Default 0)
- `sheet_name` (TEXT, Not Null)
- `base_image_url` (TEXT)
- `tile_manifest_url` (TEXT) -- DZI manifest URL for tiled deep-zoom rendering
- `tile_image_width` (INTEGER) -- Natural pixel width of the high-res tile source
- `tile_image_height` (INTEGER) -- Natural pixel height of the high-res tile source
- `scale_ratio` (FLOAT)
- `scale_preset` (TEXT)
- `active_scopes` (JSONB, Default '[]') -- Array of assigned scope names
- `milestone_schedules` (JSONB, Default '{}') -- Mapping of milestones to start/end dates
- `created_at` (TIMESTAMPTZ)

## 3. units
- `id` (UUID, Primary Key)
- `sheet_id` (UUID, Foreign Key -> sheets.id)
- `unit_number` (TEXT, Not Null)
- `unit_type` (TEXT)
- `computed_area` (FLOAT)
- `polygon_coordinates` (JSONB, Not Null)
- `icon_offset_x` (FLOAT, Default 0)
- `icon_offset_y` (FLOAT, Default 0)
- `walk_sequence` (INTEGER, Default NULL) -- Ordered walk route position; NULL = not in any route
- `created_at` (TIMESTAMPTZ)

## 4. project_milestones
- `id` (UUID, Primary Key)
- `project_id` (UUID, Foreign Key -> projects.id)
- `sequence_order` (INTEGER, Default 0)
- `name` (TEXT, Not Null)
- `color` (TEXT, Not Null)
- `track` (TEXT, Not Null, Default 'Production') -- Conceptually acts as the "Scope of Work"
- `applies_to_unit_types` (JSONB, Default NULL) -- Applicability rule: NULL/empty array = applies to ALL unit types; else array of `units.unit_type` strings this milestone applies to
- `created_at` (TIMESTAMPTZ)

## 5. status_logs (The Event Sourcing Table)
*Note: We append to this table to track history. Do not simply update rows unless fixing an error.*
- `id` (UUID, Primary Key)
- `unit_id` (UUID, Foreign Key -> units.id)
- `milestone` (TEXT, Not Null)
- `status_color` (TEXT, Not Null)
- `temporal_state` (TEXT, Not Null, Default 'completed') -- CHECK constraint `status_logs_temporal_state_check`: 'planned' | 'ongoing' | 'completed' | 'none'. "Not applicable" is intentionally NOT a temporal_state — see milestone_applicability_overrides
- `track` (TEXT, Not Null, Default 'Production')
- `planned_start_date` (DATE)
- `planned_end_date` (DATE)
- `logged_date` (DATE, Not Null, Default CURRENT_DATE)
- `client_timestamp` (TIMESTAMPTZ) -- Represents the exact moment the offline/online worker committed the change in their UI
- `created_at` (TIMESTAMPTZ)

## 6. profiles
- `id` (UUID, Primary Key, Foreign Key -> auth.users.id)
- `display_name` (TEXT)
- `email` (TEXT, Not Null)
- `created_at` (TIMESTAMPTZ)

## 7. project_members
- `id` (UUID, Primary Key)
- `project_id` (UUID, Foreign Key -> projects.id)
- `user_id` (UUID, Foreign Key -> auth.users.id / profiles.id)
- `role` (TEXT, Not Null) -- Enum: 'admin', 'pm', 'superintendent', 'viewer'
- `created_at` (TIMESTAMPTZ)

## 8. sheet_vectors (Vector Cache Table)
- `sheet_id` (UUID, Primary Key, Foreign Key -> sheets.id ON DELETE CASCADE)
- `vectors` (JSONB, Not Null) -- Cached vector linework from PDF extraction
- `created_at` (TIMESTAMPTZ, Default now())

## 9. milestone_applicability_overrides
*Per-unit applicability overrides. Override beats the `applies_to_unit_types` rule on the milestone. A slot that is not applicable is excluded from all progress denominators, auto-advance sequencing, and bottleneck computation — it never appears in `status_logs`.*
- `id` (UUID, Primary Key)
- `milestone_id` (UUID, Not Null, Foreign Key -> project_milestones.id ON DELETE CASCADE)
- `unit_id` (UUID, Not Null, Foreign Key -> units.id ON DELETE CASCADE)
- `is_applicable` (BOOLEAN, Not Null) -- false = exclude a rule-included unit; true = re-include a rule-excluded unit
- `created_by` (UUID)
- `created_at` (TIMESTAMPTZ, Default now())
- `updated_at` (TIMESTAMPTZ, Default now())
- UNIQUE (milestone_id, unit_id)
- RLS: any project member can read/write (mirrors status_logs membership join units -> sheets -> project_members)
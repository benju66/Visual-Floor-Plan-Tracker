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
- `created_at` (TIMESTAMPTZ)

## 4. project_milestones
- `id` (UUID, Primary Key)
- `project_id` (UUID, Foreign Key -> projects.id)
- `sequence_order` (INTEGER, Default 0)
- `name` (TEXT, Not Null)
- `color` (TEXT, Not Null)
- `track` (TEXT, Not Null, Default 'Production') -- Conceptually acts as the "Scope of Work"
- `created_at` (TIMESTAMPTZ)

## 5. status_logs (The Event Sourcing Table)
*Note: We append to this table to track history. Do not simply update rows unless fixing an error.*
- `id` (UUID, Primary Key)
- `unit_id` (UUID, Foreign Key -> units.id)
- `milestone` (TEXT, Not Null)
- `status_color` (TEXT, Not Null)
- `temporal_state` (TEXT, Not Null, Default 'completed') -- Enum: 'planned', 'ongoing', 'completed', 'none'
- `track` (TEXT, Not Null, Default 'Production')
- `planned_start_date` (DATE)
- `planned_end_date` (DATE)
- `logged_date` (DATE, Not Null, Default CURRENT_DATE)
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
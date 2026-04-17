# SitePulse Supabase Database Schema

> **AI INSTRUCTIONS:** Use this schema when writing Supabase queries, hooks, or backend logic. Do not guess table columns; refer to this map. This represents the CURRENT state of the database.

## 1. projects
- `id` (UUID, Primary Key)
- `name` (TEXT, Not Null)
- `created_at` (TIMESTAMPTZ)

## 2. sheets
- `id` (UUID, Primary Key)
- `project_id` (UUID, Foreign Key -> projects.id)
- `sheet_name` (TEXT, Not Null)
- `base_image_url` (TEXT)
- `created_at` (TIMESTAMPTZ)

## 3. units
- `id` (UUID, Primary Key)
- `sheet_id` (UUID, Foreign Key -> sheets.id)
- `unit_number` (TEXT, Not Null)
- `polygon_coordinates` (JSONB, Not Null)
- `icon_offset_x` (FLOAT, Default 0)
- `icon_offset_y` (FLOAT, Default 0)
- `created_at` (TIMESTAMPTZ)

## 4. project_milestones
- `id` (UUID, Primary Key)
- `project_id` (UUID, Foreign Key -> projects.id)
- `name` (TEXT, Not Null)
- `color` (TEXT, Not Null)
- `track` (TEXT, Not Null, Default 'Production')
- `created_at` (TIMESTAMPTZ)

## 5. status_logs (The Event Sourcing Table)
*Note: We append to this table to track history. Do not simply update rows unless fixing an error.*
- `id` (UUID, Primary Key)
- `unit_id` (UUID, Foreign Key -> units.id)
- `milestone` (TEXT, Not Null)
- `status_color` (TEXT, Not Null)
- `temporal_state` (TEXT, Not Null, Default 'completed') -- Enum: 'planned', 'ongoing', 'completed'
- `track` (TEXT, Not Null, Default 'Production')
- `logged_date` (DATE, Not Null, Default CURRENT_DATE)
- `created_at` (TIMESTAMPTZ)
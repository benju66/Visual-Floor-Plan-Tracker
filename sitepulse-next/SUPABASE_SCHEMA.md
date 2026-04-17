# SitePulse Supabase Database Schema

> **AI INSTRUCTIONS:** Use this schema when writing Supabase queries, hooks, or backend logic. Do not guess table columns; refer to this map.

---

## 1. Core Architecture (Multi-Tenancy & Access)
To support scale (e.g., multiple companies, contractors, or teams), we need a top-level organizational layer.

### `organizations`
Grouping entity preventing data leakage between different companies.
- `id` (UUID, Primary Key)
- `name` (String)
- `created_at` (Timestamp)

### `users`
Tied to Firebase or Supabase Auth.
- `id` (UUID, Primary Key)
- `organization_id` (UUID, Foreign Key)
- `email` (String)
- `role` (String) - e.g., 'Admin', 'Manager', 'FieldWorker'
- `created_at` (Timestamp)

---

## 2. Project Hierarchy
The spatial and grouping logic for your floorplans.

### `projects`
- `id` (UUID, Primary Key)
- `organization_id` (UUID, Foreign Key)
- `name` (String) - Defines the dynamic routing URL `localhost:3000/projects/[id]`
- `status` (String) - e.g., 'Active', 'Archived', 'Completed'
- `created_at` (Timestamp)

### `sheets` (or `floorplans`)
- `id` (UUID, Primary Key)
- `project_id` (UUID, Foreign Key)
- `sheet_name` (String) - e.g., "Level 2", "North Wing"
- `base_image_url` (String) - Generated high-res PNG
- `original_pdf_url` (String) - Original vector file
- `order_index` (Integer) - Controls the sorting in the sidebar/menus
- `created_at` (Timestamp)

### `units` (or `locations`)
The physical entities being tracked mapped directly to a sheet.
- `id` (UUID, Primary Key)
- `sheet_id` (UUID, Foreign Key)
- `unit_number` (String)
- `type` (String) - e.g., 'Room', 'Apartment', 'Equipment', 'Zone' (Useful for later filtering)
- `polygon_coordinates` (JSON) - Used for vector mapping
- `icon_offset_x` (Float) - UI positioning
- `icon_offset_y` (Float) - UI positioning
- `current_milestone_id` (UUID, Foreign Key) - **Optimization field:** Snapshots the current exact state so Dashboard KPI aggregations are instantly fast without having to parse the whole history log!
- `created_at` (Timestamp)

---

## 3. Timeline & Lifecycle Tracking
The logic powering the historical tracking and dynamic milestones.

### `project_milestones`
- `id` (UUID, Primary Key)
- `project_id` (UUID, Foreign Key)
- `name` (String) - e.g., "Framing", "Drywall" 
- `color` (String) - Hex value for the vector map exports
- `track` (String) - e.g., "Production", "Inspections"
- `sequence_order` (Integer) - **Crucial for Cycle Times:** Determines what comes first. Allows you to calculate "Did this unit leapfrog a step?" or "Are we 50% done?"
- `created_at` (Timestamp)

### `status_logs` (The Event/History Log)
This table must be **Append-Only**. Do not delete rows. This is the heart of your historical record.
- `id` (UUID, Primary Key)
- `unit_id` (UUID, Foreign Key)
- `user_id` (UUID, Foreign Key) - Who made the change?
- `milestone_id` (UUID, Foreign Key, Nullable) - Links to the defined milestone. Null could indicate a "Clear" event.
- `track` (String) - e.g., "Production"
- `event_type` (String) - e.g., 'STATUS_SET', 'STATUS_CLEARED', 'ISSUE_REPORTED'
- `temporal_state` (String) - 'planned', 'ongoing', 'completed', 'none'
- `notes` (Text) - Optional field for the field worker to add context.
- `created_at` (Timestamp) - Exactly *when* it happened.

# Backlog — deferred items

Known issues and follow-ups intentionally deferred. Each entry: what, impact, options, and where it lives.

---

## 1. `project_members.user_email` — invite-by-email is broken in prod
**Logged:** 2026-06-17 · **Priority:** medium (a user-facing feature silently fails) · **Status:** deferred

**What:** `src/types/database.types.ts` declares `project_members.user_email`, and code reads/writes it, but the column **does not exist in the live database**. So the **SettingsMenu → Team tab "Invite Member" (by email)** path fails at runtime when it inserts `{ project_id, user_email, role }`.

**Why it's only "sometimes" visible:** there are two parallel invite mechanisms.
- `GlobalSettingsModal` (dashboard → Global Settings → User Management) invites by **`user_id`** — looks up an existing user, requires they've already signed up. **Works.**
- `SettingsMenu` (project Settings → Team) invites by **`user_email`** — stores email, no `user_id`. **Broken.**

**Affected code:** `src/components/SettingsMenu.tsx` (~L1023/1024/1043 read; ~L1071 insert); `src/components/manage/assignee.ts` (reads `m.user_email` as a label fallback — degrades gracefully).

**Options to resolve:**
1. **Add the column** — additive migration `ALTER TABLE project_members ADD COLUMN IF NOT EXISTS user_email text;`. Quickest unblock, no code change. Enables "invite before signup," but rows with a null `user_id` then need link-on-signup logic (not obviously built yet).
2. **Consolidate on the working path** — refactor the SettingsMenu invite to look up `user_id` like `GlobalSettingsModal` does, then drop `user_email` from the types. One consistent mechanism, no migration; keeps the "must sign up first" limitation.

**Context:** found during the 2026-06-17 types-vs-live audit that also fixed `units.assigned_to` (added column), `projects.procore_company_id`, and `profiles` (commit `7d6b223`). Note: `src/types/database.types.ts` is hand-maintained and drifts from the live schema — worth a periodic re-audit.

---

## 2. Polygon holes / donut + cut-out geometry
**Logged:** 2026-06-17 · **Priority:** low–medium (data fidelity for a minority of spaces) · **Status:** deferred

**What:** Support tracing a location that has an interior **void** — a "donut" room wrapped around an excluded core (e.g. an elevator shaft, atrium, or light well) — by cutting a hole out of its polygon, so the recorded boundary and computed area exclude the core. Today `units.polygon_coordinates` is a **single flat ring** (`PercentPoint[]`); there is no way to represent an interior hole.

**Why deferred (decided 2026-06-17, Location Labeling Workbench plan):** true hole geometry is a **cross-cutting geometry upgrade**, not a labeling-workflow feature. The clean representation is a multi-ring polygon (exterior + interior rings, GeoJSON-style: `PercentPoint[][]`), which ripples through the canvas drawing tools, snapping, the `isPercentPointArray` guard, `computed_area` math, **and** the backend PDF export (`/export-pdf`). Bundling it into the workbench build would bloat and risk that delivery. The labeling standard (§3.7) currently works around it (trace the outer boundary; a tracked core like a shaft is labeled as its own location), and the workbench adds a lightweight **`units.has_void` flag** so the dataset is honest and these can be cleaned up once real geometry lands.

**Scope when picked up:**
1. Geometry model: extend `polygon_coordinates` to support an optional interior-ring list (exterior + holes) without breaking existing single-ring rows; update the `isPercentPointArray`/narrowing guards + tests.
2. Canvas UX: a "cut hole / add void" tool on the polygon editor; render holes; keep snapping + corner-gravity working on inner rings.
3. Area math: subtract hole area in `computed_area`.
4. Export: update the backend `/export-pdf` polygon rendering to honor holes.
5. Migrate `has_void`-flagged labels: revisit those locations and capture the real void.

**Context:** belongs to **Workstream B (tracing/geometry)**-adjacent work, but is its own dedicated effort. See `Notes/plans/Location-Labeling-Workbench-Plan.md` (Out of scope / decision 5).

# SitePulse - Visual Floor-Plan Tracker

SitePulse is an enterprise-grade construction project management platform focused on visual tracking. It replaces traditional spreadsheet schedules with an interactive, map-based interface that allows field teams to track unit statuses directly on architectural floorplans.

![SitePulse Overview](https://via.placeholder.com/1200x600.png?text=SitePulse+Visual+Tracker) *Note: Replace with actual screenshot*

## 🏗️ Technical Stack

**Frontend Layer (`/sitepulse-next`)**
* **Framework:** [Next.js 16](https://nextjs.org/) (React 19, Client-heavy interactions)
* **Canvas Engine:** [React-Konva](https://konvajs.org/docs/react/index.html) (High-performance 2D WebGL mapping)
* **State Management:** [Zustand](https://github.com/pmndrs/zustand) (Persisted, Modularized via `useMapStore`, `useUIStore`, `useSettingsStore`)
* **Styling:** Tailwind CSS V4, Lucide React Icons
* **Interactions:** `@dnd-kit` for workspace and sequence management

**Backend API (`/sitepulse-backend`)**
* **Framework:** [FastAPI](https://fastapi.tiangolo.com/) (High-performance Async Python)
* **PDF Processing:** [PyMuPDF / fitz](https://pymupdf.readthedocs.io/) (High-fidelity conversion, exact matrix mapping, vector markup regeneration)
* **Authentication:** Supabase Auth (Local JWT validation via `PyJWT` — no network round-trip)
* **Database & Storage:** Supabase (PostgreSQL, Storage buckets for original and converted sheets)

## 🚀 Core Features

* **Interactive Floorplan Canvas:** Easily trace architectural spaces (units, rooms) over uploaded blueprints.
* **Hybrid Vector-Snapping Engine:** A high-precision, invisible R-Tree spatial index that extracts architectural lines from source CAD/PDFs. It allows users to trace perfectly straight, pixel-accurate walls by mathematically locking the drawing cursor and nodes to the original structural geometries (with gravity corner-snapping).
* **Enterprise State Integrity:** Built to prevent data races. Tracks *Planned*, *Ongoing*, and *Completed* stages with precise sequence enforcement and downstream bottleneck detection.
* **Architectural PDF Exports:** Unlike standard dashboard tools that just take a screen capture, SitePulse calculates the exact matrix de-rotation of your original PDF to programmatically inject visual statuses (hatching, opacity, lines) back into the source PDF file as Bluebeam-compatible annotations.
* **Idempotent Synchronization Engine:** A defense-in-depth offline sync stack featuring slot-unique `UPSERT` mutations (one row per unit/track/milestone), a Last-Write-Wins timestamp guard via Postgres RPC, per-item IndexedDB checkpointing for crash-proof field syncs, and a trigger-managed `status_audit_log` for full-fidelity historical audit trails. Paired with real-time WebSocket cache injections for thundering-herd-proof dashboards.
* **Centralized Scheduling:** Transition effortlessly between the visual canvas and a spreadsheet-like data grid to manage start/completion dates automatically linked to visually mapped units.
* **Procore SSO Integration:** Native deep-linking from the Procore App Marketplace directly into project canvases, with automated domain-restricted user provisioning and project auto-enrollment.
* **Mobile Field Experience (Swipe Deck):** An enterprise-grade, gesture-driven mobile interface optimized for high-speed field triage. Features "Smart Confirm" swipe navigation, inline segmented controls for exact status assignment, proactive out-of-sequence bottleneck detection (with persistent UI banners), and a robust multi-layer Snapshot Undo queue to ensure absolute data integrity.
* **Enterprise RBAC Wrapper:** Multi-tenant project data access ensuring subcontractors, managers, and admins only see what they are authorized to manage.
* **Progress Visualization Suite:** Four views that turn raw statuses into schedule insight — map Lag Mode, per-unit Journey timelines, the per-level Floor Pulse rail, and the Type Scorecard. See [Progress Visualization Views](#-progress-visualization-views).

## 📊 Progress Visualization Views

All four views are computed client-side from data the app already captures. The shared math lives in `sitepulse-next/src/utils/progressAnalytics.ts` — one source of truth for bottleneck variance, the color scale, and group rollups/forecasts.

The common building block is the **bottleneck variance** of a unit: its bottleneck is the earliest incomplete milestone (by `sequence_order`) in the active track, and its variance is that milestone's planned window measured against today:

| Condition | Verdict | Color |
|---|---|---|
| All milestones completed | **Complete** | emerald |
| Planned finish has passed | **Behind** (ramped: 1–3d amber → 15+d red) | amber → red |
| Planned start still in the future | **Ahead / not due** | blue |
| Today inside the planned window | **On pace** | gray |
| No planned dates, work started | **No plan dates** (shows days idle instead) | dark slate |
| No planned dates, nothing logged | **Not started** | light slate |

A unit is **stalled** when it has work in flight but no status write in 14+ days (last activity comes from `status_logs.client_timestamp`, which is restamped on every write — no extra queries needed).

### 1. Map Lag Mode (floor-plan canvas)

**What it does:** A toolbar toggle (gauge icon) that recolors every unit polygon by its schedule variance instead of its bottleneck-milestone color. The floor plan flips from "what trade is each unit on" to "how late is each unit" — lag clusters jump out spatially. The on-canvas legend swaps to the fixed variance scale automatically, and the hover tooltip leads with the verdict (e.g. *"8d behind plan · Drywall"*) in both modes. Out-of-sequence hatching is unaffected.

**Needed to work correctly:**
* **Planned dates on status logs** (`planned_start_date` / `planned_end_date`). Units whose bottleneck has no dates fall back to days-idle coloring — honest, but coarser. The more slots carry planned dates, the more the map means.
* The toggle is per-browser (persisted in `mapSettings.colorByVariance`).
* ⚠️ Lag colors are **display-only**: the recoloring happens on copies inside `FloorplanCanvas`. Never feed variance-colored statuses into write paths (bulk actions, quick modals) — see `AGENTS.md` §3.

### 2. Unit Journey Timeline (location history modal)

**What it does:** Opening a unit's history now shows a **Journey** tab by default: one swimlane per milestone with the planned window as a dashed ghost bar, the actual work as a solid bar (built from the append-only `status_audit_log`), red-ticked **idle gaps** between milestones with day counts, a today line, and the unit's variance verdict in the header. The old flat audit table survives as the **Log** tab for dispute/audit use.

**Needed to work correctly:**
* **The audit trail** (`status_audit_log` — created by the `20260518` migration). Actual bars derive from each milestone's first `ongoing` entry and its completion's `logged_date`. Projects with history only in `status_logs` (pre-migration) will show completion points but not durations.
* **Honest logging in the field:** a milestone marked straight to `completed` without ever passing through `ongoing` renders as a point-in-time completion, not a duration bar.
* Planned ghost bars need planned dates on the current status logs (same requirement as Lag Mode).

### 3. Floor Pulse (dashboard, per-level rail)

**What it does:** One row per sheet, stacked in building order (top floor first). Each row: a completion bar with a **plan tick** (where the level *should* be today, from planned finish dates) and a "−N pts vs plan" flag when the gap is large; **pace** (completions in the last 7 days vs. the trailing 4-week average); a **forecast chip** (*"→ ~wk of Aug 24"*) projected at the **median** weekly pace of the last 6 full weeks; and a stalled count. Clicking a row scopes the whole dashboard (KPIs, velocity chart, milestone breakdown) to that level — this rail replaced the old Active Level / All Levels toggle and the Active Locations / Not Started KPI cards. The map button on each row jumps straight to that level's floor plan. (The Completion Velocity chart below it also gained a dashed **planned** line from the same dates, so the burn-up finally shows ahead/behind, not just motion.)

**Needed to work correctly:**
* **Sheet `sequence_order`** set sensibly (it drives the building-stack ordering).
* **Completions logged with real dates** — pace and forecasts bucket `status_audit_log` completions by `logged_date`. Median weekly pace (not mean) keeps one bulk back-dating session from wrecking the forecast, but garbage dates still mean garbage pace.
* **Enough signal:** forecasts and trends are deliberately **suppressed, not faked** — levels with fewer than 12 task slots show *"too few tasks"*, and levels with zero recent completions show *"no pace to project"* instead of an invented date. A level showing "—" is the feature working, not broken.

### 4. Type Scorecard (dashboard, comparative leaderboard)

**What it does:** One row per `unit_type` across **all levels**, sorted worst-first so "which type is dragging the schedule?" is answered by the first row (tagged `RISK 1`). Each row: completion bar with plan tick, an **average variance chip** (mean bottleneck variance across the type's units, − = behind), a weekly-completions sparkline with trend arrow, and a stalled count. Clicking a row expands its **burn-up** — actual cumulative completions vs. the planned cumulative line.

**Needed to work correctly:**
* **Meaningful `unit_type` values** on units (set when tracing/naming spaces). Types you never assigned land in "Unspecified"; the module hides itself entirely if the project has only one type — there's nothing to compare.
* Variance chips need planned dates (types with none show *"no plan dates"* instead of a number).
* Sparklines/trends are suppressed for types with fewer than 8 units — small groups produce noisy, misleading trends.

### Data-quality summary

| You get… | …when you maintain |
|---|---|
| Lag Mode + plan ticks + variance chips | `planned_start_date` / `planned_end_date` on status logs |
| Journey duration bars + idle gaps | the `status_audit_log` migration applied; statuses moved through `ongoing` before `completed` |
| Pace, forecasts, sparklines | completions logged with accurate `logged_date` |
| Floor ordering | `sequence_order` on sheets |
| Type comparisons | `unit_type` assigned on units |

## 🛠️ Local Development Setup

### Prerequisites
* Node.js (v18+)
* Python 3.10+
* A [Supabase](https://supabase.com) Project

### 1. Supabase Environment Configuration
SitePulse relies heavily on Supabase. Both the frontend and backend need access to your Supabase keys.

**Create `.env.local` in `sitepulse-next/`:**
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_API_URL=http://localhost:8000
```

**Create `.env` in `sitepulse-backend/`:**
```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_service_role_or_anon_key
SUPABASE_JWT_SECRET=your_supabase_jwt_secret
FRONTEND_URL=http://localhost:3000
```

### 2. Frontend Initialization
```bash
cd sitepulse-next
npm install
npm run dev
```
*Your frontend will be running on `http://localhost:3000`*

### 3. Backend Initialization
```bash
cd sitepulse-backend
python -m venv venv
# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload
```
*Your backend will be running on `http://localhost:8000`*

## 🧪 Testing

**Frontend (`sitepulse-next/`) — Vitest + React Testing Library**
```bash
cd sitepulse-next
npm run test            # run once
npm run test:watch      # watch mode
npm run test:coverage   # coverage report (src/utils, src/types)
```
Tests are co-located next to the code (`foo.ts` → `foo.test.ts`). Seed coverage targets the pure-logic and serialization layers — geometry/snapping math, the JSONB type guards, and the project-scoped IndexedDB pending-changes store.

**Backend (`sitepulse-backend/`) — pytest**
```bash
cd sitepulse-backend
pip install -r requirements-dev.txt   # one-time
python -m pytest -q
```
Tests live in `tests/` and run hermetically — `conftest.py` injects test `SUPABASE_*` env vars before importing `main`, so no real Supabase project is needed. Seed coverage pins the local-JWT auth path (valid/expired/wrong-role/tampered tokens) and the public-vs-protected route boundary.

> There is no E2E framework yet (Playwright deferred); canvas and mobile swipe-deck flows are verified manually against `npm run dev`. See `.agent/skills/` for the `write-tests`, `verify-feature`, and related agent skills.

## 📖 Key Architecture Concepts

* **Map vs Table Sync:** The application features deep integration between the `Canvas` elements and the `FieldStatusTable`. Updates made visually immediately reflect in the table, and vice-versa.
* **Coordinate Mapping:** Frontend Konva percentages (`pctX`, `pctY`) are utilized to keep shapes responsive. Upon PDF export, the backend transforms these percentages against `CropBox` matrices and `derotation_matrix` logic to perfectly apply Bluebeam-ready vector annotations regardless of sheet crop orientations.
* **Event Propagation:** Strict control is maintained over click events (`e.cancelBubble = true`) to prevent dragging operations from inadvertently selecting elements beneath them on the interactive canvas.
* **Slot-Unique Status Model:** `status_logs` enforces `UNIQUE(unit_id, track, milestone)` — one current-state row per slot. All mutations use the `upsert_status_log` RPC or `.upsert()`. History is preserved in the append-only `status_audit_log` table via a Postgres trigger.
* **Offline-First Sync:** Pending changes are persisted to IndexedDB with project-scoped keys. The sync engine (`handleApplyAll`) dequeues items individually, checkpointing to IDB after each success. `client_timestamp` reflects offline-capture time, not sync time.

## 🗃️ Database Migrations

SQL migrations live in `sitepulse-next/supabase/migrations/`. These must be applied to your Supabase project manually via the SQL Editor or Supabase CLI before deploying frontend changes that depend on them.

| Migration | Purpose |
|---|---|
| `20260518_status_logs_idempotency.sql` | Deduplicates existing rows, adds slot-unique constraint, creates `status_audit_log` table + trigger, and deploys the `upsert_status_log` RPC with LWW timestamp guard |
| `20260610_milestone_applicability.sql` | Adds `project_milestones.applies_to_unit_types`, the `milestone_applicability_overrides` table (+ RLS), and a `temporal_state` CHECK constraint |
| `20260616_location_taxonomy.sql` | **Additive.** Adds `projects.project_type` (8-value CHECK), `units.top_level_role` (4-value CHECK) + `units.subtype_id` (FK → `subtypes`, `ON DELETE SET NULL`), the global `subtypes` dictionary table (RLS: read = any member, write = `owner`/`admin`/`pm` only), seeds 70 sub-types + the `Other (pending)` sentinel, and backfills role/sub-type from the legacy `unit_type` (which is **kept**). Idempotent; safe to re-run |
| `20260617_taxonomy_correction.sql` | **Corrective (data-touching).** Migrates `projects.project_type` CHECK from 8 → **9 values** (splits `Housing and Hotel` → `Housing` + `Hotel`; remaps existing rows → `Housing`), moves Restaurant `Kitchen`/`Prep` sub-types to `support` (Back of House), and re-scopes `subtypes.default_project_types` off the retired type. `units` are **not** re-backfilled (a unit's `top_level_role` is its own source of truth). Mirrors `src/utils/locationTaxonomy.ts`. Idempotent; safe to re-run |
| `20260617_workbench_schema.sql` | **Additive + nullable (no backfill).** Location Labeling Workbench foundation: adds `projects.kind` (`'live'`/`'workbench'` CHECK, default `'live'`, indexed `idx_projects_kind`) as the hidden-container marker; creates the `workbench_sheets` sidecar (1:1 with a workbench `sheets` row — per-drawing `sheet_project_type`/`level_label`/`source_sheet_number`/`vector_quality`/`is_partial`/`review_state` + reviewer stamps; RLS mirrors `units` → `sheets` → `project_members`: read = any member, write = `owner`/`admin`/`pm`, never `anon`); and adds nullable label flags `units.spans_levels`/`level_note`/`has_void`. `unit_type` and the status/sync pipeline are untouched; the live app is unaffected (all new columns nullable/defaulted + unread by existing UI). Idempotent; safe to re-run |
| `20260618_workbench_soft_delete.sql` | **Additive + nullable (no backfill).** Drawing Library soft-delete (Phase 8b): adds `workbench_sheets.deleted_at TIMESTAMPTZ` (NULL = active, non-NULL = archived) and `workbench_sheets.deleted_by UUID` (provenance; plain UUID, mirrors `reviewed_by`). The library read hook excludes archived drawings by default (with a "Show archived" path); archive/restore are plain `UPDATE`s already covered by the existing privileged `workbench_sheets` UPDATE policy — **RLS unchanged, no `anon` grant.** Prod-safe; the live app never reads these columns. Idempotent; safe to re-run |
| `20260623_project_contacts.sql` | **Additive + isolated (no backfill).** Project Contacts Phase 1: creates the `project_contacts` table (one row per person on a project — `company` NOT NULL + `first_name`/`last_name`/`job_title`/`mobile_phone`/`email`, nullable `procore_id` reserved for the Phase 4 live sync, `created_by`/timestamps), with `UNIQUE(project_id, email)` for the Phase 2 Procore CSV de-dupe (NULL emails stay distinct), indexes `(project_id)` and `(project_id, company)`, and RLS read = any member / write = `owner`/`admin`/`pm`/`superintendent`, never `anon`. Touches no existing table/RPC/RLS (only FKs `projects(id)`); the live app is unaffected until the Settings → Contacts section reads it. Idempotent; safe to re-run |
| `20260625_sheet_text.sql` | **Additive + isolated (no backfill).** AI Tracing Assist Phase 1: creates the `sheet_text` 1:1 write-through cache (PK = FK `sheets(id)` `ON DELETE CASCADE`; `text JSONB NOT NULL DEFAULT '[]'` holding `[{ text, pctX, pctY }]` — each extracted PDF word + its position in the **same percent space** as `sheet_vectors`/`units.polygon_coordinates`; `created_at`). It IS the `sheet_vectors` write-through pattern, for text. RLS mirrors `workbench_sheets` (`sheets` → `project_members`): read = any member, write = `owner`/`admin`/`pm`, never `anon`. A scanned sheet with no text layer caches an empty array (an OCR-later candidate, not an error). Backend-only foundation (`/extract-text/{sheet_id}` + `backfill_text.py`); no UI reads it yet. Touches no existing table/RPC/RLS. Idempotent; safe to re-run |
| `20260625_sheet_metadata.sql` | **Additive + isolated (no backfill).** AI Tracing Assist Phase 3a: creates the `sheet_metadata` 1:1 verified-capture table (PK = FK `sheets(id)` `ON DELETE CASCADE`) holding the human-confirmed title-block facts — `sheet_number`, `sheet_name` (the printed title, distinct from `sheets.sheet_name` = library label), `architect_firm` (the corpus + calibration key) — plus the dragged `title_block_bbox JSONB` (percent space) and Milestone-1 provenance (`source`/`model_version`/frozen `suggested_fields JSONB`/`review_status`/`spec_version`; plain TEXT, no enums). Written **client-side** by the workbench title-block reader, so the privileged-write RLS is load-bearing — read = any member, write = `owner`/`admin`/`pm`, never `anon` (mirrors `sheet_text`). Touches no existing table/RPC/RLS. Idempotent; safe to re-run |
| `20260625_sheet_gridlines.sql` | **Additive + isolated (no backfill).** AI Tracing Assist Phase 3b: creates the `sheet_gridlines` 1:1 verified-capture table (PK = FK `sheets(id)` `ON DELETE CASCADE`) holding a sheet's confirmed structural grid as `gridlines JSONB NOT NULL DEFAULT '[]'` = `[{ label, p1, p2, axis }]` (bubble label + the two snapped endpoints in percent space + `'h'`/`'v'` orientation), banked in one "accept all" upsert, plus Milestone-1 provenance (`source`/`model_version`/frozen `suggested_gridlines JSONB`/`review_status`/`spec_version`; plain TEXT, no enums). Written **client-side** by the workbench gridline annotator, so the privileged-write RLS is load-bearing — read = any member, write = `owner`/`admin`/`pm`, never `anon` (mirrors `sheet_metadata`). Touches no existing table/RPC/RLS. Idempotent; safe to re-run |
| `20260626_workbench_fully_traced.sql` | **Additive + nullable-defaulted (auto-backfill `false`).** AI Tracing Assist Phase 4c: adds `workbench_sheets.fully_traced BOOLEAN NOT NULL DEFAULT false` — the per-sheet completeness / training-eligibility gate the reviewer ticks to declare "every room AND every floor passage on this sheet is traced." It feeds the review Definition-of-Done ("Mark reviewed" stays blocked until it's set, alongside a live "no unresolved flagged openings" recompute) and the forward-looking `isExportEligible` helper that excludes partial / product-use sheets from the future training-corpus export. Lives on the review sidecar beside `review_state`/`reviewed_by`/`deleted_at`, not on `sheets`. The `NOT NULL DEFAULT false` backfills every existing row to "not certified"; the live app never reads it. **No RLS change** — setting it rides the existing privileged `workbench_sheets` UPDATE policy (owner/admin/pm, never `anon`). Idempotent; safe to re-run |
| `20260626_units_opening_edges.sql` | **Additive + nullable-defaulted (auto-backfill `[]`).** AI Tracing Assist Phase 4a: adds `units.opening_edges JSONB NOT NULL DEFAULT '[]'` = `[{ edgeIndex, type }]` — floor-level passages (`door`/`cased_opening`/`overhead`/`pass_through`) tagged on a room's perimeter while tracing, referenced by the polygon edge's START-vertex index so a tag rides polygon edits. A column ON `units` (not a new table) because an opening on the boundary you trace is free, perfectly located, and attributed to its room — so it rides the existing unit write + M1 provenance + `trace_events`; canonical openings + connectivity are **derived** later (Phase 4b). `type` is plain TEXT inside the JSON (no CHECK enum). **No RLS change** (rides `units`); the `NOT NULL DEFAULT '[]'` backfills every existing row, the live app never reads it. Idempotent; safe to re-run |

> ⚠️ **The `20260518` dedup step is destructive.** Always back up `status_logs` before running. The `20260610` and `20260616` migrations are additive (no data loss), but `20260616`'s `UPDATE` backfill is data-touching — run on a branch/backup first. The `20260617_taxonomy_correction` migration is corrective and **rewrites existing `projects.project_type` + `subtypes` rows** — also run on a branch/backup first. `20260617_workbench_schema` and `20260618_workbench_soft_delete` are purely additive/nullable (no backfill) and prod-safe, but still applied via an explicit approval gate. |

---
*Built for the future of construction management.*

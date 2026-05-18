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

> ⚠️ **The dedup step is destructive.** Always back up `status_logs` before running.

---
*Built for the future of construction management.*

# TASK: Feature Mapping & Contextual Discovery

Execute these steps to build a 360-degree understanding of the target feature **before** proposing any change. Stop and ask one clarifying question if you find conflicting logic or a dead-end code path. Do not guess.

> Read `sitepulse-next/AGENTS.md` first — it is the single source of architectural truth for this repo. There is no separate `ARCHITECTURE.md`.

**Step 1: Codebase Indexing & File Discovery**
Search the repository to identify every file related to this feature. SitePulse is a monorepo with two surfaces — be explicit about which one(s) the feature touches:
* **Frontend** (`sitepulse-next/`, Next.js App Router + React 19): UI components, Konva canvas layers (`src/components/canvas/`), Zustand stores (`src/store/*.ts`), TanStack Query hooks (`src/hooks/*.ts`), utilities (`src/utils/`), domain/database types (`src/types/`).
* **Backend** (`sitepulse-backend/main.py`, FastAPI): PDF/CAD vector extraction, export endpoints, JWT auth.
* **Database** (Supabase): tables, the `upsert_status_log` RPC, triggers, and SQL in `sitepulse-next/supabase/migrations/`.
* Output: a structured list of **Primary Impact Files** (direct changes) and **Secondary Impact Files** (dependencies / consumers).

**Step 2: Data Flow & Dependency Mapping**
Trace the data lifecycle. Data in this app originates from one of:
* **User canvas/field input** → staged in the local `pendingChanges` buffer (`useFieldData.ts`) → IndexedDB mutation queue → Supabase via `upsert_status_log` RPC / `.upsert()`.
* **Supabase** reads via TanStack Query hooks, with real-time WebSocket cache injections.
* **Procore SSO/OAuth** deep-link launch (`src/app/api/auth/procore/`) — this is OAuth provisioning, **not** a webhook.
* **Backend PDF vector extraction** (PyMuPDF) → `sheet_vectors` cache table → `useSnappingVectors()`.
Identify where state is transformed, which hook/service owns the logic, and where the final state is stored or rendered.

**Step 3: Integration & Sync-Integrity Audit**
Identify every external touchpoint and integrity guarantee the feature must preserve:
* Does it touch the **offline-first sync engine**? (the IDB mutation queue, per-item checkpointing, `client_timestamp` capture-time stamping, `hasRehydrated` guard, `isSyncingRef`). Breaking these causes data loss.
* Does it write `status_logs`? It MUST go through the `upsert_status_log` RPC or `.upsert({ onConflict: 'unit_id,activity_id' })` — never plain `.insert()`.
* Does it touch backend auth? Auth is **local JWT validation** (`PyJWT` + `SUPABASE_JWT_SECRET`) — never reintroduce a `supabase.auth.get_user()` network call.
* Does it touch the snapping engine? Never persist `RBush`/`Map`/`Set` instances into TanStack Query cache (IDB serialization will crash).

**Step 4: Pattern Recognition ("house style")**
Review `AGENTS.md` and existing components to identify the patterns you MUST reuse and the ones you MUST NOT break:
* **Reuse:** existing TanStack Query hooks for all data fetching; the appropriate Zustand store (`useMapStore`/`useUIStore`/`useSettingsStore`) for global UI state; `useHydratedStore` for persisted settings; `getSnappedCoordinate()` / `mixAlpha()` in `src/utils/geometry.ts`; the Container/Presenter pattern in `FieldStatusTable`.
* **Do NOT introduce:** `useState`/`useEffect` for data fetching or global UI state; class instances in Query cache; plain `.insert()` on `status_logs`; migrating `pendingChanges` out of local `useState`; `python-jose`; custom CSS outside Konva DOM overlays; `any` (prefer `unknown` + narrowing).
* Note: **offline caching is a required core capability here, not a forbidden pattern** — preserve it.

**Step 5: Contextual Summary**
Provide a concise summary of the feature's **current state** and the exact **blast radius** of the proposed change (which files, which sync/auth/type invariants are at risk). Do **not** propose an implementation plan yet.

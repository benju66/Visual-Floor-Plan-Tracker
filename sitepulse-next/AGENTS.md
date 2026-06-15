<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# SitePulse AI Assistant Instructions

Welcome to the SitePulse codebase. Please follow these architectural rules strictly to maintain the integrity of the application.

## 0. How to communicate with me (the user)
The user is the product owner, not a trained developer. When responding:
- **Lead with a 1-2 sentence plain-English summary** of what you did or found, before any technical detail.
- **Explain jargon in passing** — e.g. "the mutation queue (the list of offline changes waiting to save)".
- **Keep it short.** Prefer a few sentences over long essays. Only go deep when I ask, or when a decision genuinely needs it.
- **Still be precise** — don't dumb down the actual technical work or hide trade-offs; just frame them in everyday terms.
- When suggesting a change, say **what it does for the app/user**, not only how the code works.

## 1. Core Architecture
- **Framework:** Next.js (App Router)
- **Styling:** Tailwind CSS v4, Lucide React for icons
- **State Management:** Zustand (for Global UI / Persisted Settings — modularized into `useMapStore`, `useUIStore`, and `useSettingsStore`)
- **Data Fetching:** TanStack React Query (for Server State, Data Syncing, and Caching)
- **Database / Backend:** Supabase
- **Canvas Rendering:** Konva / React-Konva

## 2. State Management & Data Fetching (CRITICAL)
- **NEVER** use `useState` or `useEffect` for fetching database data or managing global UI state.
- **Data Fetching:** Always use/extend the established TanStack Query custom hooks (`src/hooks/useProjectQueries.ts`, `src/hooks/useMapActions.ts`, `src/hooks/useProjectActions.ts`). Server state handles an **Offline-First** setup utilizing `@tanstack/react-query-persist-client` writing to `IndexedDB` for durable disconnected mutations. Do not break this mutation queue or the WebSocket cache injections that resolve Thundering Herds.
- **Global State:** All floating UI state (modals, active tools, selected units, filters) MUST be managed in the appropriate Zustand store (`src/store/useMapStore.ts`, `src/store/useUIStore.ts`, or `src/store/useSettingsStore.ts`).
- **Persisted State:** When accessing persisted Zustand properties (like `settings`, `mapSettings`, `legendPosition`), you MUST use the `useHydratedStore` custom hook (exported from `src/store/useSettingsStore.ts`) to prevent React hydration mismatch errors.
- **`pendingChanges` is intentionally local `useState`** in `useFieldData.ts` — do NOT migrate it to Zustand or TanStack Query cache. It is a staging buffer that feeds the IDB mutation queue via `handleApplyAll` → `onApplyPendingChanges` → `commitUnitMilestone`. Moving it to global state would bypass the offline replay queue. However, an **IndexedDB persistence layer** (`src/utils/pendingChangesStore.ts`) writes the in-memory state to IDB on every update and rehydrates it on mount, so pending changes survive page refreshes and tab closures. IDB keys are **project-scoped** (`sitepulse-pending-changes-${projectId}`) to prevent cross-project data contamination. A `hasRehydrated` guard prevents the persist effects from overwriting IDB with empty state before rehydration completes.
- **Idempotent Sync Engine (`status_logs`):** The `status_logs` table has a `UNIQUE(unit_id, track, milestone)` constraint enforcing one current-state row per slot. All writes use either the `upsert_status_log` RPC (single mutations) or `.upsert({ onConflict: 'unit_id,track,milestone' })` (bulk). A Last-Write-Wins timestamp guard in the RPC rejects stale `client_timestamp` values. **Never revert to plain `.insert()` for status_logs** — it will cause constraint violations.
- **Status Audit Log:** A trigger-managed `status_audit_log` table records every state change (append-only). History/timeline queries (`useUnitHistory`, `useStatusHistory`) read from `status_audit_log`, NOT from `status_logs`. `status_logs` is current-state only; `status_audit_log` is the full timeline.
- **Per-Item IDB Checkpoint:** `handleApplyAll` dequeues items individually from IndexedDB after each successful mutation. An `isSyncingRef` guards the reactive `useEffect` persist hooks from firing during the sync loop. If the app crashes mid-sync, only unsynced items remain in IDB on rehydration. Do NOT remove `isSyncingRef` or revert to all-or-nothing queue clearing.
- **Capture-Time Timestamps:** `client_timestamp` is stamped at offline-capture time (when `PendingChange.capturedAt` is set in `handleLocalUpdate`), NOT at sync time. This ensures history timelines reflect actual field work progression. The `commitUnitMilestone` function in `useMapActions.ts` passes `extraProps.client_timestamp` through to the mutation; for immediate (online) mutations, `useUpdateStatus` stamps it as a fallback.
- **RLS Security Posture (2026-06):** `upsert_status_log` is `SECURITY INVOKER` — the `status_logs` RLS membership policies govern writes. Do NOT flip it back to `SECURITY DEFINER` or re-grant `EXECUTE` to `anon`; that re-opens unauthenticated status writes. Privileged-role checks in policies use `role in ('owner','admin','pm')` — `create_new_project` assigns `'owner'`, so never drop it from those lists. The `floorplans` storage bucket is **public by design** (capability URLs keyed by sheet UUID; required by the versioned-URL caching pipeline in §5) — revisit before handling sensitive drawings or multi-tenant launch.

## 3. Map & Canvas Engine (React-Konva)
- The interactive floorplan map is rendered via `<FloorplanCanvas />`. Operations rely heavily on Konva's drawing lifecycle.
- **Event Bubbling & Native Isolation:** Map interactions are complex. While React's synthetic `e.stopPropagation()` stops bubbling within the React tree (sufficient for most `onClick` events), it **does not** stop native events from reaching Konva's native DOM listeners. For custom HTML overlays that scroll or require strict isolation from map zooming/panning, you MUST use a `useRef` to attach a native DOM event listener (e.g., `el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: false })`) and utilize CSS like `overscroll-contain` to prevent browser scroll chaining.
- The Canvas UI is modularized (`CanvasContextMenu`, `MapHorizontalToolbar`). Avoid bloating the main `FloorplanCanvas` file.
- The field list UI uses a **Container/Presenter pattern**: `FieldStatusTable` (container, `src/components/FieldStatusTable.tsx`) invokes `useFieldData` (`src/hooks/useFieldData.ts`) for shared business logic, then conditionally renders one of three presenters: `StatusTable` (desktop table), `DesktopCardGrid` (desktop cards), or `MobileSwipeDeck` (mobile swipe). `MobileSwipeDeck` is **lazy-loaded** via `next/dynamic` with `ssr: false` to exclude it from the desktop bundle. Shared UI atoms live in `src/components/ui/FieldStatusAtoms.tsx`. The mobile header includes a `SyncIndicator` (`src/components/ui/SyncIndicator.tsx`) that shows pending/synced state.

## 4. Best Practices
- Components needing client hooks must start with `"use client"`.
- If modifying database schemas, immediately reflect changes in the Supabase query definitions located in the hook files.
- **Database Schema Changes:** New tables (`status_audit_log`) and functions (`upsert_status_log`) must have their types added to `src/types/database.types.ts` (Tables and Functions blocks respectively). Derive domain types in `src/types/domain.ts` using `Database['public']['Tables']['<table>']['Row']`.
- Stick to Tailwind utilities for new implementations; do not introduce custom CSS files unless fundamentally required for Konva DOM overlays.

## 5. Hybrid Vector-Snapping Engine
- The backend parses CAD/PDF files via PyMuPDF into percentage-normalized line data.
- The frontend loads this array via `useSnappingVectors()` (which checks the `sheet_vectors` cache table first, then falls back to the backend API with write-through caching).
- **CRITICAL:** Do NOT attempt to persist instantiated `RBush` class objects into TanStack Query state, as this will crash the `@tanstack/react-query-persist-client` IndexedDB serialization. Always return raw JSON arrays from the hook, and instantiate `RBush` inside `useState` + deferred `useEffect(setTimeout(10))` blocks within the rendering components to avoid blocking the initial render.
- Rely on `getSnappedCoordinate()` in `src/utils/geometry.ts` for aspect-ratio aware mathematical snapping and "Gravity" corner-snapping. The `mixAlpha()` utility in the same file is the single source of truth for CSS color → rgba() conversion (handles hex, rgb, rgba inputs).
- **PDF Rendering (off-main-thread):** The floor-plan drawing is rendered client-side by pdf.js inside a dedicated Web Worker (`src/workers/pdfRender.worker.ts` + `src/workers/pdfRenderProtocol.ts`). `usePdfRenderer` is a thin client: it downloads the original PDF (through the module-level LRU byte cache in `src/utils/pdfByteCache.ts` — call `invalidatePdfBytes(sheetId)` whenever a sheet's original PDF changes) and receives transferred `ImageBitmap`s: a 1×/2× LOD pyramid eagerly, the 4× LOD lazily on first deep zoom, and debounced sharp viewport crops past `DEEP_ZOOM_THRESHOLD`. Shared pure math lives in `src/utils/pdfRenderMath.ts` (unit-tested). Do NOT call pdf.js `page.render` on the main thread — it rasterizes on the calling thread and janks Konva pan/zoom. PDF bytes and the preview PNG are fetched via **versioned public URLs** (`src/utils/pdfSource.ts`, `?v=<sheets.pdf_version>`) so the browser/CDN can cache them long-term; the backend bumps `pdf_version` on upload/re-attach. The server-rendered `converted/<sheetId>.png` doubles as an instant placeholder LOD before pdf.js output exists. The OpenSeadragon tile path was removed; `tile_manifest_url` is a vestigial column.

## 6. TypeScript Guardrails (CRITICAL)
- **Language:** This codebase is migrating incrementally from JavaScript to strict TypeScript. `tsconfig.json` has `allowJs: true` and `checkJs: false`, so `.js`/`.jsx` files remain valid during migration.
- **Type Registry:** All shared domain types live in `src/types/`. The single source of truth is `src/types/domain.ts`, which derives Row/Insert types from the auto-generated `src/types/database.types.ts`. **Never** hand-write a type that duplicates a Supabase table shape — always derive it via `Database['public']['Tables']['<table>']['Row']`.
- **JSONB Narrowing:** Supabase's type generator types JSONB columns as `Json`. You MUST narrow these at the query boundary (inside `queryFn`) using type guards or assertions — do NOT let `Json` propagate into component props. Use the `isPercentPointArray()` guard in `src/types/domain.ts` for `polygon_coordinates`.
- **IDB Serialization Safety:** The offline mutation queue (`src/utils/persister.ts`) uses `@tanstack/query-async-storage-persister` to write to IndexedDB. Every value flowing through TanStack Query cache MUST be JSON-serializable. **Never** store class instances (e.g., `RBush`, `Map`, `Set`, DOM nodes) in query state. If `JSON.parse(JSON.stringify(value))` would lose data, it cannot go in the cache.
- **Zustand Store Typing:** Every Zustand store must be created with an explicit state interface: `create<MyState>()(...)`. Setter functions that accept functional updaters must be typed as `(val: T | ((prev: T) => T)) => void`.
- **`pendingChanges` Remains Local:** The `pendingChanges` and `pendingTimelineChanges` state in `useFieldData.ts` is typed as `Record<string, PendingChange>` via local `useState`. This is intentional — do NOT migrate it to Zustand or TanStack Query. A separate IDB persistence layer (`src/utils/pendingChangesStore.ts`) persists these maps to IndexedDB using project-scoped keys via `idb-keyval`. Do NOT change the key format (`sitepulse-pending-changes-${projectId}`) or remove the `hasRehydrated` guard. Note: `setPendingTimelineChanges` is explicitly exported to allow `MobileSwipeDeck` to manage deep snapshot undo/redo queues. See Section 2 for full rationale.
- **No `any`:** Prefer `unknown` with type narrowing over `any`. During migration, `// @ts-nocheck` may be temporarily used on large files being converted, but must be removed before merging to main.
- **File Extensions:** New files must use `.ts`/`.tsx`. When converting an existing file, rename `.js` → `.ts` or `.jsx` → `.tsx` and fix all type errors before committing. Do not commit a renamed file that still has `// @ts-nocheck`  to the main branch.

## 7. Backend API Rules (`sitepulse-backend/main.py`)
- **Auth Pattern (CRITICAL):** ALL protected endpoints use `Depends(get_current_user)`. This dependency validates the Supabase JWT **locally** using `PyJWT` and `SUPABASE_JWT_SECRET` — it does NOT call `supabase.auth.get_user()`. Do NOT revert to the network call; it was a primary cause of `/extract-vectors` 500 timeouts on Render's free tier. The correct pattern is:
  ```python
  import jwt  # PyJWT — NOT python-jose (abandoned, CVE-2024-33663)
  payload = jwt.decode(token, supabase_jwt_secret, algorithms=["HS256"], options={"verify_aud": False})
  ```
- **Supabase Client Timeouts:** The global `supabase` client is initialized with `SafeClientOptions(postgrest_client_timeout=25, storage_client_timeout=25)`. `SafeClientOptions` is a local subclass of `ClientOptions` that adds the missing `storage` field — a guard against a supabase-py v2.28.3 regression where `_init_supabase_auth_client` reads `client_options.storage` but the dataclass omits it. Do NOT revert to plain `ClientOptions` unless a future supabase-py release restores the field. The 25-second limits exist to ensure storage downloads fail gracefully as catchable Python exceptions before Render's 30-second platform deadline fires an opaque process kill. Do NOT remove or increase these values without a corresponding Render plan upgrade.
- **Startup Validation:** The `lifespan` async context manager validates that `supabase.auth`, `supabase.storage`, and `supabase.postgrest` all initialized before accepting traffic. This converts silent import-time crashes into clear deploy-time failures in Render logs. Do NOT remove this guard.
- **No `python-jose`:** The project uses `PyJWT==x.x.x` exclusively. `python-jose` is abandoned (last release 2021, CVE-2024-33663) and must not be re-added.
- **No Debug File Writes:** Never write user data to disk in endpoint handlers (e.g., `open("debug.txt", "w")`). Render's filesystem is ephemeral and shared; this leaks PII. Use `print()` or structured logging to stdout only — Render captures stdout in its log dashboard.
- **Exception Handling:** Each endpoint wraps its work in `try / except fitz.FileDataError / except HTTPException / except Exception`. The `except fitz.FileDataError` branch returns a 404 (PDF not found). Storage timeouts surface as `httpx.ReadTimeout` and are caught by the generic `except Exception` block — they will now produce a descriptive 500 message instead of a silent platform kill.

## 8. Backend Dependency Notes (`sitepulse-backend/requirements.txt`)
- **`pyiceberg` is a transitive dependency of `storage3`** (the Supabase Storage client), which requires `pyiceberg>=0.10.0`. You cannot remove it from the installed environment by removing it from `requirements.txt` — pip's resolver will pull it back in. Do not waste effort attempting to eliminate it.
- **Do NOT manually pin `starlette`**: FastAPI manages its own compatible `starlette` version. A manual pin creates silent conflicts. Let FastAPI's declared dependency resolve it.
- **Do NOT re-add `python-jose`**: See §7. Use `PyJWT` only.
- **`rich`, `cachetools`, `tenacity`** are required by `supabase-py` internals. Keep them pinned even though `main.py` does not import them directly.

## 9. Testing
- **Frontend (`sitepulse-next/`) — Vitest + React Testing Library.** Config in `vitest.config.ts` (jsdom env, `@/*` alias via native `resolve.tsconfigPaths`, setup in `vitest.setup.ts`). Tests are co-located: `foo.ts` → `foo.test.ts`, globbed from `src/**/*.{test,spec}.{ts,tsx}`. Run with `npm run test` / `test:watch` / `test:coverage`.
  - **Vitest globals are OFF on purpose** — import `{ describe, it, expect, vi }` from `'vitest'` in each file so `tsc --noEmit` stays clean without extra global types. Test files ARE included in `npm run typecheck`; keep them type-clean.
  - Prioritize the pure-logic and serialization layers — they hold the load-bearing invariants. Seed coverage exists for `src/utils/geometry.ts`, `src/types/domain.ts` (the JSONB guards), and `src/utils/pendingChangesStore.ts` (project-scoped IDB keys, empty-map-deletes-key, silent IDB degradation). Mock `idb-keyval` via `vi.mock`; stub `RBush` as `{ search: () => items } as never` rather than importing the real index.
  - Note: the `domain.ts` guards are not null-safe per element (`isPercentPointArray([null])` throws, not `false`) — test with safe primitives.
- **Backend (`sitepulse-backend/`) — pytest.** Tests in `tests/`; dev deps in `requirements-dev.txt` (`pip install -r requirements-dev.txt`). Run `python -m pytest -q` from the backend dir. The root `conftest.py` sets hermetic `SUPABASE_*` env vars BEFORE `main` is imported (required — `main` raises at import without them) and exports `TEST_JWT_SECRET` for minting test JWTs. `pytest.ini` restricts collection to `tests/`, excluding the ad-hoc root `test_fitz.py`.
  - Seed coverage pins the security-critical auth path: `get_current_user` accepts a valid `authenticated` JWT and rejects expired / wrong-role / tampered tokens with 401, and protected routes reject a missing bearer before any handler or Supabase call runs.
- **No E2E framework yet** (Playwright deferred). Canvas/swipe-deck flows are verified manually via `npm run dev` — see the `verify-feature` skill.
- When adding behavior, add or extend a test. See the `write-tests` skill in `.agent/skills/` for the full conventions and mocking recipes.

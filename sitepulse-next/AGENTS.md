<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# SitePulse AI Assistant Instructions

Welcome to the SitePulse codebase. Please follow these architectural rules strictly to maintain the integrity of the application.

## 1. Core Architecture
- **Framework:** Next.js (App Router)
- **Styling:** Tailwind CSS v4, Lucide React for icons
- **State Management:** Zustand (for Global UI / Persisted Settings — modularized into `useMapStore`, `useUIStore`, and `useSettingsStore`)
- **Data Fetching:** TanStack React Query (for Server State, Data Syncing, and Caching)
- **Database / Backend:** Supabase
- **Canvas Rendering:** Konva / React-Konva

## 2. State Management & Data Fetching (CRITICAL)
- **NEVER** use `useState` or `useEffect` for fetching database data or managing global UI state.
- **Data Fetching:** Always use/extend the established TanStack Query custom hooks (`src/hooks/useProjectQueries.js`, `src/hooks/useMapActions.js`, `src/hooks/useProjectActions.js`). Server state handles an **Offline-First** setup utilizing `@tanstack/react-query-persist-client` writing to `IndexedDB` for durable disconnected mutations. Do not break this mutation queue or the WebSocket cache injections that resolve Thundering Herds.
- **Global State:** All floating UI state (modals, active tools, selected units, filters) MUST be managed in the appropriate Zustand store (`src/store/useMapStore.js`, `src/store/useUIStore.js`, or `src/store/useSettingsStore.js`).
- **Persisted State:** When accessing persisted Zustand properties (like `settings`, `mapSettings`, `legendPosition`), you MUST use the `useHydratedStore` custom hook (exported from `src/store/useSettingsStore.js`) to prevent React hydration mismatch errors.
- **`pendingChanges` is intentionally local `useState`** in `useFieldData.js` — do NOT migrate it to Zustand or TanStack Query cache. It is a staging buffer that feeds the IDB mutation queue via `handleApplyAll` → `onApplyPendingChanges` → `commitUnitMilestone`. Moving it to global state would bypass the offline replay queue.

## 3. Map & Canvas Engine (React-Konva)
- The interactive floorplan map is rendered via `<FloorplanCanvas />`. Operations rely heavily on Konva's drawing lifecycle.
- **Event Bubbling & Native Isolation:** Map interactions are complex. While React's synthetic `e.stopPropagation()` stops bubbling within the React tree (sufficient for most `onClick` events), it **does not** stop native events from reaching Konva's native DOM listeners. For custom HTML overlays that scroll or require strict isolation from map zooming/panning, you MUST use a `useRef` to attach a native DOM event listener (e.g., `el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: false })`) and utilize CSS like `overscroll-contain` to prevent browser scroll chaining.
- The Canvas UI is modularized (`CanvasContextMenu`, `MapHorizontalToolbar`). Avoid bloating the main `FloorplanCanvas` file.
- The field list UI uses a **Container/Presenter pattern**: `FieldStatusTable` (container, `src/components/FieldStatusTable.jsx`) invokes `useFieldData` (`src/hooks/useFieldData.js`) for shared business logic, then conditionally renders one of three presenters: `StatusTable` (desktop table), `DesktopCardGrid` (desktop cards), or `MobileSwipeDeck` (mobile swipe). Shared UI atoms live in `src/components/ui/FieldStatusAtoms.jsx`. Pure sub-components live in `src/components/ui/StatusTrigger.jsx` and `src/components/ui/DatesInline.jsx`.

## 4. Best Practices
- Components needing client hooks must start with `"use client"`.
- If modifying database schemas, immediately reflect changes in the Supabase query definitions located in the hook files.
- Stick to Tailwind utilities for new implementations; do not introduce custom CSS files unless fundamentally required for Konva DOM overlays.

## 5. Hybrid Vector-Snapping Engine
- The backend parses CAD/PDF files via PyMuPDF into percentage-normalized line data.
- The frontend loads this array via `useSnappingVectors()` (which checks the `sheet_vectors` cache table first, then falls back to the backend API with write-through caching).
- **CRITICAL:** Do NOT attempt to persist instantiated `RBush` class objects into TanStack Query state, as this will crash the `@tanstack/react-query-persist-client` IndexedDB serialization. Always return raw JSON arrays from the hook, and instantiate `RBush` inside `useState` + deferred `useEffect(setTimeout(10))` blocks within the rendering components to avoid blocking the initial render.
- Rely on `getSnappedCoordinate()` in `src/utils/geometry.ts` for aspect-ratio aware mathematical snapping and "Gravity" corner-snapping. The `mixAlpha()` utility in the same file is the single source of truth for CSS color → rgba() conversion (handles hex, rgb, rgba inputs).
- **Tile Pyramid Rendering:** When `sheet.tile_manifest_url` is present, `FloorplanCanvas` renders an OpenSeadragon `TileRenderer` behind the Konva `Stage` for progressive deep-zoom loading. When absent, the legacy `useImage()` + `<KonvaImage>` path is used. All markup and interaction remains on the Konva layer.

## 6. TypeScript Guardrails (CRITICAL)
- **Language:** This codebase is migrating incrementally from JavaScript to strict TypeScript. `tsconfig.json` has `allowJs: true` and `checkJs: false`, so `.js`/`.jsx` files remain valid during migration.
- **Type Registry:** All shared domain types live in `src/types/`. The single source of truth is `src/types/domain.ts`, which derives Row/Insert types from the auto-generated `src/types/database.types.ts`. **Never** hand-write a type that duplicates a Supabase table shape — always derive it via `Database['public']['Tables']['<table>']['Row']`.
- **JSONB Narrowing:** Supabase's type generator types JSONB columns as `Json`. You MUST narrow these at the query boundary (inside `queryFn`) using type guards or assertions — do NOT let `Json` propagate into component props. Use the `isPercentPointArray()` guard in `src/types/domain.ts` for `polygon_coordinates`.
- **IDB Serialization Safety:** The offline mutation queue (`src/utils/persister.ts`) uses `@tanstack/query-async-storage-persister` to write to IndexedDB. Every value flowing through TanStack Query cache MUST be JSON-serializable. **Never** store class instances (e.g., `RBush`, `Map`, `Set`, DOM nodes) in query state. If `JSON.parse(JSON.stringify(value))` would lose data, it cannot go in the cache.
- **Zustand Store Typing:** Every Zustand store must be created with an explicit state interface: `create<MyState>()(...)`. Setter functions that accept functional updaters must be typed as `(val: T | ((prev: T) => T)) => void`.
- **`pendingChanges` Remains Local:** The `pendingChanges` and `pendingTimelineChanges` state in `useFieldData.ts` is typed as `Record<string, PendingChange>` via local `useState`. This is intentional — do NOT migrate it to Zustand or TanStack Query. See Section 2 for rationale.
- **No `any`:** Prefer `unknown` with type narrowing over `any`. During migration, `// @ts-nocheck` may be temporarily used on large files being converted, but must be removed before merging to main.
- **File Extensions:** New files must use `.ts`/`.tsx`. When converting an existing file, rename `.js` → `.ts` or `.jsx` → `.tsx` and fix all type errors before committing. Do not commit a renamed file that still has `// @ts-nocheck`  to the main branch.

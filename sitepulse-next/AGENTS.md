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

## 3. Map & Canvas Engine (React-Konva)
- The interactive floorplan map is rendered via `<FloorplanCanvas />`. Operations rely heavily on Konva's drawing lifecycle.
- **Event Bubbling:** Map interactions are complex. Ensure custom HTML overlays (Toolbars, Context Menus) cleanly stop event propagation (e.g., `e.stopPropagation()`) so clicking a button doesn't trigger a canvas `onClick`.
- The Canvas UI is modularized (`CanvasContextMenu`, `MapHorizontalToolbar`, `FieldStatusTable`). Avoid bloating the main `FloorplanCanvas` file.

## 4. Best Practices
- Components needing client hooks must start with `"use client"`.
- If modifying database schemas, immediately reflect changes in the Supabase query definitions located in the hook files.
- Stick to Tailwind utilities for new implementations; do not introduce custom CSS files unless fundamentally required for Konva DOM overlays.

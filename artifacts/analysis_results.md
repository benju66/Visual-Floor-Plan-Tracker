# SitePulse Architecture Audit Report

Following a deep codebase review indexing the data flow, dependencies, and integration points, below is the structured audit report categorizing the identified architectural issues by severity.

## 🚨 CRITICAL (Must Fix Now)
*Bugs that cause data loss, security breaches, or fatal crashes.*

* **Offline Queue Synchronization Data Bloat (Data Integrity Risk):**
  * **Location:** `src/hooks/useFieldData.ts` (`handleApplyAll`) and `src/hooks/useProjectQueries.ts` (`useUpdateStatus`).
  * **Issue:** When a mobile user restores connectivity, `handleApplyAll` iterates sequentially through the `pendingChanges` array, firing an individual API mutation for each item. If the application is closed or crashes mid-sync, the local IDB queue is not updated to reflect the successful mutations. Upon reopening, the entire queue is rehydrated and re-submitted. Because the backend `useUpdateStatus` performs an `insert` (append-only) rather than an idempotent `upsert` for `status_logs`, this creates duplicate database records, eventually bloating the application and skewing history timelines.

## ⚠️ WARNING (Fix Soon)
*UX glitches, performance bottlenecks, or race conditions.*

* **Thundering Herd / Sync Performance Bottleneck:**
  * **Location:** `src/hooks/useFieldData.ts`
  * **Issue:** The sequential `for` loop executing `await onApplyPendingChanges?.([change])` performs poorly for large bulk updates (e.g., hundreds of offline field changes). This creates a massive UI block and prolonged `isApplying` states. It should be refactored to chunk updates and leverage the existing `useBulkInsertStatusLogs` mutation.
* **Canvas Component Monolith:**
  * **Location:** `src/components/FloorplanCanvas.tsx`
  * **Issue:** The canvas file spans ~1700 lines. It acts as a monolith handling event bubbling, matrix math, coordinate mapping, vector geometry initialization (`RBush`), panning/zooming, and keyboard shortcuts. This concentrated complexity is highly prone to regression and makes unit testing individual canvas interactions extremely difficult.
* **Incomplete TypeScript Migration:**
  * **Location:** `src/components/StatusTable.jsx`, `src/components/DesktopCardGrid.jsx`
  * **Issue:** The repository is in a transitional state. Essential UI components relying on strict data structures (like status logs and milestones) are still in JavaScript, bypassing the strict JSONB type narrowings mandated in `AGENTS.md`. This increases the likelihood of runtime `TypeError` crashes.
* **Potential Native DOM Event Bleed:**
  * **Location:** Canvas overlay components.
  * **Issue:** While `AGENTS.md` explicitly mandates the use of native `useRef` event listeners with CSS `overscroll-contain` to stop React synthetic events from bubbling into Konva's native listeners, the sprawling nature of the current canvas setup makes it easy for future context menus or toolbars to accidentally capture drag/wheel events meant for the canvas, causing erratic UX behavior on touch devices.

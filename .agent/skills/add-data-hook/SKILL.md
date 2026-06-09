# TASK: Add or Extend a Data Hook (SitePulse)

Use this when a feature needs to read or write server data, or manage global UI state. The rules here are non-negotiable — they protect the offline-first sync engine and the IndexedDB persistence layer. Ground everything in `sitepulse-next/AGENTS.md` §2 and §6.

**Step 1: Decide what kind of state this is**
* **Server data (DB reads/writes, syncing, caching)** → TanStack React Query, via the established hooks. **NEVER** use `useState`/`useEffect` to fetch DB data.
* **Global UI state (modals, active tools, selected units, filters)** → the appropriate Zustand store: `src/store/useMapStore.ts`, `useUIStore.ts`, or `useSettingsStore.ts`. **NEVER** use `useState`/`useEffect` for this.
* **Persisted settings** (e.g. `settings`, `mapSettings`, `legendPosition`) → read through the `useHydratedStore` hook (exported from `useSettingsStore.ts`) to avoid React hydration mismatches.
* **The `pendingChanges` field buffer** stays local `useState` in `useFieldData.ts` — do not move it. It feeds the IDB mutation queue.

**Step 2: Extend an existing hook, don't fork the pattern**
* Reads/queries live in `src/hooks/useProjectQueries.ts`. Mutations/actions live in `src/hooks/useMapActions.ts` and `src/hooks/useProjectActions.ts`. Add to these rather than scattering new `useQuery`/`useMutation` calls in components.
* Match the existing query-key conventions so cache invalidation and the WebSocket cache injections keep working.

**Step 3: Keep cache values serializable (CRITICAL)**
* The Query cache is persisted to IndexedDB via `@tanstack/query-async-storage-persister` (`src/utils/persister.ts`). Every cached value MUST be JSON-serializable.
* **Never** put a class instance (`RBush`, `Map`, `Set`, DOM node) into query state — it crashes the IDB serializer. Return raw JSON arrays from the hook and instantiate classes (e.g. `RBush`) inside the consuming component via `useState` + a deferred `useEffect(setTimeout(...))`. See `useSnappingVectors()` for the write-through-cache pattern (check the `sheet_vectors` cache table, fall back to the backend API).

**Step 4: Narrow JSONB at the query boundary**
* If the query returns a JSONB column (typed `Json`), narrow it inside `queryFn` with a type guard (e.g. `isPercentPointArray` for `polygon_coordinates`). Do not let `Json` propagate into component props.
* Derive return types from `src/types/domain.ts` — never hand-write a shape that duplicates a Supabase table.

**Step 5: Mutations must preserve sync integrity**
* `status_logs` writes go through the `upsert_status_log` RPC (single) or `.upsert({ onConflict: 'unit_id,track,milestone' })` (bulk) — **never** plain `.insert()`.
* Preserve `client_timestamp` capture-time semantics: it is stamped when the change is captured offline (`PendingChange.capturedAt`), not at sync time. Pass it through; don't restamp it at sync.
* Don't break the IDB mutation queue, the per-item checkpointing (`isSyncingRef`), or the `hasRehydrated` guard.

**Step 6: Verify**
* `npm run typecheck` and `npm run lint`.
* Add a Vitest test for any pure logic / serialization behavior the hook introduces (see the `write-tests` skill); run `npm run test`.
* For sync-affecting changes, manually verify the offline path: apply changes offline → confirm IDB persistence under the project-scoped key → reload → confirm replay with no duplicate `status_logs` rows.

**Gate:** Report verification output. Flag any place you were tempted to use `useState`/`useEffect` for data and chose the hook/store instead.

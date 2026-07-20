# Frontend Structure (W3) — centralize query keys, split the data-layer god-file, finish the TS migration (self-contained build plan)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: W3 of the 2026-07-15 code-review backlog. Sibling that defers work HERE: `Notes/plans/JS-to-TS-Migration-Plan.md` (W2 — "queryKeys sweep, file splits" and "QueryProvider converts at the END of W3"). W2 is COMPLETE (P1 #17 · flag-cleanup #18 · P2 #19 · P3 #20, all merged 2026-07-20), so W3's gating dependency is cleared.

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` — **§2 (state/sync engine) is the load-bearing section for this workstream**; also §5 (no RBush/Map/Set in cache) and §6 (TS guardrails).
2. Re-read the files named below fresh — **do not trust line numbers; they drift** (this file was written against `useProjectQueries.ts` = 1,555 lines; it grows).
3. Build the sub-phases IN ORDER. Verify after each (§ Verification). Each phase is one fresh session.
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence plain-English summary; explain jargon in passing; keep it short.

## Goal
When W3 is done, the app behaves **exactly** as it does today, but its data layer is maintainable: the ~67 hand-written react-query cache keys all flow through one central factory (so a rename can't silently break cache invalidation), the 1,555-line `useProjectQueries.ts` god-file is split into small domain files (units, statuses, activities, sheets, contacts, history, …) behind a barrel so no importer changes, and the last untyped file (`QueryProvider.jsx`) becomes strict TypeScript — closing the JS→TS migration 100%. Zero user-visible change; the payoff is that a whole class of "edited one hook, silently broke another view's cache" bugs becomes far harder to introduce, and the offline-sync spine is finally fully typed.

## Out of scope / deferred
- **ZERO behavior change.** This is a pure structure/typing refactor. Nothing about what the owner sees or how sync behaves may change. A bug or smell found mid-refactor gets **FLAGGED** in the phase report, not silently fixed. There are **no sanctioned runtime edits** in this workstream (unlike W2 Phase 3's date-sort).
- **`SettingsMenu.tsx` decomposition is OUT** (owner decision — "Core data-layer" scope). It is a 1,333-line *presentational* god-component (already TypeScript, no data-layer overlap). It stays an **opportunistic Codebase-Health item** — lift a tab into `settings/<Tab>.tsx` only when a feature already touches that tab. If a W3 hook-signature change ripples into `SettingsMenu`'s call sites, update the call sites in place; do **not** decompose it here.
- **`MobileSwipeDeck` pure-logic extraction + tests is an OPTIONAL final phase (P7)** the owner green-lights or skips. It is independent of the query layer (see Open decisions).
- **No schema changes, no migrations, no RLS/auth changes, no offline-queue semantics changes.** Nothing moves between the DB and the app.
- **The genuine `walk_sequence` schema-type gap** (`database.types.ts` is missing the `units.walk_sequence` column, forcing `.update({ walk_sequence } as any)` in `useUpdateWalkSequence`) — regenerating/patching `database.types.ts` to delete that one `as any` is allowed IF it's a pure type addition matching the live column (verify against prod schema first), else FLAG it. Do not chase the other ~30 read-boundary casts in this workstream unless a split trivially dissolves one.

## Relationship to Codebase Health Slice 2 (reconciliation — read once)
`Codebase-Health-Refactor-Master-Plan.md` Slice 2 listed `useProjectQueries.ts` + `SettingsMenu.tsx` as god-files but **never committed to them** — Target 1 (FloorplanCanvas) shipped; the standing recommendation for Targets 2 & 3 was "return to features, split opportunistically." **W3 ABSORBS the `useProjectQueries` split** (Slice 2 Target 2 is redirected here). `SettingsMenu` (Target 3) stays with Codebase Health per above. Recommended one-line housekeeping (not required to start): annotate Slice 2 Target 2 in the master plan as "→ redirected into W3 (Frontend Structure)". Do NOT run a parallel Codebase-Health lane against `useProjectQueries` while W3 is live — two plans owning one 1,555-line spine file is the direct-conflict risk.

## Locked product decisions (from the owner)
- **Scope = "Core data-layer"** (2026-07-20): queryKeys sweep → `useProjectQueries` domain split (barrel-preserving) → `QueryProvider`→TS last. Characterization tests folded in (which also closes the flagged `useProjectActions` test gap). `SettingsMenu` excluded; `MobileSwipeDeck` = optional final phase.
- **Zero behavior change**; flag-don't-fix; no `@ts-nocheck`/`@ts-ignore`/new `any` reaches main.
- **Barrel-preserving split**: `useProjectQueries.ts` stays as a re-export barrel throughout so all ~35 importers resolve unchanged; per-domain import rewrites (if ever) are a later, optional pass — NOT part of W3.

## Data model
No schema changes. The refactor only reshapes how the app **caches and invalidates** existing reads/writes. The invariants it must preserve byte-for-byte (AGENTS §2):
- **`status_logs` writes** go through `upsert_status_log` (single) or `.upsert({ onConflict: 'unit_id,activity_id' })` (bulk) — **never `.insert()`**. The slot key is `activity_id` (not the name); strip the synthesized `activityName` and legacy `milestone` keys before every write.
- **Omit-preserves / present-clears** date semantics (`upsert_status_log`, migration `20260712`) are hand-implemented in the four status mutations — when Statuses is extracted (P5), this contract must land in ONE shared helper, not be forked.
- **Capture-time `client_timestamp`** is stamped at capture (or as an online fallback in `useUpdateStatus`) — preserve exactly.
- Query caches this touches (shapes that must stay stable): `['statuses', sheetId, ...unitIds]` = `StatusLog[]` (with synthesized `activityName`), `['all_project_statuses', ...unitIds]` = `StatusLog[]`, `['all_project_units', ...sheetIds]` = `Unit[]`, `['units', sheetId]` = `Unit[]`, `['activities', projectId]` = `Activity[]`, `['sheet', sheetId]` = a single `Sheet`.
- **IDB serialization (AGENTS §5/§6):** everything in the cache must remain JSON-serializable — never let an `RBush`/`Map`/`Set`/DOM node into query state. The `QueryProvider` realtime injector only ever writes plain row objects; keep it that way when typing it (P6).

## Build-on inventory (read these fresh before using)
- **`src/types/queryKeys.ts`** (~86 lines) — THE central key factory. A flat `export const queryKeys = { … } as const` map; each entry is `name: (args) => ['prefix', ...args] as const`. **It has NO prefix/partial-match accessors** — that's the gap P1 fills. It already has `sheets(projectId)` but **no `sheet(sheetId)`** (single-sheet). Extend it; keep the flat shape.
- **`src/hooks/useProjectQueries.ts`** (1,555 lines) — the god-file. 14 `useQuery` hooks, 28 `useMutation` hooks, 1 exported helper (`fetchAllIn<T>`, imported EXTERNALLY by `useWorkbench.ts` + `useProjectActions.ts`), 6 exported types (`MemberWithProfile`, `ProjectContactFields`, `RecalculateAreaUpdate`, `UpdateSheetScaleVars`, `NewActivityRow`, `StatusHistoryEvent`). No default export. Internal shared helpers: `fetchStatusLogsForUnits` (+ type `StatusRowWithActivity`), `selectUnitsWithOpeningEdges` (must stay module-scope for referential stability).
- **`src/hooks/useProjectActions.ts`** (~271 lines) — coupled: imports `useUpdateActivity`, `useReorderSheets`, `fetchAllIn` from the god-file; has its own inline `['statuses']` invalidation. NO test today. `handleDeleteSheet` is a 7-step cascade with a paginated `status_logs` delete that fixed a real 1000-row-cap prod bug — the highest-risk untested path.
- **`src/providers/QueryProvider.jsx`** (~113 lines) — the last `.jsx`. Sets up the offline-first `QueryClient` + persister, and holds the **realtime cache injector** (subscribes to `status_logs` postgres_changes; surgically injects/removes rows in caches keyed by inline `['statuses']` / `['all_project_statuses']` / `['activities']`, synthesizing `activityName` from the `['activities']` cache). Converting it needs the typed cache shapes + the new prefix accessors → that's why it's LAST.
- **`src/utils/persister.ts`** (~21 lines) — IDB async-storage adapter (`idb-keyval` → `createAsyncStoragePersister`). The `getItem: () => Promise<string | null | undefined>` union is load-bearing; don't narrow it. No changes expected.
- **Test harness (AGENTS §9):** `src/test/renderWithQuery.tsx` (fresh `QueryClient`, retries off) + chainable `vi.mock('@/supabaseClient')` stubs. Canonical examples: `src/hooks/useProjectQueries.test.tsx`, `src/hooks/useSnappingVectors.test.tsx`. **Do NOT add `msw`.** Vitest globals OFF — import `{ describe, it, expect, vi }` from `'vitest'`.
- **`src/utils/pagination.ts`** (`paginateAll`) + `fetchAllIn` — the 1000-row-cap-safe readers ([[supabase-1000-row-cap]]). Reuse; never revert an aggregation to a bare `.select()`.

## Pure logic to extract + unit-test
- **queryKey builder equivalence (P1):** a pure `queryKeys.test.ts` asserting every NEW prefix builder emits the EXACT array the old literal produced (e.g. `queryKeys.statusesBySheet('s1')` deep-equals `['statuses', 's1']`). This is the cheap guard that the sweep is byte-identical.
- **Status-write contract helper (P5):** extract the strip-`activityName`/`milestone` + omit-preserves/present-clears + `client_timestamp` stamping into ONE pure `src/utils/statusWrite.ts` (`+ .test.ts`) consumed by all four status mutations. Pass timestamps IN (never `Date.now()` inside). This is the single most important extraction in the workstream — the contract currently copy-pasted four ways.
- **(Optional, P7) MobileSwipeDeck deck logic:** deck ordering (`main` vs `skippedToBack`), the undo/redo pending-map reducer, and the none→planned→ongoing→completed transition → `src/utils/swipeDeck.ts` (`+ .test.ts`).

## Sub-phasing (ship + verify each)

### Phase 1 — queryKeys sweep (prerequisite for the split)
- **Scope:** Add the missing prefix/partial-match accessors to `src/types/queryKeys.ts` (at minimum: a single-sheet `sheet(sheetId)`; prefix builders for the variadic families so call sites stop hand-writing arrays — e.g. `statusesBySheet(sheetId)`→`['statuses', sheetId]`, `statusesAll()`→`['statuses']`, `allProjectStatusesAll()`→`['all_project_statuses']`, `allProjectUnitsAll()`→`['all_project_units']`, `unitsAll()`→`['units']`, `activitiesAll()`→`['activities']`). Each MUST emit an array byte-identical to the literal it replaces. Then migrate the **~67 production bypass call-sites** (Buckets A/B/C from the survey) across `useProjectQueries.ts`, `useMapActions.ts`, `useUndoRedo.ts`, `useProjectActions.ts`, `useWorkbenchActions.ts`, `GlobalSettingsModal.tsx`, `ScheduleWorkspace.tsx`, `MspImportPanel.tsx`, project `page.tsx`. **EXCLUDE `QueryProvider.jsx`** — its inline keys ride its own conversion (P6). Add the pure `queryKeys.test.ts` equivalence test.
- **Watch:** `useMapActions.ts` does positional prefix READS like `getQueryData(['statuses', activeSheetId])` against a stored `['statuses', sheetId, ...unitIds]` key — these are intentional prefix reads; map them to the new `statusesBySheet` accessor, do NOT "fix" them to the full `statuses(sheetId, unitIds)` key.
- **Approval gates:** ⛔ none beyond standing rules (branch off main, PR through CI, no merge until "Approved").
- **Exit criteria:** typecheck + full test suite + build green · new `queryKeys.test.ts` proves byte-identity · grep shows no inline `queryKey: ['statuses'…]`/`['all_project_…']`/`['units'…]`/`['sheet'…]`/`['activities']` literals remain OUTSIDE `queryKeys.ts` and `QueryProvider.jsx` · live dev:3010 smoke: open a project, change a status, confirm it still recolors on the map + updates the list (invalidation intact) · close with verify-feature.

### Phase 2 — Safety-net characterization tests (before the split)
- **Scope:** Add `src/hooks/useProjectActions.test.tsx` — activity CRUD (`handleAddActivity`/`handleUpdateActivity`/`handleDeleteActivity`) asserting the DB calls + the exact invalidation keys, plus a focused **`handleDeleteSheet` cascade** test pinning the paginated `status_logs` delete (the 1000-row-cap fix) and active-sheet reassignment. Extend `src/hooks/useProjectQueries.test.tsx` to cover the query/mutation hooks in the domains about to move that aren't yet covered (so the split runs under green). Mock via the existing `renderWithQuery` + chainable supabase stub recipe.
- **Approval gates:** ⛔ none. Tests-only; zero product diff.
- **Exit criteria:** new tests green + full suite green · these tests assert TODAY's behavior (they become the split's regression net) · close with verify-feature (SKIP the live click-through — tests-only phase).

### Phase 3 — Split wave 1 (lowest-coupling domains)
- **Scope:** Extract to new files under `src/hooks/` (keep `useProjectQueries.ts` as a barrel that `export *`s them all): (a) a **shared module** `src/hooks/projectQueriesShared.ts` (or similar) holding `fetchAllIn`, `fetchStatusLogsForUnits` + `StatusRowWithActivity`, and any literal-key constants — re-exported at the old path so `useWorkbench.ts`/`useProjectActions.ts` still resolve `fetchAllIn`; (b) **Contacts** (`useProjectContacts` + 4 mutations + `ProjectContactFields`) — fully self-contained, do first; (c) **History** (`useUnitHistory`, `useStatusHistory` + `StatusHistoryEvent`); (d) **Sheets** (`useSheets`, `useSheetById`, `useUpdateSheetScopes`, `useUpdateSheetScale` + `UpdateSheetScaleVars`, `useUpdateSheetSchedule`, `useReorderSheets`).
- **Approval gates:** ⛔ none. No call-site import changes (barrel absorbs it).
- **Exit criteria:** typecheck + full suite + build green · the barrel re-exports every moved symbol (type-only exports too: `ProjectContactFields`, `UpdateSheetScaleVars`, `StatusHistoryEvent`) · grep confirms all 35 importers still resolve · live dev:3010 smoke of a touched surface (open Contacts tab, open a sheet) · close with verify-feature.

### Phase 4 — Split wave 2 (units + activities)
- **Scope:** Extract **Units** (`useUnits` + `selectUnitsWithOpeningEdges`, `useAllProjectUnits`, `useCreateUnit`, `useUpdateUnitGeometry`, `useUpdateUnitFields`, `useClearProjectUnitTypes`, `useRecalculateSheetAreas` + `RecalculateAreaUpdate`, `useDeleteUnit`), **WalkSequence** (`useUpdateWalkSequence`), **Activities** (`useActivities`, `useUpdateActivity`, `useUpdateActivityRules`, `useSetActivitySubcontractor`, `useCreateActivitiesBulk` + `NewActivityRow`, `useReorderActivities`), **Applicability** (`useActivityOverrides`, `useSetActivityApplicability`, `useBulkSetApplicability`). The two cross-domain writers (`useDeleteUnit` writes `status_logs`; `useUpdateActivity` syncs `status_color` to `status_logs`) reference the STATUS keys via the P1 factory accessors — that's fine, they don't import status hooks. Extract the shared unit optimistic-rollback pattern to one helper if it falls out cleanly; else leave inline + FLAG.
- **Approval gates:** ⛔ none. **If this overruns one session, split Activities+Applicability into their own phase** — an extra kickoff is cheap.
- **Exit criteria:** triple-green · barrel intact · live dev:3010 smoke: trace/edit a unit, change an activity's applicability · close with verify-feature.

### Phase 5 — Split wave 3 (statuses — the write contract) + reshape useProjectActions
- **Scope:** Extract **Statuses** (`useStatuses`, `useAllProjectStatuses`, `useUpdateStatus`, `useClearStatus`, `useBulkUpdateStatus`, `useBulkInsertStatusLogs`) into their own file, AND land the shared `src/utils/statusWrite.ts` (§ Pure logic) so the omit-preserves/strip/`client_timestamp` contract lives in ONE place consumed by all four mutations (behavior byte-identical — pin with a `.test.ts`). Reshape `useProjectActions.ts`'s imports to the new file paths (or keep pulling from the barrel). Also extract **Project + Members** (`useProject`, `useUpdateProject`, `useProjectMembers`, `useCurrentUserRole`, `useUpdateProjectMemberRole` + `MemberWithProfile`) if not already homed. After this, `useProjectQueries.ts` is a thin barrel.
- **Approval gates:** ⛔ **HIGHEST-RISK PHASE — this is the offline-sync spine.** No gate beyond standing rules, but the Phase-2 safety net + AGENTS §2 invariants (upsert-only, capture-time timestamp, slot key = activity_id, strip synthesized fields) are characterization boundaries — preserve byte-for-byte; if the compiler or a "cleanup" tempts a runtime change, STOP and flag.
- **Exit criteria:** triple-green · `statusWrite.ts` unit-tested · live dev:3010: change single + bulk statuses online, then offline (DevTools offline) queue a change and confirm it replays on reconnect (the sync engine still works) · close with verify-feature.

### Phase 6 — QueryProvider.jsx → tsx (FINAL — closes the JS→TS migration 100%)
- **Scope:** Rename `src/providers/QueryProvider.jsx` → `.tsx` (keep `"use client"`). Type `{ children: React.ReactNode }`; type the Supabase realtime `payload` (`RealtimePostgresChangesPayload<…>` or a narrowed raw `status_logs` row) so `payload.new`/`payload.old` and the synthesized-`activityName` `newLog` are typed `StatusLog`; type the `['activities']` cache read as `Activity[]` and the `setQueryData`/`setQueriesData` updaters as `StatusLog[]`; route its inline `['statuses']`/`['all_project_statuses']`/`['activities']` keys through the P1 prefix accessors. Preserve the persister/buster/`shouldDehydrateMutation` block exactly.
- **Approval gates:** ⛔ App Router provider boundary → `build` is mandatory. No behavior change (realtime injector logic byte-identical). Don't touch persister/offline-queue semantics.
- **Exit criteria:** triple-green (build mandatory) · zero `@ts-nocheck`, no new `any` · `git ls-files 'src/**/*.jsx' 'src/**/*.js'` returns **NOTHING** (migration 100% complete) · live dev:3010: two tabs/sessions — change a status in one, confirm it injects into the other's map/list cache via realtime (the WebSocket sync still works) · close with verify-feature. **This phase completes W3's core and the JS→TS migration — update [[js-to-ts-migration-workstream]] to DONE.**

### Phase 7 (OPTIONAL — owner green-lights or skips) — MobileSwipeDeck pure-logic extraction + tests
- **Scope:** Extract the deck-ordering, undo/redo pending-map reducer, and swipe state machine from `src/components/MobileSwipeDeck.tsx` (614 lines) into `src/utils/swipeDeck.ts` (`+ .test.ts`); leave the framer-motion gesture wiring in the component. Closes the review's `MobileSwipeDeck` test gap. Independent of the query layer — can run any time, or never.
- **Approval gates:** ⛔ touches the `pendingChanges`/`pendingTimelineChanges` maps that feed the IDB offline queue (AGENTS §2) — the extraction must be behavior-identical; pin with tests before trusting it.
- **Exit criteria:** triple-green · new pure tests green · live dev:3010 (mobile viewport): swipe-right progression + undo/redo + choose-status still work · close with verify-feature.

## Hard guardrails (AGENTS.md — do not violate)
- **ZERO behavior change.** No sanctioned runtime edits in W3. If the compiler or a "while I'm here" pushes a runtime change — stop, flag, ask.
- **`status_logs`:** upsert-only (`upsert_status_log`/`.upsert`), never `.insert()`; slot key `activity_id`; strip `activityName`+`milestone` before write; omit-preserves/present-clears intact; capture-time `client_timestamp`.
- **`pendingChanges`/`pendingTimelineChanges` stay local `useState`** in `useFieldData.ts` — never migrate to Zustand/Query.
- **No `RBush`/`Map`/`Set`/DOM nodes in Query/IDB cache** (§5/§6). Keep `getSnappedCoordinate`/`RBush` instantiation out of cache state.
- **Barrel keeps every importer resolving** — a moved symbol MUST be re-exported at `src/hooks/useProjectQueries.ts` (both `@/hooks/useProjectQueries` and the relative `./useProjectQueries` importers point at it). Type-only exports too.
- **New prefix keys must be byte-identical** to the literals they replace — a single differing element silently breaks invalidation (pinned by `queryKeys.test.ts`).
- Derive Supabase shapes from `database.types.ts`/`domain.ts`; no `@ts-nocheck`/`@ts-ignore`/new `any` on main.
- Do NOT touch `SettingsMenu` decomposition, the offline queue, or `progressAnalytics`.
- ⚠️ dev:3010 points at PROD Supabase — click-throughs use throwaway data only; delete what you create ([[no-live-write-probes]]). **Restart dev:3010 after any file rename** (renaming App Router / provider files under a running dev server wedges it — the /dashboard 404 in W2 P3).

## Verification commands (the exit-criteria gate)
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
Lint is NOT a gate (~1850 pre-existing problems). Live click-throughs via `npm run dev:3010` (port 3010). Vitest globals OFF — import from `'vitest'`.

## Open decisions
- **P7 (MobileSwipeDeck) go/skip** — decide at the P6 close. It's independent; W3's core is P1–P6.
- **Master-plan annotation** — whether to mark Codebase-Health Slice 2 Target 2 as "redirected into W3" (recommended, one line) to keep the plan set self-consistent. Cosmetic; not blocking.
- **`walk_sequence` schema-type gap** — whether to patch `database.types.ts` to delete the one `as any` (only if it exactly matches the live column) or leave it flagged. Resolve in P4 when Units moves.

# Kickoff — Frontend Structure (W3), Phase 1: queryKeys sweep (the prerequisite for the file split)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Frontend Structure (W3)** — the queryKeys sweep: add the missing prefix/partial-match accessors to the central `src/types/queryKeys.ts` factory and migrate the ~67 hand-written cache-key call-sites through them (EXCLUDING `QueryProvider.jsx`, which is deferred to W3's final phase). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-20 - Frontend Structure Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Frontend-Structure-Plan.md` (Phase 1)
> - `sitepulse-next/AGENTS.md` (§2 is load-bearing)
>
> Branch off `main`, PR through CI. Build **only Phase 1**. ⛔ ZERO behavior change — every new key builder MUST emit an array byte-identical to the literal it replaces (a single differing element silently breaks cache invalidation); if anything tempts a runtime change, STOP and flag. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
The app caches server data with react-query, and every cache entry is identified by a "key" (a little array like `['statuses', sheetId]`). Today ~67 of those keys are typed out by hand, scattered across ~9 files — and because a key written in one file must exactly match the key read in another, a one-character drift silently breaks cache updates (a status change stops refreshing the map). This phase routes them all through the single key factory so they can't drift. It's also the **hard prerequisite** for the next phases: we can't safely split the big `useProjectQueries.ts` file until writers and readers share one key symbol instead of duplicated literals.

## Where the workstream stands
W3 is the final lane of the 2026-07-15 review (W1 Guardrails / W2 JS→TS / W4 Backend Structure all shipped). W2 (the JS→TS migration) merged completely on 2026-07-20 (#17/#18/#19/#20), which cleared W3's gating dependency. This is Phase 1 of 6 (+1 optional). **Re-baseline off current `main`.**

## Scope — do exactly this
1. **Extend `src/types/queryKeys.ts`** (keep its flat `export const queryKeys = { … } as const` shape — do NOT restructure it into a nested factory). Add:
   - `sheet(sheetId)` → `['sheet', sheetId]` (single-sheet; the factory has `sheets(projectId)` but no singular — Bucket C).
   - Prefix/partial builders for the variadic families whose call-sites currently hand-write shorter prefixes than any existing builder can emit: e.g. `statusesBySheet(sheetId)` → `['statuses', sheetId]`, `statusesAll()` → `['statuses']`, `allProjectStatusesAll()` → `['all_project_statuses']`, `allProjectUnitsAll()` → `['all_project_units']`, `unitsAll()` → `['units']`, `activitiesAll()` → `['activities']`, and `projectMembersAll()`/`currentUserRole`-style full keys where a call site duplicates an existing builder's output (Bucket A).
   - Name them however reads cleanly, but each MUST return the **exact** legacy array. Add a doc-comment noting these are the prefix-invalidation accessors.
2. **Migrate the ~67 production bypass call-sites** to the builders, in these files (grep each fresh — line numbers drift): `useProjectQueries.ts`, `useMapActions.ts`, `useUndoRedo.ts`, `useProjectActions.ts`, `useWorkbenchActions.ts`, `GlobalSettingsModal.tsx`, `ScheduleWorkspace.tsx`, `MspImportPanel.tsx`, `app/project/[projectId]/page.tsx`.
   - ⛔ **EXCLUDE `src/providers/QueryProvider.jsx`** — its inline keys (`['statuses']`, `['all_project_statuses']`, `['activities']`) are sweept when it converts to TS in W3's FINAL phase. Leave them.
   - ⚠️ **`useMapActions.ts` prefix READS**: `getQueryData(['statuses', activeSheetId])` reads a 2-element prefix of a stored `['statuses', sheetId, ...unitIds]` key — this is an intentional prefix read. Map it to `statusesBySheet(activeSheetId)`; do NOT "correct" it to the full `statuses(sheetId, unitIds)` key (that would change the lookup and break it).
   - Leave the already-correct prefix pattern in `useWorkbench.ts:90` (`[...queryKeys.workbenchSheets(id), includeArchived]`) as-is.
3. **Add `src/types/queryKeys.test.ts`** — a pure test asserting each NEW builder deep-equals the exact legacy literal (e.g. `expect(queryKeys.statusesBySheet('s1')).toEqual(['statuses', 's1'])`). This is the byte-identity guard.

## Guardrails
- ⛔ **ZERO behavior change.** Keys must be byte-identical; the persisted-cache `buster` in QueryProvider is NOT bumped (no cache invalidation intended). If a builder can't reproduce a literal exactly, STOP and flag.
- AGENTS §2 invariants are untouched here (no write-path logic changes) — but you're editing invalidation call-sites in the sync engine, so verify the offline/realtime paths still behave (see exit criteria).
- No `@ts-nocheck`/`@ts-ignore`/new `any`. Derive nothing new; this is call-site mechanics.
- Vitest globals OFF — import `{ describe, it, expect }` from `'vitest'`; co-locate `queryKeys.test.ts`.
- ⚠️ dev:3010 → PROD Supabase; throwaway data only, delete what you create ([[no-live-write-probes]]). Restart dev:3010 if you rename anything (you shouldn't in P1).

## Exit criteria (Definition of Done)
- Triple-green: `typecheck` / `test` (full suite) / `build`.
- `queryKeys.test.ts` proves every new builder emits the exact legacy array.
- Grep proof: no inline `queryKey: ['statuses'…]`, `['all_project_statuses'…]`, `['all_project_units'…]`, `['units'…]`, `['sheet'…]`, `['activities']` literals remain **outside** `src/types/queryKeys.ts` and `src/providers/QueryProvider.jsx` (and test files).
- Live dev:3010: open a project → change a single status and a bulk status → confirm the map still recolors and the list still updates (invalidation intact); toggle DevTools offline, queue a change, reconnect, confirm it replays.
- Close with the **verify-feature** skill, present the diff summary + any flags, then **STOP — no merge until the owner says "Approved."** After approval + merge, draft the Phase 2 kickoff (safety-net characterization tests) per [[post-approval-handoff-ritual]].

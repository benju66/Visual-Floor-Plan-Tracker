# Kickoff — Frontend Structure (W3), Phase 3: split wave 1 (shared module + Contacts + History + Sheets, barrel-preserving)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3 of Frontend Structure (W3)** — the FIRST code split of the 1,555-line `useProjectQueries.ts` god-file. Extract the lowest-coupling domains into new files and turn `useProjectQueries.ts` into a **barrel** that re-exports them, so **none of the ~35 importers change**. Move: (a) a shared module (`fetchAllIn` + `fetchStatusLogsForUnits` + `StatusRowWithActivity`), (b) **Contacts**, (c) **History**, (d) **Sheets**. Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-20 - Frontend Structure Phase 3 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Frontend-Structure-Plan.md` (Phase 3 + "Build-on inventory")
> - `sitepulse-next/AGENTS.md` (§2 sync-engine invariants, §6 TS guardrails)
>
> Branch off `main`, PR through CI. Build **only Phase 3**. ⛔ ZERO behavior change — this is a pure move-and-re-export; the P2 safety-net tests + full suite must stay green THROUGHOUT (they are the regression net for exactly this). No importer edits, no `@ts-nocheck`/`@ts-ignore`/new `any`. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
`useProjectQueries.ts` is one 1,555-line file holding the app's entire data layer — every read and write hook. It's hard to navigate and risky to edit. This phase starts breaking it into small per-topic files (contacts, history, sheets, …) **without changing a single line of behavior or a single import elsewhere**: the old file stays put as a "barrel" that just re-exports everything from the new files, so all ~35 files that import from it keep working untouched. We start with the three lowest-risk topics. The P1 (central keys) and P2 (characterization tests) phases exist precisely so this move is safe — if a hook comes out behaving differently, a P2 test goes red.

## Where the workstream stands
W3 scope = "Core data-layer". **P1 (queryKeys sweep, #21 `91efdd0`) + P2 (safety-net tests, #22 `04ff03d`) SHIPPED to main 2026-07-20.** Full suite = 1416 tests, all green. This is Phase 3 of 6 (+1 optional) — the first of three split waves (P3 low-coupling → P4 Units/Activities/Applicability → P5 Statuses last, the sync spine). **Re-baseline off current `main` and re-grep the god-file — line numbers below WILL have drifted.**

## The barrel mechanism (the whole trick)
`useProjectQueries.ts` becomes (mostly) a re-export barrel:
```ts
export * from './projectQueries/shared';
export * from './projectQueries/contacts';
export * from './projectQueries/history';
export * from './projectQueries/sheets';
// …the not-yet-split hooks (Units/Activities/Applicability/Statuses/Project/Members/
//   WalkSequence/bulk) stay defined inline here for now (P4/P5 move them).
```
- `export *` re-exports **both values AND types** (TS re-exports type-only names too) — so `ProjectContactFields`, `UpdateSheetScaleVars`, `StatusHistoryEvent` ride along automatically. Verify with typecheck; if `verbatimModuleSyntax`/`isolatedModules` complains about a type, use an explicit `export type { … } from './…'` for that name.
- Domains are **disjoint** — no duplicate export names, so `export *` can't collide.
- **Suggested layout:** a `src/hooks/projectQueries/` subfolder (`shared.ts`, `contacts.ts`, `history.ts`, `sheets.ts`) keeps the split tidy; flat `src/hooks/projectQueriesShared.ts` etc. is also fine (plan's wording). Pick one, be consistent.

## Scope — extract exactly these (grep each fresh; ranges are from the current file)
1. **Shared module** (`projectQueries/shared.ts`) — the helpers the domains + later phases lean on:
   - `export async function fetchAllIn<T>(…)` (~L383) — **externally imported** by `useWorkbench.ts` (`import { fetchAllIn } from './useProjectQueries'`) and `useProjectActions.ts` — so it MUST remain re-exported from the barrel path. It wraps `paginateAll` (`@/utils/pagination`).
   - `fetchStatusLogsForUnits(unitIds)` (~L417, currently module-internal) + `type StatusRowWithActivity` (~L416). Used by `useStatuses`/`useAllProjectStatuses` (which stay in the god-file until P5) — so after the move, the god-file imports `fetchStatusLogsForUnits` from `./projectQueries/shared`. (This pre-positions it for P5.)
   - ⚠️ Do **NOT** move `selectUnitsWithOpeningEdges` (~L336) here — it belongs to Units (P4) and must keep its module scope for referential stability; leave it in the god-file for now.
2. **Contacts** (`projectQueries/contacts.ts`) — fully self-contained; do first: `type ProjectContactFields` (~L167), `useProjectContacts` (~L172), `useCreateProjectContact` (~L190), `useUpdateProjectContact` (~L227), `useDeleteProjectContact` (~L252), `useImportProjectContacts` (~L280).
3. **History** (`projectQueries/history.ts`): `useUnitHistory` (~L102), `useStatusHistory` (~L1507) + `type StatusHistoryEvent` (~L1505). (`useStatusHistory` inlines its own `paginateAll`; it does NOT need `fetchStatusLogsForUnits`.)
4. **Sheets** (`projectQueries/sheets.ts`): `useSheets` (~L125), `useSheetById` (~L1245), `useUpdateSheetScopes` (~L1217), `useUpdateSheetScale` (~L1275) + `interface UpdateSheetScaleVars` (~L1266), `useUpdateSheetSchedule` (~L1312), `useReorderSheets` (~L1399). ⚠️ `useReorderSheets` is **externally imported** by `useProjectActions.ts` — keep it re-exported.

Each moved hook must carry EVERYTHING it needs: its imports (`supabase`, `queryKeys`, `paginateAll`, domain types from `@/types/domain`, JSONB guards, `Database`/`Json`), any module-scope constant it closes over, and its exact key usage via the P1 `queryKeys.*` accessors. Copy the code **verbatim** — no "while I'm here" edits.

## Guardrails
- ⛔ **ZERO behavior change — pure move + re-export.** The P2 characterization tests (`useProjectActions.test.tsx`, `useProjectQueries.test.tsx`) and the full 1416-test suite MUST stay green at every step. Run them after each domain move, not just at the end.
- **No importer changes anywhere.** The barrel absorbs the move; all ~35 importers keep `import { … } from '@/hooks/useProjectQueries'` (or the relative `./useProjectQueries`). If you find yourself editing an importer, STOP — the barrel isn't re-exporting something.
- **The P2 tests mock at the barrel boundary** (`vi.mock('@/hooks/useProjectQueries', …)` in `useProjectActions.test.tsx`, and `vi.mock('@/supabaseClient')` under `useProjectQueries.test.tsx`). The domain files import `supabase` from `@/supabaseClient`, so that mock still intercepts — do NOT change how the domain files import supabase, or the mocks miss.
- AGENTS §2 untouched: no status-write logic changes (Statuses isn't even moving this phase). No `@ts-nocheck`/`@ts-ignore`/new `any`; derive nothing new.
- ⚠️ dev:3010 → PROD Supabase; throwaway data only ([[no-live-write-probes]]). **Restart dev:3010 after creating the new files** if the running server wedges (App-Router/hooks module-graph reshuffle — the W2 P3 /dashboard-404 lesson).

## Exit criteria (Definition of Done)
- Triple-green: `typecheck` / `test` (full 1416+ suite) / `build`. Build is meaningful here (module-graph reshuffle) — run it.
- The barrel re-exports **every** moved symbol, **types included** (`ProjectContactFields`, `UpdateSheetScaleVars`, `StatusHistoryEvent`) — prove with a grep that each still resolves from `@/hooks/useProjectQueries`.
- `git grep`-check the two external value importers still resolve from the barrel path: `fetchAllIn` (`useWorkbench.ts`, `useProjectActions.ts`) and `useReorderSheets` (`useProjectActions.ts`).
- No file outside `src/hooks/**` changed (no importer edits); `useProjectQueries.ts` shrank by the moved lines and gained the `export *` lines only.
- Live dev:3010 smoke of a touched surface: open the **Contacts** directory (renders `useProjectContacts`) and **open a sheet** (renders `useSheetById`/`useSheets`) — both load without console errors (cache reads intact through the barrel).
- Close with the **verify-feature** skill; present the diff summary + any flags, then **STOP — no merge until the owner says "Approved."** After approval + merge, draft the Phase 4 kickoff (split wave 2: Units + WalkSequence + Activities + Applicability — note the plan's "split Activities+Applicability into their own phase if it overruns" escape hatch) per [[post-approval-handoff-ritual]].

## Notes carried from P1/P2
- The two P2 flags remain **open and out of scope** (do not fix here): (1) the dead-ish tile-cleanup block in `handleDeleteSheet`; (2) errors silent when `settings.enableToasts` is off. Carry them forward.
- `QueryProvider.jsx` still holds the only inline cache keys (5 of them) — untouched until P6.
- Full current export surface of the god-file (for reference when checking the barrel is complete): Project/Members (`useProject`, `useUpdateProject`, `useProjectMembers`, `useCurrentUserRole`, `useUpdateProjectMemberRole` + `MemberWithProfile`), Units (`useUnits`+`selectUnitsWithOpeningEdges`, `useAllProjectUnits`, `useCreateUnit`, `useUpdateUnitGeometry`, `useUpdateUnitFields`, `useClearProjectUnitTypes`, `useRecalculateSheetAreas`+`RecalculateAreaUpdate`, `useDeleteUnit`, `useUpdateWalkSequence`), Statuses (`useStatuses`, `useAllProjectStatuses`, `useUpdateStatus`, `useClearStatus`, `useBulkUpdateStatus`, `useBulkInsertStatusLogs`), Activities (`useActivities`, `useUpdateActivity`, `useUpdateActivityRules`, `useSetActivitySubcontractor`, `useCreateActivitiesBulk`+`NewActivityRow`, `useReorderActivities`), Applicability (`useActivityOverrides`, `useSetActivityApplicability`, `useBulkSetApplicability`) — all STAY inline this phase; only Contacts/History/Sheets + the shared helpers move.

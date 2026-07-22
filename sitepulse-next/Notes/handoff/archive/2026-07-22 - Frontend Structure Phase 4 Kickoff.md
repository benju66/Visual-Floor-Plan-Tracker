# Kickoff — Frontend Structure (W3), Phase 4: split wave 2 (Units + WalkSequence + Activities + Applicability, barrel-preserving)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 4 of Frontend Structure (W3)** — split wave 2 of the `useProjectQueries.ts` god-file (now ~1,058 lines after P3). Extract **Units**, **WalkSequence**, **Activities**, and **Applicability** into new files under the existing `src/hooks/projectQueries/` folder and add their `export *` lines to the barrel, so **none of the importers change**. Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-22 - Frontend Structure Phase 4 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Frontend-Structure-Plan.md` (Phase 4 + "Build-on inventory")
> - `sitepulse-next/AGENTS.md` (§2 sync-engine invariants, §6 TS guardrails)
>
> Branch off `main`, PR through CI. Build **only Phase 4**. ⛔ ZERO behavior change — pure move-and-re-export; the P2 safety-net tests + full suite (1416+) must stay green THROUGHOUT. No importer edits, no `@ts-nocheck`/`@ts-ignore`/new `any`. **If the session overruns, split Activities+Applicability into their own phase** (plan's escape hatch). Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
P3 proved the barrel trick works: Contacts/History/Sheets + the shared readers moved out with zero importer churn and zero behavior change. This phase moves the next tier — the location (unit) hooks and the activity hooks. After it, only the Statuses write contract (P5's job — the offline-sync spine, deliberately LAST) plus Project/Members remain inline in the god-file.

## Where the workstream stands
**P1 (queryKeys, #21) + P2 (safety net, #22) + P3 (split wave 1, #23 `b241810`) SHIPPED to main; CI green each.** Full suite = 1416 tests. The split pattern is established:
- New domain files live in `src/hooks/projectQueries/` (`shared.ts`, `contacts.ts`, `history.ts`, `sheets.ts` exist).
- `useProjectQueries.ts` opens with the barrel block (`export * from './projectQueries/…'`) and imports `fetchAllIn`/`fetchStatusLogsForUnits` from `./projectQueries/shared` for its still-inline hooks.
- **Re-baseline off current `main` and re-grep the god-file — line numbers WILL have drifted.**

## Scope — extract exactly these (grep each fresh)
Add four files, each with its `export *` line in the barrel (follow the P3 file style: only the imports the domain needs, code copied VERBATIM):
1. **`projectQueries/units.ts`** — `selectUnitsWithOpeningEdges` (module-scope, **stays unexported** — it must keep referential stability as a module constant; move it WITH `useUnits`), `useUnits`, `useAllProjectUnits`, `useCreateUnit`, `useUpdateUnitGeometry`, `useUpdateUnitFields`, `useClearProjectUnitTypes`, `useRecalculateSheetAreas` + `export interface RecalculateAreaUpdate`, `useDeleteUnit`, and the "unit-CRUD mutations are ONLINE-ONLY…" comment block that governs them.
2. **`projectQueries/walkSequence.ts`** — `useUpdateWalkSequence`. ⚠️ Contains the known `as any` on the `walk_sequence` update (schema-type gap). **Open decision from the plan resolves HERE:** patch `database.types.ts` to add `units.walk_sequence` ONLY if it exactly matches the live prod column (verify first — read-only schema check); otherwise move the cast verbatim and FLAG.
3. **`projectQueries/activities.ts`** — `useActivities`, `useUpdateActivity`, `useUpdateActivityRules`, `useSetActivitySubcontractor`, `useCreateActivitiesBulk` + `export interface NewActivityRow`, `useReorderActivities`.
4. **`projectQueries/applicability.ts`** — `useActivityOverrides`, `useSetActivityApplicability`, `useBulkSetApplicability`.

Cross-domain notes (fine as-is, keep verbatim):
- `useDeleteUnit` deletes `status_logs` rows and invalidates `queryKeys.statusesBySheet(sheetId)`; `useUpdateActivity` syncs `status_color` into `status_logs` and invalidates `statusesAll()`/`allProjectStatusesAll()`. They reference STATUS **keys** via the P1 factory only — they do NOT import status hooks. That stays exactly so.
- `useAllProjectUnits` uses `fetchAllIn` — import it from `./shared` (already the pattern in the god-file).
- If the shared unit optimistic-rollback pattern (`onMutate` snapshot → `onError` restore) falls out cleanly as ONE helper, extract it; else leave inline + FLAG (plan's wording — do not force it).

After the move, the god-file keeps ONLY: Project/Members (`useProject`, `useUpdateProject`, `useProjectMembers`, `useCurrentUserRole`, `useUpdateProjectMemberRole` + `MemberWithProfile`) and Statuses (`useStatuses`, `useAllProjectStatuses`, `useUpdateStatus`, `useClearStatus`, `useBulkUpdateStatus`, `useBulkInsertStatusLogs`) — both move in P5.

## Guardrails
- ⛔ **ZERO behavior change — pure move + re-export.** P2 tests + full suite green after EACH domain move, not just at the end (P3 ran the full gate 4×; do the same).
- **No importer changes anywhere.** External value importers riding the barrel this phase: `useCreateUnit` (`useWorkbenchActions.ts`), `useUnits`/`useDeleteUnit` (`WorkbenchTracer.tsx`, `WorkbenchReviewTable.tsx`, `MapSidebar.tsx`), `useUpdateActivity` (`useProjectActions.ts`), `useUpdateWalkSequence` (`WalkSequenceModal.tsx`, `FloorplanCanvas.tsx`). The test files that `vi.mock('@/hooks/useProjectQueries', …)` wholesale (`useProjectActions.test.tsx`, `FloorplanCanvas.test.tsx`, `WorkbenchTracer.test.tsx`, `UnitHistoryModal.test.tsx`) are unaffected by barrel internals — do not touch them.
- Domain files import `supabase` from `@/supabaseClient` (the P2 mock boundary) — same as P3's files.
- AGENTS §2 untouched: `useDeleteUnit`'s status_logs delete and `useUpdateActivity`'s color sync are moved byte-for-byte; no status-write logic changes.
- No `@ts-nocheck`/`@ts-ignore`/new `any`; the ONLY sanctioned `any` deletion is the `walk_sequence` one, and only under the type-matches-prod condition above.
- ⚠️ dev:3010 → PROD Supabase; throwaway data only. Restart dev:3010 if it wedges after the module-graph reshuffle.

## Exit criteria (Definition of Done)
- Triple-green: `typecheck` / `test` (full suite) / `build`, run after each domain move.
- Barrel probe (P3 recipe): a temporary file importing every moved symbol — values AND types (`RecalculateAreaUpdate`, `NewActivityRow`) — from `@/hooks/useProjectQueries` typechecks, then is deleted.
- `git diff --stat` shows only `src/hooks/**` changed (+ this kickoff doc at commit time).
- Live dev:3010 smoke (throwaway data, delete what you create): trace or edit a unit on the map (units mutations through the barrel) and toggle an activity's applicability for one location (applicability path) — no console errors.
- Close with the **verify-feature** skill; present the diff summary + flags, then **STOP — no merge until the owner says "Approved."** After approval + merge, draft the Phase 5 kickoff (Statuses + `statusWrite.ts` shared contract + Project/Members + reshape `useProjectActions` — the HIGHEST-RISK phase; give its kickoff the AGENTS §2 invariants verbatim) per the handoff ritual.

## Notes carried from P3
- `fetchStatusLogsForUnits` is now exported from `projectQueries/shared.ts` (was file-private pre-P3) — P5 will consume it from there; nothing to do this phase.
- The two P2 flags stay open and out of scope: (1) dead-ish tile-cleanup block in `handleDeleteSheet`; (2) errors silent when `enableToasts` is off.
- `QueryProvider.jsx` keeps its 5 inline keys until P6.
- W3 P1–P3 kickoff docs are still in `Notes/handoff/` — sweep them to `handoff/archive/` at workstream close (or opportunistically with a phase commit).

# Kickoff — Frontend Structure (W3), Phase 5: split wave 3 — Statuses (the write contract) + statusWrite.ts + Project/Members

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 5 of Frontend Structure (W3)** — the FINAL and HIGHEST-RISK split of `useProjectQueries.ts` (now 528 lines): the **Statuses** domain (the offline-sync spine) and **Project/Members**, leaving the god-file a thin barrel. Also land `src/utils/statusWrite.ts` (+ test) so the status-write contract lives in ONE pure helper instead of four copies. Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-22 - Frontend Structure Phase 5 Kickoff.md` (this file — the §2 invariants below are LOAD-BEARING)
> - `sitepulse-next/Notes/plans/Frontend-Structure-Plan.md` (Phase 5 + "Pure logic to extract" + "Data model")
> - `sitepulse-next/AGENTS.md` §2 (sync engine) and §6 (TS guardrails)
>
> Branch off `main`, PR through CI. Build **only Phase 5**. ⛔ The status mutations' runtime behavior must stay BYTE-IDENTICAL — the only sanctioned code change is relocating shared mechanics into `statusWrite.ts`, pinned by its own tests + the P2 safety net + the full suite (1416+), green THROUGHOUT. No importer edits, no `@ts-nocheck`/`@ts-ignore`/new `any`. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
Four waves in, everything except the status-writing engine has moved out of the god-file behind the barrel, with zero behavior change. This phase moves the last, most delicate piece — the six hooks that write field progress, which feed the offline queue and the map/list caches — and, while the safety net is at its strongest, consolidates the copy-pasted write contract (strip synthesized fields, stamp capture-time timestamps, omit-preserves/present-clears) into one tested helper so future edits can't silently fork it.

## Where the workstream stands
**P1 (#21) → P2 (#22) → P3 (#23, `b241810`) → P4 (#24, `e3b56c6`) ALL SHIPPED to main; CI green each; full suite = 1416.** `useProjectQueries.ts` = 528 lines: the barrel block (8 `export *` lines), Project/Members (`useProject`, `useUpdateProject`, `useProjectMembers`, `useCurrentUserRole`, `useUpdateProjectMemberRole` + `MemberWithProfile`), and Statuses (`useStatuses`, `useAllProjectStatuses`, `useUpdateStatus`, `useClearStatus`, `useBulkUpdateStatus`, `useBulkInsertStatusLogs`). `projectQueries/shared.ts` already exports `fetchAllIn` + `fetchStatusLogsForUnits` (pre-positioned in P3 for exactly this phase). **Re-grep the god-file fresh — do not trust remembered line numbers.**

## Scope
1. **`projectQueries/project.ts`** — Project/Members: `MemberWithProfile`, `useProjectMembers`, `useCurrentUserRole`, `useProject`, `useUpdateProject`, `useUpdateProjectMemberRole`. Self-contained, lowest risk — do FIRST, full gate, then Statuses.
2. **`src/utils/statusWrite.ts` (+ `statusWrite.test.ts`)** — the shared write-contract mechanics as SMALL pure functions (not one mega-helper; the four mutations have deliberately different semantics — extract only what is genuinely shared):
   - `sanitizeStatusWrite(log)`-style strip: delete `id`, `created_at`, synthesized `activityName`, legacy `milestone`.
   - `client_timestamp` stamping rule: honor a provided capture-time value; stamp now-ISO ONLY as the online fallback. **Pass timestamps IN — never `Date.now()`/`new Date()` buried in the helper** (plan's rule; keeps it testable).
   - The completion-date rule used by the bulk paths: stamp today ONLY when `logged_date === null && temporal_state === 'completed'` (a schedule write must never fabricate progress; a bulk "mark Planned/Ongoing" must never fabricate a completion date).
   - Each helper's test pins the EXACT before/after object shape the inline code produces today.
3. **`projectQueries/statuses.ts`** — the six status hooks, consuming `fetchAllIn`/`fetchStatusLogsForUnits` from `./shared` and the new `statusWrite.ts` helpers. Every RPC payload, upsert row, optimistic-cache shape, cancel/invalidate key set stays byte-identical (all keys already flow through the P1 `queryKeys.*` accessors — keep exact accessors: `statusesBySheet(sheetId)`, `allProjectStatusesAll()`, `statuses(...)`, `allProjectStatuses(...)`).
4. **Barrel**: add the two `export *` lines. After this, `useProjectQueries.ts` is a thin barrel (~30 lines of re-exports). `useProjectActions.ts` keeps importing from the barrel (locked decision — per-domain import rewrites are NOT part of W3).

## ⛔ AGENTS §2 invariants — preserve BYTE-FOR-BYTE (characterization boundaries)
- `status_logs` writes go through the `upsert_status_log` RPC (single) or `.upsert(..., { onConflict: 'unit_id,activity_id' })` (bulk) — **NEVER `.insert()`**. Slot key is `activity_id`, never the name.
- Strip the synthesized `activityName` AND the legacy `milestone` key before every write.
- **Omit-preserves / present-clears** (migration `20260712`): an ABSENT JSON key preserves the stored value; a PRESENT null/`''` clears it. Concretely: `useUpdateStatus` must NOT drop a null `logged_date` (present-null is an intentional clear); `useClearStatus` must keep sending explicit-empty `status_color`/`planned_start_date`/`planned_end_date`/`logged_date`/`actual_start_date` (a 'none' reset clears everything); `useBulkUpdateStatus`'s keep-existing and apply branches only include `planned_*` keys when the caller supplied them.
- **Capture-time `client_timestamp`**: comes from `PendingChange.capturedAt` via the caller; stamp at write time ONLY as the online fallback. Keys must stay uniform across a bulk chunk (PostgREST requirement).
- Cache shapes stay stable and JSON-serializable: `['statuses', sheetId, ...unitIds]` / `['all_project_statuses', ...unitIds]` = `StatusLog[]` with synthesized `activityName`; optimistic entries keep their `temp_*` id patterns.
- Do NOT touch `QueryProvider.jsx` (P6), the offline queue (`useFieldData`/`pendingChanges`), `autoAdvance.ts`, or `upsert_status_log` itself.
- If the compiler or a cleanup tempts ANY runtime change beyond the sanctioned helper extraction — STOP and flag.

## Guardrails
- Full gate (typecheck + full suite) after EACH step: project.ts move → statusWrite.ts (+tests, still consumed by NOBODY — land it green first) → statuses.ts move consuming it. The P2 tests (`useProjectQueries.test.tsx` covers status mutations' DB calls + invalidation keys) are the regression net — if one goes red, the extraction changed behavior: fix the extraction, never the test.
- Domain files import `supabase` from `@/supabaseClient` (the P2 mock boundary). Test files that `vi.mock('@/hooks/useProjectQueries')` wholesale are unaffected.
- External importers riding the barrel this phase: `useUpdateStatus` (`ScheduleWorkspace`, `useMapActions`), `useBulkInsertStatusLogs` (`CascadePanel`, `ScheduleWorkspace`, `MspImportPanel`), `useStatuses` (project `page.tsx`), `useAllProjectStatuses` (`FieldStatusTable`, `ProjectDashboard`, `BaselineControl`, `ScheduleWorkspace`), `useProject`/`useProjectMembers`/`useCurrentUserRole` (many) — none change.
- ⚠️ dev:3010 → PROD Supabase. Status writes are REAL — smoke ONLY on the throwaway "Test" project (project id `8796bbe0-…`, all 0% progress), restore/clean every write, and re-verify state via read-only SQL after.

## Exit criteria (Definition of Done)
- Triple-green (typecheck / full suite / build) after each step; `statusWrite.test.ts` green.
- Barrel probe (P3/P4 recipe): every moved symbol incl. `MemberWithProfile` resolves from `@/hooks/useProjectQueries`; temp file deleted.
- `git diff --stat`: only `src/hooks/**` + `src/utils/statusWrite.*` (+ this kickoff doc at commit).
- Live dev:3010 smoke on the throwaway Test project: (a) single status change online (map or list) — recolors + persists, verify the `status_logs` row via SQL then restore it; (b) bulk status change — same; (c) **offline replay**: DevTools offline → queue a status change → reconnect → confirm it replays once (no duplicate slot rows — check by SQL count on the slot) → restore. Zero residue.
- Close with **verify-feature**; present diff + flags; **STOP — no merge until "Approved."** After approval + merge, draft the Phase 6 kickoff (QueryProvider.jsx→tsx — finishes the JS→TS migration 100%; build mandatory; two-tab realtime smoke) per the handoff ritual.

## Notes carried forward
- Open flags (do NOT fix here): applicability confirm button mislabeled "Delete"; silent errors when `enableToasts` off; dead-ish tile-cleanup block in `handleDeleteSheet`; unit optimistic-rollback pattern inline ×5 (optional helper — only if it falls out cleanly during review, else leave).
- Plan doc "Open decisions": `walk_sequence` gap RESOLVED in P4 (types already matched prod; cast deleted) — annotate the plan's line if you touch the plan file anyway; otherwise leave.
- W3 P1–P4 kickoff docs still sit in `Notes/handoff/` — sweep all of them to `handoff/archive/` at workstream close (P6), one commit.

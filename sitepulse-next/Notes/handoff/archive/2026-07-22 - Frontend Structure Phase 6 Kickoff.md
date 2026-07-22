# Kickoff — Frontend Structure (W3), Phase 6: QueryProvider.jsx → tsx (FINAL — closes the JS→TS migration at 100%)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 6 of Frontend Structure (W3)** — the FINAL core phase: convert `src/providers/QueryProvider.jsx` → strict TypeScript `.tsx` (the LAST `.js`/`.jsx` file under src — this closes the JS→TS migration at 100%), and route its 5 inline cache keys through the P1 `queryKeys` accessors. Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-22 - Frontend Structure Phase 6 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Frontend-Structure-Plan.md` (Phase 6 + "Data model")
> - `sitepulse-next/AGENTS.md` §2 (sync engine, realtime injector) and §6 (TS guardrails)
>
> Branch off `main`, PR through CI. Build only Phase 6. ⛔ ZERO behavior change — the realtime injector logic and the persister/offline-queue setup stay byte-identical; this is typing + key-accessor routing only. **`npm run build` is MANDATORY** (App Router provider boundary) and **restart dev:3010 after the rename** (provider-file renames wedge the running server — the W2 P3 lesson). No `@ts-nocheck`/`@ts-ignore`/new `any`. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
One file in the entire app is still plain JavaScript: the provider that sets up the offline-first cache and the live-update listener (the WebSocket that injects other users' status changes into your open map/list). Converting it to strict TypeScript closes the months-long JS→TS migration at exactly 100% — and because it's the file that glues the cache, the persister, and realtime together, typing it is the last guardrail on the whole data layer W3 just restructured.

## Where the workstream stands
**P1 (#21) → P2 (#22) → P3 (#23) → P4 (#24) → P5 (#25, `97c4709`) ALL SHIPPED to main; CI green each; full suite = 1428.** `useProjectQueries.ts` = a 17-line barrel over ten `projectQueries/` domain files; `statusWrite.ts` holds the shared write contract (12 tests). `QueryProvider.jsx` (~113 lines) is the ONLY remaining `.jsx`/`.js` under src, and holds the app's last 5 inline cache keys (2× `['statuses']`, 2× `['all_project_statuses']`, 1× `['activities']`). The P1 accessors for all three already exist (`statusesAll()`, `allProjectStatusesAll()`, `activitiesAll()`) — pre-added for exactly this phase. **Read the actual current file first.**

## Scope
1. **Rename** `src/providers/QueryProvider.jsx` → `QueryProvider.tsx` via `git mv` (keep `"use client"`).
2. **Type it** (AGENTS §6 — derive, never hand-write):
   - Props: `{ children: React.ReactNode }`.
   - The Supabase realtime `payload` (`RealtimePostgresChangesPayload<…>` or a narrowed raw `status_logs` Row) so `payload.new`/`payload.old` are typed; the synthesized-`activityName` `newLog` is a `StatusLog`.
   - The `['activities']` cache read as `Activity[] | undefined`; every `setQueryData`/`setQueriesData` updater as `StatusLog[]`.
   - The persister / buster / `shouldDehydrateMutation` block: **byte-identical logic**, typing only. Do NOT narrow `src/utils/persister.ts`'s `getItem` union (load-bearing).
3. **Key routing**: replace the 5 inline keys with `queryKeys.statusesAll()` / `queryKeys.allProjectStatusesAll()` / `queryKeys.activitiesAll()` — each emits the byte-identical array (pinned by `queryKeys.test.ts`), so cache behavior cannot change.
4. **Docs riding this PR** (workstream-close housekeeping, all approved in prior phase reports):
   - AGENTS §2: one-line addition — the status-write strip/stamp mechanics live ONLY in `src/utils/statusWrite.ts` (P5); never re-inline or fork them.
   - Annotate the plan's "Open decisions": `walk_sequence` gap RESOLVED in P4 (types already matched prod; cast deleted).
   - Sweep the W3 P1–P6 kickoff docs from `Notes/handoff/` to `handoff/archive/` (closed-phase convention).

## Guardrails
- ⛔ The realtime injector only ever writes plain row objects into the cache (IDB serialization, AGENTS §5/§6) — keep it that way; no Map/Set/class instances.
- JSONB stays narrowed at the boundary; no `Json` leaking into component types.
- If typing pressures ANY runtime change — stop and flag. The only diff outside the provider should be the 3 docs items + the archive sweep.
- ⚠️ Restart dev:3010 after the rename BEFORE smoking (module-graph wedge risk). dev:3010 → PROD Supabase; smoke on the throwaway "Test" project only, restore any write (P5's SQL-baseline recipe).

## Exit criteria (Definition of Done)
- Triple-green: `typecheck` / full suite / **build (mandatory)**. Zero `@ts-nocheck`, no new `any`.
- **`git ls-files 'sitepulse-next/src/**/*.jsx' 'sitepulse-next/src/**/*.js'` returns NOTHING** — the JS→TS migration is 100% complete.
- Grep: zero inline `['statuses']`/`['all_project_statuses']`/`['activities']` literals anywhere outside `queryKeys.ts`.
- Live dev:3010 smoke (fresh server): (a) app boots, a project loads from the persisted cache (persister intact); (b) **two-tab realtime**: change a status in tab A on the throwaway Test project → tab B's map/list updates WITHOUT a refresh (the WebSocket injector works, typed) → restore the slot via SQL baseline.
- Close with **verify-feature**; present diff + flags; **STOP — no merge until "Approved."**
- **After approval + merge:** update memories — [[js-to-ts-migration-workstream]] → DONE 100%, [[frontend-structure-workstream]] → core COMPLETE — and ask the owner the ONE open decision: **P7 (MobileSwipeDeck pure-logic extraction + tests) — green-light or skip?** That answer closes W3.

## Notes carried forward (the post-W3 fix backlog, priority order — do NOT fix here)
1. **Planned-date clearing on status writes** (P5 discovery): `commitUnitActivity` sends `extraProps || sheet-schedule || null-present` (`useMapActions.ts` ~L578) — a status tap wipes slot-level planned dates when the level has no schedule window. Real silent-data-loss quirk; candidate for its own small workstream.
2. Silent errors when `enableToasts` is off (P2 flag).
3. Applicability confirm button mislabeled "Delete" (P4 flag).
4. Dead-ish tile-cleanup block in `handleDeleteSheet` (P2 flag); unit optimistic-rollback pattern inline ×5 (optional).

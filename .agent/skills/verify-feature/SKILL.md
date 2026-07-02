# TASK: Post-Implementation Verification & Teardown

Execute these steps sequentially. Stop and ask for clarification if any step fails or hits an unexpected state.

> This repo's architectural source of truth is `sitepulse-next/AGENTS.md`. There is no `ARCHITECTURE.md` and no C4 docs — do not look for or write them.

**Step 1: Intent vs. Execution Audit**
Compare the original Implementation Plan against the actual file system, independent of version control.
* Identify every file you created, modified, or deleted this session.
* Read the current contents of those files into context.
* Evaluate the written code against the plan:
  * Did the execution satisfy every requirement?
  * Were any changes made outside the plan's scope?
Flag all discrepancies.

**Step 2: Cross-Surface Verification — prove it works**
Verification is type-checking, the Vitest suite, a production build, and live browser checks (there is still **no E2E framework** — browser checks are manual). Run from `sitepulse-next/` and report the exact commands and their output:
* `npm run typecheck` — `tsc --noEmit`. This is the primary gate. **Zero new type errors.** No file may merge to `main` still carrying `// @ts-nocheck`.
* `npm run test` — the Vitest suite (co-located `*.test.ts`; globals are OFF — import `{ describe, it, expect }` from `'vitest'`). All tests must pass, and new behavior needs a new/extended test (see the `write-tests` skill).
* `npm run build` — must compile cleanly (catches App Router / server-component / bundling errors).
* **Lint is NOT a gate** — the repo carries ~1850 pre-existing lint problems. Only confirm the files you touched add no new errors; never chase the whole-repo count.
* If you changed the **backend** (`sitepulse-backend/`), confirm `uvicorn main:app` starts and the affected endpoint responds; watch for startup `lifespan` validation failures.
* If you changed **UI/canvas/UX**, launch `npm run dev:3010` (http://localhost:3010 — NOT the default 3000; a dev server is often already running there) and visually verify: Konva map interactions (draw/snap/pan/zoom), the field table ↔ map sync, and — for mobile work — the `MobileSwipeDeck` gesture/swipe flow and `SyncIndicator` state.
* If you changed **sync logic**, verify the offline path: apply changes offline, confirm they persist to IndexedDB (project-scoped key `sitepulse-pending-changes-${projectId}`), reload, and confirm they replay without duplicate `status_logs` rows.

**Step 3: Documentation Sync**
Review the new code against `AGENTS.md`.
* Did this work add a new table, RPC, trigger, or migration? Then `src/types/database.types.ts` and `src/types/domain.ts` must reflect it, the migration must live in `sitepulse-next/supabase/migrations/`, and the migration table in the root `README.md` should be updated.
* Did it establish a new reusable pattern, hook, or invariant — or change a sync/auth/serialization rule? Draft the corresponding update to the relevant section of `AGENTS.md`.
* If file references in `AGENTS.md` drifted (e.g. a `.js` file you converted to `.ts`), fix them.

**Step 4: The Merge Gate**
Present a final "Definition of Done" report: the exact verification commands run, their output, what you verified in the browser, and any docs updated. **Then stop entirely.** Do not commit, push, or merge until I explicitly reply with "Approved."

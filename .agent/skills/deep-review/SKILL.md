# TASK: Deep Review of the Implementation Plan

Execute the following steps sequentially. If you are unsure about any context or hit a blocker, stop and ask one clarifying question. Do not guess.

> Ground every judgment in `sitepulse-next/AGENTS.md` — it is this repo's single source of architectural truth.

**Step 1: Primary Inspection**
Review `AGENTS.md` and the current Implementation Plan. Identify bugs, logical gaps, unhandled edge cases, and security flaws. Update the plan to fix any issue that causes a broken user flow, a security hole, or data loss. Pay special attention to this codebase's known high-risk areas:
* **Sync integrity:** does the plan keep `status_logs` writes on the `upsert_status_log` RPC / `.upsert()` path (never plain `.insert()`)? Does it preserve the IDB mutation queue, per-item checkpointing (`isSyncingRef`), `hasRehydrated` guard, and capture-time `client_timestamp`?
* **State boundaries:** no data fetching or global UI state via `useState`/`useEffect`; `pendingChanges` stays local; persisted Zustand reads go through `useHydratedStore`.
* **Serialization safety:** nothing non-JSON-serializable (`RBush`, `Map`, `Set`, DOM nodes) enters the TanStack Query cache / IndexedDB persister.
* **Auth & backend:** backend auth stays on local `PyJWT` validation (no `supabase.auth.get_user()` network call); no `python-jose`; no user data written to Render's ephemeral disk.
* **Types:** new DB shapes derived from `database.types.ts` via `domain.ts`; JSONB narrowed at the query boundary; no `any`; no `// @ts-nocheck` reaching `main`.

**Step 2: Secondary Sweep**
Conduct a secondary sweep for edge cases the first pass missed — offline/reconnect races, multi-tab and cross-project contamination, hydration mismatches, Konva native-vs-synthetic event leakage, PDF de-rotation/CropBox edge cases, and RBAC/multi-tenant access boundaries. Update the plan with your findings.

**Step 3: Impact Analysis**
Confirm you fully understand everything impacted. Ensure the changes will not break adjacent modules (map ↔ table sync, the canvas layers, the export pipeline, the swipe deck). Outline a brief rollback strategy for the core files being modified — and for any database migration, since the `status_logs` dedup step is destructive.

**Step 4: Verification**
For every new fix added to the plan, define exactly how it will be verified. Remember this repo has no test framework: verification means `npm run typecheck` / `npm run lint` / `npm run build`, plus targeted browser checks (and the offline replay path for sync changes). Be specific about what you will run and what output proves success.

**Step 5: Review Gate**
Present the updated implementation plan. Stop and wait for my explicit approval before writing any code.

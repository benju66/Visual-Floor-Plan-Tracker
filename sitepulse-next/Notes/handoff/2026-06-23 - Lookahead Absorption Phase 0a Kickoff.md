# Kickoff — Lookahead Absorption, Phase 0a: Database + vendored module + persistence adapter

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 0a of Lookahead Absorption** (create the `lookahead_plans` table + RLS, vendor the Lookahead app into `src/lookahead/`, and write the persistence adapter — NO visible UI yet). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-23 - Lookahead Absorption Phase 0a Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Lookahead-Absorption-Plan.md` (Phase 0a)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 0a**. ⛔ Present the full migration SQL and **STOP** for my approval before applying anything to the live FP-Analytics database — that's also where I confirm the security rule. Don't commit or push until I say "Approved."

---

## Context for the session (the detail the launch prompt points at)

### What you're building
A superintendent will eventually open a SitePulse project and switch to a 5th "Look-Ahead" view that
shows the standalone Look-Ahead Schedule app (currently at `C:\Users\BUrness\Dev\Lookahead`), tied to
that project. **Phase 0a is the foundation only — no user-visible view yet.** It lands three things:
1. a new isolated `lookahead_plans` table (+ RLS) in the **live** Supabase;
2. the Lookahead source **vendored** into `sitepulse-next/src/lookahead/` (copied, with three required edits);
3. a **persistence adapter** that loads/saves the plan document for a project using SitePulse's own
   session + Supabase client.

The visible wiring (the toggle button + render branch + autosave mount) is **Phase 0b — do not build it here.**

### Required reading (in this order)
1. `sitepulse-next/AGENTS.md` — architectural invariants. Most are irrelevant here because this table is
   isolated, but §6 (TypeScript / JSONB narrowing / no-`any`) and §4 (new tables → add to
   `database.types.ts` + derive in `domain.ts`) DO apply.
2. `sitepulse-next/Notes/plans/Lookahead-Absorption-Plan.md` — the full plan. Phase 0a scope, the data
   model, the **⚠️ Known gotchas** section (read it — they're required steps, not surprises), and the
   guardrails.
3. `sitepulse-next/supabase/migrations/20260617_workbench_schema.sql` — the **template** for an additive
   table + idempotent RLS policies. Your migration mirrors its style (guarded `IF NOT EXISTS`,
   `pg_policies` existence checks, `TO authenticated`).
4. The `create-migration` skill — follow its workflow for authoring/applying the migration.
5. Source you'll touch/copy (re-read fresh): `src/supabaseClient.ts`, `src/types/database.types.ts`,
   `src/types/domain.ts`; and on the Lookahead side `store/useSession.ts` (the seam you're replacing),
   `store/useStore.ts` (exports `useStore`, `projectBlob`, `loadProject`), `lib/types.ts` (`ProjectBlob`),
   `lib/defaults.ts` (`makeBlankProjectBlob`), and the rest of `lib/` + `components/`.

### Scope checklist (Phase 0a only)
- [ ] **Migration** `supabase/migrations/<date>_lookahead_plans.sql`: `lookahead_plans` (id, `project_id`
      uuid NOT NULL **UNIQUE** REFERENCES projects(id) ON DELETE CASCADE, `doc` jsonb NOT NULL, created_by,
      created_at, updated_at) + RLS. READ = any project member; WRITE = `role IN ('owner','admin','pm','superintendent')`
      (⛔ confirm the superintendent inclusion at the approval gate). Idempotent + additive.
- [ ] **Types**: add `lookahead_plans` to `database.types.ts` `Tables`; derive a Row type in `domain.ts`;
      add `isProjectBlob(doc: unknown): doc is ProjectBlob` guard **+ co-located test**.
- [ ] **Vendor** the Lookahead module into `src/lookahead/` (see plan for the exact copy / do-not-copy list),
      applying the three required edits:
      - strip the zustand `persist` wrapper from the copied `useStore.ts` (gotcha #1 — single localStorage
        key would contaminate across projects);
      - rewrite internal `@/lib`/`@/store` imports to `@/lookahead/...` (gotcha #2);
      - reconcile deps (gotcha #3) + port print CSS/font (gotcha #4).
- [ ] **Adapter** `src/lookahead/persistence.ts` (or `useLookaheadPlan(projectId)`): `loadPlan` (SELECT →
      `isProjectBlob` narrow → `useStore.getState().loadProject(doc)`); `savePlan` (`projectBlob(state)` →
      upsert on `project_id`). Uses `src/supabaseClient.ts`. Lazy-create (write only on first save).

### ⛔ Approval gates — STOP and wait for the owner
- **Before applying the migration to the live FP-Analytics DB:** present the complete SQL file. The owner
  confirms here whether **superintendents** can write (assumed yes). Do not apply until told.
- **Do not commit or push to `main`** until the owner says "Approved."

### Guardrails specific to this phase
- Touch **no** existing table/RPC/RLS. Do not read or write `status_logs`, `units`, `sheets`,
  `project_milestones`. The new table is fully isolated.
- The new `lookahead_plans` table is empty, so exercising load/save against it is safe — but do not run
  write probes against any OTHER table (memory: "No live-write probes" overwrote real data once).
- Narrow `Json → ProjectBlob` with the guard at the query boundary; no `any`.
- Do NOT wire into SitePulse's offline `pendingChanges` queue (out of scope).
- The copied Lookahead files keep their own conventions; the ONLY deliberate edits are the three above.

### Exit criteria (Definition of Done for 0a — then STOP)
- `typecheck` + `test` + `build` green (absolute-prefix commands in the plan's Verification section).
- `isProjectBlob` unit-tested.
- The vendored module compiles; the adapter's load/save works against the new empty `lookahead_plans` row.
- Close the phase with the **`verify-feature`** skill (its Definition of Done → stop). Do not commit/push
  until the owner says "Approved." Then hand off Phase 0b with a short chat pointer + a 0b kickoff file.

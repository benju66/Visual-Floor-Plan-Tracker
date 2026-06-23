# Lookahead Absorption — bring the Look-Ahead Schedule into SitePulse as a 5th view (self-contained build plan)

> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then **re-read the actual current files before editing** (the
> codebase moves faster than docs — do not trust line numbers here).
> Parent/related: this is a NEW workstream. The longer-term schedule-import/versioning/Monte-Carlo
> vision (rework of the Phase 3 Gantt) is a SEPARATE later workstream — see
> `Notes/Phase3-Gantt-Schedule-Plan.md` — and does NOT block this.

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) in full first.
2. Re-read the files named in §"Build-on inventory" fresh — line numbers drift.
3. Build the sub-phases in order (0a → 0b → 1). Verify after each slice (§Verification).
4. Keep the owner (a product owner, not a developer) in the loop: lead with a 1–2 sentence
   plain-English summary; explain jargon in passing; keep it short.

## Goal
When this is done, a superintendent opens a SitePulse project, clicks a **5th view toggle**
("Look-Ahead", next to Map / List / Dashboard / Schedule), and sees the **trade × day
look-ahead schedule grid** for that project — the same app that currently lives standalone in
`C:\Users\BUrness\Dev\Lookahead`. They edit it; it **autosaves** to a new `lookahead_plans`
row tied to that project. No separate login, no separate project list — it rides on SitePulse's
existing session and project. Map / List / Dashboard / Schedule are completely unaffected.

In plain terms: SitePulse tracks **where** work is (the map); Lookahead plans **when/who**
(the weekly grid). This puts both tools behind one login for the super who uses both.

## Out of scope / deferred (do NOT build these here)
- **Task ↔ milestone mapping** between Lookahead tasks and SitePulse location-milestones — deferred;
  a non-binding soft-link comes much later. For now the two are independent.
- **Offline durability** — the absorbed Lookahead keeps its own debounced save; it does NOT join
  SitePulse's offline `pendingChanges` / IndexedDB mutation queue (AGENTS.md §2). Later decision.
- **Schedule import (MS Project / P6), baseline versioning, version-compare, Monte Carlo** — a
  separate later workstream on the Phase 3 Gantt, not this plan.
- **Mobile** — desktop-only for v1, exactly like the existing Schedule view (`hidden md:flex`).
- **Lookahead's own auth / Login / Dashboard / project list** — dropped; SitePulse owns these.
- **Pre-filling Lookahead's project info** (job name, super, dates) from the SitePulse project —
  a Phase 1 nicety, not Phase 0.

## Locked product decisions (from the owner)
- **UI:** Lookahead is a **5th top-level view** (peer to Map/List/Dashboard/Schedule), not a sub-tab
  or modal. `useUIStore.viewMode` is already a free `string`, so the value is just `'lookahead'`.
- **One SitePulse project = one lookahead plan.** Enforced by `UNIQUE(project_id)` on the new table.
  Lookahead's existing multi-**area** support (interior/exterior/…) lives **inside** the plan's blob.
- **Data model = a NEW isolated table** `lookahead_plans` in the **live FP-Analytics / Visual-Floor-Plan-Tracker
  Supabase**, storing Lookahead's `ProjectBlob` **verbatim** in a `doc jsonb` column. Purely additive —
  existing tables / RPCs / RLS / code paths are untouched (same shape as `workbench_sheets`).
- **Port-and-adapter:** copy Lookahead's `lib/` + document store + grid components **unchanged**;
  the ONLY swapped piece is persistence + auth (`useSession.ts` → a SitePulse adapter that uses
  SitePulse's session + the active `project_id`). The standalone Lookahead repo stays **frozen**.
- **Edit access (ASSUMED — confirm at the 0a migration gate):** owner / admin / pm / **superintendent**
  can write a plan; viewers read-only. Rationale: the look-ahead is the super's own tool. If the owner
  prefers parity with sheets/units (owner/admin/pm only), drop `'superintendent'` from the writer list.
- **Dev against the live DB** (the table is brand-new and empty, so exercising it is safe — see guardrails).

## Data model
New table only — nothing else changes.

```
lookahead_plans
  id          uuid PRIMARY KEY default gen_random_uuid()
  project_id  uuid NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE
  doc         jsonb NOT NULL          -- Lookahead's ProjectBlob, stored verbatim/opaque
  created_by  uuid                    -- auth.uid() at create (nullable)
  created_at  timestamptz NOT NULL default now()
  updated_at  timestamptz NOT NULL default now()
```
- `doc` is **opaque to Postgres** — no foreign keys reach into it, no triggers, no constraints on its
  contents. Its shape is owned by the app (`ProjectBlob` in the copied Lookahead types).
- **RLS** (mirror the `workbench_sheets` policies in `supabase/migrations/20260617_workbench_schema.sql`,
  but the join is simpler — straight to `project_members` on `project_id`, no `sheets` hop):
  - READ (`SELECT`) — any authenticated member of the project.
  - WRITE (`INSERT`/`UPDATE`/`DELETE`) — members whose `role IN ('owner','admin','pm','superintendent')`
    (per the assumed decision above). Never `anon`. All policies `TO authenticated`.
- Touches **no** existing table: not `status_logs`, `units`, `sheets`, `project_milestones`, nothing.
  The `status_logs` UNIQUE/`upsert_status_log`/applicability invariants are irrelevant here — Lookahead
  does not read or write any of them.
- **Types:** add `lookahead_plans` to the `Tables` block of `src/types/database.types.ts`; derive a
  domain Row type in `src/types/domain.ts`. **`doc` is `Json`** — narrow it to `ProjectBlob` at the query
  boundary with a guard (`isProjectBlob`, AGENTS.md §6), never let `Json` reach component props.

## Build-on inventory (read these fresh before using)
**SitePulse — wire into (do not fork):**
- `src/store/useUIStore.ts` — `viewMode` is a free `string` with `setViewMode`; no union edit needed.
- `src/components/TopHeader.tsx` — the desktop view-toggle group (`hidden md:flex`, ~the Dashboard/List/
  Schedule/Map buttons). Add a **5th button** copying the Schedule button pattern (`viewMode === 'lookahead'`).
- `src/app/project/[projectId]/page.jsx` — the `viewMode === 'dashboard' ? … : 'list' ? … : 'schedule' ? …`
  render chain (around the schedule branch). Add `: viewMode === 'lookahead' ? <LookaheadWorkspace projectId=… />`.
- `src/supabaseClient.ts` — the existing typed `supabase` client. The adapter uses THIS (not a new client).
- `src/hooks/useProjectQueries.ts` — conventions for TanStack Query hooks (use for the plan **load**;
  the **save** keeps Lookahead's own debounced approach for now, per scope).
- `supabase/migrations/20260617_workbench_schema.sql` — the **template** for an additive table + 4 RLS
  policies, all idempotent (guarded `IF NOT EXISTS` / `pg_policies` checks). Follow it + the
  `create-migration` skill.

**Lookahead — COPY UNCHANGED into `sitepulse-next/src/lookahead/`** (vendored module):
- `lib/*` → `schedule.ts`, `date.ts`, `defaults.ts`, `tokens.ts`, `config.ts`, `uid.ts`, `view.ts`, `types.ts`
- `store/useStore.ts` (the document store — exports `useStore`, `projectBlob(state)`, `loadProject(data)`)
- `components/*` EXCEPT the router/auth shells: keep `LookAhead.tsx` (grid root), `Header.tsx`,
  `Toolbar.tsx`, `ActionBars.tsx`, `RollModal.tsx`, `SettingsDrawer.tsx`, `Menus.tsx`, `AreaSwitcher.tsx`.

**Lookahead — DO NOT copy (replaced by SitePulse):**
- `store/useSession.ts` → replaced by the SitePulse persistence adapter.
- `components/App.tsx` → replaced by a thin `LookaheadWorkspace` mount.
- `components/Login.tsx`, `components/Dashboard.tsx` → SitePulse owns auth + project picking.
- `lib/supabase.ts` → use SitePulse's `src/supabaseClient.ts`.

## ⚠️ Known gotchas (each is a required step, not a surprise)
1. **localStorage collision.** The copied `store/useStore.ts` wraps state in zustand `persist` with a
   **single** key `"la-sched-orchard-v3"`. Inside SitePulse that one key is shared across ALL projects →
   cross-project contamination, and it would hydrate a stale blob before the adapter loads the right one.
   **Fix:** remove the `persist(...)` wrapper in the copied store (the adapter is the single source of
   persistence). This is the ONE deliberate edit to an otherwise-verbatim copy — call it out in the PR.
2. **Path-alias rewrite.** Lookahead files import `@/lib/…`, `@/store/…`. In SitePulse `@/` = `src/`, so
   after copying to `src/lookahead/` those resolve to the WRONG files. **Fix:** rewrite the copied files'
   internal imports to `@/lookahead/lib/…`, `@/lookahead/store/…` (or relative within the module).
3. **Dependency reconciliation.** SitePulse already has `zustand`, `@dnd-kit/core`, `@dnd-kit/sortable`,
   `@supabase/supabase-js`, `date-fns`, `lucide-react`. Re-read Lookahead's `package.json` and add any
   missing deps it actually imports (candidates: `@dnd-kit/modifiers`, `@dnd-kit/utilities`, `zundo`, `geist`
   fonts). Note: the document store appears to hand-roll undo via `past/future` snapshots — confirm whether
   `zundo` is actually imported anywhere before adding it.
4. **Print CSS + font.** Lookahead's 11×17 print rules live in its `app/globals.css` (`@page`, print
   overrides) and it uses the Geist font. Port the print rules into SitePulse's `globals.css` (scoped so
   they don't affect other views) so printing still works; decide on font (Geist vs inherit SitePulse's).
   Lookahead components use inline styles + `lib/tokens.ts`, so visual styling travels with them (low Tailwind clash risk).
5. **`"use client"`.** All copied components already have it; the new `LookaheadWorkspace` wrapper needs it.

## Pure logic to extract + unit-test
The roll-forward / date math is already copied verbatim in `src/lookahead/lib/schedule.ts` + `date.ts`
(unchanged, so not the new risk surface). The NEW pure surface to test:
- `isProjectBlob(doc: unknown): doc is ProjectBlob` — the `Json → ProjectBlob` narrowing guard at the
  query boundary. Co-locate `isProjectBlob.test.ts`; test a valid blob, missing `areas`, wrong types.
  Keep it null-safe (mirror the spirit of the existing `domain.ts` guards, AGENTS.md §9).
- Optional (nice-to-have, not required): port a couple of `schedule.ts` roll tests if Lookahead shipped
  any — but since the logic is unchanged, skip unless cheap.

## Sub-phasing (ship + verify each)

### Phase 0a — Database + vendored module + persistence adapter (no visible UI yet)
- **Scope:**
  1. **Migration** `supabase/migrations/<date>_lookahead_plans.sql` — create `lookahead_plans` + RLS,
     idempotent, additive (template: the workbench migration).
  2. **Types** — add `lookahead_plans` to `database.types.ts`; derive a Row domain type in `domain.ts`;
     add the `isProjectBlob` guard (+test).
  3. **Vendor the module** — copy the Lookahead files listed above into `src/lookahead/`, applying
     gotchas #1 (strip `persist`), #2 (import paths), #3 (deps), #4 (print CSS/font).
  4. **Adapter** — `src/lookahead/persistence.ts` (or a small `useLookaheadPlan(projectId)` hook):
     `loadPlan(projectId)` → SELECT the row, narrow `doc` via `isProjectBlob`, hand to
     `useStore.getState().loadProject(doc)`; `savePlan(projectId)` → take `projectBlob(useStore.getState())`
     and **upsert** into `lookahead_plans` on `project_id`. Uses SitePulse's `supabase` client + session.
     Lazy-create: only write a row on first save (don't insert empty rows on mere view-open).
- **⛔ Approval gates (STOP and get explicit owner sign-off):**
  - The **migration SQL** — present the full file and STOP before applying to the live FP-Analytics DB.
    This is also where the owner confirms the **superintendent-write** RLS decision.
  - Do not push to `main`.
- **Exit criteria:** `typecheck` + `test` + `build` green · `isProjectBlob` unit-tested · the module
  compiles · adapter load/save verified against the **new empty** `lookahead_plans` table only (safe — it
  holds no existing data; touch nothing else) · close with the `verify-feature` skill, then STOP.

### Phase 0b — Wire the visible view (the user-facing slice)
- **Scope:**
  1. `TopHeader.tsx` — add the 5th view button (`'lookahead'`, `hidden md:flex`, Schedule-button pattern).
  2. `page.jsx` — add the `viewMode === 'lookahead'` render branch → `<LookaheadWorkspace projectId={…} />`.
  3. `src/lookahead/LookaheadWorkspace.tsx` (`"use client"`) — the thin mount that replaces `App.tsx`:
     on open, `loadPlan(projectId)` (or blank via `makeBlankProjectBlob`); subscribe to the document store
     and **debounce-save** (~800ms) via the adapter; flush on unmount / tab-hide; render `<LookAhead />`.
  4. Decide & implement: lazy-create blank plan on first save (recommended) vs empty-state CTA; desktop-only.
- **Approval gates:** no migration here; do not push to `main` until "Approved."
- **Exit criteria:** `typecheck` + `test` + `build` green · **live `dev:3010` click-through**: open a
  project → switch to Look-Ahead → edit a cell → reload → it persisted; switch to Map/List/Dashboard/Schedule
  → all unaffected · close with `verify-feature`, then STOP.

### Phase 1 — Stop double-entry (seed vocabulary) — ⛔ DROPPED (superseded 2026-06-23)
**Do NOT build this.** The owner dropped the one-time pre-fill/seed approach. The double-entry problem is
instead solved by a SEPARATE new workstream: a **project-level "Trades" tab** that is the single shared
source of truth, read live by both the project and the Look-Ahead view (no copying/pre-fill). It will
eventually pull trades from the linked **Procore** project, and a super can still **free-type** a trade
name directly into a Look-Ahead cell when desired. See `Notes/plans/Project-Trades-*.md` (new plan) — and
the superseded kickoff `Notes/handoff/2026-06-23 - Lookahead Absorption Phase 1 Kickoff.md` (banner at top).
With Phase 1 dropped, **Lookahead Absorption is complete at 0a + 0b.**

## Hard guardrails (AGENTS.md — do not violate)
- **Touch no existing table / RPC / RLS.** `lookahead_plans` is fully isolated; do not read or write
  `status_logs`, `units`, `sheets`, `project_milestones`, or any existing object. The `upsert_status_log`
  / status_logs UNIQUE / capture-time `client_timestamp` / applicability rules do not apply here.
- **Do NOT wire Lookahead into the offline `pendingChanges` queue** (AGENTS.md §2) — out of scope.
- **Types:** derive from `database.types.ts`; narrow `Json → ProjectBlob` with `isProjectBlob` at the query
  boundary; no `any` (prefer `unknown` + narrowing) (§6). Keep the blob JSON-serializable (it already is).
- **Migration:** additive + nullable-safe + **idempotent**; follow the workbench template + `create-migration`
  skill; **present SQL and STOP** before applying to the live DB. Never modify existing rows in other tables
  (memory: "No live-write probes" — but the new empty `lookahead_plans` table is safe to exercise).
- **Verify** via `typecheck` + `test` + `build` (absolute-prefix commands below) + a `dev:3010`
  click-through for UI. **Lint is NOT a gate** (~1850 pre-existing problems).
- The copied Lookahead files keep their own TS/inline-style/token conventions — do not "Tailwind-ify" them;
  the only deliberate edit to the copy is stripping the localStorage `persist` (gotcha #1) + import paths.

## Open decisions
- **Superintendent write access** — assumed YES (owner/admin/pm/superintendent). Confirm at the 0a
  migration gate; flip by dropping `'superintendent'` from the writer role list.
- **Lazy vs eager plan creation** — recommend lazy (create the row on first save). Resolve in 0b.
- **Desktop-only for v1** — recommended (match Schedule's `hidden md:flex`). Resolve in 0b.

## Verification commands (the exit-criteria gate)
Bash cwd persists across calls and a stray `cd` triggers a prompt — run npm with an **absolute prefix**:
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck   # tsc --noEmit (primary gate)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test         # vitest (one file: ... run test -- src/lookahead/isProjectBlob.test.ts)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build         # next build (after editing live components)
```
- Vitest globals are OFF — import `{ describe, it, expect, vi }` from `'vitest'`; co-locate `*.test.ts`.
- No E2E framework — a live click-through via `npm run dev:3010` (from `sitepulse-next/`, port 3010) is the
  only UI verification.

# Kickoff — Lookahead Absorption, Phase 1: Stop double-entry (seed vocabulary)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Lookahead Absorption** (when a project's blank Look-Ahead plan is first created, pre-populate it from the SitePulse project so the super isn't re-typing the team/trades). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-23 - Lookahead Absorption Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Lookahead-Absorption-Plan.md` (Phase 1 + Out of scope + Guardrails)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 1**. No migration this phase (read-only seeding from existing tables). Verify with a live `dev:3010` click-through on a brand-new project. Don't commit or push until I say "Approved."

---

## Context for the session (the detail the launch prompt points at)

### Plain-English goal
Today, when a super opens a project that has no Look-Ahead plan yet, they get a **blank** grid and
have to hand-type their subcontractors, trade rows, and the job header (name, super, dates) — even
though SitePulse already knows most of that. Phase 1 removes that double-entry: a new blank plan opens
**pre-filled** with the project's trades and team, so the super starts from a sensible draft instead of
an empty page. It's a convenience/onboarding nicety — no schema, no new tables, no server work.

### What 0a + 0b already shipped (the foundation — do NOT redo)
- **0a (committed `e1d1b01`):** `lookahead_plans` table + RLS live in the FP-Analytics DB; the Look-Ahead
  app vendored into `src/lookahead/`; the persistence adapter (`src/lookahead/persistence.ts`:
  `loadPlan`/`savePlan`) + `isProjectBlob` guard (+test). **Lazy-create** is honored — a row is written
  only on the first real save.
- **0b (committed `99b0913`):** the visible 5th view — `TopHeader.tsx` toggle button, the
  `viewMode === 'lookahead'` branch in `page.jsx`, and `src/lookahead/LookaheadWorkspace.tsx` (the thin
  mount: loads the plan or a **blank** one, debounce-saves ~800ms, flushes on hide/unload/unmount). The
  vendored `Header.tsx` "← Projects" button is suppressed while `embedded`.
- The **blank** plan today comes from `makeBlankProjectBlob` (in `src/lookahead/lib/defaults.ts`). **That
  blank is the seam you hook in Phase 1.**

### Where the seeding plugs in
`LookaheadWorkspace` mounts → `useSession.openPlan(projectId)` → adapter `loadPlan`. When `loadPlan`
finds **no row**, it currently hands the store a plain blank blob. Phase 1: when there's no saved row,
build a **seeded** blob (blank + project vocabulary) instead of the empty one, and load THAT. The seeded
blob is still only persisted on the first real edit (lazy-create unchanged) — opening then leaving must
NOT write a row.

> ⚠️ Decide where the seed happens and keep it clean: either (a) `LookaheadWorkspace` fetches the
> SitePulse vocabulary and passes it into a new `makeSeededProjectBlob(blank, seed)` builder, or (b) a
> small `useLookaheadSeed(projectId)` hook. Keep the SitePulse-data fetching OUT of the vendored
> `src/lookahead/lib/*` (those stay portable/standalone) — the builder should take already-fetched plain
> data as an argument, not call Supabase itself.

### The data shapes (re-read fresh before using — line numbers drift)
**Look-Ahead target (`src/lookahead/lib/types.ts`):**
- `ProjectBlob.project: ProjectMeta` → `info: ProjectInfo` (`jobName, jobNumber, location,
  superintendent, preparedBy, projectStart, projectEnd`), `subs: Sub[]` (`id, code, company, contact,
  phone`), `holidays`, `milestones`.
- `ProjectBlob.areas[id].weeks[wk].groups: Group[]` → `Group.name` is the **trade group / phase row
  heading**; `Group.rows[].sub` references a subcontractor.

**SitePulse sources (confirmed shapes — verify with the hooks):**
- `project_milestones` Row: `id, project_id, sequence_order, name, color, track, applies_to_unit_types,
  created_at`. These are the project's **construction phases/trades** (e.g. Framing, Drywall, Paint) — the
  natural source for **`Group.name`** trade-row headings. Hook: `useMilestones(projectId)`
  (`src/hooks/useProjectQueries.ts`).
- `project_members` Row: `id, project_id, user_id, user_email, role`. ⚠️ **These are SitePulse app users,
  not subcontractor companies** — so they map to `Sub.contact`/`Sub.company` only loosely. Hook:
  `useProjectMembers(projectId)`. **Open question for the owner (below).**
- `projects` (job name etc.) → `ProjectInfo.jobName` and friends. Use whatever the existing project query
  already loads (`page.jsx`/`useProjectQueries.ts`); don't add a new fetch if the name is already in hand.

### ⛔ Open decisions — surface these to the owner BEFORE building
1. **What seeds `Sub[]`?** `project_members` are app users (emails), not trade companies, so seeding the
   subcontractor directory from them is a semantic stretch. Options: (a) seed trade **rows/groups** from
   `project_milestones` only and leave `subs` empty; (b) also seed `subs` from members (email →
   `contact`); (c) seed both. **Recommend (a) for v1** — milestones → trade groups is the clean,
   high-value mapping; members→subs can come later. Confirm with the owner.
2. **`ProjectInfo` pre-fill scope** — job name is easy and safe; superintendent/dates are nice but may be
   blank or wrong on the SitePulse side. Recommend: pre-fill `jobName` (+ anything already reliably on the
   project), leave the rest blank for the super to fill. Confirm.
3. **Re-seed behavior** — seeding happens ONLY when there is no saved plan (first open). An existing plan
   is never re-seeded or overwritten. (No decision needed — just don't regress lazy-create.)

## Locked decisions (carry these in)
- **No migration, no backend, no RLS** this phase — pure read-only seeding from already-fetched tables.
- **Lazy-create preserved** — a seeded blob is still only written on the first real edit; open-then-leave
  writes nothing.
- **Never re-seed or overwrite an existing plan** — seeding is first-open-only.
- **Desktop-only** (unchanged from 0b).
- Keep the vendored `src/lookahead/lib/*` portable — pass plain seed data in; don't let it call Supabase.

## ⚠️ Watch-outs
- **Don't break lazy-create.** The classic regression here is writing the seeded row on open. Re-use 0b's
  guard model (the workspace's `lastSavedRef` content-snapshot baseline) — the seeded blob is the new
  baseline, so it only saves once the super actually edits.
- **Empty/edge projects:** a project with zero milestones or members must still open a usable (blank-ish)
  plan — seed defensively (null-safe; empty arrays, not crashes).
- **No new fetch storms:** reuse the existing TanStack Query hooks (`useMilestones`, `useProjectMembers`);
  don't hand-roll a fetch in the vendored module or duplicate a query already live on the page.
- Touch **no** existing table/RPC/RLS; don't wire into the offline `pendingChanges` queue (out of scope).

## Pure logic to extract + unit-test
- A pure `makeSeededProjectBlob(blank, seed)` (or `buildLookaheadSeed(milestones, members, projectName)`)
  that takes plain SitePulse data and returns a `ProjectBlob` — **co-locate a `.test.ts`**: milestones →
  ordered trade groups, the `ProjectInfo` pre-fill, and the empty-project edge (no milestones/members →
  valid blank-ish blob, no throw). This is the new risk surface; the date/roll math is unchanged from 0a.

## Verification (exit criteria for Phase 1 — then STOP)
- `typecheck` + `test` + `build` green (absolute-prefix commands in the plan's Verification section).
- The seed builder is unit-tested (happy path + empty-project edge).
- **Live `dev:3010` click-through:** open a **brand-new** project (no existing plan) → switch to
  **Look-Ahead** → confirm it opens **pre-populated** with the project's trades (and job name) instead of
  blank; open-then-leave without editing writes **no** row (lazy-create intact); edit a cell → reload →
  persists. An EXISTING plan opens unchanged (not re-seeded). Map/List/Dashboard/Schedule unaffected.
- Close with the **`verify-feature`** skill, then STOP. Don't commit/push until the owner says "Approved."

> **Note:** Phase 1 is the LAST phase in `Lookahead-Absorption-Plan.md`. Deferred/out-of-scope items
> (task↔milestone soft-link, offline durability, schedule import / baselines / Monte Carlo on the Phase 3
> Gantt, mobile) are SEPARATE later workstreams — do not pull them in here.

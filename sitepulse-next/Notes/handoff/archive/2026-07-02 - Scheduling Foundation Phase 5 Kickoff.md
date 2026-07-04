# Kickoff — Scheduling Foundation (Slice A), Phase 5: Playbooks (reusable project-type-scoped activity sequences)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 5 of Scheduling Foundation (Slice A)** — playbooks: a named, reusable, project-type-scoped activity sequence (dictionary activities + their default FS edges) that seeds a new or empty project's activity set in one action. Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-02 - Scheduling Foundation Phase 5 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Scheduling-Foundation-Slice-A-Plan.md` (Phase 5 + Data model + Hard guardrails + Open decisions)
> - `sitepulse-next/AGENTS.md` (§2 status_logs invariants — untouched this phase, §4 activity dictionary / Schedule-view-home / dependencies bullets, §6 types + JSONB narrowing)
>
> Branch off `main` if the phase-2/3/4 stack has been merged; otherwise stack on `feat/scheduling-foundation-phase-4`. **⛔ This phase HAS a migration** (playbook storage) — present the full SQL and STOP for approval before applying anything; resolve the storage-shape open decision with me FIRST. Do NOT touch the standalone Look-Ahead (`src/lookahead/`). Don't commit/push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Where Phase 4 left us (read before starting)
Phase 4 shipped the **MS Project import** (branch `feat/scheduling-foundation-phase-4`, commits
90f2be7 + 60e31ce, stacked on phase-3; no migration). State now:
- The **Schedule view** is the complete activity home: `ActivityManagerPanel` (add/edit/reorder/
  applies-to + FS predecessor picker), `ScheduleSetupWizard` (first-run multi-select from the
  dictionary), `CascadePanel` (level dates → locations), `MspImportPanel` (MSPDI import →
  reconcile → planned dates).
- The **global activity dictionary** (Phase 2) is live on prod: 30 active entries + the
  `Other (pending)` sentinel, aliases, `default_project_types`, optional default `track`, `type`.
- **`activity_dependencies`** (Phase 3b) is live on prod: FS-only + `lag_days`, pair-unique,
  `wouldCreateCycle` app-level guard, one-predecessor-per-activity v1 UI.
- **`useCreateActivitiesBulk`** (Phase 3a) seeds several activities in ONE insert with explicit
  `sequence_order` — the wizard uses it because looping `handleAddMilestone` collides on a stale
  maxOrder. **Playbook application must reuse this bulk path** (and extend it for edges).

## What this phase is (plain English)
Today a new project starts from a blank activity list (or hand-picking dictionary entries in the
wizard). A **playbook** is a saved recipe — "Multifamily — Interior Finishes", say: an ordered
list of dictionary activities plus their usual finish-to-start links. Starting a project (or an
empty Schedule view) from a playbook seeds the whole activity set + sequence + dependencies in
one action. It's a starting point, not a straitjacket — everything stays fully editable after,
and choosing a playbook is never required.

## Verify the live surface FIRST (confirm; don't trust this doc)
- `src/components/schedule/ScheduleSetupWizard.tsx` — the first-run flow playbooks extend (or
  sit beside): multi-select of active dictionary entries, project-type ordering, seeds via
  `useCreateActivitiesBulk`. A playbook pick is essentially a pre-checked selection + edges.
- `src/hooks/useProjectQueries.ts` — `useCreateActivitiesBulk` (single INSERT, explicit
  `sequence_order`); check what it returns (ids are needed to insert the FS edges after).
- `src/hooks/useActivityDependencies.ts` + `src/utils/activityDependencies.ts` — edge insert
  shape + `wouldCreateCycle`.
- `src/utils/activityDictionary.ts` + `src/hooks/useActivityDictionary.ts` — entry shape,
  `activitiesForProjectType` ordering, RLS posture to mirror.
- The **project-create flow** (dashboard "New Project" → `create_new_project` RPC or
  `useProjectActions`) — find where a just-created project could offer "start from a playbook"
  without blocking creation.
- `supabase/migrations/20260702_activity_dictionary.sql` + `20260703_activity_dependencies.sql`
  — the RLS/grant patterns the playbook migration copies (read = member, write =
  owner/admin/pm, never anon).

## Scope (only this phase)
1. ⛔ **Migration — playbook storage.** Resolve the open decision first (see below), then:
   a table (or pair) holding a playbook's `name`, `default_project_types` scoping, an ORDERED
   set of `activity_dictionary` references (with per-item track/type overrides only if trivially
   cheap), and its default FS edges (predecessor/successor by playbook item + `lag_days`).
   RLS mirrors `activity_dictionary`. Seed nothing (or one example) — owner's call. Present the
   full SQL + STOP.
2. **`src/utils/playbooks.ts` (+ tests) — pure:** apply a playbook → the ordered
   `activities`-insert payload (explicit `sequence_order`, dictionary links) + the FS edge list
   keyed by insert position; skip/merge rules when the project ALREADY has some of the
   activities (decide: skip-duplicates-by-dictionary-id, never duplicate). No `Date.now()`.
3. **UI:** the Schedule view's first-run wizard gains a "Start from a playbook" path (picker
   scoped/ordered by the project's type), and the project-create flow offers the same
   non-blocking choice. Applying = `useCreateActivitiesBulk` + bulk edge insert; fully editable
   after; a playbook is never mandatory (blank + hand-pick stay).
4. **Authoring (minimal v1):** "Save current project's activities as a playbook" (privileged
   roles only) beats building a separate playbook editor — confirm with owner.

## ⛔ Approval gate
The migration. Present the complete SQL (tables, constraints, RLS, grants, `COMMENT ON`) and
STOP for explicit approval; apply to prod only on the owner's word (MCP `apply_migration`,
mirroring Phases 2/3).

## Exit criteria (Definition of Done)
- `typecheck` + `test` + `build` green; `playbooks.ts` tests pin ordering, edge mapping, and
  the skip-duplicates rule.
- Live (`npm run dev:3010`): a fresh/empty project starts from a playbook and lands the full
  activity set + sequence + FS edges in one action; everything editable after; blank start
  still works. Sandbox restored afterwards.
- Close with the **`verify-feature`** skill. **Do not commit/push until owner says "Approved."**
  Phase 5 is the LAST phase of Slice A — after approval, update the Slice A tracker and discuss
  the merge-to-main plan for the phase-2/3/4(/5) stack with the owner.

## Guardrails
- **status_logs untouched** — playbooks create `activities` + `activity_dependencies` rows only;
  no status writes, no planned dates.
- **Additive + idempotent migration, guarded RLS, no `anon` grants, `COMMENT ON`** (§ Hard
  guardrails). Copy the `subtypes`/`activity_dictionary` policy shape.
- **No durations on templates** (locked product decision) — a playbook holds identity +
  order + edges, never dates/durations.
- **Consolidate, don't add** — extend `ScheduleSetupWizard`, don't build a parallel wizard.
  Reuse `useCreateActivitiesBulk`; don't loop single inserts.
- Respect `wouldCreateCycle` when applying edges; playbook edges must be acyclic by
  construction (validate in `playbooks.ts`).
- Don't touch the Look-Ahead, `progressAnalytics`, or the offline mutation queue.

## Open decisions to resolve at start (with the owner, BEFORE writing SQL)
- **Storage shape** (plan's open decision): **(a) global governed playbook tables** referencing
  `activity_dictionary` (consistent with the dictionary, shareable company-wide — leaning this)
  vs (b) a JSONB snapshot per playbook (simpler, but drifts from the dictionary). Leaning (a):
  `playbooks` + `playbook_items` (+ edges either as a third table or as item-pair columns).
- **Seed content** — start empty, or save Orchard Path III's current activity set as the first
  real playbook?
- **Authoring v1** — "save current project as playbook" only, or also inline add/remove in a
  playbook admin list? (Leaning save-current-project only; admin CRUD can ride the dictionary
  admin pattern later.)

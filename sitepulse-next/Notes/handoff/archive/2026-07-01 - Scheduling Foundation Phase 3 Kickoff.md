# Kickoff — Scheduling Foundation (Slice A), Phase 3: consolidated Schedule view (+ light dependency authoring)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3 of Scheduling Foundation (Slice A)** — make the **Schedule view the single home for activity management** (move it out of Settings and consolidate the scattered Gantt pieces there), and add **light Finish-to-Start dependencies**. Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-01 - Scheduling Foundation Phase 3 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Scheduling-Foundation-Slice-A-Plan.md` (Phase 3 + Data model "After Phase 3" + Hard guardrails + Build-on inventory)
> - `sitepulse-next/AGENTS.md` (§2 state/RLS posture, §3 no `progressAnalytics` fork + applicability, §6 types + JSONB narrowing)
>
> Branch off `main`. Consider splitting **3a = view shell + management move** (UI only, no migration) and **3b = dependencies** (⛔ small migration). The dependencies table is the only DB change — present its SQL and **STOP** before applying; UI is otherwise ungated. **Do NOT touch the standalone Look-Ahead** (`src/lookahead/`). Don't commit/push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Where Phase 2 left us (read before starting)
Phase 2 shipped the **global governed activity dictionary** (branch `feat/scheduling-foundation-phase-2`,
commit `61e108e`, migration `20260702_activity_dictionary.sql` applied to prod `pmccdxmuszuykawvlphj`).
State now:
- **`activity_dictionary`** (global, governed) exists — mirrors `subtypes`: globally-unique `name`, `status`
  (active/pending/deprecated), `type` (task/milestone), optional default `track`, JSONB `aliases` +
  `default_project_types`, reserved `cost_code_id` (Slice B). RLS read = member, write = owner/admin/pm,
  never anon. Seeded with the `Other (pending)` sentinel + the distinct existing activity names (30 active).
- **`activities.dictionary_id`** (nullable FK → `activity_dictionary`, ON DELETE SET NULL). Existing
  activities are all `NULL` — the **review queue is `dictionary_id IS NULL`**. Nothing auto-linked.
- Pure helpers: `src/utils/activityDictionary.ts` (alias resolution/canonicalization, project-type
  ordering, non-blocking propose→fields). Hooks: `src/hooks/useActivityDictionary.ts` (read = member;
  propose + admin writes = privileged). Picker component: `src/components/ActivityDictionaryField.tsx`.
- The **activity editor still lives in `SettingsMenu.tsx`** (the "Milestones" tab). Phase 2 wired the
  dictionary picker into its add-row (pick by name/alias with a Linked/New chip; non-blocking add-custom)
  and added a per-row **Linked / Review** badge. **Phase 3 MOVES this whole editor into the Schedule view.**

⚠️ NOTE — `milestone`/`Milestone` are still **deprecated domain aliases** for `activity`/`Activity`
(`src/types/domain.ts`); the Settings tab is still labelled "Milestones" and hooks are still named
`useMilestones` / `useUpdateMilestone` / etc. You may keep the aliases; don't churn a mass rename. But the
**user-facing** surface you build in the Schedule view should say **"Activities."**

## What this phase is (plain English)
Right now a project's activities are authored in a cramped Settings tab, while a separate **Schedule view**
(a Gantt) already exists but doesn't own activity management. This phase makes the **Schedule view the one
place** you build and sequence a project's activities — with the floor plan present for space-bound work —
and removes the Settings milestone manager so there aren't two homes. It also adds **coarse dependencies**:
an activity can have a **Finish-to-Start predecessor + a lag in days** (no critical-path/float math — just
"B starts after A finishes, +N days"), authored with a simple predecessor picker.

## Verify the live surface FIRST (confirm; don't trust this doc)
Before moving anything, read these **fresh** (line numbers drift):
- `src/store/useUIStore.ts` — `viewMode` is a plain `string` + `setViewMode`. Find the exact value the
  Schedule tab sets (add a first-class value if it's ad-hoc).
- `src/components/TopHeader.tsx` — where the **Schedule View** tab renders (it already exists — the project
  header shows Dashboard / Field List / **Schedule** / Interactive Map / Look-Ahead).
- `src/components/schedule/` — `ScheduleWorkspace.tsx`, `GanttTimeline.tsx`, `GanttBar.tsx`,
  `CascadePanel.tsx` (the existing Gantt authoring pieces to consolidate into the Schedule view).
- `src/components/SettingsMenu.tsx` — the "Milestones" tab (`activeTab === 'milestones'`): the add-row
  (now `ActivityDictionaryField` + color + Add), the `SortableMilestoneItem` list (drag-reorder,
  edit name/color, applies-to rules, Linked/Review badge), Scopes-of-Work (tracks), Auto-Advance, and the
  Sheet Scope Assignments block. Decide what moves vs. what stays (Sheet Scope Assignments + scale may stay
  in Settings; the **activity list + add/edit + reorder + applicability** move).
- `src/hooks/useProjectQueries.ts` — `useMilestones`, `useUpdateMilestone`, `useReorderMilestones`,
  `useUpdateMilestoneRules`, `useMilestoneOverrides`, `useSetMilestoneApplicability`. Reuse these in the new
  home; don't fork them.
- `src/hooks/useProjectActions.ts` — `handleAddMilestone` (Phase 2 threads `dictionary_id`),
  `handleUpdateMilestone`, `handleDeleteMilestone`. Reuse.
- `src/utils/ganttMath.ts`, `src/utils/progressAnalytics.ts` (`orderedTrackMilestones`),
  `src/utils/bottleneck.ts` — read on `sequence_order`; the dependency graph is additive on top.

## Scope (only this phase)
**3a — Schedule view becomes the activity-management home (UI only, no migration):**
1. Ensure a first-class `viewMode` for Schedule (in `useUIStore`) + the `TopHeader` tab.
2. **Move** the activity manager out of `SettingsMenu` into the Schedule view: the activity list
   (add via `ActivityDictionaryField`, edit name/color, drag-reorder `sequence_order`, applies-to
   rules, the **Linked / Review** badge), Scopes-of-Work (tracks), and Auto-Advance. **Consolidate** the
   `schedule/` Gantt pieces into one coherent view; floor plan present for space-bound authoring. Consider a
   first-run **wizard mode** for a project with no activities (e.g. "start from your dictionary").
3. **Remove** the Settings "Milestones" tab once the Schedule view owns it — don't leave two homes
   (guardrail: consolidate, don't add). Keep back-compat hooks; just relocate the UI.

**3b — Light dependencies (⛔ small migration):**
4. ⛔ **Migration** (`supabase/migrations/<YYYYMMDD>_activity_dependencies.sql`): NEW `activity_dependencies`
   (`predecessor_activity_id`, `successor_activity_id`, `type` default `'FS'`, `lag_days int default 0`),
   FKs → `activities(id)` (ON DELETE CASCADE), a unique constraint on the pair, and RLS mirroring the
   activity/status membership posture (write = privileged, never anon). Additive. **Present SQL + STOP.**
5. Minimal authoring UI in the Schedule view: order + a **simple predecessor picker** + lag. **Coarse only**
   — no CPM, no float, no resource leveling, FS-only (out of scope per the plan).
6. Update `database.types.ts` + derive a domain type in `domain.ts`; a read/write hook mirroring the
   existing project-query hooks (online-first).

**Do NOT touch the standalone Look-Ahead** (`src/lookahead/`) or its `projectBlob`/autosave seam.

## ⛔ Approval gate (hard stop)
Only **3b's `activity_dependencies` migration** is gated: present the exact SQL + **STOP** before applying
(additive + idempotent, guarded RLS, no `anon`, `COMMENT ON`). **3a is UI-only and ungated** (no schema
change) — but still don't commit/push until "Approved."

## Exit criteria (Definition of Done)
- `typecheck` + `test` + `build` all green (`npm --prefix "…/sitepulse-next" run typecheck|test|build`).
- Live (`npm run dev:3010`): build/edit a project's **activity set + sequence entirely from the Schedule
  view**; Settings **no longer** owns activity management; add a **FS predecessor + lag** to an activity and
  see it reflected; the standalone **Look-Ahead is untouched**.
- Close with the **`verify-feature`** skill (Definition of Done → STOP). **Do not commit/push until owner
  says "Approved."** Then draft the **Phase 4 kickoff** (MS Project `.xml` import → reconciliation → planned
  dates) + hand off.

## Guardrails
- **Consolidate, don't add** — remove the Settings milestone manager when the Schedule view takes over; one
  home only. Reuse the existing `useMilestones*` hooks + `schedule/` pieces; don't fork them.
- **Don't fork `progressAnalytics`**; respect applicability (N/A stays out of denominators, §3); don't
  recolor `mapDisplayStatuses`; don't break the offline mutation queue or the snapping-vector pipeline.
- **Dependencies stay coarse** — FS + lag only. No critical path / float / resource leveling / non-FS
  relationships (explicitly out of scope for Slice A).
- **Migrations** additive + idempotent, guarded RLS, no `anon` grants, `COMMENT ON`, present SQL + STOP.
- Types: `database.types.ts` hand-maintained; derive domain types from the Row; narrow JSONB at the query
  boundary; no `Json` into props (§6). Keep Query-cache values JSON-serializable.
- **Don't touch the Look-Ahead** (`src/lookahead/`).

## Open decisions to resolve at start
- **Split 3a / 3b or ship together?** Leaning: two sessions (3a UI-only, 3b the gated migration + dep UI),
  per the plan's "Consider splitting."
- **What stays in Settings** — Sheet Scope Assignments + per-level scale/schedule may stay in Settings;
  only the activity list/add/edit/reorder/applicability + tracks + auto-advance move. Confirm with owner.
- **Wizard mode depth** — a full first-run wizard vs. a simple "start from dictionary / playbook later"
  empty-state. Playbooks are Phase 5, so keep the wizard light here.
- **Dependency authoring UI depth** — ordering + a single predecessor picker in v1; a richer graph UI is
  deferred. Confirm at 3b.

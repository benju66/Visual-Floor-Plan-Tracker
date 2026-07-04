# Kickoff — Scheduling UX Hardening, Phase 1: scope bug + pick-or-type scope + searchable activity picker

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Scheduling UX Hardening** (fix the "new Scope of Work" tab bug, make the scope box a pick-or-type menu, and add search to the first-run activity picker). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-02 - Scheduling UX Hardening Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Scheduling-UX-Hardening-Plan.md` (Phase 1 + guardrails + Out-of-scope)
> - `sitepulse-next/AGENTS.md` (§2 status-pipeline invariants — untouched this phase, §6 types)
>
> Branch off `main` **if** the Slice A Phase 5 playbooks branch (`feat/scheduling-foundation-phase-5`) has been merged; otherwise **stack on `feat/scheduling-foundation-phase-5`** (this phase edits `ScheduleSetupWizard.tsx`, which Phase 5 also changed). **No migration, no ⛔ approval gate this phase** — it's frontend-only. Do NOT touch the offline status pipeline, `src/lookahead/`, or the playbooks data model. Don't commit/push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists
From the owner's 2026-07-02 hands-on review of the Slice A scheduling build. Phase 1 clears the
three quick, low-risk friction points — all frontend, two files, no database change:
- **#2 (bug):** adding a new Scope of Work doesn't show a tab.
- **#5:** the "Scope of Work" box is a raw text field; should be pick-existing-or-type-new.
- **#6:** the first-run activity picker is a flat ~30-item checkbox list with no search.

## Verify the live surface FIRST (confirm; don't trust this doc)
- `src/components/schedule/ActivityManagerPanel.tsx` — `uniqueScopes = [...new Set(milestones.map
  (m => m.track))]`; the "New Scope" `+` handler only `setActiveTrack(val)` + clears the input, so a
  scope with no activities has no tab. This is #2. The panel also owns the scope tabs + the
  dictionary-backed add row (`ActivityDictionaryField`).
- `src/components/schedule/ScheduleSetupWizard.tsx` — the first-run wizard: the free-text "Scope of
  work" input (#5) and the flat Pick-Activities multiselect (#6). (Phase 5 added a "From a playbook"
  tab here — leave that intact.)
- `src/components/ActivityDictionaryField.tsx` — the existing dictionary typeahead (search +
  add-custom). **Reuse its search pattern for the wizard (#6)**; don't reinvent.

## Scope (only this phase)
1. **#2 — new scope shows immediately** (`ActivityManagerPanel`): keep scopes derived from
   activities' `track`, but hold added-but-empty scopes in local component state and merge them into
   the rendered tab list so a new scope's tab appears + stays selected at once. Adding an activity
   while it's active materializes it (its `track`). Ephemeral across reload is fine — an empty scope
   has nothing to persist. (First-class saved scopes are a deferred future workstream — see the plan;
   do NOT start a schema change here.)
2. **#5 — pick-or-type scope**: replace the free-text scope inputs (the panel's "New Scope" and the
   wizard's "Scope of work") with a combobox — choose an existing scope OR type a new one.
3. **#6 — searchable picker** (`ScheduleSetupWizard`): add a search box over the Pick-Activities
   list (and, since the tags stay per the owner's decision, an optional filter-by-tag). Keep it a
   multiselect; reuse the `ActivityDictionaryField` search approach.

## Guardrails
- **status_logs / offline queue untouched.** No status writes, no `upsert_status_log`, `pendingChanges`
  stays local (§2). The `track` value stays a plain string this phase.
- **No DB migration, no RLS change, no ⛔ gate.** Pure frontend. If something tempts a schema change,
  STOP and raise it.
- **Don't fork** `progressAnalytics` / `ganttMath`; don't touch `src/lookahead/` or the playbooks
  model; keep the Phase 5 "From a playbook" wizard tab working.
- **Types:** derive from `database.types.ts`; narrow JSONB at the boundary; no `Json` into props (§6).

## Exit criteria (Definition of Done)
- `typecheck` + `test` + `build` green (absolute-prefix commands in the plan's Verification section).
- Live (`npm run dev:3010`): add a new scope → its tab appears immediately; the scope box is a
  pick-or-type menu in both the panel and the wizard; the wizard's activity list filters as you type.
- Close with the **`verify-feature`** skill. **Do not commit/push until the owner says "Approved."**
  After approval, draft the Phase 2 kickoff (resizable divider) and paste its launch prompt into chat.

## Note on ordering
This is the first of four phases in `Scheduling-UX-Hardening-Plan.md`:
Phase 1 quick wins → Phase 2 resizable divider → Phase 3 Activity Library manager (Global Settings
tab) + tag cleanup → Phase 4 importer explainer + inline add. First-class Scopes and the importer
docked-redesign are deferred future workstreams (see the plan's Out-of-scope).

# Kickoff — Terminology Sweep: finish the milestone → activity rename (code + UI)

## ▶ Launch prompt (paste this to start a fresh session)
> Perform the **milestone → activity terminology sweep** (code + UI only — the database/schema is ALREADY renamed; do NOT write a migration). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-02 - Terminology Sweep (milestone to activity) Kickoff.md` (this file)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. This is a **behavior-preserving rename** — no features change. **Critical gotcha: `'milestone'` is also a legitimate *value* of `ActivityType` (`'task' | 'milestone'`) — a milestone is a *kind* of activity. Rename the old *naming*; KEEP every place `'milestone'` is a type value.** No DB migration, no `status_logs`/RPC/RLS changes. Verify by typecheck + test + build + a live click-through showing identical behavior. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## What this is (plain English)
The app renamed "milestones" to "activities" during the Scheduling Foundation work, but the rename was
only finished at the **database layer**. The **code identifiers and the user-visible text still say
"milestone" in ~81 files / ~71 visible strings**, so the product shows "Activity" in new screens and
"Milestone" in older ones. This task finishes the rename in the code and UI so the vocabulary is
consistent everywhere. **Nothing about how the app behaves changes** — this is naming only.

## Critical ground-truth facts (verify fresh before editing; do not trust these blindly)
- **The schema/data layer is ALREADY renamed — do NOT touch it and do NOT write a migration.**
  Confirmed in `src/types/database.types.ts`: `status_logs` keys on **`activity_id`** (FK
  `status_logs_activity_id_fkey`); `sheets.milestone_schedules` is now **`activity_schedules`**; and
  there are `activity_dictionary`, `activity_dependencies`, `activity_scopes`,
  `activity_applicability_overrides` tables. The offline-sync core (`upsert_status_log`, the slot
  constraint, the audit trigger) is already activity-keyed — **leave it alone.**
- **What actually remains is a deliberate transitional shim in the CODE + the UI copy:**
  - `src/types/domain.ts`: `StatusLog = Database[...]['status_logs']['Row'] & { milestone: string }` —
    the read hooks **synthesize** the activity's current NAME onto each row as a `.milestone` field.
    Also a `@deprecated Milestone` type alias, `milestoneObj`, and `BottleneckSequence.milestone`.
  - Code identifiers throughout: `useMilestones`, `filterMilestone`, `selectedMilestone`,
    `milestones` arrays, `onOpenMilestoneModal`, etc.
  - UI copy (~71 strings): e.g. "Keep Existing Milestones", "Set Milestone", "Change Milestone",
    "Milestone Breakdown", the map legend title "Milestones", "Choose milestone…", "All milestones".

## ⚠️ The one gotcha — do NOT blanket find/replace
`ActivityType = 'task' | 'milestone'` (`domain.ts`). Here **"milestone" is a legitimate VALUE** — a
milestone is a *kind* of activity (a zero-duration marker vs a durational task). **KEEP every
occurrence where `'milestone'` is a type value:** the `ActivityType` union, the `activities.type` DB
column values, any `type === 'milestone'` comparison, and any UI that labels the *kind* (e.g. a
type-picker showing "Task / Milestone"). Only rename occurrences that are the **old name for the whole
concept**. This requires judgment per occurrence — never `sed` the whole tree.

## Scope — two passes (one session if it stays green; split if it gets large)
**Pass A — code / domain identifiers (behavior-preserving):**
- Rename the synthesized field `StatusLog.milestone` → **`activityName`** (a string = the activity's
  current name); update the read hooks that populate it and every consumer (`s.milestone` →
  `s.activityName`, `log?.milestone` → `log?.activityName`, `s.milestone === activity.name`, etc.).
- Retire the `@deprecated Milestone` alias — replace usages with `Activity`; remove the alias.
- Rename identifiers: `milestoneObj` → `activityObj`, `filterMilestone` → `filterActivity`,
  `useMilestones` → `useActivities`, `selectedMilestone`, `onOpenMilestoneModal`, `milestones` arrays,
  `BottleneckSequence.milestone` → `.activityName`, etc. Grep the tree fresh for the full set.
- **Do not** rename the `'milestone'` type value or `ActivityType` (see gotcha).

**Pass B — UI copy (visible text):**
- Replace visible strings that use the OLD naming: "Milestone(s)" → "Activity/Activities" in headers,
  buttons, options, placeholders, tooltips, legend titles (`MapLegend`, `FieldStatusTable`,
  `ProjectDashboard` "Milestone Breakdown", `BulkActionDock`, `ContextActionDock`, `CanvasContextMenu`,
  `ManageToolbar`, `BulkStatusBar`, etc.).
- **Keep** any UI text where "Milestone" legitimately names the *activity kind* (task vs milestone).

## Guardrails (AGENTS.md — do not violate)
- **No migration. No `status_logs` / `upsert_status_log` / RLS / audit-trigger changes.** The data layer
  is done; this is code + copy only.
- **Behavior-preserving** — no feature changes, no logic changes, no re-coloring, no query changes.
  Don't fork `progressAnalytics`; don't touch the offline mutation queue, `pendingChanges`, or the
  snapping/vector pipeline.
- **Respect the `'milestone'` type value** everywhere (the gotcha above).
- **Types:** `database.types.ts` is hand-maintained — the DB Row already says `activity_id` etc.; you're
  renaming the derived/domain layer, not the generated Row. Narrow JSONB at the query boundary as before.
- **FloorplanCanvas overlap:** this sweep edits `FloorplanCanvas.tsx`. If a FloorplanCanvas
  decomposition is in flight on another branch, coordinate/serialize — do not run both in parallel.

## Exit criteria (Definition of Done)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` — clean.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test` — all green
  (rename any `milestone`-named test identifiers too; do not weaken assertions).
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build` — clean.
- **Grep proof:** remaining `milestone` occurrences are ONLY legitimate type-value usages
  (`'milestone'` as `ActivityType`) — no old-naming identifiers or UI copy left. Include the grep
  output in your summary.
- **Live parity check** (`npm run dev:3010`, port 3010): map legend, field/status table, dashboard
  ("Activity Breakdown"), bulk actions, context menu — all read "Activity" and behave **identically** to
  before. No behavior changed.
- Close with the **`verify-feature`** skill (Definition of Done → STOP). **Do not commit or push until
  the owner says "Approved."**

## Naming note
Target for the synthesized field is `activityName`. If that collides with an existing symbol or reads
awkwardly in a specific spot, flag it in your summary rather than inventing an inconsistent alternative
mid-sweep — consistency matters more than the exact word.

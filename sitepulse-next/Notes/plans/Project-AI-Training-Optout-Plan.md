# Per-Project AI-Training Opt-Out — toggle in Global Settings → Projects (self-contained build plan)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: the AI-Tracing capture foundation — `supabase/migrations/20260625_trace_capture.sql`,
> `docs/ANNOTATION_SPEC.md`, and the "Trace Naming & Type Assist" workstream.

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) first.
2. Re-read the files named below fresh — do not trust line numbers; they drift.
3. Build the two slices in order. Verify after each (§ verify).
4. Keep the owner (product owner, not a developer) in the loop: lead with a
   1–2 sentence plain-English summary; explain jargon in passing; keep it short.

## Goal
A project admin can flip a per-project switch in **Global Settings → Projects** (immediately
left of each project's Delete button). When a project's switch is **OFF**, nothing traced in
that project from then on contributes to AI features: it stops writing the **training corpus**
(the `trace_events` log + the provenance columns on `units`), AND its confirmed rooms stop
feeding the **live naming-vocabulary learning** that powers name/type auto-fill across every
other project. Switch defaults **ON** (every existing project keeps contributing). The
location-naming *suggestions a user sees while tracing in an opted-out project still work* —
opt-out only stops that project from *contributing back*.

## Out of scope / deferred
- **The workbench container is NOT gated.** The hidden `kind='workbench'` labeling project is
  excluded from the Projects tab by design, so it has no toggle and keeps capturing — it is the
  firm's deliberate labeling surface. (A workbench-level opt-out can be a later pass.)
- **No retroactive purge.** Toggling OFF stops *future* capture only; already-recorded
  `trace_events` rows and `units` provenance stay. (Owner decision — stop-future-only.)
- **No RLS hard-enforcement of the flag.** Gating is client-side (we skip the writes). The
  `trace_events` INSERT policy is unchanged. Acceptable for a single-firm tool; note it.
- No new UI surface beyond the one switch; no dashboard-grid indicator.

## Locked product decisions (from the owner)
- **Scope = BOTH channels** — opt-out stops the training corpus *and* the live learning. Why:
  "disable AI training" should mean the project stops influencing AI everywhere.
- **Stop-future-only** — do not delete/clear existing captured data. Why: non-destructive, simplest.
- **Placement** — a switch immediately left of each project's Delete button in the Projects tab.
- **Default ON** — opt-OUT model; silence = contributes, matching today's behaviour.

## Data model
- **NEW column** `projects.ai_training_enabled BOOLEAN NOT NULL DEFAULT true`. Additive, defaulted,
  so every existing row reads `true` with no backfill. Mirrors the `projects.kind` / `project_type`
  additive-column pattern (`20260617_workbench_schema.sql`, `20260616_location_taxonomy.sql`).
- **RLS:** none needed. `projects` already has `"Privileged members can update projects"`
  (UPDATE, USING/WITH CHECK = membership role in `owner`/`admin`) — verified live. The Projects tab
  only lists projects where the member's role is `admin` (`dashboard/page.jsx`), so the client
  `update({ ai_training_enabled })` passes RLS. SELECT policy already exposes the column to members.
- **Reads:** `projects(*)` in the dashboard fetch (`dashboard/page.jsx`) already returns the new
  column on every `adminProjects` item — no query change there.
- **No status_logs / offline-queue / applicability surface is touched.** This feature never writes
  `status_logs` and never enters the `pendingChanges` path.

## Build-on inventory (read these fresh before using)
- `src/components/GlobalSettingsModal.jsx` — Projects tab renders one row per project; the Delete
  button sits at the right of the row header. Reuse the existing peer-checkbox **toggle markup**
  already in this file (the User-Management assignment switch) for visual consistency.
- `src/app/dashboard/page.jsx` — owns `adminProjects` + passes `onProjectDeleted`. Add a sibling
  `onProjectUpdated(projectId, patch)` so a toggle reflects without a refetch.
- `src/hooks/useMapActions.ts` — the live-map write path. `saveNewUnitFromPopover` writes unit
  provenance + `recordTraceEvent`; `cancelUnitNaming` writes the `reject_suggestion` event. `project`
  is already a hook arg. These are the ONLY two map-side training writes (geometry/rename/stamp/
  duplicate do NOT record provenance).
- `src/hooks/useNamingVocabulary.ts` — reads every confirmed room (`unit_number, subtype_id`) via
  `paginateAll`; folds into the model with `buildNamingVocabulary`. Degrades to `EMPTY_VOCABULARY`
  on any error/no-session.
- `src/utils/traceCapture.ts` (`recordTraceEvent`, best-effort) and `src/utils/roomSuggestion.ts`
  (`ROOM_TEXT_MODEL_VERSION`, `deriveSuggestionSource`, `suggestedLabelFromSuggestion`) — used by the
  write path; do NOT fork them.
- `src/types/database.types.ts` (`projects` Row/Insert/Update) + `src/types/domain.ts` (`Project`
  derives automatically).

## Pure logic to extract + unit-test  → `src/utils/trainingGate.ts` (+ `.test.ts`)
- `isProjectTrainingEnabled(project): boolean` — `project?.ai_training_enabled !== false`. Default-ON:
  `true`/missing/`null`/undefined project ⇒ `true`; only an explicit `false` ⇒ `false`. This is the
  load-bearing gate for both write sites.
- `excludeUntrainableRooms(rooms, excludedSheetIds): rooms` — drop rooms whose `sheet_id` ∈ the
  excluded set; empty set ⇒ return input unchanged; tolerate null `sheet_id` (kept). Used read-side.
- Both are framework-free + deterministic (no DB/React/Date.now), unit-tested in isolation.

## Sub-phasing (ship + verify each)

### Phase 1 — DB column + types  ⛔ migration gate
- **Scope:** new migration `supabase/migrations/20260629_project_ai_training_optout.sql` (idempotent,
  `ADD COLUMN IF NOT EXISTS … BOOLEAN NOT NULL DEFAULT true`, a COMMENT, a read-only verification
  block — mirror the `20260617`/`20260616` template; NO RLS block). Add the column to
  `database.types.ts` (`projects` Row + Insert? + Update?).
- **Approval gates:** ⛔ present the exact SQL and get the owner's go-ahead before applying to prod
  (`pmccdxmuszuykawvlphj`). Additive + defaulted = safe + reversible, but it touches the live DB.
- **Exit criteria:** migration applied + tracked; `database.types.ts` compiles (`typecheck` green).

### Phase 2 — Gating + UI + tests
- **Scope:**
  1. `src/utils/trainingGate.ts` + `trainingGate.test.ts` (the two pure fns above).
  2. `useMapActions.ts`: compute `const trainingEnabled = isProjectTrainingEnabled(project)` once;
     in `saveNewUnitFromPopover` write provenance + call `recordTraceEvent` ONLY when enabled (else
     create the unit with provenance fields null and skip the event); in `cancelUnitNaming` skip the
     reject event when disabled. The name/type **suggestion still runs** (UX unaffected).
  3. `useNamingVocabulary.ts`: fetch opted-out project ids (`projects.eq('ai_training_enabled',false)`)
     → if any, fetch their sheet ids (`sheets.in('project_id', ids)`) into a `Set`; select `sheet_id`
     alongside the two learning columns; `excludeUntrainableRooms` before `buildNamingVocabulary`.
     Zero opted-out projects ⇒ skip the sheets query + filter ⇒ behaviour identical to today.
  4. `GlobalSettingsModal.jsx`: a switch left of Delete; optimistic local override + `projects.update`;
     error → revert + inline status; call `onProjectUpdated`.
  5. `dashboard/page.jsx`: `onProjectUpdated` patches the nested project in `projects` state.
- **Exit criteria:** typecheck + test + build green · `trainingGate` unit-tested · live `dev:3010`
  click-through (toggle a project off, trace on its map → no `trace_events` row / no provenance;
  toggle back on → capture resumes) · close with the verify-feature skill; do not commit/push until
  the owner says "Approved".

## Hard guardrails (AGENTS.md — do not violate)
- Derive the new column type in `database.types.ts`; never hand-roll a `projects` shape (§6).
- The naming vocabulary model stays **plain JSON** through the TanStack cache → IDB — never a
  `Map`/`Set` in cached state (the `Set` here is request-local, never cached) (§6).
- `useNamingVocabulary` stays best-effort: any error ⇒ `EMPTY_VOCABULARY`; never throw, never block a
  trace. Keep the `paginateAll` 1000-row pagination (the cap note).
- `recordTraceEvent` is best-effort and must never block a save — gating only *skips* it.
- Never touch `status_logs` / `pendingChanges` / `progressAnalytics` — this feature is unrelated to them.
- Migration must be additive + idempotent; apply BEFORE deploying the read-side code (the new
  `sheet_id`/flag reads assume the column exists — though the hook degrades to empty if missing).

## Open decisions
- None load-bearing. (Workbench-level opt-out + retroactive purge are explicitly deferred above.)

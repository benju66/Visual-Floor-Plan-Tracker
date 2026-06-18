# Kickoff — Location Labeling Workbench, Phase 7: Standard-enforcing labeling UX (naming rules + label metadata + Definition-of-Done/review)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 7 of the Location Labeling Workbench** (make the workbench tracer *enforce the labeling standard*: naming rules, the two-level/void label flags, interior-face guidance, and a Definition-of-Done + second-person review lifecycle). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-17 - Location Labeling Workbench Phase 7 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Location-Labeling-Workbench-Plan.md` (Phase 7 + § Hard guardrails + § Open decisions)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. **No DB migration is needed** — Phase 3 already shipped every column you write (`units.spans_levels/level_note/has_void`, `workbench_sheets.review_state/reviewed_by/reviewed_at`). Reuse the existing tracer / popover / taxonomy pipeline; do NOT fork `FloorplanCanvas`, `useMapActions`, `progressAnalytics`, or touch `main.py`/RLS. ⛔ **Hard stop:** if this slice grows past one session, SPLIT it — **7a = naming rules + label metadata**, **7b = Definition-of-Done + review lifecycle** — and write a fresh kickoff for the second half instead of cramming. Don't commit or push until I say "Approved."

---

> Context for the session (everything below is the detail the launch prompt points at). Self-contained: read this, then the files it names, then build.
> **✅ PHASES 1–6 ARE DONE.** Phase 6 (open a Drawing-Library drawing into a tracing view that reuses `FloorplanCanvas` to bank labels) shipped on branch `claude/workbench-phase6-tracing` (commit `422bd91`, 2026-06-17) and was verified live. You can open the existing test drawing `8ae5a09f-6459-49cd-bebe-fbce4776fc10` ("Verification Drawing — L2", `sheet_project_type='Healthcare'`) in the hidden container `1a0b0343-29ab-400f-a498-12c62d11df42` ("Drawing Library", `kind='workbench'`) and trace immediately — it already has a few Phase-6 labels on it.
> **Branch off `main`.** Small reviewable commits; `typecheck` + `test` before each. Do NOT commit/push until the owner says "Approved."

## What you're building
**Phase 7 of the Location Labeling Workbench plan** — the workbench currently lets you trace polygons and name/type them, but it does **not yet enforce the labeling standard**. This phase adds that enforcement so the banked corpus is clean and review-gated:

1. **Naming rules** — trim + collapse double-spaces on save; **uniqueness within a sheet** (a duplicate name is blocked); **auto-increment** suggestion for the next designator following the established pattern (`301 → 302`, `A-104 → A-105`, `Court 1 → Court 2`); **role + sub-type required** before a label can save (today a type-less label can be banked — Phase 7 forbids it).
2. **Label metadata** — a `spans_levels` toggle + `level_note` text (loft/mezzanine/double-height, standard §7) and a `has_void` toggle (donut rooms, standard §5), added to the workbench naming/edit form. These write the **already-existing** `units.spans_levels/level_note/has_void` columns.
3. **Interior-face guidance** (standard §3) — lightweight inline guidance text in the tracing view. **No geometry enforcement** — guidance copy only.
4. **Definition-of-Done + second-person review** (standard §9) — a per-drawing §9 checklist (computed by a pure `definitionOfDoneChecks`), and a `review_state` lifecycle on `workbench_sheets` (`draft → ready_for_review → reviewed`, stamping `reviewed_by`/`reviewed_at`). A drawing flips to **`reviewed` only when the checklist passes**.

This is the last planned phase of the A3+A4 workstream. **Clean-corpus export (A5), tracing accelerators (Workstream B), and any AI are explicitly out of scope** (separate later plans).

## Required reading (in order, fresh — do not trust line numbers; they drift)
1. `sitepulse-next/AGENTS.md` — especially **§2** (online-first writes via TanStack hooks; floating UI/modals in Zustand with an explicit interface; do NOT touch the offline `pendingChanges` queue or `status_logs`/`status_audit_log`; RLS posture — workbench writes go through normal authenticated member RLS, never `anon`, never service-role), **§4** (Location Taxonomy: `unit_type` is KEPT and applicability keys on it; `top_level_role` is the single source of truth for role; **store/export only the canonical role string — display labels are presentation-only**), **§6** (TS guardrails: new files `.ts`/`.tsx`, derive types from `database.types.ts`, narrow JSONB at the boundary, no `any`; **Zustand stores need an explicit state interface**), **§9** (Vitest globals OFF — import `{ describe, it, expect, vi }` from `'vitest'`; co-locate `foo.test.ts`).
2. `sitepulse-next/Notes/plans/Location-Labeling-Workbench-Plan.md` — read **Phase 7** in full, **§ Pure logic to extract + unit-test** (the `workbenchNaming.ts` contract: `normalizeLocationName`, `isNameUniqueOnSheet`, `suggestNextName`, `definitionOfDoneChecks` — and what their tests must cover), **§ Hard guardrails**, and **§ Open decisions** (the **duplicate-name** decision below, and note the container-robustness + Hotel-label items are already RESOLVED/SHIPPED — do not redo them).
3. **The code you're extending, fresh:**
   - `src/components/workbench/WorkbenchTracer.tsx` — **the integration site.** It already hosts the naming popover (`isLabelNamingOpen`, `labelDraftName`, `pendingLabelPoints` from `useWorkbenchStore`), wires `onPolygonComplete → handlePolygonComplete`, and saves via `saveLabel → createLabel.mutateAsync({ name, points, pick, sheet })`. Phase 7 adds the metadata toggles + naming validation around this existing save, and the interior-face guidance text. It already reads the sheet's `sheet_project_type` for the picker — reuse that.
   - `src/hooks/useWorkbenchActions.ts` — `useCreateWorkbenchLabel(sheetId)` is the write path (note its **write-site `kind='workbench'` guard** — keep an equivalent on ANY new workbench write, e.g. the review-state update). `CreateWorkbenchLabelInput` is where the new `spans_levels`/`level_note`/`has_void` fields flow in; they pass straight through `createUnit.mutateAsync({...})` (the `units` Insert type already accepts them). Add the review-state mutation here too.
   - `src/components/UnitNamingPopover.jsx` (untyped `.jsx`, boundary-typed in `WorkbenchTracer.tsx`) + `src/components/TaxonomyPicker.tsx` — the reused naming + role/sub-type UI. Phase 7 wires the new toggles + naming validation into the workbench's *use* of the popover; **decide whether to extend the shared `.jsx` (risks the live map) or add a thin workbench-only wrapper/extra fields in the tracer** — prefer NOT mutating the shared popover's contract if the live map would be affected.
   - `src/hooks/useProjectQueries.ts` — `useUnits(sheetId)` gives the existing labels on the sheet (the source for the uniqueness check's `existingNames` and for `definitionOfDoneChecks`). `useCreateUnit(sheetId)` is reused unchanged by the label write.
   - `src/store/useWorkbenchStore.ts` — the workbench Zustand store (tracing floating state lives here). Add any new Phase-7 UI state (e.g. metadata-toggle draft values, review-panel open) here with an explicit interface; use `useHydratedStore` for any persisted prefs.
   - `src/hooks/useWorkbench.ts` (`useWorkbenchContainer`, `useWorkbenchSheets`) — the container-scoped read hooks; `useWorkbenchSheets` returns the drawings with their `workbench` sidecar (incl. `review_state`). The review-state write must invalidate this key.
   - `src/utils/workbench.ts` (+ `workbench.test.ts`) — existing pure helpers (`buildWorkbenchSidecarInsert`, `computeLabelArea`). New pure logic goes in a SEPARATE `src/utils/workbenchNaming.ts` (+ `.test.ts`) per the plan — keep naming/DoD math framework-free and deterministic (pass timestamps IN, never `Date.now()` inside).

## Files this phase will likely touch (verify against the live tree first)
- **NEW** `src/utils/workbenchNaming.ts` + `src/utils/workbenchNaming.test.ts` — pure, framework-free:
  - `normalizeLocationName(raw)` — trim + collapse internal double-spaces.
  - `isNameUniqueOnSheet(name, existingNames)` — case/space-normalized within-sheet uniqueness.
  - `suggestNextName(existingNames)` — auto-increment the established designator pattern (numeric `301→302`, prefixed `A-104→A-105`, trailing-number `Court 1→Court 2`); **no pattern → no suggestion** (return null/empty).
  - `definitionOfDoneChecks(sheetLabels)` → the §9 checklist results (every label named + typed; names trimmed + unique; role + sub-type present). Tests cover numeric, prefixed, trailing-number, and the no-pattern fallback.
- **EDIT** `src/components/workbench/WorkbenchTracer.tsx` — apply `normalizeLocationName` on save; block + surface a duplicate (offer `suggestNextName` as the one-click fix); require role + sub-type (disable save until `pick` is present); add the `spans_levels`/`level_note`/`has_void` toggles to the naming form; add inline interior-face guidance copy.
- **EDIT** `src/hooks/useWorkbenchActions.ts` — extend `CreateWorkbenchLabelInput` + the insert with the three label flags; add a `useUpdateWorkbenchReviewState(sheetId)` (or similarly named) mutation that stamps `review_state`/`reviewed_by`/`reviewed_at` on `workbench_sheets`, **carrying the same `kind='workbench'` write-site guard**, invalidating `queryKeys.workbenchSheets(containerId)`.
- **NEW/EDIT** a **Definition-of-Done / review panel** in the tracer (or a sibling component under `src/components/workbench/`) — shows the §9 checklist (from `definitionOfDoneChecks(useUnits(sheetId))`) and the `draft → ready_for_review → reviewed` controls; "mark reviewed" is enabled only when the checklist passes.
- **EDIT** `src/store/useWorkbenchStore.ts` — any new Phase-7 floating state, explicit interface (§2/§6).
- **REUSE UNCHANGED:** `FloorplanCanvas`, the PDF worker, the snapping engine, `useCreateUnit`, `progressAnalytics`. **No `main.py`/RLS/migration changes.**

## ⛔ Decisions to confirm before building
- **Duplicate-name handling** (plan § Open decisions): plan default is **hard-block** within-sheet duplicates (standard §4.5 makes within-sheet uniqueness mandatory), with `suggestNextName` offered as the one-click fix. Confirm with the owner if you want warn-and-allow instead.
- **7a/7b split:** the plan explicitly allows splitting naming+metadata (7a) from DoD+review (7b). If the work won't land cleanly in one session, build **7a first**, ship+verify it, then write a fresh **7b** kickoff. Don't half-build both.
- **Shared popover vs. workbench wrapper:** decide whether the metadata toggles/validation extend the shared `UnitNamingPopover.jsx` or live in a workbench-only layer. **Default: do not change the shared popover's contract in a way that alters the live map** — prefer additive optional props or a workbench wrapper.

## How it should behave
- Tracing + naming a label: stray spaces are trimmed; a name that duplicates one already on the sheet is rejected with the next-designator suggested as a one-click fix; **save is disabled until a role + sub-type are chosen**.
- The naming form exposes a "spans levels" toggle (+ a note field) and a "has void" toggle; saving writes those onto the `units` row. Inline guidance reminds the labeler to trace the interior face (text only).
- Each drawing shows a Definition-of-Done checklist; the drawing can be moved `draft → ready_for_review → reviewed`, and **"reviewed" is only reachable once every check passes** (stamps `reviewed_by`/`reviewed_at`).
- The live app is **completely unaffected**; no `status_logs`/`status_audit_log` rows; the workbench sheet/labels never appear on the Projects Dashboard or any progress rollup. New `units` flags stay nullable + unused by the live UI.

## Guardrails (must not violate)
- **No DB migration** — Phase 3 already added every column you write. If you find yourself writing SQL, stop: you're out of scope.
- **Reuse the canvas/popover/taxonomy/create pipeline** — do NOT fork `FloorplanCanvas`, `useMapActions`, `progressAnalytics`, `bottleneck`, or `mapDisplayStatuses`; no `main.py` changes; don't touch the JWKS-ES256 auth path (§7) or the offline `pendingChanges` queue.
- **Online-first writes via TanStack mutations** — `useCreateUnit` (labels) + a new `workbench_sheets` update (review state). **Never** write `status_logs`/`status_audit_log`; never mount field/status/schedule/bulk/sync UI.
- **Stay scoped to the container** — invalidate only the workbench/`units(sheetId)` keys; a workbench label/sheet must never enter a live surface or `progressAnalytics`. **Carry the `kind='workbench'` write-site guard onto the new review-state mutation.**
- **`unit_type` stays** (applicability keys on it) — keep setting it to the chosen sub-type name. Store only the canonical `top_level_role`; display labels are presentation-only (§4).
- **Pure logic is framework-free + deterministic** — `workbenchNaming.ts` takes inputs (incl. any timestamps) as args, no `Date.now()` inside; co-located Vitest tests; narrow `polygon_coordinates` JSONB at the boundary with `isPercentPointArray` (§6); no `any`; new files `.ts`/`.tsx`; Zustand state interface explicit.

## Verify before closing (exit criteria)
Run with the absolute `--prefix` (Bash cwd persists; a stray `cd` prompts):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test -- src/utils/workbenchNaming.test.ts
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
Then a **live `npm run dev:3010`** (from `sitepulse-next/`, port 3010) click-through, opening the test drawing (`8ae5a09f…`):
- Name a label with stray/double spaces → it's trimmed on save.
- Try to reuse an existing name → it's rejected; the suggested next designator (e.g. next room number) one-click-fills.
- Try to save without picking a role/sub-type → save is blocked.
- Toggle "spans levels" (+ note) and "has void" on a label → the `units` row carries the flags (spot-check the DB).
- Walk a drawing `draft → ready_for_review`; confirm "reviewed" is blocked while a check fails, then passes once every label is named + typed.
- The live app is unaffected; the workbench sheet/labels do **not** appear on the Projects Dashboard, and **no** `status_logs` are written.

> ⚠️ Live verification writes **real** `units`/`workbench_sheets` changes under the hidden container (the intended, additive, hidden behavior). Tell the owner what you created/changed; labels cascade-delete with their sheet. Reuse the existing container + test drawing — do not create duplicates.

Close the phase with the **verify-feature** skill (Definition of Done → stop). **Do not commit or push until the owner says "Approved."**

## Scope discipline
This session builds **only Phase 7** — naming rules, the two-level/void label flags, interior-face guidance copy, and the Definition-of-Done/review lifecycle. Do **NOT** build clean-corpus export (A5), tracing accelerators (fill-room-from-walls, grid stamp — Workstream B), any AI/assisted tracing, or true polygon-with-holes geometry (Backlog). If the slice grows past one session, split **7a (naming + metadata)** from **7b (DoD + review)** and write a fresh kickoff for 7b.

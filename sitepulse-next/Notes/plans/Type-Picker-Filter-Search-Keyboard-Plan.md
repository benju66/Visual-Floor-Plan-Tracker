# Type Picker — Project-Type Filter + Fuzzy Search + Keyboard Flow

**One-line:** Make the location-**type** picker filter by the project's construction type, add fuzzy search + a "used here" recents row, and make the whole naming flow fully keyboard-drivable (name → Tab → search/list → Tab → Save → Enter). **Front-end only — no schema change, no change to what's stored or to AI training data.**

**Base commit:** `49bab1d` (branch `claude/ai-location-tracing-pipeline-ip709o`; HEAD == local `main` == `origin/main`, clean tree). Implementation happens in this branch.

**Resume prompt (if context is lost mid-build):** "Continue the Type Picker plan at `sitepulse-next/Notes/plans/Type-Picker-Filter-Search-Keyboard-Plan.md`. Check the Commit checklist for what's done, run `npm run test && npm run typecheck`, and pick up at the first unchecked item."

---

## Locked product decisions (from the owner)
1. **Filter the type list by the project's construction type.** `subtypes.default_project_types` becomes a *hard filter* in the naming pickers (today it only orders). Housing drops from ~71 visible types to ~19.
2. **Scope = per project *type*, global.** Editing "Housing"'s list changes it for every Housing project. Reuses the existing `default_project_types` column — **no new table**.
3. **Escape hatch = fuzzy search.** Searching queries the **full** dictionary (ignores the filter), so a hidden type (e.g. hospital-café "Dining Area" in a Healthcare job) is always reachable. **Use-once: picking a hidden type does NOT change the project-type's list.**
4. **"Used in this project" recents row** at the top of the picker, derived from locations already present (no new storage), so a just-used off-list type stays one keystroke away.
5. **Full keyboard flow:** name field → **Tab** → search box → type to filter, **↑/↓** to move highlight → **Tab** commits the highlight and moves focus to the **Save location** button → **Enter** saves. Never leave the keyboard.
6. **Not multi-phase.** Two commits (below).

## Out of scope (do NOT touch)
- Save mutations, provenance, `trace_events`, AI suggestion engine, DB schema, `units` columns.
- `orderedSubtypesByRole`'s existing non-restrictive contract (its 4 tests must stay green).
- The `menu`/review consumers' behavior (no filtering/recents there).

---

## Architecture decisions (the load-bearing ones)

**A1. Filtering is additive + opt-in.** Keep `orderedSubtypesByRole` as-is. Add new pure helpers in `src/utils/subtypes.ts`. Picker filters only when a new `restrictToProjectType` prop is true → naming popovers pass it; `RowActionsMenu` + `WorkbenchReviewTable` do **not** (they keep the full list).

**A2. Combobox MUST use `aria-activedescendant`, NOT roving tabindex.** The canvas keystroke guard is literally `document.activeElement?.tagName === 'INPUT' || 'TEXTAREA'` ([FloorplanCanvas.tsx:376](../../src/components/FloorplanCanvas.tsx)). Focus must **stay on the search `<input>`** while ↑/↓ move a highlighted `role="option"` via `aria-activedescendant`. If focus moved onto an `<li>`/button, `activeElement` would no longer be an INPUT, the guard would fail, and arrow keys would start nudging canvas units / Enter would close a polygon. This single decision is what makes the canvas + keyboard coexist. Also `preventDefault()` on ↑/↓ inside the input (stop the text caret jumping).

**A3. Always keep the selected + AI-suggested type visible.** Even when the filter or a search would hide it, the location's current `selectedSubtypeId` and the AI `suggestedSubtypeId` are force-included, so edit/rename and accept-suggestion never show "nothing selected." New `suggestedSubtypeId` prop (naming-create only).

**A4. Focus hand-off via refs, not DOM order.** The two toggles ("Spans two levels", "Encloses a void") + Cancel sit between the list and Save in the DOM, so natural Tab would hit them. The popover owns `nameRef`, `searchRef` (passed into the picker), `saveRef`. Name `Tab`→`searchRef.focus()`; picker `Tab` (no shift)→commit highlight + `onAdvance()` which focuses `saveRef`; `Shift+Tab` left to the browser (returns to name). Toggles stay reachable by mouse/Shift+Tab.

**A5. Disabled-Save focus race.** `WorkbenchLabelPopover` disables Save until a type is picked; a `disabled` button can't receive focus. So committing the pick (parent `setState`) and focusing Save in the same tick fails. Fix: drive the focus from an effect — `onAdvance` sets an `advanceRequestedRef`; a `useEffect` keyed on `[pick]` (or `canSave`) runs `saveRef.focus()` once the button is enabled. Deterministic; no `setTimeout` guesswork.

**A6. Recents source = already-loaded locations (no new fetch).** Pure helper `recentSubtypeIdsFromUnits(units, cap=6)` → de-duped `subtype_id`s, most-recent first. Workbench: from `WorkbenchTracer`'s sheet `units`. Live map: best-effort from project units, `[]` acceptable for v1. (Sheet-vs-project scope is a convenience detail; default to what's loaded.)

**A7. Fuzzy search = small pure helper, no new dependency.** `fuzzyRankSubtypes(subtypes, query)` ranks across name + aliases: exact > prefix > word-boundary > substring > subsequence; empty query → input order; no match → `[]`. Pure + unit-tested. Searching uses the **full active dictionary** (bypasses the project-type filter = the escape hatch). No-match optionally offers "Add '<query>' as new type (pending)" reusing the existing proposal path (nice-to-have, not required).

**A8. Graceful for all 4 consumers.** Search box + arrow nav added for every variant (pure usability win). `restrictToProjectType`, `recentSubtypeIds`, `suggestedSubtypeId`, `onAdvance`, `searchRef` are all **optional**; `autoFocusSearch` defaults true for menu/review, **false** for the naming popovers (their name field owns autofocus). `onPick` contract unchanged.

---

## File-by-file changes

### Commit A — dormant infra + Library curation (zero runtime change to pickers)
1. **`src/utils/subtypes.ts`** — add (dormant, nothing calls them yet):
   - `restrictSubtypesToProjectType(subtypes, projectType, { keepIds })` — filter to active types whose `default_project_types` includes `projectType`; universal types (all 9) pass automatically; always keep `keepIds` (selected + suggested); `projectType == null` → no restriction.
   - `fuzzyRankSubtypes(subtypes, query)` — see A7.
   - `recentSubtypeIdsFromUnits(units, cap)` — see A6.
2. **`src/utils/subtypes.test.ts`** — add `describe` blocks for the three helpers (do not edit the existing `orderedSubtypesByRole` tests). Cover: universal-passes, other-vertical-dropped, keepIds-forced, null-returns-all; rank ordering + alias match + empty/no-match; recents dedupe/cap/order.
3. **`src/components/taxonomy/LocationLibraryPanel.tsx`** — `DictionaryRow` gains an "edit project types" affordance (toggle chips like the Add form, saved via existing `useUpsertSubtype({ id, name, role, defaultProjectTypes })`). Reword the Add form's **"Suggest first for"** → **"Show in these project types"** (it now filters, not just sorts). Update the helper copy accordingly.

### Commit B — picker rewrite + popover keyboard wiring
4. **`src/components/TaxonomyPicker.tsx`** — rewrite to a combobox:
   - New optional props: `restrictToProjectType?: boolean`, `suggestedSubtypeId?: string | null`, `recentSubtypeIds?: string[]`, `searchRef?: RefObject<HTMLInputElement>`, `onAdvance?: () => void`, `autoFocusSearch?: boolean` (default `true`).
   - Search `<input role="combobox" aria-expanded aria-controls aria-activedescendant>`; `<ul role="listbox">` with `role="option"` rows; `activeIndex` state over a computed **flat option list** (recents group → role groups, in visual order).
   - Data: no query → (recents) + role groups, filtered when `restrictToProjectType`, `keepIds` = selected+suggested. With query → `fuzzyRankSubtypes` over full active dict (no filter), grouped or flat.
   - Keys on the input: ↑/↓ move `activeIndex` (preventDefault); Enter commits `flatOptions[activeIndex]` via `onPick` (preventDefault + stopPropagation); Tab (no shift) → commit + `onAdvance?.()`; Escape → clear query if any, else nothing (popover handles cancel). Mouse hover/click unchanged.
   - Keep the **"Other (pending)"** proposal affordance. Keep `variant` styling.
5. **`src/components/workbench/WorkbenchLabelPopover.tsx`** — add `nameRef`, `searchRef`, `saveRef`; name `Tab`→focus search; pass `restrictToProjectType`, `suggestedSubtypeId`, `recentSubtypeIds`, `searchRef`, `onAdvance` (focus Save via effect, A5), `autoFocusSearch={false}`. Keep Enter-in-name = save.
6. **`src/components/workbench/WorkbenchTracer.tsx`** — compute `recentSubtypeIds = recentSubtypeIdsFromUnits(units)`, derive `suggestedSubtypeId` from `labelSuggestion`; pass both to the popover.
7. **`src/components/UnitNamingPopover.jsx`** — same ref/Tab wiring (lighter: Save isn't disabled, so focus is simple); pass `restrictToProjectType`, recents best-effort, `autoFocusSearch={false}`.
8. **Live map consumer of `UnitNamingPopover`** (`src/app/.../page.jsx`) — pass `recentSubtypeIds` from project units if cheap; else omit (`[]`). Optional for v1.
9. **`RowActionsMenu.tsx` / `WorkbenchReviewTable.tsx`** — **no change** (they get search+arrows for free; they do NOT pass `restrictToProjectType`/recents, so behavior = full list as today). Verify they still work.

---

## Commit & push discipline
- Land **Commit A**, verify (tests/typecheck/build + Library read-back), then **Commit B**, verify (full checklist). **Push once at the end** (both auto-deploy from `main`; pushing A alone is harmless since it's dormant, but a single push keeps the deploy atomic).
- Conventional messages; end with the Co-Authored-By trailer. Do not push until the owner says so.

## Risk register
| Risk | Mitigation |
|---|---|
| Arrow keys leak to canvas (nudge units / close polygon) | `aria-activedescendant` keeps focus on the INPUT → canvas `isInputActive` guard holds (A2). Manual check in checklist. |
| Tab focuses a still-disabled Save → focus lost | Effect-driven focus after pick commits (A5). |
| Filter hides the type a location already uses | Force-include selected + suggested ids (A3). |
| Breaking the menu/review consumers | New behaviors opt-in; default off; `onPick` unchanged. Manual check both. |
| Existing `orderedSubtypesByRole` tests break | Don't touch that function; filter is a new helper. |
| Unreachable-type deploy window | Filter + search ship together in Commit B; single push. |
| Typing letters triggers tool shortcuts (1/2/3, Space) | INPUT-focused guard (A2). Manual check. |

---

## VERIFICATION PLAN

### Automated (gates — per AGENTS.md §9; lint is NOT a gate)
Run from `sitepulse-next/`:
- `npm run test` — new helper tests + all existing green.
- `npm run typecheck` — clean (test files are type-checked too).
- `npm run build` — production build succeeds.

### Manual checklist (no E2E framework; verify via `npm run dev:3010`)
**Filter + search (workbench, a Housing-type sheet):**
- [ ] Trace a polygon → popover opens, **name field** focused.
- [ ] Type list shows ~19 (17 universal + Dwelling Unit + Live/Work Unit); **Dental Operatory absent**.
- [ ] Type "dental" in search → Dental Operatory appears (escape hatch); pick it → saves; the Housing list is **unchanged** afterward (use-once).
- [ ] "Used in this project" row shows recently-used types after a couple of saves.

**Keyboard-only flow (no mouse):**
- [ ] Name → **Tab** → focus lands in search box.
- [ ] Type "sta" → narrows to Stair; **↓/↑** move the highlight; highlight visible.
- [ ] **Tab** → highlighted type committed (Type shows it) **and** focus on "Save location".
- [ ] **Enter** → location saves and appears on canvas.
- [ ] **Esc** clears a non-empty search; Esc again (or in name) cancels.

**Canvas-guard (the dangerous interplay):**
- [ ] With search focused, pressing **1/2/3** types into the box (does NOT switch tools).
- [ ] **↑/↓** move the list highlight (do NOT nudge selected units / pan).
- [ ] **Enter** in search commits a type (does NOT close/059 finish a polygon).

**Edit + suggestion:**
- [ ] Rename a location whose type is off-list for this project → popover shows its **current type selected**.
- [ ] A sheet-text AI suggestion that's off-list still appears pre-selected.

**Other consumers (regression):**
- [ ] Live map `UnitNamingPopover`: name→Tab→search→↓→Tab→Enter saves; saving with **no** type still allowed (optional type).
- [ ] Manage `RowActionsMenu` "Change type": full list (no project filter), search works, pick updates type.
- [ ] `WorkbenchReviewTable` assign-type: full list, search works, pick assigns.

**Library curation (Commit A):**
- [ ] Edit an existing type's project-types in the Location Library → reopen → persisted. Removing "Housing" from a type hides it from Housing pickers; adding shows it.

### Rollback
Pure front-end + dormant helpers. Revert the two commits (`git revert`) — no migration, no data to unwind. The dormant helpers in Commit A are inert even if B is reverted.

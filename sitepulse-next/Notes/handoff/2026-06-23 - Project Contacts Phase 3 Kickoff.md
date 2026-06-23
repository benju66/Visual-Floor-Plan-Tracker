# Kickoff — Project Contacts, Phase 3: Look-Ahead consumes the contacts as its cell palette

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3 of Project Contacts** (the absorbed **Look-Ahead** view reads the project's `project_contacts` directory and offers it as the **autocomplete palette** for the trade/sub cell — while free-typing any name stays fully intact). **No schema changes, no migration, no new table.** Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-23 - Project Contacts Phase 3 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Project-Contacts-Plan.md` (Phase 3 + "Pure logic to extract" + Hard guardrails + Open decisions)
> - `sitepulse-next/AGENTS.md` (§6 TypeScript/no-`any`; §9 Vitest conventions; the Look-Ahead portability guardrail)
>
> Branch off `feat/project-contacts-phase-2` (NOT bare `main` — Phases 1 & 2 are not merged to main yet; see Context). Build **only Phase 3**. No approval gate this phase (read-only consumption of Phase-1 data; the ONE deliberate vendored edit is the datalist source). Don't commit or push until I say "Approved."

---

## Context for the session

### Where Phases 1 & 2 left off (built, approved, NOT yet merged to main)
- **Branch chain:** `main` → `feat/project-contacts-phase-1` (table + Settings CRUD) → `feat/project-contacts-phase-2` (CSV import). **Neither is merged to `main`.** Phase 3 must branch off **`feat/project-contacts-phase-2`** so the table, hooks, and Settings UI all exist — branching off bare `main` would drop the entire foundation.
- **Phase 1 (committed on the phase-1 branch; migration is LIVE on prod):** the `project_contacts` table exists on prod (`pmccdxmuszuykawvlphj`, `20260623_project_contacts.sql`). Data layer in `src/hooks/useProjectQueries.ts`: `useProjectContacts(projectId)` (returns `ProjectContact[]`, sorted company → last → first) plus create/update/delete. Domain type `ProjectContact` in `src/types/domain.ts`. Settings UI = `ContactsManager` in `src/components/SettingsMenu.tsx`.
- **Phase 2 (committed `582bd27` on the phase-2 branch):** `parseProcoreDirectoryCsv` in `src/utils/procoreDirectoryCsv.ts` + an "Import from Procore CSV" control. **Phase 3 doesn't touch any Phase-2 code** — it just benefits from a populated directory.

### Plain-English goal
Today a superintendent **re-types** every sub into the Look-Ahead grid by hand (the "Sub" cell). Phase 3 makes that cell **autocomplete from the project's contact directory** — they start typing and the project's companies/people drop down. They can still **type any name that isn't in the list** (the cell is a free-text input, not a locked dropdown). One source of truth, picked instead of re-typed.

### Required reading (in order)
1. `sitepulse-next/AGENTS.md` — §6 (TypeScript / no-`any` / narrow at boundaries), §9 (Vitest: globals OFF, import `{ describe, it, expect }` from `'vitest'`, co-locate `*.test.ts`, keep test files type-clean). **Lint is NOT a gate.**
2. `sitepulse-next/Notes/plans/Project-Contacts-Plan.md` — "Phase 3", "Pure logic to extract + unit-test", "Hard guardrails (keep the vendored Look-Ahead portable)", "Open decisions" (palette granularity).
3. Re-read fresh (line numbers drift — this is a fast-moving area):
   - `src/lookahead/components/LookAhead.tsx` — the sub cell + the datalist (see pointers below).
   - `src/lookahead/LookaheadWorkspace.tsx` — the SitePulse mount; **this is the injection site** (it already receives `projectId`).
   - `src/lookahead/store/useStore.ts` + `src/lookahead/lib/types.ts` — `Sub[]`, `Row.sub`, `project.subs`.
   - `src/hooks/useProjectQueries.ts` — `useProjectContacts` + the `ProjectContact` shape.

### Build-on inventory (current pointers — verify before editing)
- **`LookAhead.tsx` ~line 444:** `const subCodes = project.subs.map((x) => x.code).filter(Boolean);` — today's palette source is the blob's own `project.subs` codes.
- **`LookAhead.tsx` ~lines 748–752:** the one `<datalist id="la-subs">`, rendering `subCodes` as `<option>`s.
- **`LookAhead.tsx` ~lines 661–667:** the sub `<input defaultValue={r.sub} list="la-subs" … >` — a **free-text input bound to the datalist**. Free-typing already works; Phase 3 only changes/augments what the datalist offers. **Do NOT convert this to a `<select>`.**
- **`LookaheadWorkspace.tsx`:** renders `<LookAhead />` once the plan is hydrated; has `projectId` in scope. Fetch contacts here and pass a palette **down as a prop** — keep all Supabase access in this file (outside the vendored module).

### The ONE deliberate vendored edit (call it out in the PR/handoff)
`LookAhead` currently takes no props. Add a small, optional prop (e.g. `extraSubs?: string[]` / `palette?: string[]`) and **merge it with the existing `subCodes`** when rendering the datalist (union + de-dupe; preserve free-typing). Default it to `[]` so the standalone/vendored behavior is unchanged when no palette is supplied. This is the only edit inside `src/lookahead/`. **Do NOT** make `src/lookahead/lib/*` or the store call Supabase, and **do NOT** put `contact_id`/structured contact refs into the blob — the cell still stores a plain string.

### ⛔ Open decision to resolve FIRST (palette granularity)
The plan leaves this open. Pick one (then state which you built):
- **Company-only** (e.g. `Acme Drywall, Inc.`) — closest to today's behavior (the cell historically held a sub *code*/company). **Recommended default.**
- **"Company — First Last"** per contact — richer, but the cell is one short free-text field, so long labels may be awkward, and many rows share a company.
- A blend (distinct companies **plus** `Company — First Last` entries) is possible but can bloat the dropdown for a 250-contact project. If unsure, ship **company-only** and note the others as a fast follow.
> If the owner hasn't weighed in, build **company-only**, keep `contactsToPalette` flexible enough to switch later, and surface the choice in the exit report.

## Pure logic to extract + unit-test (where correctness lives)
- **`src/utils/contactsToPalette.ts`** → `contactsToPalette(contacts: ProjectContact[]): string[]` — pure: derive the datalist entries (distinct, trimmed, non-empty, sorted, de-duped) per the granularity decision. **Put it in `src/utils/` (NOT in `src/lookahead/lib/*`)** so the vendored module stays Supabase-free and portable; import the `ProjectContact` type only.
- **`src/utils/contactsToPalette.test.ts`** (co-located, `{ describe, it, expect }` from `'vitest'`) — cover: distinct companies collapse to one entry; blank/whitespace company excluded; result is de-duped + sorted; (if you build labels) a contact with no name falls back to company-only.

## Scope checklist (Phase 3 only)
- [ ] `contactsToPalette` pure helper + co-located test (above).
- [ ] In `LookaheadWorkspace.tsx`: `useProjectContacts(projectId)` → `contactsToPalette(...)` → pass as a prop to `<LookAhead palette={…} />`. Keep Supabase access in this file only.
- [ ] In `LookAhead.tsx`: accept the optional prop, **merge with `subCodes`** for the `la-subs` datalist (union + de-dupe). Free-typing intact; cell still stores a plain string; no blob shape change.
- [ ] No schema change, no migration, no new table, no Phase-2/Settings changes. Do NOT wire into the offline `pendingChanges` queue.

### ⛔ Approval gates
- **None this phase** — no schema; read-only consumption of Phase-1 data; one isolated vendored edit. **Still: do not commit or push until the owner says "Approved."**

### Exit criteria (Definition of Done for Phase 3 — then STOP)
- `typecheck` + `test` + `build` green (absolute-prefix commands in the plan's Verification section).
- `contactsToPalette` unit tests pass.
- Live `dev:3010` click-through: a project with contacts (import the sample via Phase 2 if needed) → open **Look-Ahead** → a row's **Sub** cell autocompletes from the project's contacts → **still accepts a free-typed name not in the list** → the edit persists across reload → Map/List/Dashboard/Schedule/Settings unaffected.
- Close with the **`verify-feature`** skill (`.agent/skills/verify-feature/SKILL.md` — not an invocable slash-skill; and remember its local overrides: **port 3010, lint is not a gate, there IS Vitest now**). Do not commit/push until "Approved."

### Notes / drift to watch
- The Look-Ahead document (`ProjectBlob`, stored verbatim in `lookahead_plans.doc`) must stay **portable/opaque** — contacts are a *palette only*. Never persist a contact reference into the blob.
- `LookAhead` is vendored; minimize the surface of the prop edit and default it to empty so the module still runs standalone.
- The phase-2 branch carries an untracked `docs/procore_project_directory_export.csv` (real-PII sample, intentionally NOT committed). Use it for the live import step; don't commit it.
- After Phase 3 ships, the Project Contacts workstream is complete through Phase 3; **Phase 4 (live Procore Directory API sync) remains deferred** with its own plan + approval gates.

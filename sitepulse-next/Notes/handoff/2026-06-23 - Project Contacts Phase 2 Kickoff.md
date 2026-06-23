# Kickoff — Project Contacts, Phase 2: bulk import from a Procore directory CSV export

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of Project Contacts** (bulk-import contacts from a Procore project-directory CSV export into the existing `project_contacts` table — a pure CSV parser + an "Import from Procore CSV" control in the Project Contacts settings section; **no schema changes**, no Look-Ahead changes). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-23 - Project Contacts Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Project-Contacts-Plan.md` (Phase 2 + "Pure logic to extract" + Guardrails)
> - `sitepulse-next/AGENTS.md` (§6 TypeScript/no-`any`; §9 Vitest conventions)
>
> Branch off `main`. Build **only Phase 2**. No DB migration and no approval gate this phase (client-side parse + insert into the already-isolated table). Don't commit or push until I say "Approved."

---

## Context for the session

### Where Phase 1 left off (already shipped to prod)
- The `project_contacts` table is **live** on the prod DB (`pmccdxmuszuykawvlphj`, migration
  `20260623_project_contacts.sql`). Columns: `id, project_id, company (NOT NULL), first_name,
  last_name, job_title, mobile_phone, email, procore_id (nullable), created_by, created_at, updated_at`.
- **`UNIQUE(project_id, email)` was KEPT** (owner gate decision) → Phase 2 de-dupes by upserting
  `onConflict: 'project_id,email'`. Postgres treats NULL emails as distinct, so blank-email rows never
  collide (and never upsert-merge — each becomes its own row).
- **Writers = owner/admin/pm/superintendent** (RLS). The import control must be gated the same way the
  add/edit/delete controls already are (`canEdit` in `SettingsMenu.tsx`'s `ContactsManager`).
- Phase 1 data layer to reuse: `useProjectContacts` / `useCreateProjectContact` /
  `useUpdateProjectContact` / `useDeleteProjectContact` in `src/hooks/useProjectQueries.ts`, and the
  `ContactsManager` component in `src/components/SettingsMenu.tsx`. The `ProjectContactFields` type
  (exported from `useProjectQueries.ts`) is the per-contact shape the parser should emit.

### Plain-English goal
Today a PM/super would re-type or hand-add every sub. Phase 2 lets them **upload (or paste) the Procore
project-directory CSV export once** and have all the people land in Project Contacts — and **re-importing
the same file updates people instead of creating duplicates**.

### Required reading (in order)
1. `sitepulse-next/AGENTS.md` — §6 (TypeScript / no-`any` / narrow at boundaries), §9 (Vitest: globals
   OFF, import `{ describe, it, expect }` from `'vitest'`, co-locate `*.test.ts`, keep test files
   type-clean). Lint is **not** a gate.
2. `sitepulse-next/Notes/plans/Project-Contacts-Plan.md` — "Phase 2", "Pure logic to extract + unit-test",
   "Hard guardrails". This file is the plan-of-record; re-read the actual current source before editing.
3. Re-read fresh: `src/hooks/useProjectQueries.ts` (the Phase 1 contact hooks + `ProjectContactFields`),
   `src/components/SettingsMenu.tsx` (the `ContactsManager` + `cleanContactFields`/`ContactFormFields`
   helpers to reuse), `src/types/domain.ts` (`ProjectContact`).

### The sample file (build + test against it)
`docs/procore_project_directory_export.csv` — **254 data rows**, **UTF-8 BOM**, 22 columns. Exact header:
```
Person/Vendor,Id,First Name,Last Name,Company,Job Title,Country,Address,City,State,Zip,Business Phone,Mobile Phone,Fax Number,Email,Tags/Keywords,Project Roles,Trade(s),Permission Template,Standard Cost Code List,Old Sage 100 Contractor Standard Cost Codes,Sage 100 Contractor Standard Cost Codes
```
Gotchas the parser MUST handle:
- **UTF-8 BOM** on the first header cell (strip it before matching `Person/Vendor`).
- **Quoted fields containing commas** — company names like `"Acme Drywall, Inc."` (RFC-4180-ish: a field
  wrapped in `"`, embedded `,` literal, `""` = an escaped quote). Don't naïvely `split(',')`.
- **`Trade(s)` is 100% empty** — do NOT rely on it (it exists in the header; just ignore it).
- **Map columns by HEADER NAME, not position** — exports reorder columns. Resolve indices from the header
  row, after BOM-stripping.

### Column → field mapping (the only columns Phase 2 reads)
| `project_contacts` field | CSV header | Notes |
|---|---|---|
| `company`     | `Company`      | NOT NULL — **skip a row if Company is blank** (the table requires it) |
| `first_name`  | `First Name`   | blank → null |
| `last_name`   | `Last Name`    | blank → null |
| `job_title`   | `Job Title`    | blank → null |
| `mobile_phone`| `Mobile Phone` | blank → null (owner's spec is Mobile only; ignore `Business Phone`/`Fax Number`) |
| `email`       | `Email`        | blank → null (NULL emails won't collide under the unique key) |

- **`procore_id` stays NULL in Phase 2** — the `Id` column is the Procore id, but the plan reserves
  `procore_id` for the Phase 4 live sync ("not used in 1–3"). Don't populate it unless the owner asks.
- **Ignore `Person/Vendor`** — all sample rows are `Person`; just keep any row that has a Company.
- Reuse Phase 1's blank-to-null/trim logic (mirror `cleanContactFields` in `SettingsMenu.tsx`) so import
  and manual entry store identical shapes (and blank emails stay NULL, not `''`).

### Scope checklist (Phase 2 only)
- [ ] **Pure parser** `src/utils/procoreDirectoryCsv.ts` →
      `parseProcoreDirectoryCsv(text: string): ProjectContactFields[]` (pass the text IN — no file I/O in
      the pure fn). RFC-4180-ish: handle the BOM, quoted commas, `""` escapes; resolve columns by header
      name; trim; blank→null; **drop the header; skip rows with no Company**; ignore `Trade(s)`.
- [ ] **Co-located test** `src/utils/procoreDirectoryCsv.test.ts` — cover: a quoted-comma company name, a
      BOM-prefixed header, a missing-email row (→ `email: null`), a `""` escaped quote, that `Trade(s)` is
      ignored, and a blank-Company row is skipped. (Import `{ describe, it, expect }` from `'vitest'`.)
- [ ] **Import UI** — an **"Import from Procore CSV"** control inside `ContactsManager`
      (`SettingsMenu.tsx`), shown only when `canEdit`. File upload **or** paste-textarea → parse →
      **preview the count** ("Found N contacts across M companies") → confirm → bulk **upsert** into
      `project_contacts` with `onConflict: 'project_id,email'`. Add a `useImportProjectContacts(projectId)`
      mutation in `useProjectQueries.ts` that chunks the upsert (mirror the 800-row `CHUNK_SIZE` pattern
      used by the bulk status hooks) and invalidates `queryKeys.projectContacts(projectId)`.
- [ ] Bulk upsert must set `project_id` on every row; let the DB default `created_by`/timestamps. Surface
      a clear error if the insert is rejected (e.g. RLS / a same-file duplicate email within one batch).

### ⛔ Approval gates
- **None this phase** — client-side parse + insert into the already-isolated, already-RLS'd table; no
  schema change. **Still: do not commit or push to `main` until the owner says "Approved."**

### Guardrails specific to this phase
- **No migration, no schema change** — the table and its unique key already exist.
- Touch **no** existing table/RPC/RLS other than reading/writing `project_contacts`. No Look-Ahead changes
  (that's Phase 3). Do NOT wire into the offline `pendingChanges` queue.
- Keep the parser **pure** (text in, array out) — all correctness lives there and is unit-tested. The
  component does file reading + rendering only.
- Derive types from `ProjectContactFields`; no `any` (prefer `unknown` + narrowing). Narrow CSV strings at
  the parser boundary.

### Exit criteria (Definition of Done for Phase 2 — then STOP)
- `typecheck` + `test` + `build` green (absolute-prefix commands in the plan's Verification section).
- Parser unit tests pass (the cases above).
- Live `dev:3010` click-through: open Settings → **Project Contacts** → Import the sample
  `docs/procore_project_directory_export.csv` → preview shows ~254 contacts → confirm → the list fills,
  grouped by company → **re-import the same file → no duplicates** (counts stay the same; emails upsert) →
  reload → persists. Map/List/Dashboard/Schedule/Look-Ahead unaffected.
- Close with the **`verify-feature`** skill (run its steps from `.agent/skills/verify-feature/SKILL.md` —
  it isn't an invocable slash-skill). Do not commit/push until "Approved." Then hand off Phase 3
  (Look-Ahead consumes the palette) with a short chat pointer + a Phase 3 kickoff file.

### Notes / drift to watch
- `database.types.ts` is hand-maintained and can drift from the live DB — `project_contacts` was
  hand-added in Phase 1. No type changes are needed in Phase 2 (no schema change).
- The SettingsMenu team-roster dropdown uses `'super'` as a role value, but the canonical superintendent
  role is `'superintendent'` (used by RLS + `domain.ts`). Gate the import control on the same `canEdit`
  expression Phase 1 already uses, not on the dropdown's value.

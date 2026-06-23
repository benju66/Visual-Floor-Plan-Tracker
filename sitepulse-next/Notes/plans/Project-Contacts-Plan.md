# Project Contacts — a shared project-level contact directory, used by Look-Ahead (self-contained build plan)

> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then **re-read the actual current files before editing** — the codebase
> moves faster than docs; do not trust line numbers here.
> Parent/related: this REPLACES the dropped "Lookahead Absorption Phase 1" (the one-time pre-fill).
> See `Notes/plans/Lookahead-Absorption-Plan.md` (Phase 1 marked DROPPED). Look-Ahead itself was
> absorbed in that plan's Phases 0a + 0b (the vendored module under `src/lookahead/` + the 5th view).

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) first — esp. §4 (new tables → types),
   §6 (TypeScript / JSONB narrowing / no-`any`), §2 (RLS posture).
2. Re-read the files in §"Build-on inventory" fresh — line numbers drift.
3. Build the sub-phases in order (1 → 2 → 3; Phase 4 is deferred). Verify after each slice (§Verification).
4. Keep the owner (a product owner, not a developer) in the loop: lead with a 1–2 sentence
   plain-English summary; explain jargon in passing; keep it short.

## Goal
A SitePulse project gains a **Project Contacts** directory — a shared list of the people working the
job (Company, name, title, mobile, email), managed once in the project Settings menu. The absorbed
**Look-Ahead** view reads this directory so a superintendent **picks a company/contact** for a schedule
row instead of re-typing it — while still being free to **type any name directly** when they want.
Contacts can be **bulk-imported from a Procore project-directory CSV export** (and, much later, synced
live from Procore). One source of truth, entered/imported once, reused across the app.

In plain terms: today the super retypes their subs into Look-Ahead by hand. This gives the project a
real shared contact list — type it once (or import it from Procore) and pick from it everywhere.

## Out of scope / deferred (do NOT build these in Phases 1–3)
- **Live Procore Directory API sync** — Phase 4 (deferred). The existing `/api/auth/procore/*` routes
  are **login-only**: they use a Procore token once to provision a Supabase user (domain-locked to
  `@fpcinc.com`) then discard it. Live directory sync needs token storage/refresh + a project↔Procore
  link + Directory API calls — a real new integration, not a tweak. Phase 2 (CSV import) delivers the
  data-load value cheaply in the meantime.
- **Structured contact links inside the Look-Ahead blob.** The Look-Ahead document (`ProjectBlob`,
  stored verbatim in `lookahead_plans.doc`) must stay portable/opaque. Look-Ahead consumes contacts as
  a *palette* (autocomplete source) only; the cell still stores a plain string. Do NOT add `contact_id`
  foreign keys into the blob.
- **Replacing Look-Ahead's own `subs` list / migrating existing blobs.** Phase 3 *augments* the cell
  palette with project contacts; it does not delete or migrate the blob's existing `subs`.
- **Using contacts elsewhere** (assigning to units, schedule, notifications, @mentions) — possible
  future reuse of the same table; not built here. (The name "Project Contacts" was chosen so the
  settings section can grow other uses later.)
- **Mobile** — the Settings menu + Look-Ahead are desktop-first; match existing behavior, no new mobile work.

## Locked product decisions (from the owner)
- **Name:** the section is **"Project Contacts"** (not "Trades") — future-proof; Procore's own "Trade(s)"
  column is empty in real exports, so we model people-by-company, not trades.
- **Placement:** a **section inside the project Settings menu** (`SettingsMenu.tsx`), mirroring the
  existing Milestones manager — not a new top-level view, not a standalone modal.
- **Per-contact fields:** **Company, First Name, Last Name, Job Title, Mobile Phone, Email** (owner's
  list). Plus a nullable `procore_id` reserved for the Phase 4 sync, and standard id/project_id/timestamps.
- **Look-Ahead behavior:** the contact list is a **palette/reference, not a hard constraint** — picking
  is offered, free-typing in the cell is always allowed (it already is — see Build-on inventory).
- **Procore lands in stages:** CSV import first (Phase 2), live API sync later (Phase 4).

## Data model
New table only — nothing existing changes. Template: `supabase/migrations/20260623_lookahead_plans.sql`
and `20260617_workbench_schema.sql` (additive + idempotent + RLS `TO authenticated`).

```
project_contacts
  id            uuid PRIMARY KEY default gen_random_uuid()
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE
  company       text NOT NULL
  first_name    text
  last_name     text
  job_title     text
  mobile_phone  text
  email         text
  procore_id    text                  -- nullable; reserved for Phase 4 live sync; not used in 1–3
  created_by    uuid default auth.uid()
  created_at    timestamptz NOT NULL default now()
  updated_at    timestamptz NOT NULL default now()
```
- **Indexes:** `(project_id)` and `(project_id, company)` for the company-grouped list.
- **De-dupe for import (Phase 2):** Email is present on all real rows → propose
  `UNIQUE (project_id, email)` (Postgres treats NULL emails as distinct, so blank-email rows won't
  collide) and `upsert onConflict: 'project_id,email'`. ⛔ Confirm at the Phase 1 migration gate —
  if the owner expects duplicate emails, drop the constraint and de-dupe in app code instead.
- **RLS** (mirror the project-config posture):
  - READ (`SELECT`) — any authenticated member of the project.
  - WRITE (`INSERT`/`UPDATE`/`DELETE`) — members whose `role IN ('owner','admin','pm')` (assumed;
    confirm at the Phase 1 gate, incl. whether `'superintendent'` should write). Never `anon`. All `TO authenticated`.
- Touches **no** existing table/RPC/RLS. Not `status_logs`, `units`, `sheets`, `project_milestones`,
  `lookahead_plans`, nothing — fully isolated/additive.
- **Types:** add `project_contacts` to the `Tables` block of `src/types/database.types.ts`; derive
  `ProjectContact = Database['public']['Tables']['project_contacts']['Row']` in `src/types/domain.ts`.

## Build-on inventory (read these fresh before using — do NOT fork)
**SitePulse:**
- `src/components/SettingsMenu.tsx` — the project Settings modal. The **Milestones manager** here is the
  pattern to copy for the Project Contacts section (list + add/edit/delete + dnd-kit reorder; role-gated
  via `useCurrentUserRole`). Reuse its hooks/conventions; do not reinvent the modal shell.
- `src/hooks/useProjectQueries.ts` — TanStack Query hook conventions. Add `useProjectContacts(projectId)`
  (list) + create/update/delete mutations here, following `useMilestones`/`useReorderMilestones`.
- `src/supabaseClient.ts` — the existing typed client (use this; no new client).
- `src/types/database.types.ts` + `src/types/domain.ts` — table types + derived domain Row.
- `supabase/migrations/20260623_lookahead_plans.sql` + `20260617_workbench_schema.sql` — additive-table +
  idempotent-RLS templates. Follow them + the `create-migration` skill.

**Look-Ahead (vendored — keep portable; the ONE deliberate edit is the palette injection):**
- `src/lookahead/components/LookAhead.tsx` — the `sub` cell is **already a free-text `<input>` with a
  `<datalist id="la-subs">`** autocomplete (search `defaultValue={r.sub}` and `<datalist id="la-subs">`).
  Today the datalist is fed from `project.subs` codes. **Phase 3 feeds it from project contacts instead
  of / in addition to that.** Free-typing already works — nothing to "enable", only the palette source changes.
- `src/lookahead/LookaheadWorkspace.tsx` — the SitePulse mount (Phase 0b). **This is where Phase 3
  fetches `useProjectContacts(projectId)` and injects the palette** into the store/datalist, keeping
  `src/lookahead/lib/*` and the store free of any Supabase calls (portability guardrail).
- `src/lookahead/store/useStore.ts` / `lib/types.ts` — `Sub[]`, `Row.sub`. Do NOT make these call Supabase.

**Sample data for Phase 2:** `docs/procore_project_directory_export.csv` (254 people, 73 companies; columns
include `Person/Vendor, Id, First Name, Last Name, Company, Job Title, …, Mobile Phone, …, Email, …, Trade(s)`).
Note: company names contain **commas inside quotes**, there's a **UTF-8 BOM**, and `Trade(s)` is empty —
the parser must handle quoted commas + BOM and must NOT rely on `Trade(s)`.

## Pure logic to extract + unit-test (where correctness lives)
- **Phase 2:** `src/utils/procoreDirectoryCsv.ts` →
  `parseProcoreDirectoryCsv(text: string): ContactDraft[]` — RFC-4180-ish CSV parse handling quoted
  commas + BOM; map columns (Company, First/Last, Job Title, Mobile Phone, Email); trim; drop the
  header; skip empty rows. Co-locate `procoreDirectoryCsv.test.ts` — test a quoted-comma company name,
  a BOM-prefixed header, a missing-email row, and that `Trade(s)` is ignored. Pass the text IN (no file
  I/O in the pure fn).
- **Phase 3 (small):** a `contactsToPalette(contacts)` helper (distinct companies and/or
  "Company — First Last" labels) + test. Keep it pure; the component does the rendering.

## Sub-phasing (ship + verify each)

### Phase 1 — `project_contacts` table + the Project Contacts settings section
- **Scope:**
  1. **Migration** `supabase/migrations/<date>_project_contacts.sql` — create `project_contacts` + indexes
     + RLS, idempotent/additive (templates above).
  2. **Types** — add `project_contacts` to `database.types.ts`; derive `ProjectContact` in `domain.ts`.
  3. **Hook** — `useProjectContacts(projectId)` + create/update/delete mutations in `useProjectQueries.ts`.
  4. **UI** — a **"Project Contacts"** section in `SettingsMenu.tsx` mirroring the Milestones manager:
     list grouped/sorted by Company, add/edit/delete a contact (Company, First, Last, Job Title, Mobile,
     Email), role-gated writes. No Look-Ahead changes, no import yet.
- **⛔ Approval gates (STOP for explicit owner sign-off):**
  - The **migration SQL** — present the full file and STOP before applying to the live DB. Confirm here:
    the **writer roles** (owner/admin/pm ± superintendent) and the **`UNIQUE(project_id, email)`** de-dupe
    decision.
  - Do not push to `main` until "Approved."
- **Exit criteria:** typecheck + test + build green · contacts CRUD works against the new table (safe — it's
  empty/isolated) · live `dev:3010` click-through: open Settings → Project Contacts → add/edit/delete a
  contact → reload → persists; other Settings sections + all views unaffected · close with `verify-feature`, STOP.

### Phase 2 — Bulk import from a Procore directory CSV export
- **Scope:**
  1. `src/utils/procoreDirectoryCsv.ts` (+ test) — the pure parser above.
  2. An **"Import from Procore CSV"** control in the Project Contacts section: upload/paste the export →
     parse → preview count → bulk **upsert** into `project_contacts` (de-dupe per the Phase 1 decision).
  3. Verify against `docs/procore_project_directory_export.csv` (254 rows → expected contacts; re-import is
     idempotent, not duplicated).
- **Approval gates:** none (client-side parse + insert into the new isolated table only). Do not push to `main` until "Approved."
- **Exit criteria:** typecheck + test + build green · parser unit-tested (quoted commas, BOM, missing email,
  ignores `Trade(s)`) · live import of the sample file lands the contacts and re-import doesn't duplicate ·
  `verify-feature`, STOP.

### Phase 3 — Look-Ahead consumes Project Contacts as the cell palette
- **Scope:**
  1. In `LookaheadWorkspace.tsx`, fetch `useProjectContacts(projectId)` and inject a palette into the
     Look-Ahead store/datalist (decide company-only vs company+contact labels — see Open decisions).
  2. Feed the existing `<datalist id="la-subs">` in `LookAhead.tsx` from that palette (the ONE deliberate
     vendored edit; call it out). **Free-typing stays intact**; the cell still stores a plain string; the
     blob stays portable (no `contact_id`).
  3. `contactsToPalette` helper (+ test).
- **Approval gates:** none (no schema; read-only consumption of Phase 1 data). Do not push to `main` until "Approved."
- **Exit criteria:** typecheck + test + build green · helper unit-tested · live `dev:3010`: open Look-Ahead →
  a row's trade/sub cell autocompletes from the project's contacts → still accepts a free-typed name → edit
  persists across reload; Map/List/Dashboard/Schedule unaffected · `verify-feature`, STOP.

### Phase 4 — Live Procore Directory API sync (DEFERRED — separate later workstream)
- Out of scope for now. Sketch only: store/refresh a Procore token, link a SitePulse project to a Procore
  project, pull the Directory (vendors + contacts) via the Procore REST API, reconcile into
  `project_contacts` via `procore_id`. Needs its own plan + approval gates (auth/secrets, RLS, rate limits).

## Hard guardrails (AGENTS.md — do not violate)
- **Touch no existing table/RPC/RLS.** `project_contacts` is fully isolated/additive; don't read or write
  `status_logs`, `units`, `sheets`, `project_milestones`, `lookahead_plans`, or any existing object.
- **Migration:** additive + nullable-safe + **idempotent**; follow the template + `create-migration` skill;
  **present SQL and STOP** before applying to the live DB. Never modify rows in other tables (memory:
  "No live-write probes").
- **Types:** derive from `database.types.ts`; no `any` (prefer `unknown` + narrowing) (§6).
- **Keep the vendored Look-Ahead portable:** inject contacts from `LookaheadWorkspace` (outside the
  module); never make `src/lookahead/lib/*` or the store call Supabase. Do NOT put structured contact
  references into the Look-Ahead blob — the cell value stays a plain string.
- **Do NOT wire into the offline `pendingChanges` queue** (§2) — out of scope.
- **Verify** via typecheck + test + build + a `dev:3010` click-through. **Lint is NOT a gate** (~1850 pre-existing problems).

## Open decisions
- **Writer roles** — assumed owner/admin/pm; confirm at the Phase 1 migration gate (± superintendent).
- **De-dupe key** — assumed `UNIQUE(project_id, email)`; confirm at the Phase 1 gate.
- **Look-Ahead palette granularity** — company-only vs "Company — Contact" labels in the cell; resolve in Phase 3.
- **Optional extra field** — the CSV also has Business Phone; the owner's spec is Mobile only. Add Business
  Phone (nullable) only if the owner asks.

## Verification commands (the exit-criteria gate)
Bash cwd persists and a stray `cd` triggers a prompt — run npm with an **absolute prefix**:
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck   # tsc --noEmit (primary gate)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test         # vitest (one file: ... run test -- src/utils/procoreDirectoryCsv.test.ts)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build         # next build (after editing live components)
```
- Vitest globals are OFF — import `{ describe, it, expect, vi }` from `'vitest'`; co-locate `*.test.ts`.
- No E2E framework — a live click-through via `npm run dev:3010` (from `sitepulse-next/`, port 3010) is the only UI verification.

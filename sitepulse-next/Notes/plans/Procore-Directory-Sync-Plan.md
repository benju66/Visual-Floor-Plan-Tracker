# Procore Directory Sync — live pull of a project's Procore directory into Project Contacts (self-contained build plan)

> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then **re-read the actual current files before editing** — the
> codebase moves faster than docs; do not trust line numbers here.
> **Parent spec:** `Notes/plans/Project-Contacts-Plan.md`. This plan is **Phase 4** of that
> workstream (Phases 1–3 — table + Settings CRUD, Procore CSV import, Look-Ahead palette —
> are already BUILT). Phase 4 was deliberately deferred there as "its own plan + approval
> gates"; this is that plan.

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) — esp. §2 (RLS posture; offline
   queue is OUT of scope here), §4 (new tables/columns → types), §6 (TypeScript / no-`any` /
   narrow JSONB & untrusted API JSON at the boundary), §7 (server-side auth pattern), §9 (Vitest).
2. Re-read the files in §"Build-on inventory" fresh — line numbers drift.
3. Build the sub-phases in order (4a → 4b). Verify after each slice (§Verification). 4c+ are deferred.
4. Keep the owner (a product owner, not a developer) in the loop: lead with a 1–2 sentence
   plain-English summary; explain jargon in passing; keep it short.

## Goal
A SitePulse project that is **linked to a Procore project** gains a **"Sync from Procore"**
button in its Project Contacts settings section. Clicking it pulls that project's Procore
**directory** (the people on the job — Company, name, title, mobile, email) live over the
Procore API and reconciles them into the existing `project_contacts` table: new people are
added, changed people are updated, and people who left Procore are **kept** (never auto-deleted).
Manually-typed and CSV-imported contacts are never touched by the sync. One button, always
current, no re-typing and no CSV export/upload round-trip.

In plain terms: today contacts come in by hand or by uploading a Procore CSV (Phase 2). Phase 4
adds a live "pull straight from Procore" button so the directory stays current on its own.

## Locked product decisions (from the owner, 2026-06-24)
- **Connection = one shared "service account."** SitePulse talks to Procore through a single
  dedicated **Procore Data Connection / service-account** app (company-scoped), **not** each
  user's personal Procore login. The sync runs the same regardless of who clicks it, and there
  is **no per-user token to store or refresh** — a fresh short-lived token is minted from the
  service-account secret on each sync (OAuth **client-credentials** grant). This is the
  Procore-blessed pattern for server-to-server integrations.
- **Trigger = manual button.** A "Sync from Procore" control in the Project Contacts settings
  section, on demand. **No scheduler / background worker in v1** (that's deferred — see below).
- **Departed contacts = keep, never auto-delete.** A previously-synced person who no longer
  appears in the Procore pull stays in `project_contacts` (the sync only ever inserts/updates;
  it reports a "no longer in Procore" count but does not remove or archive in v1).
- **Scope = people, with their company.** v1 pulls project **users/people** (Company from their
  Procore vendor, plus name/title/mobile/email) — the **same shape as the Phase-2 CSV import**,
  so it reconciles cleanly with rows already in the table. Vendors-as-standalone-companies is deferred.
- **Reconcile key = `procore_id`, with an email-based "adopt" fallback** (see §Data model) so a
  live sync upgrades an existing CSV/hand-typed row in place instead of colliding on the table's
  `UNIQUE(project_id, email)`.

## Out of scope / deferred (do NOT build these in Phase 4a/4b)
- **Scheduled / automatic sync** (nightly cron, Procore webhooks). Deferred to a later slice — it
  needs a Render cron job or worker + idempotent run semantics. v1 is the manual button only.
- **Vendors as standalone company-only contacts.** v1 maps company *from each person's vendor*;
  it does not create company-only rows for vendors with no listed person.
- **Departed-row archival / deletion.** v1 keeps departed rows untouched. A `synced_at` /
  `is_archived` status field + "hide stale" UI is a later slice if the owner wants it.
- **Per-user Procore OAuth token storage/refresh.** Explicitly NOT built — the service-account
  client-credentials model removes the need. Do not add a `procore_tokens` table.
- **Writing back to Procore** (SitePulse → Procore). Read-only pull only.
- **The offline `pendingChanges` queue.** Sync is an online, server-side operation; it never
  touches the IndexedDB mutation queue (AGENTS.md §2).

## Data model
**No new table. Re-uses columns that already exist** (verified 2026-06-24 against
`src/types/database.types.ts`):
- `projects.procore_project_id` (text, nullable) and `projects.procore_company_id` (text,
  nullable) — **already present**, set today at project creation via the Procore launch →
  `/dashboard?link_procore_project=…` → `POST /api/projects` flow. The sync **reads** these to
  know which Procore project/company to pull. Projects created manually (not via the Procore
  launch) will have them `NULL` → that project needs a one-time **link** step (Phase 4b UI).
- `project_contacts.procore_id` (text, nullable) — the reconcile key, **already reserved** by the
  Phase-1 migration. Procore-sourced rows carry it; manual/CSV rows have it `NULL`.
- `project_contacts` `UNIQUE(project_id, email)` — still in force. The reconcile must match on
  **`procore_id` first, then fall back to matching an existing row by (project_id, email)** and
  *adopt* it (stamp its `procore_id`) — otherwise a Procore person whose email already exists as a
  CSV/manual row would violate the unique constraint on insert.
- Writer roles (from the Phase-1 RLS): `owner`/`admin`/`pm`/`superintendent`. The sync **writes**
  via the service-role admin client (server-side, bypasses RLS), so the route MUST itself verify
  the **calling SitePulse user is a privileged member of the project** before writing (AGENTS.md
  §2/§7 — never trust the client; mirror the project_contacts write policy in code).

**Possible additive column (decide at the 4b gate, only if needed):** a nullable
`project_contacts.synced_at TIMESTAMPTZ` to record the last Procore pull per row, useful for a
future "stale" indicator. Not required for v1's keep-everything policy — propose it at the gate;
if added, it's an additive idempotent migration via the `create-migration` skill (present SQL + STOP).

## Build-on inventory (read these fresh before using — do NOT fork)
**Existing Procore integration (login-only today — extend, don't break):**
- `src/app/api/auth/procore/callback/route.js` — the OAuth **authorization-code** login flow:
  exchanges `code` → token at `https://login.procore.com/oauth/token`, calls
  `https://api.procore.com/rest/v1.0/me`, domain-locks `@fpcinc.com`, provisions a Supabase user,
  then **discards the token**. Phase 4 does NOT touch this flow; it adds a *separate*
  service-account token mint. Reuse it only as the reference for Procore base URLs + fetch shape.
- `src/app/api/auth/procore/launch/route.js` + `src/app/dashboard/page.jsx` +
  `src/app/api/projects/route.js` — the existing **project↔Procore link**: launch looks up a
  project by `procore_project_id`; an unlinked launch routes to `/dashboard?link_procore_project=…
  &link_procore_company=…`; creating the project stamps `procore_project_id`. **Phase 4b reuses
  this** and adds a way to link an *existing* project (set both `procore_project_id` and
  `procore_company_id`).
- Env secrets today: `NEXT_PUBLIC_PROCORE_CLIENT_ID` + `PROCORE_CLIENT_SECRET` (the **login** app),
  `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`. Phase 4 adds **new, server-only**
  secrets for the **service-account** app (a *different* Procore app): e.g.
  `PROCORE_SERVICE_CLIENT_ID` + `PROCORE_SERVICE_CLIENT_SECRET`. **Never** `NEXT_PUBLIC_*` for the
  secret — it must stay server-side.

**Project Contacts (Phases 1–3 — the table + hooks + Settings UI to build on):**
- `src/hooks/useProjectQueries.ts` — `ProjectContactFields`, `useProjectContacts(projectId)`,
  create/update/delete, and **`useImportProjectContacts(projectId)`** (Phase 2: de-dupes non-null
  emails in-payload, chunked 800-row upsert `onConflict:'project_id,email'`, invalidates the
  `projectContacts` query). The Phase-4 "apply sync" mutation follows this hook's conventions but
  upserts `onConflict:'project_id,procore_id'`-style logic (see reconcile, below) rather than email.
- `src/components/SettingsMenu.tsx` — the **Project Contacts** section, including Phase 2's
  `ImportContactsControl` (file/paste → preview "Found N across M companies" → confirm → upsert,
  `canEdit`-gated via `useCurrentUserRole`). The **"Sync from Procore" button (4b) mirrors this
  control's shape**: trigger → preview the diff → confirm → apply.
- `src/utils/procoreDirectoryCsv.ts` (+ test) — Phase 2's pure CSV→`ProjectContactFields` mapper.
  The Phase-4 API mapper is the **API-JSON analogue** of this: pure, co-located test, maps Procore
  Directory user JSON → the same `ProjectContactFields` shape (+ `procore_id`).
- `src/types/database.types.ts` + `src/types/domain.ts` — `ProjectContact` / `ProjectContactInsert`
  derive here. No new table expected; if `synced_at` is added, regenerate/patch these (§4).

## Pure logic to extract + unit-test (where correctness lives)
Keep all framework-free correctness in `src/utils/` with co-located `*.test.ts` (Vitest globals
OFF — import `{ describe, it, expect }` from `'vitest'`). The route/UI only does I/O + rendering.
- **`src/utils/procoreDirectoryApi.ts` → `mapProcoreUserToContact(apiUser): MappedContact`** — pure:
  narrow ONE untrusted Procore Directory user object (`unknown` in, no `any`) → `ProjectContactFields
  & { procore_id: string }`. Map company from the user's `vendor.name` (fallbacks documented in code),
  name/title/mobile/email, trim, blank→null (mirror `cleanContactFields`), skip/flag rows with no
  company. **Verify the exact Procore field names + endpoint version against current Procore Directory
  API docs at build time** — this plan assumes `vendor.name`, `email_address`, `mobile_phone`,
  `job_title`, `first_name`, `last_name`, `id`, but Procore versions drift (v1.0/v1.1/v2).
- **`src/utils/reconcileProcoreContacts.ts` → `reconcileProcoreContacts(existing: ProjectContact[],
  incoming: MappedContact[]): { toInsert, toUpdate, departed }`** — pure, the heart of the feature:
  1. Match incoming → existing **by `procore_id`** first; if none, **by `(lowercased) email`** and
     *adopt* that row (→ `toUpdate` with the row's `id` + a newly-stamped `procore_id`).
  2. Unmatched incoming → `toInsert`.
  3. Matched → `toUpdate` only if a mapped field actually changed (avoid no-op writes).
  4. Existing rows that **have a `procore_id`** but are absent from `incoming` → `departed`
     (reported only; per the keep-everything policy, NOT inserted/updated/deleted).
  5. Existing rows with **`procore_id = NULL`** that did not match by email are **never touched**.
  Tests: procore_id match updates in place; email-fallback adopts a CSV row (stamps procore_id, no
  duplicate, no unique-constraint collision); unchanged row produces no update; brand-new person
  inserts; a departed synced row lands in `departed` and NOT in insert/update; a manual (procore_id
  NULL, non-matching email) row is ignored entirely.

## Sub-phasing (ship + verify each)

### Phase 4a — Service-account auth + Directory fetch + pure map/reconcile (read-only, NO writes)
The integration spike + all the pure correctness. Proves we can mint a service token and pull a
project's directory, and computes the reconcile **diff** — but writes nothing to the DB yet.
- **Scope:**
  1. **Service token mint** — a small server helper that POSTs `grant_type=client_credentials`
     with `PROCORE_SERVICE_CLIENT_ID`/`PROCORE_SERVICE_CLIENT_SECRET` to
     `https://login.procore.com/oauth/token` and returns a short-lived access token (optionally
     cache module-level until ~60s before expiry). Server-only.
  2. **Directory fetch** — call the project-users Directory endpoint
     (`GET /rest/v1.x/projects/{procore_project_id}/users`, header `Procore-Company-Id:
     {procore_company_id}`) and run each result through `mapProcoreUserToContact`. **Confirm the
     exact endpoint/version/fields against Procore docs.**
  3. **Pure helpers + tests** — `procoreDirectoryApi.ts` and `reconcileProcoreContacts.ts` above.
  4. **Preview route** — `GET/POST /api/procore/sync-contacts?projectId=…` that: verifies the
     caller is a privileged member of the project, reads the project's `procore_project_id` +
     `procore_company_id` (400 with a clear message if unlinked), fetches + maps the directory,
     loads existing `project_contacts`, runs `reconcileProcoreContacts`, and returns the **counts**
     `{ toInsert, toUpdate, departed }` as a **dry-run preview**. **Writes nothing.**
- **⛔ Approval gates (STOP for explicit owner sign-off):**
  - **Procore service-account app + secrets.** Owner/Procore-admin must register the Data
    Connection app, grant it Directory read on the target project, and provide
    `PROCORE_SERVICE_CLIENT_ID`/`PROCORE_SERVICE_CLIENT_SECRET`. Present the exact env-var names +
    where they go (Render + local `.env`), confirm the **OAuth scopes/permissions** cover the
    Directory, and STOP before wiring secrets. Do not hardcode or commit any secret.
  - Confirm the **target test project** is linked (`procore_project_id` + `procore_company_id` set)
    before a live fetch; if not, do the dry run against it only after linking (4b) or temporarily.
- **Exit criteria:** typecheck + test + build green · both pure helpers unit-tested · the preview
  route returns sensible counts against a real linked project (read-only — safe) · `verify-feature`, STOP.

### Phase 4b — Apply the sync (writes) + the "Sync from Procore" UI + link-existing-project
Turns the dry run into real writes and gives the superintendent the button.
- **Scope:**
  1. **Apply** — extend the route (or add `POST …/apply`) to perform the reconcile writes via the
     service-role admin client: insert `toInsert`, update `toUpdate` (including the email-adopt
     `procore_id` stamp), leave `departed` untouched. Idempotent: a second immediate sync yields
     zero inserts/updates. Re-uses the chunked-upsert discipline from `useImportProjectContacts`.
  2. **UI** — a **"Sync from Procore"** control in the Project Contacts section (mirror
     `ImportContactsControl`): click → preview "Will add N, update M, N′ no longer in Procore" →
     confirm → apply → toast result; `canEdit`-gated. Disabled with a hint when the project is
     unlinked.
  3. **Link an existing project** — a minimal affordance (in the same section or project settings)
     to set `procore_project_id` + `procore_company_id` on a project that wasn't created via the
     Procore launch, so the sync has a target. Reuse the existing link columns; no new table.
- **⛔ Approval gates:** the **first live write** to a real project's `project_contacts` via sync —
  confirm the target project + owner go-ahead (heed memory `no-live-write-probes`: never test the
  write path against unrelated existing rows). Do not push to `main` until "Approved."
- **Exit criteria:** typecheck + test + build green · live `dev:3010`: link a project → preview →
  apply → contacts appear/update in the Settings list and (via Phase 3) in the Look-Ahead palette →
  immediate re-sync is idempotent (0 changes) → a manual/CSV row with no Procore match is untouched ·
  `verify-feature`, STOP.

### Phase 4c+ — Deferred (separate later slices)
Scheduled/automatic sync (Render cron + idempotent run), departed-row archival/`synced_at` status +
"hide stale" UI, vendors-as-companies, and any Procore→SitePulse write-back. Each needs its own
kickoff + gates.

## Hard guardrails (AGENTS.md — do not violate)
- **Secrets stay server-side.** The service-account client secret is server-only env (`PROCORE_
  SERVICE_CLIENT_SECRET`); never `NEXT_PUBLIC_*`, never committed, never logged. The Directory pull
  and token mint run **only** in a Next.js API route (co-located with the existing `/api/auth/
  procore/*` + service-role admin pattern) — **not** in the FastAPI backend, not on the client.
- **Server-side authorization.** The service-role admin client bypasses RLS, so the route MUST
  verify the calling SitePulse user is a privileged member (`owner`/`admin`/`pm`/`superintendent`)
  of the target project before any read of contacts or write — mirror the project_contacts policy
  in code (AGENTS.md §2/§7). Never trust a client-supplied role/project pairing blindly.
- **Narrow untrusted API JSON at the boundary** (AGENTS.md §6) — Procore responses are `unknown`;
  guard/narrow into typed shapes inside the mapper. No `any`; prefer `unknown` + narrowing.
- **Touch no unrelated table/RPC/RLS.** Writes go only to `project_contacts` (and, for linking,
  `projects.procore_project_id`/`procore_company_id`). Not `status_logs`, `units`, `lookahead_plans`,
  etc. Reconcile **only** rows with a `procore_id` (plus the one-time email-adopt); never delete,
  and never modify manual/CSV rows.
- **Migration discipline** — only if `synced_at` is added: additive + nullable + idempotent via the
  `create-migration` skill; **present SQL and STOP** before applying (memory `no-live-write-probes`).
- **Do NOT wire into the offline `pendingChanges` queue** — sync is an online server operation.
- **Verify** via typecheck + test + build + a `dev:3010` click-through. **Lint is NOT a gate**
  (~1850 pre-existing problems).

## Open decisions (resolve at the noted gate)
- **Procore Directory endpoint + field names + API version** — confirm against current Procore docs
  at 4a build time (this plan's `vendor.name`/`email_address`/`mobile_phone`/`job_title`/`id` are
  assumptions). Also confirm whether project **users** vs **vendor contacts** is the right list for
  "the people on the job."
- **`synced_at` column** — add (additive migration) or skip for v1's keep-everything policy. Decide
  at the 4b gate.
- **Token caching** — mint-per-sync (simplest) vs. module-level cache until near-expiry. Decide at 4a
  (favor mint-per-sync unless rate limits bite).
- **Where the "link existing project" UI lives** — inside the Project Contacts section vs. general
  project settings. Decide at 4b (favor co-locating with the Sync button).

## Verification commands (the exit-criteria gate)
Bash cwd persists and a stray `cd` triggers a prompt — run npm with an **absolute prefix**:
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck   # tsc --noEmit (primary gate)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test         # vitest (one file: ... run test -- src/utils/reconcileProcoreContacts.test.ts)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build         # next build (after editing live components / routes)
```
- Vitest globals are OFF — import `{ describe, it, expect, vi }` from `'vitest'`; co-locate `*.test.ts`.
- No E2E framework — a live click-through via `npm run dev:3010` (from `sitepulse-next/`, port 3010) is the only UI verification.

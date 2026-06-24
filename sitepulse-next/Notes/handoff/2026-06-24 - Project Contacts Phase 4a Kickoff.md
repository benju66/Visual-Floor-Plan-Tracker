# Kickoff — Project Contacts, Phase 4a: Procore service-account auth + Directory fetch + pure reconcile (read-only, no writes)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 4a of Project Contacts** (mint a Procore **service-account** token, **fetch a linked project's Procore directory read-only**, and compute the reconcile **diff** into `project_contacts` — **a dry-run preview that writes NOTHING to the database**). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-24 - Project Contacts Phase 4a Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Procore-Directory-Sync-Plan.md` (the Phase-4 plan-of-record — Phase 4a scope, Data model, Pure logic, Hard guardrails, Open decisions)
> - `sitepulse-next/AGENTS.md` (§2 RLS/auth posture, §6 TypeScript/no-`any`/narrow untrusted JSON, §7 server-side auth, §9 Vitest)
>
> Branch off `feat/project-contacts-phase-3` (the tip of the Project Contacts chain — NOT bare `main`; Phases 1–3 are not merged to main yet. If they've since merged, branch off `main`). Build **only Phase 4a**. ⛔ **Approval gate:** the Procore **service-account app + its secrets** — present the exact env-var names and required Directory scopes and **STOP for owner sign-off before wiring any secret**; never hardcode/commit/log a secret. Phase 4a writes nothing to the DB. **Don't commit or push until I say "Approved."**

---

## Context for the session

### Plain-English goal
Today contacts come in by hand or by uploading a Procore CSV (Phase 2). Phase 4 will add a live
**"Sync from Procore"** button that pulls the project's directory straight from Procore. **Phase 4a
is the plumbing-and-proof slice only:** get SitePulse talking to Procore through one shared
**service-account** connection, pull a linked project's directory **read-only**, and work out
*what would change* (add / update / no-longer-in-Procore counts) — **without writing anything yet**.
The button and the actual writes are Phase 4b.

### Where Phases 1–3 left off (all BUILT; none merged to main)
- **Branch chain:** `main` → `…phase-1` (table + Settings CRUD; migration LIVE on prod) →
  `…phase-2` (CSV import) → `…phase-3` (Look-Ahead palette). Phase 4a branches off
  **`feat/project-contacts-phase-3`** so the `project_contacts` table, the `ProjectContact` /
  `ProjectContactFields` types, `useProjectContacts`/`useImportProjectContacts`, and the Settings
  section all exist. Branching off bare `main` would drop the whole foundation.
- The `project_contacts` table is LIVE on prod (`pmccdxmuszuykawvlphj`) with `procore_id` (text,
  nullable) **already reserved** as the reconcile key, and `UNIQUE(project_id, email)` in force.
- **It is currently empty in every project** (the Phase-2 live import was never run) — fine for 4a;
  the reconcile/preview works against an empty existing-set too.

### What already exists for Procore (verified 2026-06-24 — read these fresh)
- `src/app/api/auth/procore/callback/route.js` — the **login-only** OAuth (authorization-code)
  flow: exchanges `code` → token, calls `/rest/v1.0/me`, domain-locks `@fpcinc.com`, provisions a
  Supabase user, **then discards the token**. **Phase 4a does NOT touch this** — it adds a
  *separate* service-account (**client-credentials**) token mint. Use this file only as the
  reference for Procore base URLs (`login.procore.com`, `api.procore.com`) and fetch shape.
- `projects.procore_project_id` AND `projects.procore_company_id` (both text, nullable) **already
  exist** and are set today at project creation via the Procore launch →
  `/dashboard?link_procore_project=…&link_procore_company=…` → `POST /api/projects` flow
  (`launch/route.js`, `dashboard/page.jsx`, `api/projects/route.js`). Phase 4a **reads** these to
  know which Procore project/company to pull. A project created manually will have them `NULL` →
  for the 4a dry run, pick a project that is already linked (or link one in Procore-launch first;
  the in-app "link existing project" affordance is Phase 4b).
- Existing env: `NEXT_PUBLIC_PROCORE_CLIENT_ID` + `PROCORE_CLIENT_SECRET` are the **login** app.
  Phase 4a adds **new, server-only** secrets for the **service-account** app (a *different* Procore
  Data Connection app): `PROCORE_SERVICE_CLIENT_ID` + `PROCORE_SERVICE_CLIENT_SECRET`. The secret is
  **server-only — never `NEXT_PUBLIC_*`, never committed/logged**.

### Build only this (Phase 4a scope — four pieces)
1. **Service token mint** (server helper): POST `grant_type=client_credentials` with the service
   secrets to `https://login.procore.com/oauth/token` → short-lived access token. Mint-per-sync is
   fine for v1 (module-level cache-until-near-expiry is optional — see Open decisions).
2. **Directory fetch** (server): `GET /rest/v1.x/projects/{procore_project_id}/users` with header
   `Procore-Company-Id: {procore_company_id}`. **⚠ Confirm the exact endpoint, API version, and
   field names against current Procore Directory API docs** — the plan's assumed fields
   (`vendor.name`, `email_address`, `mobile_phone`, `job_title`, `first_name`, `last_name`, `id`)
   may have drifted (v1.0 / v1.1 / v2), and confirm project **users** is the right list vs vendor contacts.
3. **Two pure helpers + co-located Vitest tests** (this is where correctness lives — see the plan's
   "Pure logic" section for the full test list):
   - `src/utils/procoreDirectoryApi.ts` → `mapProcoreUserToContact(apiUser): MappedContact` —
     narrow ONE **untrusted** Procore user (`unknown` in, **no `any`**) → `ProjectContactFields &
     { procore_id: string }`; company from `vendor.name`, trim, blank→null, flag/skip no-company.
   - `src/utils/reconcileProcoreContacts.ts` → `reconcileProcoreContacts(existing, incoming):
     { toInsert, toUpdate, departed }` — match by **`procore_id` first, then by `(project_id,
     lowercased email)` and *adopt*** (stamp procore_id onto an existing CSV/manual row so a live
     sync upgrades it in place instead of colliding on `UNIQUE(project_id, email)`); unchanged →
     no update; existing-with-procore_id absent from incoming → `departed` (reported only, kept);
     existing with `procore_id = NULL` and no email match → **never touched**.
4. **Dry-run preview route** — `…/api/procore/sync-contacts` (GET or POST, `projectId` param) that:
   verifies the **calling SitePulse user is a privileged member** (`owner`/`admin`/`pm`/
   `superintendent`) of the project (service-role bypasses RLS — enforce in code, AGENTS.md §2/§7);
   reads the project's `procore_project_id` + `procore_company_id` (**400 with a clear message if
   unlinked**); fetches + maps the directory; loads existing `project_contacts`; runs the reconcile;
   returns the **counts** `{ toInsert, toUpdate, departed }`. **Writes NOTHING.**

### Locked decisions (from the owner, 2026-06-24 — don't re-litigate)
- **Shared service-account connection** (not per-user tokens) → **no `procore_tokens` table**, no
  per-user refresh; mint a fresh token from the secret each sync.
- **Manual button** trigger (Phase 4b) — **no scheduler/worker** in v1.
- **Keep departed rows, never auto-delete** — the sync only inserts/updates; reports departed.
- **People-with-company** scope (matches the Phase-2 CSV shape) — vendors-as-companies deferred.

### ⛔ Approval gates (STOP for explicit owner sign-off)
- **The Procore service-account app + secrets.** The owner / a Procore company admin must register
  the Data Connection app, grant it **Directory read** on the target project, and provide
  `PROCORE_SERVICE_CLIENT_ID` / `PROCORE_SERVICE_CLIENT_SECRET`. **Present the exact env-var names +
  where they go (Render + local `.env`), confirm the OAuth scopes/permissions cover the Directory,
  and STOP before wiring secrets.** Never hardcode/commit/log a secret.
- No DB-write gate this phase (4a is read-only/dry-run). Still: **do not commit or push until the
  owner says "Approved."**

### Exit criteria (Definition of Done for Phase 4a — then STOP)
- `typecheck` + `test` + `build` green (absolute-prefix commands in the plan's Verification section).
- Both pure helpers (`procoreDirectoryApi`, `reconcileProcoreContacts`) unit-tested per the plan's
  test list.
- The preview route returns sensible `{ toInsert, toUpdate, departed }` counts against a **real
  linked project** (read-only — safe; nothing written). If no project is linked yet, say so and
  stop rather than writing/linking.
- Close with the **`verify-feature`** skill (`.agent/skills/verify-feature/SKILL.md` — not an
  invocable slash-skill; remember the local overrides: **port 3010, lint is not a gate, there IS
  Vitest now**). Do not commit/push until "Approved."

### Notes / drift to watch
- **Confirm Procore API specifics at build time** — endpoint path, version, and field names drift;
  the plan's shapes are assumptions to verify, not gospel.
- **Server-only + authorize in code** — the route uses the service-role admin client (bypasses RLS),
  so it must check project membership/role itself before reading contacts. Keep all Procore I/O in
  the Next.js API route (co-located with `/api/auth/procore/*`), **not** the FastAPI backend, **not**
  the client.
- After 4a, **Phase 4b** turns the dry run into real writes + the "Sync from Procore" button + a
  "link an existing project" affordance (its own kickoff + a live-write approval gate).

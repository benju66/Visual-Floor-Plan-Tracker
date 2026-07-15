# Security Hardening — close the unauthenticated API routes, fix role drift, harden Procore SSO (self-contained build plan)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: none — this workstream comes from the 2026-07-15 four-agent code review ("fix first" security items).

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) in full.
2. Re-read the files named below fresh — do not trust line numbers; they drift.
3. Build the sub-phases in order. Verify after each slice (§ verify).
4. Keep the owner (product owner, not a developer) in the loop: lead with a
   1–2 sentence plain-English summary; explain jargon in passing; keep it short.

## Goal
When this is done: (1) nobody can create projects or grant themselves membership without being logged in — the two Next.js API routes that currently accept an unverified `user_id` from the request body require a real login token and derive the user from it; (2) a superintendent added from the Team tab actually gets superintendent permissions (today they're saved under a misspelled role value the database doesn't recognize); (3) "Log in with Procore" keeps working past 50 user accounts and can't be abused to redirect users to attacker-chosen pages.

## Out of scope / deferred
- **The Subcontractor capability buildout** (what subs can see/do, their own views, RLS grants) — a future workstream the owner plans. This plan only makes `'sub'` a *recognized, stored, view-only* value so assignments made now survive that buildout.
- Converting the touched `.js`/`.jsx` files to TypeScript — that's the separate JS→TS migration backlog (2026-07-15 review). Phase 1 touches `dashboard/page.jsx` and Phase 3 rewrites `callback/route.js`; keep them `.js(x)` unless the edit is total anyway (Phase 3's callback rewrite is — see phase notes).
- Procore Directory sync (Project Contacts Phase 4) — the callback/launch routes stay login-only.
- The backend (FastAPI) — nothing in this plan touches `sitepulse-backend`; its auth was verified consistent in the same review.
- Folding TopHeader's ad-hoc superintendent gates into the `controlVisibility` matrix — worthwhile, but a UX-behavior change; noted for the refactor backlog, not done here.

## Locked product decisions (from the owner)
- **Subcontractor role stays but is view-only for now** (owner, 2026-07-15: "Eventually we are planning to add the ability to add a project's subcontractors and build out what they can eventually do"). `'sub'` remains selectable and stored; it grants nothing beyond viewer today; the dropdown label says so ("Subcontractor (view-only)").
- **`'superintendent'` is the canonical stored value** — not a decision so much as ground truth: the DB RLS policies (`20260623_project_contacts.sql`) and `GlobalSettingsModal` already use it; only SettingsMenu's Team tab writes `'super'`. Existing `'super'` rows get backfilled.
- Fixes are **surgical**: no RLS changes, no new privileges granted anywhere in this plan.

## Data model
- **No schema changes.** `project_members.role` is a free TEXT column (no CHECK constraint) — that's why `'super'`/`'sub'` rows could exist at all.
- Phase 2 includes a **prod data backfill** (⛔ gated): `UPDATE project_members SET role = 'superintendent' WHERE role = 'super'`. `'sub'` rows are left as-is (recognized value now). Run the audit SELECT first; see Phase 2.
- Roles in play (ground truth, verified 2026-07-15): `'owner'` (assigned by the `create_new_project` RPC; checked in RLS `role IN ('owner','admin','pm')` lists and in `SettingsMenu.tsx` `canEdit`), `'admin'`, `'pm'`, `'superintendent'` (in `project_contacts` RLS + `GlobalSettingsModal` + TopHeader gates), `'viewer'`, plus drifted `'super'`/`'sub'` written only by SettingsMenu's Team tab. Note `src/types/domain.ts` `MemberRole` is currently missing `'owner'` — Phase 2 fixes the type to match reality.

## Build-on inventory (read these fresh before using)
- `src/app/api/projects/route.js` — unauthenticated service-role project creation (Phase 1 target).
- `src/app/api/workbench/container/route.ts` — same pattern for the workbench container (Phase 1 target). Its header comment explicitly says it mirrors api/projects — keep the two routes mirrored after the fix too.
- Call sites: `src/app/dashboard/page.jsx` `handleCreateProject` (fetches `/api/projects`, body carries `user_id`) and `src/hooks/useWorkbench.ts` `useWorkbenchContainer` (fetches `/api/workbench/container`, body carries `user_id`). Both must send the session token instead.
- **Token pattern to copy:** `src/services/api.ts` — every FastAPI call already sends `Authorization: Bearer ${token}`; callers pass `session.access_token` from `useAuth()` (`src/providers/AuthProvider.jsx`). Reuse this exact convention for the two Next routes.
- `src/components/SettingsMenu.tsx` Team tab (~lines 1210–1328) — the two role `<select>`s that write `'super'`/`'sub'`; role-change goes through `useUpdateProjectMemberRole` (`src/hooks/useProjectQueries.ts`), invite is a direct `project_members` insert.
- `src/components/TopHeader.tsx` — three `currentUserRole !== 'superintendent'` gates; `src/components/GlobalSettingsModal.tsx` — the Users-tab role select (already canonical).
- `src/types/domain.ts` `MemberRole`; `src/types/queryKeys.ts` for invalidations.
- `src/app/api/auth/procore/callback/route.js` + `src/app/api/auth/procore/launch/route.js` + the Procore button in `src/app/login/page.jsx` (builds the OAuth URL client-side — relevant to Phase 3's CSRF design).
- Test harness: `src/test/renderWithQuery.tsx` + the `vi.mock` chainable-Supabase recipe (AGENTS §9). Route handlers are plain async functions — import and call them in Vitest with `vi.mock('@supabase/supabase-js')`.

## Pure logic to extract + unit-test
- `src/utils/roles.ts` (Phase 2): the canonical role constants (`ROLES`, ordered `ROLE_OPTIONS` for dropdowns with labels incl. "Subcontractor (view-only)"), `isPrivilegedRole(role)` mirroring the RLS `('owner','admin','pm')` set, and `normalizeLegacyRole(role)` (`'super'→'superintendent'`, everything else pass-through) so stale cached rows render correctly pre-backfill. Framework-free + `roles.test.ts`.
- `src/utils/procoreState.ts` (Phase 3): encode/decode of the OAuth `state` payload (`{ nonce, returnTo }`), `isSafeReturnPath(path)` (must start with a single `/`, reject `//`, `\`, and anything containing `://`). Pure + `procoreState.test.ts`.
- Server auth helper (Phase 1): `src/utils/serverAuth.ts` — `getUserFromRequest(request)` reads the `Authorization: Bearer` header and verifies it via a server-side Supabase client (`auth.getUser(token)`), returning `{ user }` or `{ error: 401-shaped }`. Not pure (network), but unit-tested with a mocked `@supabase/supabase-js`.

## Sub-phasing (ship + verify each)

### Phase 1 — Authenticate the two service-role API routes
- **Scope:**
  - New `src/utils/serverAuth.ts` (`getUserFromRequest`) + test.
  - `api/projects/route.js`: require a valid bearer token; take `user_id` from the verified token (**ignore/remove it from the body**); on `project_members` insert failure, best-effort delete the just-created project row (no more orphans), then fail; replace `error.message` in responses with generic strings ("Could not create the project.") — full details to `console.error` only.
  - `api/workbench/container/route.ts`: same treatment (401 without a valid token; membership row uses the token's user id; generic errors).
  - Call sites: `dashboard/page.jsx` sends `Authorization: Bearer ${session.access_token}` and drops `user_id` from the body; `useWorkbench.ts` `useWorkbenchContainer` gets the token via `supabase.auth.getSession()` inside the queryFn (keep the `userId` param solely for `enabled:`), drops the body.
  - Route-handler tests (Vitest, mocked `@supabase/supabase-js`): no/invalid token → 401 and **no DB call**; valid token → member row uses the token's user id, never a body-supplied one; member-insert failure → project row cleaned up + generic 500.
- **Approval gates:** ⛔ this is an auth-behavior change to live routes — present the diff summary before commit (standing rule: no commit/push until "Approved"). No migration, no RLS change, no offline-queue involvement (both calls are online-only by nature).
- **Exit criteria:** typecheck + test + build green · live dev:3010 click-through: create a project from the dashboard (works logged in), visit the workbench (container resolves), and a raw `curl` POST with no token gets 401 · close with the verify-feature skill.

### Phase 2 — One role vocabulary + prod backfill
- **Scope:**
  - New `src/utils/roles.ts` + tests (see § Pure logic).
  - `src/types/domain.ts`: `MemberRole = 'owner' | 'admin' | 'pm' | 'superintendent' | 'sub' | 'viewer'` (adds the two real-world values; `'sub'` documented view-only).
  - `SettingsMenu.tsx` Team tab: both `<select>`s render from `ROLE_OPTIONS` — `'super'` option becomes `'superintendent'`, `'sub'` stays with the "(view-only)" label; display of `member.role` goes through `normalizeLegacyRole`.
  - `TopHeader.tsx` + `SettingsMenu.tsx:~898` `canEdit`: compare against the constants (behavior unchanged for canonical values; `'super'` rows start being treated as superintendents pre-backfill thanks to `normalizeLegacyRole` — apply it where `currentUserRole` is read).
  - ⛔ **Prod backfill (STOP for approval):** first run the audit `SELECT role, count(*) FROM project_members GROUP BY role;` and show the owner the counts. Then present the exact SQL — `UPDATE project_members SET role = 'superintendent' WHERE role = 'super';` — via the create-migration skill conventions and **STOP until the owner approves**. `'sub'` rows are NOT touched. Never run writes against prod without the explicit go-ahead (standing rule: no live-write probes).
- **Approval gates:** ⛔ the backfill above. The app-code sweep itself is behavior-preserving for canonical values.
- **Exit criteria:** typecheck + test + build green · `roles.test.ts` pins the option list and `normalizeLegacyRole` · live dev:3010 click-through: Team tab shows the new labels; changing a member to Superintendent stores `'superintendent'` (verify in the network tab / a dev-DB row) · close with verify-feature.

### Phase 3 — Procore SSO hardening
- **Scope:** (this rewrites most of `callback/route.js` — convert it to `.ts` in the same pass, per the JS→TS skill, since every line is being touched anyway; `launch/route.js` likewise if touched heavily)
  - **Kill the `listUsers()` scan** (breaks past ~50 users): attempt `supabaseAdmin.auth.admin.createUser(...)` first and treat an "email already exists" error as the existing-user case, then `generateLink` by email (which never needed the user object). No pagination loop, race-safe. Also check the error of every admin call instead of destructuring blind.
  - **CSRF `state`:** new tiny `GET /api/auth/procore/start?returnTo=...` route that (a) sets an httpOnly, short-lived nonce cookie, (b) builds the Procore authorize URL with `state = encode({ nonce, returnTo })`, and (c) redirects. The login page button navigates to `/api/auth/procore/start?...` instead of hand-building the URL (client JS can't set httpOnly cookies — that's why the start route exists). The callback decodes `state`, requires the nonce to match the cookie, clears it, and only redirects to `isSafeReturnPath(returnTo)` paths (else `/dashboard`).
  - **Domain allow-list → env:** `PROCORE_ALLOWED_EMAIL_DOMAINS` (comma-separated, e.g. `fpcinc.com`), replacing the hardcoded `@fpcinc.com` + "CHANGE THIS" comment. Missing/empty env = deny all (fail closed) with a clear server log. ⛔ the owner must add this env var in Vercel before deploy — call it out at approval time.
  - Pure `src/utils/procoreState.ts` + tests (see § Pure logic).
- **Approval gates:** ⛔ env var addition on Vercel (owner action); ⛔ this changes the login flow — present the flow diff before commit.
- **Exit criteria:** typecheck + test + build green · `procoreState.test.ts` pins encode/decode + `isSafeReturnPath` (incl. `//evil.com`, `https://…`, `\` cases) · live verification is limited without Procore credentials in dev: verify email/password login untouched on dev:3010, and the owner does the Procore click-through on the Vercel preview/prod after env setup · close with verify-feature.

## Hard guardrails (AGENTS.md — do not violate)
- **RLS posture (§2):** no policy changes, no new grants, `anon` never granted anything. The service-role key stays server-side only — never expose it to the client or widen client RLS as an alternative fix.
- These routes are **online-first request/response** — do not route them through the offline mutation queue, and do not touch `pendingChanges`, `upsert_status_log`, or any status-write path.
- `SUPABASE_SERVICE_ROLE_KEY` reads stay in server files only (`app/api/**`); never import it into client components/hooks.
- TypeScript guardrails (§6): new files are `.ts`; derive row types from `database.types.ts`; no `any` (the invite insert's existing `as any` may be removed if trivially fixable, else leave it for the refactor backlog — don't expand it).
- Error responses from API routes carry **generic strings**; full errors go to server logs only (mirrors the backend §7 error-manners rule).
- Lint is NOT a gate (~1850 pre-existing problems) — verify with typecheck + test + build.

## Verification commands (the exit-criteria gate)
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
Live click-throughs via `npm run dev:3010` (from `sitepulse-next/`, port 3010 — not 3000). Vitest globals are OFF: import `{ describe, it, expect, vi }` from `'vitest'`; co-locate tests.

## Open decisions
- None blocking. The future Subcontractor buildout (what `'sub'` can do) is deliberately deferred to its own workstream — when opened, start from `src/utils/roles.ts` and the RLS role lists.
- Phase 2's backfill counts are unknown until the audit SELECT runs (prod). If it surfaces role values beyond `'super'`/`'sub'`/canonical, STOP and show the owner before writing any UPDATE.

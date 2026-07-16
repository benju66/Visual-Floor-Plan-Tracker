# Kickoff — Security Hardening, Phase 3: Procore SSO hardening

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3 of Security Hardening** (make "Log in with Procore" scale past ~50 accounts and close its CSRF / open-redirect gaps). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-15 - Security Hardening Phase 3 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Security-Hardening-Plan.md` (Phase 3)
> - `sitepulse-next/AGENTS.md`
>
> Build **only Phase 3**. ⛔ No RLS/policy changes and no new grants. The `PROCORE_ALLOWED_EMAIL_DOMAINS` env var is an owner action on Vercel — call it out at approval time, don't invent a value. Present the login-flow diff before commit. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
"Log in with Procore" has three problems. (1) It finds the matching user by **scanning the whole user list one page at a time** — that quietly breaks for the earliest-created accounts once there are more than ~50 users. (2) It has **no CSRF protection** on the OAuth round-trip and will **redirect the browser wherever the `returnTo` value says**, which an attacker can abuse to bounce a logged-in user to a malicious page. (3) The allowed email domain is **hardcoded** in the source with a "CHANGE THIS" comment. This phase fixes all three.

## Scope (and nothing more)
This phase **rewrites most of `src/app/api/auth/procore/callback/route.js`** — convert it to `.ts` in the same pass (per the JS→TS skill; every line is being touched anyway). `launch/route.js` likewise if it's touched heavily.

1. **Kill the `listUsers()` scan.** Instead of paginating users to find the match, attempt `supabaseAdmin.auth.admin.createUser(...)` **first** and treat an "email already exists" error as the existing-user case; then `generateLink` by email (which never needed the user object). No pagination loop, race-safe. **Check the error of every admin call** instead of destructuring blind.
2. **CSRF `state` + safe redirect.** New tiny **`GET /api/auth/procore/start?returnTo=…`** route that (a) sets an httpOnly, short-lived **nonce cookie**, (b) builds the Procore authorize URL with `state = encode({ nonce, returnTo })`, and (c) redirects to Procore. The **login page button navigates to `/api/auth/procore/start?…`** instead of hand-building the OAuth URL (client JS can't set httpOnly cookies — that's why the start route exists). The **callback decodes `state`, requires the nonce to match the cookie, clears the cookie, and only redirects to `isSafeReturnPath(returnTo)` paths** (else `/dashboard`).
3. **Domain allow-list → env.** `PROCORE_ALLOWED_EMAIL_DOMAINS` (comma-separated, e.g. `fpcinc.com`), replacing the hardcoded `@fpcinc.com` + "CHANGE THIS" comment. **Missing/empty env = deny all (fail closed)** with a clear server-log line. ⛔ the owner must add this env var in Vercel before deploy — call it out at approval time.
4. **New pure `src/utils/procoreState.ts` + `procoreState.test.ts`:** `encode`/`decode` of the `state` payload (`{ nonce, returnTo }`), and `isSafeReturnPath(path)` — must start with a single `/`, and reject `//`, `\`, and anything containing `://`. Framework-free + fully unit-tested.

## Build-on inventory (read these FRESH before editing — line numbers drift)
- `src/app/api/auth/procore/callback/route.js` — the `listUsers()` scan, blind destructuring, hardcoded domain, unchecked redirect all live here.
- `src/app/api/auth/procore/launch/route.js` — the other half of the flow.
- `src/app/login/page.jsx` — the Procore button that currently builds the OAuth URL client-side (this is what changes to navigate to `/start`).
- `src/utils/serverAuth.ts` (Phase 1) — the pattern for a server-side helper that reads a request + returns a typed result; the service-role `createClient` usage in the two API routes is the model for the admin client here.
- Token/cookie conventions: Next.js route handlers set cookies via the `NextResponse` cookies API — read the current Next docs in `node_modules/next/dist/docs/` (AGENTS.md top rule) before writing cookie code.

## Guardrails (from the plan — re-read AGENTS.md yourself)
- ⛔ **No RLS/policy changes, no new grants.** `SUPABASE_SERVICE_ROLE_KEY` stays in `app/api/**` server files only.
- The Procore callback/launch/start routes stay **login-only** — do NOT build Procore Directory sync (that's Project Contacts Phase 4, deferred).
- Generic error strings to the client; full errors to `console.error`/server logs only (mirror Phase 1 + backend §7).
- New files are `.ts`; the callback rewrite converts `.js → .ts` (fix all types, no `// @ts-nocheck` on the committed file). Keep `launch` `.js` unless it's touched heavily.
- Lint is not a gate; verify with typecheck + test + build.

## Exit criteria (Definition of Done)
- Typecheck + test + build green (the `npm --prefix …` commands in the plan).
- `procoreState.test.ts` pins `encode`/`decode` round-trip and `isSafeReturnPath` — including the attack cases `//evil.com`, `https://evil.com`, `/\evil.com`, `\\evil.com`, and a bare `path` with no leading slash (all rejected); a normal `/project/123?x=1` accepted.
- **Live verification is limited without Procore credentials in dev:** confirm email/password login is untouched on `dev:3010`, and the owner does the real Procore click-through on the Vercel preview/prod **after** adding `PROCORE_ALLOWED_EMAIL_DOMAINS`.
- ⛔ Call out the Vercel env var (`PROCORE_ALLOWED_EMAIL_DOMAINS`) as an owner action at approval time. Present the login-flow diff, then **STOP — no commit/push until the owner says "Approved."**
- Close the phase with the **verify-feature** skill.

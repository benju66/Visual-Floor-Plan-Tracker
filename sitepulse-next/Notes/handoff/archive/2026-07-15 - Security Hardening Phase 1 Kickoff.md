# Kickoff — Security Hardening, Phase 1: Authenticate the two service-role API routes

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Security Hardening** (require a real login token on the two unauthenticated Next.js API routes and derive the user from it). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-15 - Security Hardening Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Security-Hardening-Plan.md` (Phase 1)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 1**. ⛔ No RLS/policy changes and the service-role key never leaves server files; present the diff summary when done. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
Two server routes create database rows with the all-powerful service-role key while trusting whatever `user_id` the caller typed into the request. Anyone who can reach the deployed site — no login — can create projects and make any user an admin of them. This phase makes both routes demand the caller's real login token (a JWT — the signed proof-of-login the browser already holds) and take the user identity from that token instead of the request body.

## Scope (and nothing more)
1. **New `src/utils/serverAuth.ts`** — `getUserFromRequest(request)`: read `Authorization: Bearer <token>`, verify via a server-side Supabase client's `auth.getUser(token)`, return the user or a 401-shaped error. Unit-test with `vi.mock('@supabase/supabase-js')`.
2. **`src/app/api/projects/route.js`** — require the token; use the verified user's id for the `project_members` admin row (ignore any body `user_id`); if the member insert fails, best-effort delete the just-created project (no orphans) then return a generic 500; all client-facing errors become generic strings ("Could not create the project."), details to `console.error` only.
3. **`src/app/api/workbench/container/route.ts`** — same treatment (the file's own comment says it mirrors api/projects — keep them mirrored).
4. **Call sites** — `src/app/dashboard/page.jsx` `handleCreateProject`: add `Authorization: Bearer ${session.access_token}` (session comes from `useAuth()`), drop `user_id` from the body. `src/hooks/useWorkbench.ts` `useWorkbenchContainer`: fetch the token via `supabase.auth.getSession()` inside the queryFn, drop the body payload, keep the `userId` param only for `enabled:`.
5. **Route tests** — no/invalid token → 401 with no DB call; valid token → member row uses the token's user id; member-insert failure → cleanup + generic 500.

The token-header convention to copy is `src/services/api.ts` (every FastAPI call already does exactly this).

## Guardrails (from the plan — re-read AGENTS.md yourself)
- ⛔ **No RLS/policy changes, no new grants** — this is app-code auth only. `anon` gets nothing.
- `SUPABASE_SERVICE_ROLE_KEY` stays in `app/api/**` server files only.
- These are online request/response routes — do not involve the offline mutation queue or any status-write path.
- Generic error strings to the client; full errors to server logs only.
- New files are `.ts`. Do not convert `dashboard/page.jsx` to TS in this phase (that's the JS→TS backlog) — make the minimal edit.
- Lint is not a gate; verify with typecheck + test + build (absolute-prefix commands in the plan).

## Exit criteria (Definition of Done)
- Typecheck + test + build green (`npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` / `run test` / `run build`).
- `serverAuth` + both route test files pass; tests import from `'vitest'` (globals are OFF).
- Live click-through on `npm run dev:3010` (from `sitepulse-next/`, port 3010): logged-in project creation works; workbench container resolves; a raw no-token `curl -X POST http://localhost:3010/api/projects` returns 401.
- Close the phase with the **verify-feature** skill, present the diff summary, then **STOP — do not commit or push until the owner says "Approved."**

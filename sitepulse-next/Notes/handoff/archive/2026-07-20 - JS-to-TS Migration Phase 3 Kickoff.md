# Kickoff — JS→TS Migration, Phase 3 (final): dashboard page + the two API routes

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3 of the JS→TS Migration** (the final conversion phase — `app/dashboard/page.jsx` + the two API routes `app/api/projects/route.js` and `app/api/auth/procore/launch/route.js` — to strict TypeScript; 3 files, ~440 lines). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-20 - JS-to-TS Migration Phase 3 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/JS-to-TS-Migration-Plan.md` (Phase 3)
> - `.agent/skills/js-to-ts-conversion/SKILL.md` + `sitepulse-next/AGENTS.md` §6
>
> Branch off `main`, PR through CI. Build **only Phase 3**. ⛔ Zero behavior change **except the one sanctioned edit below** — if the compiler pushes toward any OTHER runtime change, STOP and flag it. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Where the workstream stands
Phases 1 (#17), the flag-cleanup (#18), and 2 (#19) are all merged to `main`. **Re-baseline off current `main`.** After this phase, the ONLY remaining `.jsx` under `src/` is `providers/QueryProvider.jsx`, which is deliberately deferred to the END of W3 (it needs the cache-shape types W3's `useProjectQueries` split will give it) — do NOT touch it here. This phase closes W2.

## Why this phase exists (plain English)
The Projects Dashboard and the two server routes are the last untyped seams: the dashboard reads a joined Supabase query and threads project rows into typed modals; the routes create a project with the service-role key and resolve a Procore deep-link. Typing them makes the join shape, the request body, and the create-flow contract compiler-checked — no change to what the owner sees, save one behavior-identical date-sort rewrite the compiler requires.

## The ONE sanctioned runtime edit (pre-approved)
`app/dashboard/page.jsx:~62` sorts with `new Date(b.projects.created_at) - new Date(a.projects.created_at)`. TS won't subtract `Date`s, so this MUST become `.getTime()` arithmetic:
```ts
.sort((a, b) => new Date(b.projects.created_at ?? 0).getTime() - new Date(a.projects.created_at ?? 0).getTime())
```
`projects.created_at` is `string | null` (verified in `database.types.ts`), and `new Date()` rejects `null` under strict TS — the `?? 0` keeps a null row sorting as epoch-oldest, which is exactly how the old `new Date(null)` coercion already behaved. Behavior-identical; call it out explicitly in the PR. **The same `created_at: string | null` wrinkle also hits the card's `Created on {new Date(project.created_at).toLocaleDateString()}` (~:207)** — guard it the same minimal way (`?? ''` or `?? 0`) and flag it; do not restructure the render.

## Scope — conversion order
1. **`app/api/auth/procore/launch/route.js` → `.ts`** (trivial, ~34 lines, do first). `import { NextResponse, type NextRequest } from 'next/server'`; `export async function GET(request: NextRequest)`. `searchParams.get(...)` is `string | null` (already handled). `.maybeSingle()` types the row as `{ id: string } | null` — the `if (project)` guard already narrows it. Env vars: match the house style in `api/auth/procore/callback/route.ts` — `createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string)`. Auth/redirect semantics stay byte-identical.
2. **`app/api/projects/route.js` → `.ts`** (~72 lines). `export async function POST(request: NextRequest)`. Lean on **`getUserFromRequest`** (`src/utils/serverAuth.ts`) — it's typed `Promise<{ user: User; error: null } | { user: null; error: AuthError }>`, and the existing `const { user, error: authError } = ...; if (authError) return …authError.status` pattern types cleanly (AuthError has `.status`). **Narrow the JSON body**: `const body: unknown = await request.json()`, then a small guard/validation to a `{ name?: string; procore_project_id?: string | null; project_type?: string | null }` shape — `unknown` in, validated out (never let `any` propagate). Env vars: same `as string` house style. The service-role create + member-insert + orphan-cleanup flow (Security P1) stays **byte-identical** — this is auth-critical; Security Hardening owns those checks.
3. **`app/dashboard/page.jsx` → `.tsx`** (~338 lines, the main one). Keep `"use client"`. `useAuth()` is now typed (Phase 1 → `{ session: Session | null }`) — `session?.user?.id` / `session.access_token` need no cast. Typing map:
   - **The embedded select** `project_members.select('role, projects (*)')` — derive the row as `{ role: string; projects: Project | null }` (Supabase types embedded joins loosely; narrow at the query boundary with a guard/assertion, per AGENTS §6 + the plan's §Data model). The **workbench-contamination filter** becomes a **type guard** so downstream sees non-null projects: `data.filter((r): r is { role: string; projects: Project } => !!r.projects && r.projects.kind !== 'workbench')`. Then `projects` state is `Array<{ role: string; projects: Project }>`, so the `.sort` (above) and `p.projects.created_at`/`.id`/`.name` derefs are safe.
   - `useState` types: `projects` (that array), `loading: boolean`, `linkProcoreProject: string | null`, the modal booleans, `newProjectName`/`newProjectType: string`, `creating: boolean`.
   - `handleProjectDeleted(projectId: string)` and `handleProjectUpdated(projectId: string, patch: Partial<Project>)` — these MUST match `GlobalSettingsModal`'s existing props (`onProjectDeleted?: (projectId: string) => void`, `onProjectUpdated?: (projectId: string, patch: Partial<Project>) => void`). `adminProjects = projects.filter(p => p.role === 'admin').map(p => p.projects)` yields `Project[]`, structurally assignable to the modal's `adminProjects: AdminProject[]` (AdminProject is a `Pick<Project, …>` subset) — no change needed there.
   - `handleCreateProject(e: React.FormEvent<HTMLFormElement>)`. Preserve the bearer-token `fetch('/api/projects', …)` create flow byte-identical.

## Guardrails
- ⛔ **Zero behavior change except the sanctioned `.getTime()` date-sort edit** (+ the twin `created_at` null-guards, which are behavior-identical for real rows). Any OTHER compile-forced runtime change → stop and flag.
- AGENTS §6 + skill: derive Supabase shapes from `database.types.ts`/`domain.ts`; narrow `Json`/`unknown` at the boundary; no `any`/`@ts-ignore` end states; no `@ts-nocheck` on main; keep `"use client"`; rename in place.
- **Don't touch** `QueryProvider.jsx`, the offline queue, or the Security-Hardening auth semantics in the routes (byte-identical checks — env `as string` house style, `getUserFromRequest`, service-role flow).
- Existing tests pass unmodified (annotations excepted). Lint is NOT a gate.
- ⚠️ dev:3010 points at PROD Supabase — create-project round-trip writes a REAL project; use a throwaway name and DELETE it after (Global Settings → delete), or verify create via a network-response check without persisting. The Procore launch route can't be exercised locally — typecheck/build + code review are its gate; note it in the report.

## Exit criteria (Definition of Done)
- Triple green: `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` / `run test` / `run build`.
- Grep proof: zero `@ts-nocheck`, no new `any` in the diff, and **`git ls-files 'src/**/*.jsx'` returns ONLY `providers/QueryProvider.jsx`** (W2 complete).
- Live dev:3010: dashboard lists projects · create-project round-trips (POST /api/projects with the bearer token — throwaway project, then delete it) · Global Settings project toggle still patches the dashboard card in place. Note that the Procore launch route is code-review-gated (not locally exercisable).
- Close with the **verify-feature** skill, present the diff summary + any flags, then **STOP — no merge until the owner says "Approved."**

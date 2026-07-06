# Kickoff — Codebase Health, Slice 1 Phase 3: type the global settings modal (`GlobalSettingsModal.jsx → GlobalSettingsModal.tsx`)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3 of Codebase Health Slice 1** (convert
> `src/components/GlobalSettingsModal.jsx → GlobalSettingsModal.tsx`, **behavior-preserving** — no
> runtime change). This is the **final** phase of Slice 1. It's the cross-project admin modal
> (team management, Location/Activity/Cost-Code libraries, admin project-delete, AI-training toggle).
> Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-06 - Codebase Health Slice 1 Phase 3 (GlobalSettingsModal) Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Codebase-Health-Slice-1-Type-Spine-Plan.md` (Phase 3 + guardrails)
> - `sitepulse-next/AGENTS.md` (esp. §6 TypeScript guardrails, §2 state/data-fetching, §4 derive-from-database.types)
>
> Branch off `main`. Build **only Phase 3**. Rename + fix all type errors; type the loosely-initialised
> `useState` (the main hazard) with explicit params, and derive member/profile/project shapes from
> `domain.ts` (`Profile`/`ProjectMember`/`MemberWithProfile`/`Project`) rather than re-inventing them.
> This file is the **least test-covered** of the three, so the `dev:3010` smoke is the primary proof.
> Do **not** refactor invites (C2 premise is stale — type as-is). No `any`, no `@ts-nocheck`. Don't
> commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English goal
`GlobalSettingsModal` is the admin popup opened from the **dashboard** (Global Settings): search a
person and add/remove them from projects with a role, browse the company-wide Location/Activity/
Cost-Code libraries, delete a project (behind a type-the-name guard), and flip a project's
AI-training opt-out. It's still untyped JavaScript. Converting it turns the compiler on for the
admin surface so a future change can't silently mis-wire a member row, a role, or a project. Nothing
you see or do changes.

## Where this sits
Codebase Health → **Slice 1 (type the spine)**, **Phase 3 of 3 (LAST)**: `page.jsx → page.tsx`
(**DONE, merged**) → `StatusTable.jsx → .tsx` (**DONE, merged 817d0c2**) → `GlobalSettingsModal.jsx`
(this). Plan-of-record: `Notes/plans/Codebase-Health-Slice-1-Type-Spine-Plan.md`. The **C1
types-drift audit is committed** (reconciled `database.types.ts` to live), so trust the types.

## What Phases 1 & 2 already settled (build on it, don't re-litigate)
- **The conversion method is proven twice:** rename `.jsx`→`.tsx`, derive prop/state shapes from the
  typed hooks + `database.types.ts`/`domain.ts`, narrow `Json` at the query boundary, cast the rare
  irreconcilable seam narrowly (never `any`, never `@ts-nocheck`), keep JSX byte-identical.
- **`MemberWithProfile`** (`ProjectMember & { profiles: Pick<Profile,'id'|'email'|'display_name'> | null }`)
  is exported from `useProjectQueries.ts`; `Profile`/`ProjectMember`/`Project` live in `domain.ts`.
  Derive the member/role/project shapes from these — do not hand-write a Supabase table shape (AGENTS §6).
- **`MemberRole`** (`'admin' | 'pm' | 'superintendent' | 'viewer'`) is already a domain union; the
  file's role `<select>`/assignments use plain strings — reuse `MemberRole` where it's the role slot.

## Scope — build exactly this
1. **Rename** `src/components/GlobalSettingsModal.jsx → GlobalSettingsModal.tsx`; fix **all** type errors.
2. **Type the props.** Current signature: `{ isOpen, onClose, adminProjects, onProjectDeleted, onProjectUpdated }`.
   Define a `GlobalSettingsModalProps` interface — `isOpen: boolean`, `onClose: () => void`,
   `adminProjects` a project-list shape (derive from `Project`, narrowed to the fields the modal
   actually reads — id/name/ai_training_enabled/…), and the two callbacks. Check the **call site**
   (`ProjectDashboard`/dashboard) for the exact `adminProjects` element shape and callback signatures
   and match them — don't guess.
3. **Type the loosely-initialised `useState` (the main hazard).** These infer `null`/`{}`/`[]` and need
   explicit params (line numbers drift — re-read fresh):
   - `targetUser` → `{ id: string; display_name: string | null; email: string } | null` (the searched profile).
   - `assignments` → `Record<string, { assigned: boolean; role: string; initialAssigned: boolean; initialRole: string; memberId: string | null }>`
     (per-project assign/role staging; use `MemberRole` for the role slot if it stays clean).
   - `saveStatus` / `projectStatus` → `{ type: string; message: string }` (or a tighter `'' | 'success' | 'error'` union if it types cleanly).
   - `confirmProject` → the armed-for-delete project shape `| null` (same element type as `adminProjects`).
   - `trainingOverrides` → `Record<string, boolean>`; `deletingId` / `trainingSavingId` → `string | null`.
   - `globalTeam` → the `profiles` rows the modal selects: `Pick<Profile, 'id' | 'email' | 'display_name'>[]`.
4. **Narrow the raw Supabase reads at the boundary.** This file calls `supabase.from(...).select(...)`
   **directly** (in `useEffect` / handlers) rather than through the typed hooks — that's pre-existing;
   **do NOT refactor it to hooks** (that's Slice 2 territory). Just narrow each `data` result to the
   typed shape at the call boundary (assert/guard the `select`ed columns), so `Json`/`any` never
   reaches state or JSX (AGENTS §6).
5. **Type the event handlers** (`handleSearch(e)`, role-`<select>` `onChange`, checkbox `onChange`,
   the delete-confirm input) — no implicit `any` on `e`.
6. **Behavior unchanged** — type-only. No logic, prop, or data-flow edits (that's Slice 2).

## Seams to mind
- **Sub-panels are already typed** (`LocationLibraryPanel`, `ActivityLibraryPanel`, `CostCodeLibraryPanel`
  are `.tsx`) — reuse their prop types; pass what they declare, don't reshape.
- **Direct `supabase` + `useAuth` + `useQueryClient`** are used inline. `session` from `useAuth` is typed;
  `queryClient.invalidateQueries`/`setQueryData` calls should use the existing `queryKeys` where present.
  Keep the raw-query structure — only add types over it.
- **`deleteProjectService`** from `@/services/api` — check its typed signature and match; don't recast.
- **AI-training toggle** writes `projects.ai_training_enabled` (col is live on prod — see
  [[project-ai-training-optout]]); `trainingOverrides` is the optimistic mirror. Type it, don't rewire it.
- **C2 — invites/team surface:** the C1 audit found the "silent failure on missing `user_email`" premise
  **stale** (`project_members.user_email` exists in prod; invites resolved 2026-06-19). Slice 1 does
  **NOT** refactor invites — type the member/assign flow **as-is**.
- If typing surfaces a genuine latent bug, **fix a small one inline; flag a behavior-affecting one** to
  the owner (as Phase 2 did with the Actual-Completed null-log crash) — don't paper over with a cast or
  silently change behavior.

## Hard guardrails (AGENTS.md — do not violate)
- **No DB/RLS/schema/queue change; no migration.** One file rename + types only.
- Derive types from `database.types.ts` / `domain.ts`; narrow `Json`/raw reads at the boundary (§6);
  **no `any`** (prefer `unknown` + narrowing), **no `@ts-nocheck`** on merge.
- **`use client`:** the file currently has **no directive** and works via its client parent — **preserve
  that**; only add `"use client"` if the conversion/runtime genuinely requires it.
- Never touch the status pipeline / offline queue / `mapDisplayStatuses` (this file doesn't, keep it that way).
- **Vitest globals OFF**; **Lint is NOT a gate** — verify with typecheck + test + build.

## Exit criteria (Definition of Done → then STOP)
- `GlobalSettingsModal.tsx` compiles with **zero** errors; no `@ts-nocheck`, no new `any`.
- `typecheck` + `test` + `build` all green (commands below).
- **Live `dev:3010` (least-covered → primary proof):** open the modal from the dashboard's Global
  Settings, then exercise:
  - each **tab** (Users / Location Library / Activity Library / Cost-Code Library / Projects) renders;
  - **member search** returns a person, and an **assign + role change** stages/saves as before;
  - the **project-delete type-to-confirm guard** arms when you type the name — **then CANCEL, do NOT
    delete a real project** ([[no-live-write-probes]]; ⚠️ dev build points at the PROD database);
  - the **AI-training toggle** reflects/flips a project's opt-out (verify UI; avoid a needless prod write).
- Close with the `verify-feature` skill. **Do not commit or push until the owner says "Approved."**

## Verification commands
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
Lint is NOT a gate. ⚠️ a `next build` corrupts a running `dev:3010` server → restart via
`scripts/restart-dev.ps1`.

## Next after this
Slice 1 is **complete** once this merges — all three spine files (`page`, `StatusTable`,
`GlobalSettingsModal`) are typed. Per the owner's 2026-07-04 resequencing, the next workstream is
**Slice 0 Phase 0.4** (FloorplanCanvas characterization "golden master"; kickoff already drafted at
`handoff/2026-07-04 - Codebase Health Slice 0 Phase 0.4 Kickoff.md`) → then **Slice 2** (decompose
FloorplanCanvas). Consider a short retro line in [[codebase-health-refactor]] when Slice 1 closes.

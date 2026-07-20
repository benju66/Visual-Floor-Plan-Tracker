# Kickoff — JS→TS Migration, Phase 1: AuthProvider + trivial pages + cast-removal components

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of the JS→TS Migration** (convert AuthProvider, the trivial app pages, and the six cast-removal components to strict TypeScript — 10 files, zero behavior change). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-18 - JS-to-TS Migration Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/JS-to-TS-Migration-Plan.md` (Phase 1)
> - `.agent/skills/js-to-ts-conversion/SKILL.md` + `sitepulse-next/AGENTS.md` §6
>
> Branch off `main`, PR through CI. Build **only Phase 1**. ⛔ Zero behavior change — if the compiler forces a runtime edit, STOP and flag it. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
Ten files still speak plain JavaScript, so the compiler can't check what flows through them — and typed code that consumes them papers over the gap with seven explicit "trust me" casts. This phase converts the highest-leverage file first (the login/session provider — its conversion deletes four casts, including a standing rules-violation `as any`), then the trivial pages, then the six small components whose typed prop contracts already exist and just need to move into place.

## Scope — conversion order (blast-radius first)
1. **`src/providers/AuthProvider.jsx` → `.tsx`** — type the context `{ session: Session | null }` (`Session` from `@supabase/supabase-js`; the pattern to copy is `GlobalSettingsModal.tsx:~65`). Then grep `useAuth() as` and delete ALL four consumer casts: `SettingsMenu.tsx:~412` (`as any`), `GlobalSettingsModal.tsx:~65`, `app/workbench/page.tsx:~67`, `app/workbench/[sheetId]/page.tsx:~24`.
2. **`app/page.jsx` → `.tsx`** — rename only (7-line redirect).
3. **`app/layout.js` → `.tsx`** — `children: React.ReactNode`, `Metadata`/`Viewport` from `next`. App Router boundary → `npm run build` is mandatory this phase.
4. **`app/login/page.jsx` → `.tsx`** — `React.FormEvent`, `useState<string | null>` for the error; the Procore button just navigates to `/api/auth/procore/start` (Security P3) — don't touch the flow.
5. **`ConfirmModal.jsx` → `.tsx`** — import the existing `ConfirmModal` interface from `src/store/useUIStore.ts`; do not redeclare it.
6. **`AddLevelModal.jsx` → `.tsx`** — small props interface; `e.target.files` is `FileList | null`.
7. **`QuickActivityModal.jsx` → `.tsx`** — call-site contract is annotated in `app/project/[projectId]/page.tsx`; `selectedActivityId` actually holds a NAME — type it `string | null` honestly, FLAG the misnomer, don't rename. Keep the `activity.color || activity.status_color` fallback even if the type says one branch is dead (flag it).
8. **`QuickStatusModal.jsx` → `.tsx`** — same pattern; `TemporalState` from `domain.ts`, `CommitStatusExtraProps` from `src/types/mutations`; keep the W1 resync `useEffect` byte-identical.
9. **`UnitNamingPopover.jsx` → `.tsx`** — MOVE `UnitNamingPopoverProps` from `page.tsx` (~:50–63) into the component, import it back at the page, delete the `as unknown as React.FC` cast (~:65). `TaxonomyResult` + refs (`HTMLInputElement`/`HTMLButtonElement`). Its test (`UnitNamingPopover.test.tsx`) must pass unmodified.
10. **`ActivityCommandMenu.jsx` → `.tsx`** — MOVE `ActivityCommandMenuProps` from `page.tsx` (~:66–74) in, delete the cast (~:75), and implement the plan's decided union: `onSelect: (pick: Activity | { isClearAction: true; name: string; color: string }) => void` — the page handler narrows on `isClearAction`; runtime behavior identical.

## Guardrails
- ⛔ **Zero behavior change.** Conversions only; discovered bugs/smells go in the phase report as flags. The compiler pushing toward a runtime edit = stop and ask.
- AGENTS §6 + skill: derive shapes from `domain.ts`/`database.types.ts`; narrow, don't cast; no `any`/`@ts-ignore` end states; no `@ts-nocheck` on main; keep `"use client"`; rename in place.
- Don't touch `QueryProvider.jsx` (deferred to W3-end), the offline queue, or any Phase 2/3 file.
- Existing tests pass unmodified (type annotations inside tests excepted).
- ⚠️ dev:3010 points at PROD Supabase — click-through with throwaway data only; delete what you create.

## Exit criteria (Definition of Done)
- Triple green: `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` / `run test` / `run build`.
- Grep proof: zero `useAuth() as`, zero `as unknown as React.FC`, zero `@ts-nocheck`, no new `any`.
- Live dev:3010 click-through: log in → open a project → trace/name a location via the popover → open the activity command menu (pick + clear) → both quick modals open/commit/reset.
- Close with the **verify-feature** skill, present the diff summary + any flags, then **STOP — no merge until the owner says "Approved."**

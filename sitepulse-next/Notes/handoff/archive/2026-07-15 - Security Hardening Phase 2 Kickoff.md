# Kickoff — Security Hardening, Phase 2: One role vocabulary + prod backfill

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of Security Hardening** (make `'superintendent'` the one stored value for that role, keep `'sub'` as a recognized view-only value, and backfill the drifted `'super'` rows). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-15 - Security Hardening Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Security-Hardening-Plan.md` (Phase 2)
> - `sitepulse-next/AGENTS.md`
>
> Build **only Phase 2**. ⛔ No RLS/policy changes and no new grants — this is an app-code sweep plus one gated data backfill. Present the diff summary AND the audit-SELECT counts before doing anything to prod. Don't commit, push, or run the backfill UPDATE until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
A superintendent added from the **Team tab** is saved under a misspelled role value (`'super'`) that the database's permission rules don't recognize — so they silently get no superintendent powers. The rest of the app (RLS policies, Global Settings, the header gates) already uses the correct value `'superintendent'`. This phase makes the Team tab write the correct value, teaches the app one shared list of role names, and (with your explicit go-ahead) fixes the existing mis-saved rows in the live database. The `'sub'` (Subcontractor) value stays selectable but view-only, so any assignments made now survive the future Subcontractor buildout.

## Scope (and nothing more)
1. **New `src/utils/roles.ts`** — framework-free constants + helpers, `roles.test.ts` alongside:
   - `ROLES` (the canonical set) and an ordered `ROLE_OPTIONS` for dropdowns, each `{ value, label }`, with the subcontractor label reading **"Subcontractor (view-only)"**.
   - `isPrivilegedRole(role)` mirroring the RLS `('owner','admin','pm')` set exactly.
   - `normalizeLegacyRole(role)` — `'super' → 'superintendent'`, everything else pass-through — so stale cached rows render correctly **before** the backfill runs.
2. **`src/types/domain.ts`** — `MemberRole = 'owner' | 'admin' | 'pm' | 'superintendent' | 'sub' | 'viewer'` (adds the two real-world values that were missing; `'sub'` documented view-only, `'owner'` was missing entirely).
3. **`SettingsMenu.tsx` Team tab** (the two role `<select>`s, ~lines 1210–1328) — render options from `ROLE_OPTIONS` (so the old `'super'` option now writes `'superintendent'`, `'sub'` keeps the "(view-only)" label); display of each `member.role` goes through `normalizeLegacyRole`.
4. **`TopHeader.tsx` (three `!== 'superintendent'` gates) + `SettingsMenu.tsx` `canEdit` (~:898)** — compare against the constants and apply `normalizeLegacyRole` where `currentUserRole` is read, so a not-yet-backfilled `'super'` row is treated as a superintendent immediately. Behavior is unchanged for the canonical values.
5. **⛔ Prod backfill (STOP for approval, two-step):**
   - First run the **audit SELECT** — `SELECT role, count(*) FROM project_members GROUP BY role;` — and show the owner the counts. If any value beyond `'super'`/`'sub'`/canonical appears, **STOP and surface it** (plan § Open decisions).
   - Then present the exact SQL — `UPDATE project_members SET role = 'superintendent' WHERE role = 'super';` — via the create-migration skill conventions and **STOP until the owner approves running it.** `'sub'` rows are **NOT** touched.

## Guardrails (from the plan — re-read AGENTS.md yourself)
- ⛔ **No RLS/policy changes, no new grants.** The app-code sweep is behavior-preserving for canonical values; the only new behavior is `'super'` rows now reading as superintendents.
- Never run writes against prod without the explicit go-ahead (standing rule: no live-write probes). The audit SELECT is read-only and fine; the UPDATE is gated.
- New files are `.ts`. Don't convert `SettingsMenu.tsx`/`TopHeader.tsx` further than the surgical edits.
- Lint is not a gate; verify with typecheck + test + build (absolute-prefix commands in the plan).
- The `MemberRole` type must stay derived-consistent with reality; don't reintroduce a hand-written role union elsewhere.

## Exit criteria (Definition of Done)
- Typecheck + test + build green (the `npm --prefix …` commands in the plan).
- `roles.test.ts` pins the `ROLE_OPTIONS` list (values + labels, incl. "Subcontractor (view-only)"), `isPrivilegedRole`, and `normalizeLegacyRole` (`'super' → 'superintendent'`, pass-through otherwise).
- Live `dev:3010` click-through: the Team tab shows the new labels; changing a member to Superintendent stores `'superintendent'` (verify in the network tab / a dev-DB row — do NOT clobber real data).
- Present the audit-SELECT counts + the backfill SQL and **STOP** — no commit, no push, no UPDATE until the owner says "Approved."
- Close the phase with the **verify-feature** skill.

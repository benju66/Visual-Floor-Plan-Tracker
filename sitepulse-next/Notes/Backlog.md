# Backlog — deferred items

Known issues and follow-ups intentionally deferred. Each entry: what, impact, options, and where it lives.

---

## 1. `project_members.user_email` — invite-by-email is broken in prod
**Logged:** 2026-06-17 · **Priority:** medium (a user-facing feature silently fails) · **Status:** deferred

**What:** `src/types/database.types.ts` declares `project_members.user_email`, and code reads/writes it, but the column **does not exist in the live database**. So the **SettingsMenu → Team tab "Invite Member" (by email)** path fails at runtime when it inserts `{ project_id, user_email, role }`.

**Why it's only "sometimes" visible:** there are two parallel invite mechanisms.
- `GlobalSettingsModal` (dashboard → Global Settings → User Management) invites by **`user_id`** — looks up an existing user, requires they've already signed up. **Works.**
- `SettingsMenu` (project Settings → Team) invites by **`user_email`** — stores email, no `user_id`. **Broken.**

**Affected code:** `src/components/SettingsMenu.tsx` (~L1023/1024/1043 read; ~L1071 insert); `src/components/manage/assignee.ts` (reads `m.user_email` as a label fallback — degrades gracefully).

**Options to resolve:**
1. **Add the column** — additive migration `ALTER TABLE project_members ADD COLUMN IF NOT EXISTS user_email text;`. Quickest unblock, no code change. Enables "invite before signup," but rows with a null `user_id` then need link-on-signup logic (not obviously built yet).
2. **Consolidate on the working path** — refactor the SettingsMenu invite to look up `user_id` like `GlobalSettingsModal` does, then drop `user_email` from the types. One consistent mechanism, no migration; keeps the "must sign up first" limitation.

**Context:** found during the 2026-06-17 types-vs-live audit that also fixed `units.assigned_to` (added column), `projects.procore_company_id`, and `profiles` (commit `7d6b223`). Note: `src/types/database.types.ts` is hand-maintained and drifts from the live schema — worth a periodic re-audit.

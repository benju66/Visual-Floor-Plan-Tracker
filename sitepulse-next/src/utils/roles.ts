import type { MemberRole } from '@/types/domain';

// The one place the app names project-member roles. Ground truth as of 2026-07-15:
// RLS policies check `role IN ('owner','admin','pm')` for privileged writes;
// `create_new_project` assigns `'owner'`; the Team tab historically wrote a
// misspelled `'super'` that the DB permission rules don't recognize (see
// `normalizeLegacyRole`). `'sub'` (Subcontractor) is a recognized, view-only value
// today — the capability buildout is a future workstream.

/** Every recognized role value (`'owner'` is granted only at project creation). */
export const ROLES = ['owner', 'admin', 'pm', 'superintendent', 'sub', 'viewer'] as const satisfies readonly MemberRole[];

/** The roles RLS treats as privileged for writes — a mirror of `('owner','admin','pm')`. */
const PRIVILEGED_ROLES: readonly string[] = ['owner', 'admin', 'pm'];

/**
 * True when `role` is one the RLS policies admit for privileged writes
 * (`owner`/`admin`/`pm`). Null/undefined (a loading role query) is not privileged.
 */
export function isPrivilegedRole(role: string | null | undefined): boolean {
  return role != null && PRIVILEGED_ROLES.includes(role);
}

/**
 * Normalize a stored role for display and gating. The Team tab used to write the
 * misspelled `'super'`; map it to the canonical `'superintendent'` so a row that
 * hasn't been backfilled yet still renders and gates as a superintendent.
 * Everything else — including `null`/`undefined` while a role query is loading —
 * passes through unchanged.
 */
export function normalizeLegacyRole(role: string | null | undefined): string | null | undefined {
  return role === 'super' ? 'superintendent' : role;
}

/** An option for the Team-tab role dropdowns. */
export interface RoleOption {
  value: MemberRole;
  label: string;
}

/**
 * The assignable roles for the Team-tab dropdowns, in display order. `'owner'` is
 * intentionally omitted — it's granted only at project creation, never reassigned
 * from the roster. `'sub'` is selectable but VIEW-ONLY today; the label says so.
 */
export const ROLE_OPTIONS: readonly RoleOption[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'pm', label: 'Project Manager' },
  { value: 'superintendent', label: 'Superintendent' },
  { value: 'sub', label: 'Subcontractor (view-only)' },
  { value: 'viewer', label: 'Viewer' },
];

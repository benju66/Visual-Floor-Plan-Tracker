// Pure, dependency-free helpers for the project-member invite flow.
// Kept out of the API route so the validation logic stays unit-testable
// (see invite.test.ts) without spinning up a Supabase client.

/**
 * Roles an admin may assign when inviting someone. Mirrors the SettingsMenu
 * invite dropdown. 'owner' is intentionally excluded — it is reserved for the
 * project creator and must not be assignable via invite.
 */
export const ASSIGNABLE_INVITE_ROLES = ['admin', 'pm', 'super', 'sub', 'viewer'] as const;
export type AssignableInviteRole = (typeof ASSIGNABLE_INVITE_ROLES)[number];

/**
 * Roles allowed to SEND invites. Matches the project_members insert RLS policy
 * ("Privileged members can insert members": owner/admin/pm).
 */
export const INVITER_ROLES = ['owner', 'admin', 'pm'] as const;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// Pragmatic email check — not RFC-perfect, just rejects obvious garbage.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

export function isAssignableRole(role: unknown): role is AssignableInviteRole {
  return typeof role === 'string' && (ASSIGNABLE_INVITE_ROLES as readonly string[]).includes(role);
}

export interface InvitePayload {
  project_id: string;
  email: string;
  role: AssignableInviteRole;
}

export type InviteValidationResult =
  | { ok: true; value: InvitePayload }
  | { ok: false; error: string };

/**
 * Validates + normalizes the raw invite request body. Returns the cleaned
 * payload on success (email lower-cased/trimmed) or a human-readable error.
 */
export function validateInvitePayload(input: {
  project_id?: unknown;
  email?: unknown;
  role?: unknown;
}): InviteValidationResult {
  if (typeof input.project_id !== 'string' || input.project_id.trim() === '') {
    return { ok: false, error: 'Missing project_id.' };
  }
  if (typeof input.email !== 'string') {
    return { ok: false, error: 'Missing email.' };
  }
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }
  if (!isAssignableRole(input.role)) {
    return { ok: false, error: 'Invalid role.' };
  }
  return { ok: true, value: { project_id: input.project_id.trim(), email, role: input.role } };
}

/** Extracts a bearer token from an Authorization header, or '' if absent/malformed. */
export function parseBearerToken(authHeader: string | null | undefined): string {
  if (!authHeader) return '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match ? match[1].trim() : '';
}

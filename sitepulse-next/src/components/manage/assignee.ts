/**
 * Pure helpers for resolving a location's assignee (`units.assigned_to`, a user id)
 * against the project roster (`useProjectMembers`, keyed by `user_id`). Framework-free
 * and unit-tested; the UI (AssigneeCell / picker) is a thin layer over these.
 */

/** Structural shape of a `useProjectMembers` row (project_members + joined profile). */
export interface MemberLike {
  user_id: string | null;
  user_email?: string | null;
  profiles?: { display_name?: string | null; email?: string | null } | null;
}

export interface AssigneeOption {
  id: string;
  label: string;
  sublabel?: string;
}

/** Best human label for a member: display name → member email → profile email → fallback. */
export function memberLabel(m: MemberLike): string {
  return (
    m.profiles?.display_name?.trim() ||
    m.user_email?.trim() ||
    m.profiles?.email?.trim() ||
    'Member'
  );
}

/** Roster → picker options (sorted by label, case-insensitive). Members without a user id are skipped. */
export function memberOptions(members: MemberLike[]): AssigneeOption[] {
  return members
    .flatMap((m) =>
      m.user_id ? [{ id: m.user_id, label: memberLabel(m), sublabel: m.user_email ?? m.profiles?.email ?? undefined }] : []
    )
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

/** Resolve the option for a unit's `assigned_to`; unknown ids resolve to an "Unknown" label. */
export function resolveAssignee(members: MemberLike[], assignedTo: string | null | undefined): AssigneeOption | null {
  if (!assignedTo) return null;
  const m = members.find((x) => x.user_id === assignedTo);
  return { id: assignedTo, label: m ? memberLabel(m) : 'Unknown' };
}

/** 1–2 letter initials for an avatar chip. */
export function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

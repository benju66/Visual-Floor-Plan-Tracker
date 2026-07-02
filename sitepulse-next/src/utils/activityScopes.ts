import type { ActivityScope, ActivityScopeStatus } from '@/types/domain';

/**
 * Pure helpers for the managed "scopes of work" palette (Scheduling UX Hardening).
 *
 * Scopes are a small curated global list (`activity_scopes`) that the pickers draw
 * from and the Activity Library groups/filters by. They link to activities BY NAME
 * (`activity_dictionary.track` / `activities.track` stay plain text), so these
 * helpers reason over plain strings — never the status/progress pipeline. Framework-
 * free + deterministic (no `Date.now()`), unit-tested alongside this file.
 */

/** One entry in the scope filter/manage row. `id === null` ⇒ an "unmanaged" scope: a
 *  track string still used by an activity but not (or no longer) in the palette. */
export interface ScopeChip {
  id: string | null;
  name: string;
  managed: boolean;
  status: ActivityScopeStatus | null;
  /** How many of the passed activity tracks fall under this scope. */
  count: number;
}

/** Trim + drop empties, counting how many times each scope name is used. */
export function countScopeUsage(entryTracks: readonly (string | null | undefined)[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of entryTracks) {
    const name = (t ?? '').trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

/**
 * Build the ordered scope row shown above the activity list: every ACTIVE managed
 * scope first (in the palette's given order, even with zero activities), then any
 * "unmanaged" scope names still used by an activity but absent from the active
 * palette (alphabetical). Each carries a usage count so the UI can show it and offer
 * an "add to list" affordance for the unmanaged ones.
 */
export function buildScopeChips(
  scopes: readonly ActivityScope[],
  entryTracks: readonly (string | null | undefined)[],
): ScopeChip[] {
  const counts = countScopeUsage(entryTracks);
  const chips: ScopeChip[] = [];
  const seen = new Set<string>();

  for (const s of scopes) {
    if (s.status !== 'active') continue;
    chips.push({
      id: s.id,
      name: s.name,
      managed: true,
      status: 'active',
      count: counts.get(s.name) ?? 0,
    });
    seen.add(s.name);
  }

  const unmanaged = [...counts.keys()].filter((n) => !seen.has(n)).sort((a, b) => a.localeCompare(b));
  for (const name of unmanaged) {
    chips.push({ id: null, name, managed: false, status: null, count: counts.get(name) ?? 0 });
  }

  return chips;
}

/** Active managed scope names in palette order — the suggestion source for pickers. */
export function activeScopeNames(scopes: readonly ActivityScope[]): string[] {
  return scopes.filter((s) => s.status === 'active').map((s) => s.name);
}

/** Case-insensitive "is this name already in the palette?" (any status). */
export function scopeExists(scopes: readonly ActivityScope[], name: string): boolean {
  const needle = name.trim().toLowerCase();
  return scopes.some((s) => s.name.trim().toLowerCase() === needle);
}

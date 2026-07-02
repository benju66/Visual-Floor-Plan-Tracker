/**
 * Activity Library admin helpers — pure list logic for the global Activity Dictionary
 * manager (Scheduling UX Hardening, Phase 3). The manager filters/groups the FULL
 * dictionary (every status), unlike the schedule pickers which only show `active`
 * entries. Framework-free and deterministic — mirrors `filterSubtypesForAdmin` /
 * `groupSubtypesByRole` in `src/utils/subtypes.ts`.
 */
import type { ActivityDictionaryEntry, ActivityDictionaryStatus } from '@/types/domain';

/** The admin list's status filter — `'all'` plus the three real statuses. */
export type ActivityAdminStatusFilter = 'all' | ActivityDictionaryStatus;

/** Label shown for the group of entries with no default-scope (`track`) tag. */
export const NO_SCOPE_LABEL = 'No default scope';

/**
 * Filter the dictionary for the admin list: by status (`'all'` keeps every status) and
 * by a free-text query matched case-insensitively against the activity name OR any of
 * its aliases (so searching a synonym finds its canonical home). Pure — never mutates.
 */
export function filterActivitiesForAdmin(
  entries: ActivityDictionaryEntry[],
  status: ActivityAdminStatusFilter,
  query: string,
): ActivityDictionaryEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => {
    if (status !== 'all' && e.status !== status) return false;
    if (!q) return true;
    if (e.name.toLowerCase().includes(q)) return true;
    return e.aliases.some((a) => a.toLowerCase().includes(q));
  });
}

/**
 * Bucket entries by their default-scope (`track`) tag, so the manager can show each tag's
 * activities together (and make a bad tag obvious). Named tracks come first alphabetically;
 * the untagged bucket (empty/whitespace `track`) is labelled {@link NO_SCOPE_LABEL} and
 * sorts LAST. Items within a group sort by name. Pure — never mutates the input.
 */
export function groupActivitiesByTrack(
  entries: ActivityDictionaryEntry[],
): { track: string; label: string; items: ActivityDictionaryEntry[] }[] {
  const byTrack = new Map<string, ActivityDictionaryEntry[]>();
  for (const e of entries) {
    const key = (e.track || '').trim();
    const arr = byTrack.get(key);
    if (arr) arr.push(e);
    else byTrack.set(key, [e]);
  }
  const named = [...byTrack.keys()].filter((k) => k !== '').sort((a, b) => a.localeCompare(b));
  const order = byTrack.has('') ? [...named, ''] : named;
  return order.map((track) => ({
    track,
    label: track === '' ? NO_SCOPE_LABEL : track,
    items: [...(byTrack.get(track) ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

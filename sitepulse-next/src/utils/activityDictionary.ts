/**
 * Activity dictionary — pure helpers for the global governed activity dictionary
 * (Scheduling Foundation, Slice A, Phase 2).
 *
 * Framework-free and deterministic (no DB, no React, no `Date.now()`). This is the
 * scheduling counterpart of `src/utils/subtypes.ts` (the location sub-type dictionary)
 * and MIRRORS its shape: JSONB narrowing at the query boundary, alias-aware
 * resolution/search, `default_project_types` ordering, and a non-blocking
 * "Other (pending)" propose path. The TanStack Query hooks that read/propose entries
 * live in `src/hooks/useActivityDictionary.ts` and import the narrowing helper here.
 *
 * The generic alias-list append (`addAliasToList`) is REUSED from `subtypes.ts`
 * (a pure, tested list helper) rather than re-implemented — see `useActivityDictionary`.
 */
import type { Database } from '@/types/database.types';
import { isStringArray, isProjectTypeArray } from '@/types/domain';
import type {
  ActivityDictionaryEntry,
  ActivityDictionaryStatus,
  ActivityType,
  ProjectType,
} from '@/types/domain';

type ActivityDictionaryRow = Database['public']['Tables']['activity_dictionary']['Row'];

/** Sentinel entry name for "no fit yet" — the non-blocking governance escape hatch. */
export const PENDING_ACTIVITY_NAME = 'Other (pending)';

/**
 * Narrow a raw `activity_dictionary` row to the domain {@link ActivityDictionaryEntry}:
 * the two JSONB columns (`aliases`, `default_project_types`) are typed `Json` by the
 * Supabase generator and must be narrowed at the query boundary (AGENTS.md §6). Malformed
 * values degrade to `[]` rather than throwing, so a bad dictionary row can never crash a
 * picker. Mirrors `narrowSubtypeRow`.
 */
export function narrowActivityDictionaryRow(row: ActivityDictionaryRow): ActivityDictionaryEntry {
  return {
    ...row,
    aliases: isStringArray(row.aliases) ? row.aliases : [],
    default_project_types: isProjectTypeArray(row.default_project_types) ? row.default_project_types : [],
  };
}

/**
 * Canonicalize a free-typed activity name to its dictionary entry, matching the
 * canonical `name` OR any `alias`, case-insensitively (trimmed). This is the core of
 * "'MEP Rough-In' and 'Rough-Ins' resolve to the same thing": both spellings, if one
 * is an alias of the other's entry, resolve to the SAME entry.
 *
 * Only `active` entries are considered (the pending sentinel and deprecated entries are
 * never a canonicalization target). Returns `null` when nothing matches — the caller then
 * offers the non-blocking propose path. Pure — no DB, no `Date`.
 */
export function resolveActivityByName(
  dict: ActivityDictionaryEntry[],
  name: string | null | undefined,
): ActivityDictionaryEntry | null {
  const needle = (name ?? '').trim().toLowerCase();
  if (!needle) return null;
  for (const entry of dict) {
    if (entry.status !== 'active') continue;
    if (entry.name.trim().toLowerCase() === needle) return entry;
    if (entry.aliases.some(a => a.trim().toLowerCase() === needle)) return entry;
  }
  return null;
}

/** Best (lowest) match rank of `q` in one text: 0 exact, 1 prefix, 2 substring, or null. */
function matchRank(text: string, q: string): number | null {
  const t = text.trim().toLowerCase();
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (t.includes(q)) return 2;
  return null;
}

/**
 * Rank a dictionary against a free-text query, matching across the canonical `name`
 * AND every `alias` (so typing a synonym surfaces its canonical entry). Best tier wins:
 * exact > prefix > substring; non-matches are dropped. Stable within a tier (preserves
 * input order), so pass the list pre-ordered. A blank query returns a copy unchanged
 * (the caller shows its normal list). Does NOT filter by `status` — compose with a
 * status filter (pickers show only `active`). Pure — no DB, no `Date`.
 */
export function searchActivityDictionary(
  dict: ActivityDictionaryEntry[],
  query: string,
): ActivityDictionaryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...dict];
  const scored: { e: ActivityDictionaryEntry; rank: number; i: number }[] = [];
  dict.forEach((e, i) => {
    let best: number | null = matchRank(e.name, q);
    for (const a of e.aliases) {
      const r = matchRank(a, q);
      if (r !== null && (best === null || r < best)) best = r;
    }
    if (best !== null) scored.push({ e, rank: best, i });
  });
  scored.sort((a, b) => a.rank - b.rank || a.i - b.i);
  return scored.map(x => x.e);
}

/**
 * Order the dictionary for a project type's pick-list: defaults first (entries whose
 * `default_project_types` includes this project type), then everything else — stable
 * within each group. NEVER restricts (all remain available; project type only scopes
 * ordering), mirroring `subtypesForProjectType`. `projectType === null` (a project with
 * no type set yet) keeps natural order. Pure.
 */
export function activitiesForProjectType(
  projectType: ProjectType | null,
  dict: ActivityDictionaryEntry[],
): ActivityDictionaryEntry[] {
  if (projectType == null) return [...dict];
  const defaults: ActivityDictionaryEntry[] = [];
  const rest: ActivityDictionaryEntry[] = [];
  for (const entry of dict) {
    if (entry.default_project_types.includes(projectType)) defaults.push(entry);
    else rest.push(entry);
  }
  return [...defaults, ...rest];
}

/**
 * The outcome of an activity dictionary pick in the editor: either an existing
 * dictionary entry was chosen, or the user is proposing a brand-new "Other (pending)"
 * entry (a free-typed name). Mirrors the sub-type picker's `TaxonomyResult`.
 */
export type ActivityPickResult =
  | { kind: 'entry'; dictionaryId: string; name: string; track: string | null; type: ActivityType }
  | { kind: 'pending'; name: string; track: string | null };

/**
 * The fields an activity editor persists from a dictionary pick: the canonical `name`,
 * the `dictionary_id` link (or `null` when the propose write was denied), plus the
 * dictionary's suggested default `track` and `type` (the caller may use or ignore them —
 * project-specific bits stay editable on the activity itself).
 */
export interface ActivityDictionaryFields {
  name: string;
  dictionary_id: string | null;
  track: string | null;
  type: ActivityType;
}

/**
 * Resolve an {@link ActivityPickResult} into the fields to persist on a project activity.
 *
 * For an existing entry this is a pure mapping. For an "Other (pending)" proposal it calls
 * `proposePending` to create/reuse a `status='pending'` dictionary row and links to it. If
 * that write is denied (RLS — a non-privileged member) it degrades gracefully: the free-typed
 * name is still recorded with `dictionary_id = null`, so the save is NEVER blocked and the
 * activity lands in the review queue (dictionary_id IS NULL) — exactly like a backfilled
 * unlinked activity. Mirrors `taxonomyResultToUnitFields`. Pass timestamps in via the hook.
 */
export async function activityPickToFields(
  result: ActivityPickResult,
  proposePending: (vars: { name: string; note: string }) => Promise<ActivityDictionaryEntry>,
): Promise<ActivityDictionaryFields> {
  if (result.kind === 'entry') {
    return { name: result.name, dictionary_id: result.dictionaryId, track: result.track, type: result.type };
  }
  try {
    const entry = await proposePending({ name: result.name, note: result.name });
    return {
      name: entry.name,
      dictionary_id: entry.id,
      track: entry.track,
      type: (entry.type as ActivityType) ?? 'task',
    };
  } catch {
    return { name: result.name, dictionary_id: null, track: result.track, type: 'task' };
  }
}

/** The admin list's status filter — `'all'` plus the three real statuses (mirror of the sub-type admin). */
export type ActivityAdminStatusFilter = 'all' | ActivityDictionaryStatus;

/**
 * Filter the dictionary for an admin/review list: by status (`'all'` keeps every status)
 * and by a free-text query matched case-insensitively against the entry name OR any of its
 * aliases (so searching a synonym finds its canonical home). Pure — never mutates the input.
 * Mirrors `filterSubtypesForAdmin` (used by the Phase-3 Schedule-view management surface).
 */
export function filterActivityDictionaryForAdmin(
  dict: ActivityDictionaryEntry[],
  status: ActivityAdminStatusFilter,
  query: string,
): ActivityDictionaryEntry[] {
  const q = query.trim().toLowerCase();
  return dict.filter(e => {
    if (status !== 'all' && e.status !== status) return false;
    if (!q) return true;
    if (e.name.toLowerCase().includes(q)) return true;
    return e.aliases.some(a => a.toLowerCase().includes(q));
  });
}

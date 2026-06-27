/**
 * Sub-type dictionary — pure helpers for the Phase-3 taxonomy pickers.
 *
 * Framework-free and deterministic (no DB, no React). The TanStack Query hooks
 * that read/propose sub-types live in `src/hooks/useSubtypes.ts` and import the
 * narrowing helper here; the pickers import the ordering/grouping helpers. Kept
 * separate from the hooks so the load-bearing JSONB narrowing + pick-list order
 * are unit-tested in isolation (AGENTS.md §9).
 */
import type { Database } from '@/types/database.types';
import type { Subtype, SubtypeStatus, TopLevelRole, ProjectType } from '@/types/domain';
import { isStringArray, isProjectTypeArray } from '@/types/domain';
import { CANONICAL_ROLES, subtypesForProjectType } from '@/utils/locationTaxonomy';

type SubtypeRow = Database['public']['Tables']['subtypes']['Row'];

/**
 * Narrow a raw `subtypes` row to the domain {@link Subtype}: the two JSONB
 * columns (`aliases`, `default_project_types`) are typed `Json` by the Supabase
 * generator and must be narrowed at the query boundary (AGENTS.md §6). Malformed
 * values degrade to `[]` rather than throwing, so a bad dictionary row can never
 * crash a picker.
 */
export function narrowSubtypeRow(row: SubtypeRow): Subtype {
  return {
    ...row,
    aliases: isStringArray(row.aliases) ? row.aliases : [],
    default_project_types: isProjectTypeArray(row.default_project_types) ? row.default_project_types : [],
  };
}

/**
 * The outcome of a taxonomy picker: either an existing dictionary sub-type was
 * chosen, or the user is proposing a brand-new "Other (pending)" entry (a short
 * name under a chosen canonical role).
 */
export type TaxonomyResult =
  | { kind: 'subtype'; subtypeId: string; name: string; role: TopLevelRole }
  | { kind: 'pending'; role: TopLevelRole; name: string };

/** The three location columns a taxonomy pick writes. */
export interface TaxonomyUnitFields {
  /** Kept in sync with the chosen sub-type name for milestone-applicability back-compat. */
  unit_type: string;
  top_level_role: TopLevelRole;
  subtype_id: string | null;
}

/**
 * Resolve a {@link TaxonomyResult} into the unit field updates to persist.
 *
 * For an existing sub-type this is a pure mapping. For an "Other (pending)"
 * proposal it calls `proposePending` to create/reuse a `status='pending'`
 * dictionary row and points the unit at it. If that write is denied (RLS —
 * a non-privileged member) it degrades gracefully: the role + free-typed name
 * are still recorded with `subtype_id = null`, so the save is never blocked and
 * the unit lands in the review queue (role set, sub-type unassigned) exactly
 * like a backfilled legacy row.
 */
export async function taxonomyResultToUnitFields(
  result: TaxonomyResult,
  proposePending: (vars: { name: string; role: TopLevelRole; note: string }) => Promise<Subtype>,
): Promise<TaxonomyUnitFields> {
  if (result.kind === 'subtype') {
    return { unit_type: result.name, top_level_role: result.role, subtype_id: result.subtypeId };
  }
  try {
    const subtype = await proposePending({ name: result.name, role: result.role, note: result.name });
    return {
      unit_type: subtype.name,
      top_level_role: subtype.top_level_role as TopLevelRole,
      subtype_id: subtype.id,
    };
  } catch {
    return { unit_type: result.name, top_level_role: result.role, subtype_id: null };
  }
}

/**
 * Group the dictionary's selectable (`status === 'active'`) sub-types by their
 * canonical role, in canonical role order, with each role's list ordered
 * defaults-first for the given project type (reusing {@link subtypesForProjectType}).
 *
 * `projectType === null` (a project with no type set yet) keeps the dictionary's
 * natural order — the picker shows the full list and nudges the owner to set a
 * project type for tailored ordering; it never restricts or blocks.
 */
export function orderedSubtypesByRole(
  subtypes: Subtype[],
  projectType: ProjectType | null,
): Record<TopLevelRole, Subtype[]> {
  const active = subtypes.filter(s => s.status === 'active');
  // Adapt snake_case → the camelCase field subtypesForProjectType orders on; the
  // result still satisfies Subtype (it only adds a field), so reuse the canonical
  // orderer instead of forking the defaults-first logic.
  const adapted = active.map(s => ({ ...s, defaultProjectTypes: s.default_project_types }));
  const ordered: Subtype[] = projectType ? subtypesForProjectType(projectType, adapted) : adapted;

  const groups: Record<TopLevelRole, Subtype[]> = { program: [], common: [], support: [], other: [] };
  for (const subtype of ordered) {
    const role = subtype.top_level_role as TopLevelRole;
    if ((CANONICAL_ROLES as readonly string[]).includes(role)) groups[role].push(subtype);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Phase-4 dictionary-admin helpers (pure — the admin panel filters/groups the
// full dictionary, unlike the pickers which only ever show `active` entries).
// ---------------------------------------------------------------------------

/** The admin list's status filter — `'all'` plus the three real statuses. */
export type AdminStatusFilter = 'all' | SubtypeStatus;

/**
 * Append an alias name to a sub-type's `aliases[]`, immutably. Trims the input;
 * a blank or already-present (case-insensitive) name is a no-op that returns a
 * copy unchanged — so re-adding "Laboratory" to a row that already lists it
 * never duplicates. The DB column is `aliases JSONB`; this computes the next
 * value the {@link Subtype} write should persist.
 */
export function addAliasToList(aliases: readonly string[], name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return [...aliases];
  const exists = aliases.some(a => a.toLowerCase() === trimmed.toLowerCase());
  return exists ? [...aliases] : [...aliases, trimmed];
}

/**
 * Filter the dictionary for the admin list: by status (`'all'` keeps every
 * status) and by a free-text query matched case-insensitively against the
 * sub-type name OR any of its aliases (so searching a synonym finds its
 * canonical home). Pure — never mutates the input.
 */
export function filterSubtypesForAdmin(
  subtypes: Subtype[],
  status: AdminStatusFilter,
  query: string,
): Subtype[] {
  const q = query.trim().toLowerCase();
  return subtypes.filter(s => {
    if (status !== 'all' && s.status !== status) return false;
    if (!q) return true;
    if (s.name.toLowerCase().includes(q)) return true;
    return s.aliases.some(a => a.toLowerCase().includes(q));
  });
}

/**
 * Bucket sub-types into the 4 canonical roles in canonical order, preserving
 * the input order within each role and keeping EVERY status (unlike
 * {@link orderedSubtypesByRole}, which the pickers use to drop non-active rows).
 * Rows with an unrecognised role are skipped rather than crashing the panel.
 */
export function groupSubtypesByRole(subtypes: Subtype[]): Record<TopLevelRole, Subtype[]> {
  const groups: Record<TopLevelRole, Subtype[]> = { program: [], common: [], support: [], other: [] };
  for (const s of subtypes) {
    const role = s.top_level_role as TopLevelRole;
    if ((CANONICAL_ROLES as readonly string[]).includes(role)) groups[role].push(s);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Picker project-type filter + fuzzy search + recents (Type-Picker workstream).
//
// These three are PURE and currently DORMANT — Commit A lands them with tests;
// Commit B wires them into the rewritten `TaxonomyPicker`. They change nothing
// at runtime until a consumer calls them. Design notes live in
// `Notes/plans/Type-Picker-Filter-Search-Keyboard-Plan.md` (§Architecture).
// ---------------------------------------------------------------------------

/**
 * Restrict a sub-type list to those a given project type should SHOW (the
 * project-type filter — opt-in; only the naming pickers pass it). A sub-type is
 * kept when its `default_project_types` includes the project type (universal
 * Common/Support entries list all project types, so they always pass), OR when
 * its id is in `keepIds`. `keepIds` is the load-bearing safety rail: the
 * location's currently-selected type and the AI-suggested type are forced in so
 * edit/rename and accept-suggestion never render with nothing selected (plan §A3).
 *
 * `projectType == null` (project with no type set) returns the list unchanged —
 * never restricts. Pure; does NOT filter by `status` (compose with
 * {@link orderedSubtypesByRole}, which drops non-active rows + groups).
 */
export function restrictSubtypesToProjectType(
  subtypes: Subtype[],
  projectType: ProjectType | null,
  keepIds: ReadonlySet<string> = new Set(),
): Subtype[] {
  if (projectType == null) return subtypes;
  return subtypes.filter(
    (s) => s.default_project_types.includes(projectType) || keepIds.has(s.id),
  );
}

/** True when every char of `q` appears in `t` in order (gap-tolerant subsequence). */
function isSubsequence(q: string, t: string): boolean {
  let j = 0;
  for (let i = 0; i < t.length && j < q.length; i++) {
    if (t[i] === q[j]) j++;
  }
  return j === q.length;
}

/** True when `q` occurs in `t` at the start of a word (index 0 or after a non-alphanumeric). */
function hasWordStart(t: string, q: string): boolean {
  let from = 0;
  for (;;) {
    const idx = t.indexOf(q, from);
    if (idx === -1) return false;
    if (idx === 0 || !/[a-z0-9]/.test(t[idx - 1])) return true;
    from = idx + 1;
  }
}

/**
 * Best (lowest) match rank of `q` against one text: 0 exact, 1 prefix, 2
 * word-start, 3 substring, 4 subsequence, or `null` for no match. `q` is already
 * lowercased + trimmed.
 */
function matchRank(text: string, q: string): number | null {
  const t = text.toLowerCase();
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (hasWordStart(t, q)) return 2;
  if (t.includes(q)) return 3;
  if (isSubsequence(q, t)) return 4;
  return null;
}

/**
 * Fuzzy-rank a sub-type list against a free-text query, matching across the name
 * AND every alias (so a synonym finds its canonical home). Best tier wins:
 * exact > prefix > word-start > substring > subsequence; non-matches are
 * dropped. Stable within a tier (preserves input order), so callers should pass
 * the list pre-ordered. Empty/blank query returns a copy unchanged (caller shows
 * its normal grouped view). Pure — no DB, no `Date`.
 *
 * In the picker this runs over the FULL active dictionary, bypassing the
 * project-type filter — i.e. it IS the "find a hidden type" escape hatch (plan §A7).
 */
export function fuzzyRankSubtypes(subtypes: Subtype[], query: string): Subtype[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...subtypes];
  const scored: { s: Subtype; rank: number; i: number }[] = [];
  subtypes.forEach((s, i) => {
    let best: number | null = matchRank(s.name, q);
    for (const a of s.aliases) {
      const r = matchRank(a, q);
      if (r !== null && (best === null || r < best)) best = r;
    }
    if (best !== null) scored.push({ s, rank: best, i });
  });
  scored.sort((a, b) => a.rank - b.rank || a.i - b.i);
  return scored.map((x) => x.s);
}

/**
 * Match a free-text room name (e.g. an auto-filled "UNIT 101") to its best
 * dictionary sub-type, scanning the canonical name AND every alias of each ACTIVE
 * sub-type. This is the alias-aware type guess for room tracing (AI Tracing Assist —
 * Trace Naming & Type Assist Phase 1, lever D1): an owner alias ("Unit" → "Dwelling
 * Unit") and housing/hotel types that the hard-coded keyword seed ignores entirely
 * both become reachable, because it reads the LIVE dictionary the user maintains.
 *
 * Direction is flipped from {@link fuzzyRankSubtypes}: here the room NAME is the
 * haystack and each dictionary term is the needle — we want "Office" found INSIDE
 * "OFFICE 110". It reuses the same {@link matchRank} tiers (no forked ranking) but
 * caps the accepted tier at `maxRank` (default 2 = word-start) so only a HIGH-
 * confidence appearance of a dictionary term pre-selects a type; loose substring /
 * subsequence hits (ranks 3–4) never auto-guess. Best (lowest) rank wins; ties break
 * by the dictionary's input order. Returns `null` when nothing clears the bar (blank
 * name, no match, or only weak matches) — the user then picks a type by hand.
 *
 * Pure — no DB, no `Date`.
 */
export function matchSubtypeForName(
  subtypes: Subtype[],
  name: string | null | undefined,
  maxRank = 2,
): Subtype | null {
  const haystack = (name ?? '').trim().toLowerCase();
  if (!haystack) return null;
  let bestSubtype: Subtype | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const s of subtypes) {
    if (s.status !== 'active') continue;
    let best: number | null = matchRank(haystack, s.name.toLowerCase());
    for (const a of s.aliases) {
      const r = matchRank(haystack, a.toLowerCase());
      if (r !== null && (best === null || r < best)) best = r;
    }
    if (best !== null && best <= maxRank && best < bestRank) {
      bestRank = best;
      bestSubtype = s;
    }
  }
  return bestSubtype;
}

/**
 * Derive the "Used in this project" recents row from locations already present:
 * the de-duplicated `subtype_id`s, most-recent first, capped. No new storage —
 * the picker reads what the consumer already loaded (plan §A6). Sorts by
 * `created_at` as an ISO string (lexical compare = chronological for ISO 8601);
 * a null/empty timestamp sorts last. Locations without a `subtype_id` are
 * ignored. Pure — no `Date`.
 */
export function recentSubtypeIdsFromUnits(
  units: ReadonlyArray<{ subtype_id: string | null; created_at: string | null }>,
  cap = 6,
): string[] {
  const sorted = units
    .filter((u): u is { subtype_id: string; created_at: string | null } => !!u.subtype_id)
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of sorted) {
    if (seen.has(u.subtype_id)) continue;
    seen.add(u.subtype_id);
    out.push(u.subtype_id);
    if (out.length >= cap) break;
  }
  return out;
}

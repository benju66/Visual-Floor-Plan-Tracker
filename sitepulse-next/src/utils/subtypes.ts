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
import type { Subtype, TopLevelRole, ProjectType } from '@/types/domain';
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

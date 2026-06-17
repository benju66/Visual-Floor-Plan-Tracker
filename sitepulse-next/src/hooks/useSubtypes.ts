import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import { narrowSubtypeRow, addAliasToList } from '@/utils/subtypes';
import { isStringArray } from '@/types/domain';
import type { Subtype, SubtypeStatus, TopLevelRole, ProjectType } from '@/types/domain';

/**
 * Turn a Postgres `name`-UNIQUE collision (23505) into a friendly Error the
 * admin UI can show inline; re-throws anything else unchanged. Mirrors the
 * graceful-duplicate handling in {@link useProposePendingSubtype}.
 */
function asFriendlyDictionaryError(error: { code?: string }, name: string): Error {
  if (error.code === '23505') {
    return new Error(`A sub-type named “${name}” already exists in the dictionary.`);
  }
  return error as Error;
}

/**
 * Read the global governed sub-type dictionary (Location Taxonomy). Sub-types are
 * NOT project-scoped — a café in a hospital uses Restaurant's `Dining Area` — so
 * the query is keyed globally and shared across projects. JSONB columns are
 * narrowed at the boundary via {@link narrowSubtypeRow} (no raw `Json` into props).
 */
export function useSubtypes() {
  return useQuery({
    queryKey: queryKeys.subtypes(),
    queryFn: async (): Promise<Subtype[]> => {
      const { data, error } = await supabase
        .from('subtypes')
        .select('*')
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []).map(narrowSubtypeRow);
    },
    // The dictionary changes rarely (Phase-4 admin only); keep it warm.
    staleTime: 1000 * 60 * 10,
  });
}

/**
 * Propose a new "Other (pending)" sub-type (standard §5.5, non-blocking governance).
 * Inserts a `status='pending'` row with the captured note; if the name already
 * exists (UNIQUE), reuses that dictionary entry so a proposal never duplicates or
 * blocks. Writes are RLS-restricted to privileged members (`owner`/`admin`/`pm`) —
 * a denial throws and is handled gracefully by the caller (see
 * `taxonomyResultToUnitFields`). Never widened to `anon`.
 */
export function useProposePendingSubtype() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, role, note }: { name: string; role: TopLevelRole; note: string }): Promise<Subtype> => {
      const trimmedName = name.trim();
      const { data, error } = await supabase
        .from('subtypes')
        .insert({
          name: trimmedName,
          top_level_role: role,
          status: 'pending',
          proposed_note: note.trim() || null,
          default_project_types: [],
        })
        .select()
        .single();

      if (error) {
        // 23505 = unique_violation on `name`: reuse the existing entry.
        if (error.code === '23505') {
          const { data: existing, error: fetchErr } = await supabase
            .from('subtypes')
            .select('*')
            .eq('name', trimmedName)
            .single();
          if (fetchErr) throw fetchErr;
          return narrowSubtypeRow(existing);
        }
        throw error;
      }
      return narrowSubtypeRow(data);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.subtypes() }),
  });
}

// ---------------------------------------------------------------------------
// Phase-4 dictionary-admin writes (online-first, RLS-restricted to privileged
// members: owner/admin/pm — never `anon`). They follow the existing TanStack
// mutation pattern and invalidate `queryKeys.subtypes()` so every picker and
// the admin list refresh together.
// ---------------------------------------------------------------------------

export interface UpsertSubtypeInput {
  /** Present → update that row; absent → insert a new sub-type. */
  id?: string;
  name: string;
  role: TopLevelRole;
  defaultProjectTypes: ProjectType[];
  /** New rows default to `active`; pass to override (e.g. promote on save). */
  status?: SubtypeStatus;
}

/**
 * Add a new sub-type or edit an existing one (name, canonical role, default
 * project-type scoping, and optionally status). A duplicate `name` surfaces as
 * a friendly Error instead of crashing (the column is UNIQUE). Reuses
 * `narrowSubtypeRow` at the boundary so the cache never holds raw `Json`.
 */
export function useUpsertSubtype() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertSubtypeInput): Promise<Subtype> => {
      const name = input.name.trim();
      const fields = {
        name,
        top_level_role: input.role,
        default_project_types: input.defaultProjectTypes,
        ...(input.status ? { status: input.status } : {}),
      };

      if (input.id) {
        const { data, error } = await supabase
          .from('subtypes')
          .update(fields)
          .eq('id', input.id)
          .select()
          .single();
        if (error) throw asFriendlyDictionaryError(error, name);
        return narrowSubtypeRow(data);
      }

      const { data, error } = await supabase
        .from('subtypes')
        .insert({ status: 'active', ...fields })
        .select()
        .single();
      if (error) throw asFriendlyDictionaryError(error, name);
      return narrowSubtypeRow(data);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.subtypes() }),
  });
}

/**
 * Set a sub-type's governance status (active / pending / deprecated) — the
 * review-queue actions (promote, deprecate) and the per-row status control.
 * Optimistic: the list recolors immediately and rolls back on error.
 */
export function useSetSubtypeStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: SubtypeStatus }): Promise<Subtype> => {
      const { data, error } = await supabase
        .from('subtypes')
        .update({ status })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return narrowSubtypeRow(data);
    },
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.subtypes() });
      const prev = queryClient.getQueryData<Subtype[]>(queryKeys.subtypes());
      queryClient.setQueryData<Subtype[]>(queryKeys.subtypes(), old =>
        old?.map(s => (s.id === id ? { ...s, status } : s)),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.subtypes(), ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.subtypes() }),
  });
}

/**
 * Append an alias name → an existing canonical sub-type (e.g. "Salon Suite" →
 * "Salon Studio"). Reads the current `aliases[]` from the warm cache (falling
 * back to a fetch) and writes the de-duplicated next list via {@link addAliasToList}.
 * Used directly for ad-hoc aliasing and by the review queue's "fold a pending
 * proposal into an existing sub-type" action.
 */
export function useAddSubtypeAlias() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, alias }: { id: string; alias: string }): Promise<Subtype> => {
      const cached = queryClient
        .getQueryData<Subtype[]>(queryKeys.subtypes())
        ?.find(s => s.id === id);
      let current = cached?.aliases;
      if (!current) {
        const { data, error } = await supabase.from('subtypes').select('aliases').eq('id', id).single();
        if (error) throw error;
        current = isStringArray(data.aliases) ? data.aliases : [];
      }
      const nextAliases = addAliasToList(current, alias);

      const { data, error } = await supabase
        .from('subtypes')
        .update({ aliases: nextAliases })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return narrowSubtypeRow(data);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.subtypes() }),
  });
}

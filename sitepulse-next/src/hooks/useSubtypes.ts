import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import { narrowSubtypeRow } from '@/utils/subtypes';
import type { Subtype, TopLevelRole } from '@/types/domain';

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

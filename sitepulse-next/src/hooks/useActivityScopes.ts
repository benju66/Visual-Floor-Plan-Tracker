import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import type { ActivityScope, ActivityScopeStatus } from '@/types/domain';

/**
 * Hooks for the global managed "scopes of work" palette (`activity_scopes`,
 * Scheduling UX Hardening). A small curated list feeding every scope picker and the
 * Activity Library's group/filter. GLOBAL + governed (read = any project member,
 * writes = owner/admin/pm — enforced by RLS, never `anon`), so — like
 * {@link useActivityDictionary} — it's keyed globally, shared, and online-first
 * (schedule authoring, never the offline field queue). No JSONB columns → no boundary
 * narrowing. Scopes couple to activities BY NAME, so nothing here touches
 * `status_logs`, progress analytics, or the map's scope tabs.
 */

/** Turn a UNIQUE(name) collision into a friendly inline Error; re-throw anything else. */
function asFriendlyScopeError(error: { code?: string } | null, name: string): Error {
  if (error?.code === '23505') return new Error(`A scope named “${name}” already exists.`);
  return error as Error;
}

/** Read the palette, ordered by curated `sort_order` then name (active + archived). */
export function useActivityScopes() {
  return useQuery({
    queryKey: queryKeys.activityScopes(),
    queryFn: async (): Promise<ActivityScope[]> => {
      const { data, error } = await supabase
        .from('activity_scopes')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 10,
  });
}

/** Add a scope. New scopes land at the end of the list unless a `sortOrder` is given. */
export function useAddActivityScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, sortOrder }: { name: string; sortOrder?: number }): Promise<ActivityScope> => {
      const trimmed = name.trim();
      let order = sortOrder;
      if (order === undefined) {
        const { data: maxRow } = await supabase
          .from('activity_scopes')
          .select('sort_order')
          .order('sort_order', { ascending: false })
          .limit(1)
          .maybeSingle();
        order = (maxRow?.sort_order ?? -1) + 1;
      }
      const { data, error } = await supabase
        .from('activity_scopes')
        .insert({ name: trimmed, sort_order: order })
        .select()
        .single();
      if (error) throw asFriendlyScopeError(error, trimmed);
      return data;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.activityScopes() }),
  });
}

/**
 * Rename a scope. Also cascades the rename to the company dictionary's default-scope
 * hints (`activity_dictionary.track` where it equals the old name) so the Library's
 * grouping stays consistent with the palette. Project-local `activities.track` is
 * NOT globally rewritten (it's per-project data edited in the Schedule view, and a
 * global admin may not be a member of every project).
 */
export function useRenameActivityScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, oldName, name }: { id: string; oldName: string; name: string }): Promise<ActivityScope> => {
      const trimmed = name.trim();
      const { data, error } = await supabase
        .from('activity_scopes')
        .update({ name: trimmed, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw asFriendlyScopeError(error, trimmed);
      if (oldName && oldName !== trimmed) {
        await supabase
          .from('activity_dictionary')
          .update({ track: trimmed, updated_at: new Date().toISOString() })
          .eq('track', oldName);
      }
      return data;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.activityScopes() });
      qc.invalidateQueries({ queryKey: queryKeys.activityDictionary() });
    },
  });
}

/** Archive (soft-hide) or restore a scope. Activities keep their track string. */
export function useSetActivityScopeStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ActivityScopeStatus }): Promise<ActivityScope> => {
      const { data, error } = await supabase
        .from('activity_scopes')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.activityScopes() }),
  });
}

/** Hard-delete a scope from the palette. Activities that still use the name keep it
 *  (it simply reverts to an "unmanaged" derived scope). Prefer archiving. */
export function useDeleteActivityScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }): Promise<void> => {
      const { error } = await supabase.from('activity_scopes').delete().eq('id', id);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.activityScopes() }),
  });
}

/** Persist a new order — writes each scope's `sort_order` to its array index. */
export function useReorderActivityScopes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderedIds }: { orderedIds: string[] }): Promise<void> => {
      await Promise.all(
        orderedIds.map((id, i) =>
          supabase
            .from('activity_scopes')
            .update({ sort_order: i, updated_at: new Date().toISOString() })
            .eq('id', id),
        ),
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.activityScopes() }),
  });
}

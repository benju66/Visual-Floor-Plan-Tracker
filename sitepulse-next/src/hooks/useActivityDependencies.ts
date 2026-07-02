import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import type { ActivityDependency } from '@/types/domain';

/**
 * Light Finish-to-Start dependency edges between a project's activities
 * (Scheduling Foundation Slice A, Phase 3b). ONLINE-FIRST authoring hooks —
 * these never touch the offline mutation queue or the status pipeline; a
 * dependency is schedule-authoring metadata, not field progress. COARSE by
 * design: FS + lag only, one predecessor per activity in the v1 UI (the table
 * itself is pair-unique). RLS: read = project member, write = privileged
 * (owner/admin/pm), never anon — mirroring `activities`.
 */

/** All dependency edges for a project (fetched via its activity ids). */
export function useActivityDependencies(projectId: string) {
  return useQuery({
    queryKey: queryKeys.activityDependencies(projectId),
    queryFn: async (): Promise<ActivityDependency[]> => {
      if (!projectId) return [];
      // Two-step: the edges table carries no project_id (project scope flows
      // through the activities FKs), so resolve the project's activity ids first.
      const { data: acts, error: actsErr } = await supabase
        .from('activities')
        .select('id')
        .eq('project_id', projectId);
      if (actsErr) throw actsErr;
      const ids = (acts ?? []).map((a) => a.id);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from('activity_dependencies')
        .select('*')
        .in('successor_activity_id', ids);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!projectId,
  });
}

export interface SetPredecessorVars {
  /** The activity being scheduled ("B" in "B starts after A finishes"). */
  successorId: string;
  /** Its new predecessor, or null to clear the dependency. */
  predecessorId: string | null;
  /** Lag in days (may be negative for a lead). Ignored when clearing. */
  lagDays?: number;
}

/**
 * Set / replace / clear an activity's single FS predecessor. Replace = delete the
 * successor's existing edge(s) then insert the new one (the v1 UI authors one
 * predecessor per activity; delete-then-insert keeps that invariant without a
 * DB-side uniqueness on successor alone). Optimistic cache update + invalidate.
 */
export function useSetActivityPredecessor(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ successorId, predecessorId, lagDays = 0 }: SetPredecessorVars): Promise<void> => {
      const { error: delErr } = await supabase
        .from('activity_dependencies')
        .delete()
        .eq('successor_activity_id', successorId);
      if (delErr) throw delErr;
      if (!predecessorId) return;
      const { data: { session } } = await supabase.auth.getSession();
      const { error } = await supabase.from('activity_dependencies').insert({
        predecessor_activity_id: predecessorId,
        successor_activity_id: successorId,
        lag_days: Math.trunc(lagDays),
        created_by: session?.user?.id || null,
      });
      if (error) throw error;
    },
    onMutate: async ({ successorId, predecessorId, lagDays = 0 }) => {
      const key = queryKeys.activityDependencies(projectId);
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<ActivityDependency[]>(key);
      queryClient.setQueryData<ActivityDependency[]>(key, (old) => {
        const filtered = (old ?? []).filter((d) => d.successor_activity_id !== successorId);
        if (!predecessorId) return filtered;
        const optimistic: ActivityDependency = {
          id: `temp_${successorId}`,
          predecessor_activity_id: predecessorId,
          successor_activity_id: successorId,
          type: 'FS',
          lag_days: Math.trunc(lagDays),
          created_by: null,
          created_at: new Date().toISOString(),
        };
        return [...filtered, optimistic];
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.activityDependencies(projectId), ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.activityDependencies(projectId) }),
  });
}

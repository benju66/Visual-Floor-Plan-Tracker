import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import type { ScheduleBaseline, ScheduleBaselineSnapshot } from '@/types/domain';

/**
 * Named, immutable schedule-plan snapshots (Unified Schedule Engine — Phase 4).
 * ONLINE-FIRST authoring hooks — these never touch the offline mutation queue
 * or the status pipeline; a baseline versions the PLAN (level windows +
 * per-location planned dates), never field progress. The table is append-only
 * by design (no UPDATE policy exists), so the only mutations are insert +
 * delete. RLS: read = project member, insert/delete = privileged
 * (owner/admin/pm), never anon — mirroring `subtypes`/`activity_dependencies`.
 *
 * The `snapshot` column stays `Json` in the row type; narrow it with
 * `isScheduleBaselineSnapshot` (domain.ts) where the payload is READ. The
 * insert path types it at the boundary instead.
 */

/** All baselines for a project, newest first. */
export function useScheduleBaselines(projectId: string) {
  return useQuery({
    queryKey: queryKeys.scheduleBaselines(projectId),
    queryFn: async (): Promise<ScheduleBaseline[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('schedule_baselines')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!projectId,
  });
}

export interface SetBaselineVars {
  name: string;
  track: string;
  snapshot: ScheduleBaselineSnapshot;
}

/** Capture a new baseline (append-only — never updates an existing one). */
export function useSetScheduleBaseline(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, track, snapshot }: SetBaselineVars): Promise<ScheduleBaseline> => {
      const { data, error } = await supabase
        .from('schedule_baselines')
        .insert({ project_id: projectId, name, track, snapshot })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.scheduleBaselines(projectId) }),
  });
}

/** Remove a baseline (privileged) — the fix for a mis-captured snapshot. */
export function useDeleteScheduleBaseline(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (baselineId: string): Promise<void> => {
      const { error } = await supabase.from('schedule_baselines').delete().eq('id', baselineId);
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.scheduleBaselines(projectId) }),
  });
}

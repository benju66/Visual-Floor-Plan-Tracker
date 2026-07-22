import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import type { ActivityOverride } from '@/types/domain';

export function useActivityOverrides(projectId: string) {
  return useQuery({
    queryKey: queryKeys.activityOverrides(projectId),
    queryFn: async (): Promise<ActivityOverride[]> => {
      if (!projectId) return [];
      // Inner-join filter scopes the fetch to this project's activities.
      const { data, error } = await supabase
        .from('activity_applicability_overrides')
        .select('*, activities!inner(project_id)')
        .eq('activities.project_id', projectId);
      if (error) throw error;
      // Strip the embedded join object so the cache stays a flat Row array.
      return (data || []).map(({ activities, ...row }: any) => row as ActivityOverride);
    },
    enabled: !!projectId
  });
}

export function useSetActivityApplicability(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ activityId, unitId, isApplicable }: { activityId: string, unitId: string, isApplicable: boolean }) => {
      const { data: { session } } = await supabase.auth.getSession();
      // Idempotent slot upsert — safe for offline mutation replay.
      const { data, error } = await supabase
        .from('activity_applicability_overrides')
        .upsert({
          activity_id: activityId,
          unit_id: unitId,
          is_applicable: isApplicable,
          created_by: session?.user?.id || null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'activity_id,unit_id' })
        .select()
        .single();
      if (error) throw error;
      return data as ActivityOverride;
    },
    onMutate: async ({ activityId, unitId, isApplicable }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.activityOverrides(projectId) });
      queryClient.setQueriesData<ActivityOverride[]>({ queryKey: queryKeys.activityOverrides(projectId) }, old => {
        if (!old) return old;
        const filtered = old.filter(o => !(o.activity_id === activityId && o.unit_id === unitId));
        const optimistic = {
          id: `temp_${Date.now()}`,
          activity_id: activityId,
          unit_id: unitId,
          is_applicable: isApplicable,
          created_by: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        } as ActivityOverride;
        return [...filtered, optimistic];
      });
      return {};
    },
    onError: () => {},
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.activityOverrides(projectId) })
  });
}

export function useBulkSetApplicability(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ activityId, unitIds, isApplicable }: { activityId: string, unitIds: string[], isApplicable: boolean }) => {
      const { data: { session } } = await supabase.auth.getSession();
      const now = new Date().toISOString();
      const rows = unitIds.map(unitId => ({
        activity_id: activityId,
        unit_id: unitId,
        is_applicable: isApplicable,
        created_by: session?.user?.id || null,
        updated_at: now
      }));
      const CHUNK_SIZE = 800;
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const { error } = await supabase
          .from('activity_applicability_overrides')
          .upsert(rows.slice(i, i + CHUNK_SIZE), { onConflict: 'activity_id,unit_id' });
        if (error) throw error;
      }
    },
    onMutate: async ({ activityId, unitIds, isApplicable }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.activityOverrides(projectId) });
      queryClient.setQueriesData<ActivityOverride[]>({ queryKey: queryKeys.activityOverrides(projectId) }, old => {
        if (!old) return old;
        const unitSet = new Set(unitIds);
        const filtered = old.filter(o => !(o.activity_id === activityId && unitSet.has(o.unit_id)));
        const now = new Date().toISOString();
        const optimistic = unitIds.map((unitId, idx) => ({
          id: `temp_${Date.now()}_${idx}`,
          activity_id: activityId,
          unit_id: unitId,
          is_applicable: isApplicable,
          created_by: null,
          created_at: now,
          updated_at: now
        } as ActivityOverride));
        return [...filtered, ...optimistic];
      });
      return {};
    },
    onError: () => {},
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.activityOverrides(projectId) })
  });
}

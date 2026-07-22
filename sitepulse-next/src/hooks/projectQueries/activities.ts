import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import type { Activity } from '@/types/domain';

export function useActivities(projectId: string) {
  return useQuery({
    queryKey: queryKeys.activities(projectId),
    queryFn: async (): Promise<Activity[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase.from('activities')
        .select('*')
        .eq('project_id', projectId)
        .order('sequence_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!projectId
  });
}

export function useUpdateActivity(projectId: string, sheetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, newName, newColor }: { id: string, oldName?: string, newName: string, newColor: string }) => {
      const { error } = await supabase.from('activities').update({ name: newName, color: newColor }).eq('id', id);
      if (error) throw error;

      // Renaming an activity no longer touches status_logs — the rows key to the
      // stable activity_id, so history is never orphaned (the whole point of Phase 1).
      // Only the denormalized status_color needs syncing to existing rows, scoped by
      // activity_id (project-specific, so no cross-project name collision to guard).
      if (newColor) {
        const { error: colorErr } = await supabase
          .from('status_logs')
          .update({ status_color: newColor })
          .eq('activity_id', id);
        if (colorErr) throw colorErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.activities(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.statusesAll() });
      queryClient.invalidateQueries({ queryKey: queryKeys.allProjectStatusesAll() });
    }
  });
}

export function useUpdateActivityRules(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, applies_to_unit_types }: { id: string, applies_to_unit_types: string[] | null }) => {
      const { data, error } = await supabase
        .from('activities')
        .update({ applies_to_unit_types })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as Activity;
    },
    onMutate: async ({ id, applies_to_unit_types }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.activities(projectId) });
      queryClient.setQueriesData<Activity[]>({ queryKey: queryKeys.activities(projectId) }, old => {
        if (!old) return old;
        return old.map(a => a.id === id ? { ...a, applies_to_unit_types } as Activity : a);
      });
      return {};
    },
    onError: () => {},
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.activities(projectId) })
  });
}

/**
 * Assign (or clear) the subcontractor on a project activity — activities.subcontractor_id
 * (Scheduling Analytics Slice B, Phase 5). Project-scoped (a GC uses different subs per
 * job), online-first, RLS-enforced (owner/admin/pm). Pass `subcontractorId: null` to
 * clear. Optimistic over queryKeys.activities(projectId); rolls back on error. Mirrors
 * useUpdateActivityRules.
 */
export function useSetActivitySubcontractor(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, subcontractorId }: { id: string; subcontractorId: string | null }) => {
      const { data, error } = await supabase
        .from('activities')
        .update({ subcontractor_id: subcontractorId })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as Activity;
    },
    onMutate: async ({ id, subcontractorId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.activities(projectId) });
      const prev = queryClient.getQueriesData<Activity[]>({ queryKey: queryKeys.activities(projectId) });
      queryClient.setQueriesData<Activity[]>({ queryKey: queryKeys.activities(projectId) }, old => {
        if (!old) return old;
        return old.map(a => a.id === id ? { ...a, subcontractor_id: subcontractorId } as Activity : a);
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.prev?.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.activities(projectId) })
  });
}

// One-shot bulk activity creation for the Schedule view's first-run wizard
// (Scheduling Foundation Slice A, Phase 3a: "start from your dictionary").
// A single INSERT with explicit sequence_order values — the per-row
// handleAddActivity path reads max(sequence_order) from the cache, which
// doesn't refresh between calls in a loop, so seeding N activities that way
// would collide their ordering. Online-first (schedule authoring).
export interface NewActivityRow {
  name: string;
  color: string;
  track: string;
  sequence_order: number;
  dictionary_id: string | null;
  type: string;
}

export function useCreateActivitiesBulk(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rows: NewActivityRow[]) => {
      if (rows.length === 0) return;
      const { error } = await supabase
        .from('activities')
        .insert(rows.map(r => ({ ...r, project_id: projectId })));
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.activities(projectId) })
  });
}

export function useReorderActivities(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updatedActivities: Activity[]) => {
      const CHUNK_SIZE = 800;
      for (const a of updatedActivities) {
        const { error } = await supabase.from('activities')
          .update({ sequence_order: a.sequence_order })
          .eq('id', a.id);
        if (error) throw error;
      }
    },
    onMutate: async (updatedActivities) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.activities(projectId) });
      queryClient.setQueriesData<Activity[]>({ queryKey: queryKeys.activities(projectId) }, old => {
        if (!old) return old;
        const updatesMap: Record<string, number | null> = {};
        updatedActivities.forEach(ua => updatesMap[ua.id] = ua.sequence_order);

        return old.map(a => {
          if (updatesMap[a.id] !== undefined) {
            return { ...a, sequence_order: updatesMap[a.id] };
          }
          return a;
        }).sort((a, b) => {
          const aOrder = typeof a.sequence_order === 'number' ? a.sequence_order : Infinity;
          const bOrder = typeof b.sequence_order === 'number' ? b.sequence_order : Infinity;
          if (aOrder !== bOrder) {
            return aOrder - bOrder;
          }
          return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
        });
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.activities(projectId) })
  });
}

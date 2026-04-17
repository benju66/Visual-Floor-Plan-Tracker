import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';

export function useProject() {
  return useQuery({
    queryKey: ['project'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('*').limit(1).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data || null;
    }
  });
}

export function useSheets(projectId) {
  return useQuery({
    queryKey: ['sheets', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase.from('sheets').select('*').eq('project_id', projectId).order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!projectId
  });
}

export function useMilestones(projectId) {
  return useQuery({
    queryKey: ['milestones', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase.from('project_milestones').select('*').eq('project_id', projectId).order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!projectId
  });
}

export function useUnits(sheetId) {
  return useQuery({
    queryKey: ['units', sheetId],
    queryFn: async () => {
      if (!sheetId) return [];
      const { data, error } = await supabase.from('units').select('*').eq('sheet_id', sheetId);
      if (error) throw error;
      return data;
    },
    enabled: !!sheetId
  });
}

export function useStatuses(sheetId, unitIds, milestones) {
  // Filter out temporary optimistic IDs to prevent Postgres UUID syntax errors
  const validUnitIds = unitIds?.filter(id => !String(id).startsWith('temp_')) || [];
  
  return useQuery({
    // Include validUnitIds in the queryKey so it refetches when real IDs arrive
    queryKey: ['statuses', sheetId, validUnitIds],
    queryFn: async () => {
      if (!sheetId || validUnitIds.length === 0) return [];
      
      const { data, error } = await supabase.from('status_logs').select('*').in('unit_id', validUnitIds);

      if (error) throw error;
      
      const latestStatusMap = {};
      data.forEach(log => {
        const key = `${log.unit_id}_${log.track}`;
        if (!latestStatusMap[key] || new Date(log.created_at) > new Date(latestStatusMap[key].created_at)) {
          latestStatusMap[key] = log;
        }
      });
      return Object.values(latestStatusMap);
    },
    enabled: !!sheetId && validUnitIds.length > 0,
    placeholderData: keepPreviousData
  });
}

// ==== Mutations ====

export function useCreateUnit(sheetId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (newUnit) => {
      const { status_logs, ...dbUnit } = newUnit;
      const { data, error } = await supabase.from('units').insert([dbUnit]).select().single();
      if (error) throw error;
      return data;
    },
    onMutate: async (newUnit) => {
      await queryClient.cancelQueries({ queryKey: ['units', sheetId] });
      const tempId = `temp_${Date.now()}`;
      const tempUnit = { ...newUnit, id: tempId };
      queryClient.setQueriesData({ queryKey: ['units', sheetId] }, old => old ? [...old, tempUnit] : [tempUnit]);
      return {};
    },
    onError: () => {},
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['units', sheetId] });
    }
  });
}

export function useUpdateUnitGeometry(sheetId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ unitId, polygon_coordinates }) => {
      const { data, error } = await supabase.from('units').update({ polygon_coordinates }).eq('id', unitId).select().single();
      if (error) throw error;
      return data;
    },
    onMutate: async ({ unitId, polygon_coordinates }) => {
      await queryClient.cancelQueries({ queryKey: ['units', sheetId] });
      queryClient.setQueriesData({ queryKey: ['units', sheetId] }, old => {
        if (!old) return old;
        return old.map(u => u.id === unitId ? { ...u, polygon_coordinates } : u);
      });
      return {};
    },
    onError: () => {},
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['units', sheetId] })
  });
}

export function useUpdateUnitFields(sheetId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ unitId, updates }) => {
      const { status_logs, ...dbUpdates } = updates;
      const { data, error } = await supabase.from('units').update(dbUpdates).eq('id', unitId).select().single();
      if (error) throw error;
      return data;
    },
    onMutate: async ({ unitId, updates }) => {
      await queryClient.cancelQueries({ queryKey: ['units', sheetId] });
      queryClient.setQueriesData({ queryKey: ['units', sheetId] }, old => {
        if (!old) return old;
        return old.map(u => u.id === unitId ? { ...u, ...updates } : u);
      });
      return {};
    },
    onError: () => {},
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['units', sheetId] })
  });
}

export function useDeleteUnit(sheetId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (unitId) => {
      await supabase.from('status_logs').delete().eq('unit_id', unitId);
      const { error } = await supabase.from('units').delete().eq('id', unitId);
      if (error) throw error;
    },
    onMutate: async (unitId) => {
      await queryClient.cancelQueries({ queryKey: ['units', sheetId] });
      queryClient.setQueriesData({ queryKey: ['units', sheetId] }, old => old ? old.filter(u => u.id !== unitId) : old);
      return {};
    },
    onError: () => {},
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['units', sheetId] });
      queryClient.invalidateQueries({ queryKey: ['statuses', sheetId] });
    }
  });
}

export function useUpdateStatus(sheetId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (newLogData) => {
      const { error: deleteError } = await supabase.from('status_logs').delete().eq('unit_id', newLogData.unit_id).eq('track', newLogData.track);
      if (deleteError) throw deleteError;

      const { data, error } = await supabase.from('status_logs').insert([newLogData]).select().single();
      if (error) throw error;
      return data;
    },
    onMutate: async (newLogData) => {
      await queryClient.cancelQueries({ queryKey: ['statuses', sheetId] });
      
      queryClient.setQueriesData({ queryKey: ['statuses', sheetId] }, old => {
        if (!old) return old;
        const filtered = old.filter(s => !(s.unit_id === newLogData.unit_id && s.track === newLogData.track));
        return [...filtered, { ...newLogData, id: `temp_${Date.now()}` }];
      });
      return {};
    },
    onError: () => {},
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['statuses', sheetId] })
  });
}

export function useClearStatus(sheetId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ unitId, track }) => {
      const { error } = await supabase.from('status_logs').delete().eq('unit_id', unitId).eq('track', track);
      if (error) throw error;
    },
    onMutate: async ({ unitId, track }) => {
      await queryClient.cancelQueries({ queryKey: ['statuses', sheetId] });
      queryClient.setQueriesData({ queryKey: ['statuses', sheetId] }, old => {
        if (!old) return old;
        return old.filter(s => !(s.unit_id === unitId && s.track === track));
      });
      return {};
    },
    onError: () => {},
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['statuses', sheetId] })
  });
}

// Strictly enforced logic constraint: 800 CHUNK_SIZE block implemented
export function useUpdateMilestone(projectId, sheetId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, oldName, newName, newColor }) => {
      const { error } = await supabase.from('project_milestones').update({ name: newName, color: newColor }).eq('id', id);
      if (error) throw error;

      if (oldName !== newName || newColor) {
        const { data: logs, error: fetchErr } = await supabase.from('status_logs').select('id').eq('milestone', oldName);
        if (fetchErr) throw fetchErr;

        if (logs && logs.length > 0) {
          const CHUNK_SIZE = 800;
          const updates = oldName !== newName ? { milestone: newName, status_color: newColor } : { status_color: newColor };

          for (let i = 0; i < logs.length; i += CHUNK_SIZE) {
            const chunkIds = logs.slice(i, i + CHUNK_SIZE).map(l => l.id);
            const { error: chunkErr } = await supabase.from('status_logs').update(updates).in('id', chunkIds);
            if (chunkErr) throw chunkErr;
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['milestones', projectId] });
      queryClient.invalidateQueries({ queryKey: ['statuses'] });
    }
  });
}

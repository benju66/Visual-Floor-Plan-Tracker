import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';

export function useProject() {
  return useQuery({
    queryKey: ['project'],
    queryFn: async () => {
      let { data: projects } = await supabase.from('projects').select('*');
      if (!projects || projects.length === 0) {
        const { data } = await supabase.from('projects').insert([{ name: 'Orchard Path III' }]).select();
        return data[0];
      }
      return projects[0];
    },
    staleTime: Infinity, // Projects rarely change during a session
  });
}

export function useSheets(projectId) {
  return useQuery({
    queryKey: ['sheets', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase.from('sheets').select('*').eq('project_id', projectId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!projectId,
  });
}

export function useMilestones(projectId) {
  return useQuery({
    queryKey: ['milestones', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      let { data: loadedMilestones, error } = await supabase
        .from('project_milestones')
        .select('*')
        .eq('project_id', projectId)
        .order('id', { ascending: true });

      if (error) throw error;

      if (!loadedMilestones || loadedMilestones.length === 0) {
        const defaultMilestones = [
          { project_id: projectId, name: 'Framing', color: '#f59e0b', track: 'Production' },
          { project_id: projectId, name: 'Drywall', color: '#3b82f6', track: 'Production' },
          { project_id: projectId, name: 'Cabinets', color: '#f97316', track: 'Production' },
          { project_id: projectId, name: 'Paint', color: '#8b5cf6', track: 'Production' },
          { project_id: projectId, name: 'AHJ Rough-in', color: '#eab308', track: 'Inspections' },
          { project_id: projectId, name: 'AHJ Final', color: '#10b981', track: 'Inspections' },
        ];
        const { data: seeded } = await supabase.from('project_milestones').insert(defaultMilestones).select();
        return seeded || [];
      }
      return loadedMilestones;
    },
    enabled: !!projectId,
  });
}

export function useUnits(sheetId) {
  return useQuery({
    queryKey: ['units', sheetId],
    queryFn: async () => {
      if (!sheetId) return [];
      const { data, error } = await supabase.from('units').select('*').eq('sheet_id', sheetId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!sheetId,
  });
}

export function useStatuses(sheetId, unitIds, milestones) {
  return useQuery({
    queryKey: ['statuses', sheetId, unitIds?.length],
    queryFn: async () => {
      if (!unitIds || unitIds.length === 0) return [];
      const { data: logs, error } = await supabase
        .from('status_logs')
        .select('*')
        .in('unit_id', unitIds)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (logs) {
        const latestStatuses = [];
        const seen = new Set();
        for (const log of logs) {
          const milestoneDef = milestones?.find((m) => m.name === log.milestone);
          const track = milestoneDef ? milestoneDef.track : 'Production';
          const key = `${log.unit_id}-${track}`;
          
          if (!seen.has(key)) {
            latestStatuses.push({ ...log, track });
            seen.add(key);
          }
        }
        return latestStatuses;
      }
      return [];
    },
    enabled: !!sheetId && !!unitIds && unitIds.length > 0 && !!milestones,
  });
}

// ----------------------------------------------------------------------
// Mutations
// ----------------------------------------------------------------------

export function useCreateUnit(sheetId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (newUnit) => {
      const { data, error } = await supabase.from('units').insert([newUnit]).select();
      if (error) throw error;
      return data[0];
    },
    onMutate: async (newUnit) => {
      await queryClient.cancelQueries({ queryKey: ['units', sheetId] });
      const previousUnits = queryClient.getQueryData(['units', sheetId]);
      queryClient.setQueryData(['units', sheetId], (old) => [...(old || []), { ...newUnit, id: newUnit.id || `temp-${Date.now()}` }]);
      return { previousUnits };
    },
    onError: (err, newUnit, context) => {
      queryClient.setQueryData(['units', sheetId], context.previousUnits);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['units', sheetId] });
    },
  });
}

export function useUpdateUnitGeometry(sheetId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ unitId, polygon_coordinates }) => {
      const { error } = await supabase.from('units').update({ polygon_coordinates }).eq('id', unitId);
      if (error) throw error;
    },
    onMutate: async ({ unitId, polygon_coordinates }) => {
      await queryClient.cancelQueries({ queryKey: ['units', sheetId] });
      const previousUnits = queryClient.getQueryData(['units', sheetId]);
      queryClient.setQueryData(['units', sheetId], (old) => 
        old?.map(u => u.id === unitId ? { ...u, polygon_coordinates } : u)
      );
      return { previousUnits };
    },
    onError: (err, variables, context) => {
      queryClient.setQueryData(['units', sheetId], context.previousUnits);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['units', sheetId] });
    },
  });
}

export function useUpdateUnitFields(sheetId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ unitId, updates }) => {
      const { error } = await supabase.from('units').update(updates).eq('id', unitId);
      if (error) throw error;
    },
    onMutate: async ({ unitId, updates }) => {
      await queryClient.cancelQueries({ queryKey: ['units', sheetId] });
      const previousUnits = queryClient.getQueryData(['units', sheetId]);
      queryClient.setQueryData(['units', sheetId], (old) => 
        old?.map(u => u.id === unitId ? { ...u, ...updates } : u)
      );
      return { previousUnits };
    },
    onError: (err, variables, context) => {
      queryClient.setQueryData(['units', sheetId], context.previousUnits);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['units', sheetId] });
    },
  });
}

export function useDeleteUnit(sheetId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (unitId) => {
      const { error } = await supabase.from('units').delete().eq('id', unitId);
      if (error) throw error;
    },
    onMutate: async (unitId) => {
      await queryClient.cancelQueries({ queryKey: ['units', sheetId] });
      const previousUnits = queryClient.getQueryData(['units', sheetId]);
      queryClient.setQueryData(['units', sheetId], (old) => old?.filter(u => u.id !== unitId));
      return { previousUnits };
    },
    onError: (err, unitId, context) => {
      queryClient.setQueryData(['units', sheetId], context.previousUnits);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['units', sheetId] });
    },
  });
}

export function useUpdateStatus(sheetId, unitIdsLength) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (newLog) => {
      const { data, error } = await supabase.from('status_logs').insert([{
        unit_id: newLog.unit_id,
        milestone: newLog.milestone,
        status_color: newLog.status_color,
        temporal_state: newLog.temporal_state,
      }]).select();
      if (error) throw error;
      return { ...data[0], track: newLog.track };
    },
    onMutate: async (newLog) => {
      await queryClient.cancelQueries({ queryKey: ['statuses', sheetId, unitIdsLength] });
      const previousStatuses = queryClient.getQueryData(['statuses', sheetId, unitIdsLength]);
      queryClient.setQueryData(['statuses', sheetId, unitIdsLength], (old) => {
        const filtered = (old || []).filter(s => !(s.unit_id === newLog.unit_id && s.track === newLog.track));
        return [...filtered, { ...newLog, id: 'temp-' + Date.now(), created_at: new Date().toISOString() }];
      });
      return { previousStatuses };
    },
    onError: (err, newLog, context) => {
      queryClient.setQueryData(['statuses', sheetId, unitIdsLength], context.previousStatuses);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['statuses', sheetId, unitIdsLength] });
    },
  });
}

export function useClearStatus(sheetId, unitIdsLength) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ unitId, milestone }) => {
      const { error } = await supabase.from('status_logs').delete().eq('unit_id', unitId).eq('milestone', milestone);
      if (error) throw error;
    },
    onMutate: async ({ unitId, track }) => {
      await queryClient.cancelQueries({ queryKey: ['statuses', sheetId, unitIdsLength] });
      const previousStatuses = queryClient.getQueryData(['statuses', sheetId, unitIdsLength]);
      queryClient.setQueryData(['statuses', sheetId, unitIdsLength], (old) => 
        (old || []).filter(s => !(s.unit_id === unitId && s.track === track))
      );
      return { previousStatuses };
    },
    onError: (err, vars, context) => {
      queryClient.setQueryData(['statuses', sheetId, unitIdsLength], context.previousStatuses);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['statuses', sheetId, unitIdsLength] });
    },
  });
}

// Milestone mutations
export function useUpdateMilestone(projectId, sheetId, unitIdsLength) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, oldName, newName, newColor }) => {
      const { error: updateErr } = await supabase
        .from('project_milestones')
        .update({ name: newName, color: newColor })
        .eq('id', id);
        
      if (updateErr) throw updateErr;

      // The Ripple Effect
      if (oldName !== newName || newColor) {
        const { data: projectSheets } = await supabase.from('sheets').select('id').eq('project_id', projectId);
        const sheetIds = projectSheets ? projectSheets.map(s => s.id) : [];

        if (sheetIds.length > 0) {
          const CHUNK_SIZE = 800; // Preserved chunking logic
          const { data: projectUnits } = await supabase.from('units').select('id').in('sheet_id', sheetIds);
          const unitIds = projectUnits ? projectUnits.map(u => u.id) : [];
          
          if (unitIds.length > 0) {
            for (let i = 0; i < unitIds.length; i += CHUNK_SIZE) {
              const chunk = unitIds.slice(i, i + CHUNK_SIZE);
              await supabase
                .from('status_logs')
                .update({ milestone: newName, status_color: newColor })
                .eq('milestone', oldName)
                .in('unit_id', chunk);
            }
          }
        }
      }
    },
    onMutate: async ({ id, oldName, newName, newColor }) => {
      // Optimistic upate for milestones list
      await queryClient.cancelQueries({ queryKey: ['milestones', projectId] });
      const previousMilestones = queryClient.getQueryData(['milestones', projectId]);
      queryClient.setQueryData(['milestones', projectId], (old) => 
        old?.map(m => m.id === id ? { ...m, name: newName, color: newColor } : m)
      );

      // Optimistic update for active statuses
      if (sheetId) {
        await queryClient.cancelQueries({ queryKey: ['statuses', sheetId, unitIdsLength] });
        const previousStatuses = queryClient.getQueryData(['statuses', sheetId, unitIdsLength]);
        queryClient.setQueryData(['statuses', sheetId, unitIdsLength], (old) => 
          old?.map(s => s.milestone === oldName ? { ...s, milestone: newName, status_color: newColor } : s)
        );
        return { previousMilestones, previousStatuses };
      }
      return { previousMilestones };
    },
    onError: (err, vars, context) => {
      queryClient.setQueryData(['milestones', projectId], context.previousMilestones);
      if (context.previousStatuses && sheetId) {
        queryClient.setQueryData(['statuses', sheetId, unitIdsLength], context.previousStatuses);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['milestones', projectId] });
      if (sheetId) {
        queryClient.invalidateQueries({ queryKey: ['statuses', sheetId, unitIdsLength] });
      }
    },
  });
}

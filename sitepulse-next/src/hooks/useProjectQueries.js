import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';

export function useProject(projectId) {
  return useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const { data, error } = await supabase.from('projects').select('*').eq('id', projectId).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data || null;
    },
    enabled: !!projectId
  });
}

export function useUpdateProject(projectId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updates) => {
      const { data, error } = await supabase.from('projects').update(updates).eq('id', projectId).select().single();
      if (error) throw error;
      return data;
    },
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: ['project', projectId] });
      queryClient.setQueriesData({ queryKey: ['project', projectId] }, old => {
        if (!old) return old;
        return { ...old, ...updates };
      });
      return {};
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['project', projectId] })
  });
}

export function useUnitHistory(unitId) {
  return useQuery({
    queryKey: ['unit_history', unitId],
    queryFn: async () => {
      if (!unitId) return [];
      const { data, error } = await supabase.from('status_logs')
        .select('*')
        .eq('unit_id', unitId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!unitId
  });
}

export function useSheets(projectId) {
  return useQuery({
    queryKey: ['sheets', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase.from('sheets')
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

export function useMilestones(projectId) {
  return useQuery({
    queryKey: ['milestones', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase.from('project_milestones')
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

export function useAllProjectUnits(sheetIds) {
  return useQuery({
    queryKey: ['all_project_units', sheetIds],
    queryFn: async () => {
      if (!sheetIds || sheetIds.length === 0) return [];
      const { data, error } = await supabase.from('units').select('*').in('sheet_id', sheetIds);
      if (error) throw error;
      return data;
    },
    enabled: !!sheetIds && sheetIds.length > 0
  });
}

export function useAllProjectStatuses(unitIds) {
  const validUnitIds = unitIds?.filter(id => !String(id).startsWith('temp_')) || [];
  return useQuery({
    queryKey: ['all_project_statuses', validUnitIds],
    queryFn: async () => {
      if (validUnitIds.length === 0) return [];
      
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
    enabled: validUnitIds.length > 0,
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
      // NOTE: Removed destructive .delete() to preserve event sourcing history.
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

export function useBulkUpdateStatus(sheetId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ unitIds, milestone, color, temporal_state, track, planned_start_date, planned_end_date }) => {
      const CHUNK_SIZE = 800;
      
      for (let i = 0; i < unitIds.length; i += CHUNK_SIZE) {
        const chunkIds = unitIds.slice(i, i + CHUNK_SIZE);
        
        if (milestone === '__KEEP_EXISTING__') {
          if (temporal_state !== '__KEEP_EXISTING__') {
            // Note: If keeping existing milestone but changing state, we should ideally insert a NEW event log
            // However, since we don't have the current milestone names easily available inside this loop without a query,
            // we will fetch the latest statuses, build new objects, and insert them.
            const { data: latestLogs, error: logError } = await supabase.from('status_logs')
              .select('*')
              .in('unit_id', chunkIds)
              .eq('track', track);
            
            if (logError) throw logError;
            
            // Map to unit_id logic: get latest log for each unit
            const latestStatusMap = {};
            latestLogs.forEach(log => {
              const key = log.unit_id;
              if (!latestStatusMap[key] || new Date(log.created_at) > new Date(latestStatusMap[key].created_at)) {
                latestStatusMap[key] = log;
              }
            });
            
            const newLogs = [];
            for (const id of chunkIds) {
              const existing = latestStatusMap[id];
              if (existing) {
                newLogs.push({
                   unit_id: id,
                   milestone: existing.milestone,
                   status_color: existing.status_color,
                   temporal_state,
                   track,
                   planned_start_date: planned_start_date !== undefined ? planned_start_date : existing.planned_start_date,
                   planned_end_date: planned_end_date !== undefined ? planned_end_date : existing.planned_end_date
                });
              }
            }
            if (newLogs.length > 0) {
              const { error: insertError } = await supabase.from('status_logs').insert(newLogs);
              if (insertError) throw insertError;
            }
          }
        } else {
          // NOTE: Removed destructive .delete() to preserve event sourcing history.
          if (milestone !== null && temporal_state !== 'none' && temporal_state !== '__KEEP_EXISTING__') {
            const newLogs = chunkIds.map(id => ({
              unit_id: id,
              milestone,
              status_color: color,
              temporal_state,
              track,
              planned_start_date: planned_start_date || null,
              planned_end_date: planned_end_date || null
            }));
            
            const { error: insertError } = await supabase.from('status_logs').insert(newLogs);
            if (insertError) throw insertError;
          }
        }
      }
    },
    onMutate: async ({ unitIds, milestone, color, temporal_state, track, planned_start_date, planned_end_date }) => {
      await queryClient.cancelQueries({ queryKey: ['statuses', sheetId] });
      
      queryClient.setQueriesData({ queryKey: ['statuses', sheetId] }, old => {
        if (!old) return old;
        
        if (milestone === '__KEEP_EXISTING__') {
          if (temporal_state === '__KEEP_EXISTING__') return old;
          return old.map(s => {
            if (unitIds.includes(s.unit_id) && s.track === track) {
              return { 
                  ...s, 
                  temporal_state,
                  planned_start_date: planned_start_date !== undefined ? planned_start_date : s.planned_start_date,
                  planned_end_date: planned_end_date !== undefined ? planned_end_date : s.planned_end_date
              };
            }
            return s;
          });
        }
        
        const filtered = old.filter(s => !(unitIds.includes(s.unit_id) && s.track === track));
        
        if (milestone === null || temporal_state === 'none' || temporal_state === '__KEEP_EXISTING__') {
          return filtered;
        }
        
        const optimisticLogs = unitIds.map(id => ({
          id: `temp_${id}_${Date.now()}`,
          unit_id: id,
          milestone,
          status_color: color,
          temporal_state,
          track,
          planned_start_date: planned_start_date || null,
          planned_end_date: planned_end_date || null,
          created_at: new Date().toISOString()
        }));
        return [...filtered, ...optimisticLogs];
      });
      return {};
    },
    onError: () => {},
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['statuses', sheetId] })
  });
}

export function useUpdateSheetScopes(projectId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ sheetId, active_scopes }) => {
      const { data, error } = await supabase.from('sheets').update({ active_scopes }).eq('id', sheetId).select().single();
      if (error) throw error;
      return data;
    },
    onMutate: async ({ sheetId, active_scopes }) => {
      await queryClient.cancelQueries({ queryKey: ['sheets', projectId] });
      queryClient.setQueriesData({ queryKey: ['sheets', projectId] }, old => {
        if (!old) return old;
        return old.map(s => s.id === sheetId ? { ...s, active_scopes } : s);
      });
      return {};
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['sheets', projectId] })
  });
}

export function useUpdateSheetScale(projectId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ sheetId, scale_preset, scale_ratio }) => {
      const { data, error } = await supabase.from('sheets').update({ scale_preset, scale_ratio }).eq('id', sheetId).select().single();
      if (error) throw error;
      return data;
    },
    onMutate: async ({ sheetId, scale_preset, scale_ratio }) => {
      await queryClient.cancelQueries({ queryKey: ['sheets', projectId] });
      queryClient.setQueriesData({ queryKey: ['sheets', projectId] }, old => {
        if (!old) return old;
        return old.map(s => s.id === sheetId ? { ...s, scale_preset, scale_ratio } : s);
      });
      return {};
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['sheets', projectId] })
  });
}

export function useUpdateSheetSchedule(projectId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ sheetId, milestone_schedules }) => {
      const { data, error } = await supabase.from('sheets').update({ milestone_schedules }).eq('id', sheetId).select().single();
      if (error) throw error;
      return data;
    },
    onMutate: async ({ sheetId, milestone_schedules }) => {
      await queryClient.cancelQueries({ queryKey: ['sheets', projectId] });
      queryClient.setQueriesData({ queryKey: ['sheets', projectId] }, old => {
        if (!old) return old;
        return old.map(s => s.id === sheetId ? { ...s, milestone_schedules } : s);
      });
      return {};
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['sheets', projectId] })
  });
}

export function useReorderMilestones(projectId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updatedMilestones) => {
      const CHUNK_SIZE = 800;
      for (const m of updatedMilestones) {
        const { error } = await supabase.from('project_milestones')
          .update({ sequence_order: m.sequence_order })
          .eq('id', m.id);
        if (error) throw error;
      }
    },
    onMutate: async (updatedMilestones) => {
      await queryClient.cancelQueries({ queryKey: ['milestones', projectId] });
      queryClient.setQueriesData({ queryKey: ['milestones', projectId] }, old => {
        if (!old) return old;
        const updatesMap = {};
        updatedMilestones.forEach(um => updatesMap[um.id] = um.sequence_order);
        
        return old.map(m => {
          if (updatesMap[m.id] !== undefined) {
            return { ...m, sequence_order: updatesMap[m.id] };
          }
          return m;
        }).sort((a, b) => {
          if (a.sequence_order !== b.sequence_order) {
            return a.sequence_order - b.sequence_order;
          }
          return new Date(a.created_at) - new Date(b.created_at);
        });
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['milestones', projectId] })
  });
}

export function useReorderSheets(projectId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updatedSheets) => {
      for (const sheet of updatedSheets) {
        const { error } = await supabase.from('sheets')
          .update({ sequence_order: sheet.sequence_order })
          .eq('id', sheet.id);
        if (error) throw error;
      }
    },
    onMutate: async (updatedSheets) => {
      await queryClient.cancelQueries({ queryKey: ['sheets', projectId] });
      queryClient.setQueriesData({ queryKey: ['sheets', projectId] }, old => {
        if (!old) return old;
        const updatesMap = {};
        updatedSheets.forEach(us => updatesMap[us.id] = us.sequence_order);
        
        return old.map(s => {
          if (s.id in updatesMap) {
            return { ...s, sequence_order: updatesMap[s.id] };
          }
          return s;
        }).sort((a,b) => {
          const aOrder = typeof a.sequence_order === 'number' ? a.sequence_order : Infinity;
          const bOrder = typeof b.sequence_order === 'number' ? b.sequence_order : Infinity;
          return aOrder - bOrder;
        });
      });
      return {};
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['sheets', projectId] })
  });
}

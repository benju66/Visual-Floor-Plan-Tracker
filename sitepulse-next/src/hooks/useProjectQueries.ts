import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { extractVectorsService } from '@/services/api';
import { queryKeys } from '@/types/queryKeys';
import type { 
  Project, Sheet, Unit, Milestone, StatusLog, Profile, ProjectMember,
  TemporalState
} from '@/types/domain';
import type { 
  UpdateUnitGeometryVars, BulkUpdateStatusVars, UpdateStatusVars 
} from '@/types/mutations';

export type MemberWithProfile = ProjectMember & { profiles: Pick<Profile, 'id' | 'email' | 'display_name'> | null };

export function useProjectMembers(projectId: string) {
  return useQuery({
    queryKey: queryKeys.projectMembers(projectId),
    queryFn: async (): Promise<MemberWithProfile[]> => {
      if (!projectId) return [];
      const { data: members, error } = await supabase
        .from('project_members')
        .select('*')
        .eq('project_id', projectId);
      if (error) throw error;
      
      if (!members || members.length === 0) return [];
      
      const userIds = members.map(m => m.user_id as string);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email, display_name')
        .in('id', userIds);
        
      return members.map(m => ({
        ...m,
        profiles: profiles?.find(p => p.id === m.user_id) || null
      }));
    },
    enabled: !!projectId
  });
}

export function useCurrentUserRole(projectId: string) {
  return useQuery({
    queryKey: queryKeys.currentUserRole(projectId),
    queryFn: async (): Promise<string | null> => {
      if (!projectId) return null;
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.user) return null;
      
      const { data, error } = await supabase
        .from('project_members')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', session.user.id)
        .single();
        
      if (error && error.code !== 'PGRST116') throw error;
      return data?.role || null;
    },
    enabled: !!projectId,
    staleTime: 1000 * 60 * 5 // 5 minutes
  });
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: async (): Promise<Project | null> => {
      if (!projectId) return null;
      const { data, error } = await supabase.from('projects').select('*').eq('id', projectId).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data || null;
    },
    enabled: !!projectId
  });
}

export function useUpdateProject(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updates: Partial<Project>) => {
      const { data, error } = await supabase.from('projects').update(updates).eq('id', projectId).select().single();
      if (error) throw error;
      return data;
    },
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.project(projectId) });
      queryClient.setQueriesData<Project | null>({ queryKey: queryKeys.project(projectId) }, old => {
        if (!old) return old;
        return { ...old, ...updates };
      });
      return {};
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) })
  });
}

export function useUnitHistory(unitId: string) {
  return useQuery({
    queryKey: queryKeys.unitHistory(unitId),
    queryFn: async (): Promise<StatusLog[]> => {
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

export function useSheets(projectId: string) {
  return useQuery({
    queryKey: queryKeys.sheets(projectId),
    queryFn: async (): Promise<Sheet[]> => {
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

export function useMilestones(projectId: string) {
  return useQuery({
    queryKey: queryKeys.milestones(projectId),
    queryFn: async (): Promise<Milestone[]> => {
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

export function useUnits(sheetId: string) {
  return useQuery({
    queryKey: queryKeys.units(sheetId),
    queryFn: async (): Promise<Unit[]> => {
      if (!sheetId) return [];
      const { data, error } = await supabase.from('units').select('*').eq('sheet_id', sheetId);
      if (error) throw error;
      return data as unknown as Unit[];
    },
    enabled: !!sheetId
  });
}

// Ensure the return matches snapping vectors UI expectations
export interface SnappingVectorLine {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  lineData: any;
}

export function useSnappingVectors(sheetId: string) {
  return useQuery({
    queryKey: queryKeys.snappingVectors(sheetId),
    queryFn: async (): Promise<SnappingVectorLine[] | null> => {
      if (!sheetId) return null;
      
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;

      try {
        const json = await extractVectorsService(sheetId, session.access_token);
        
        const formattedData = json.vectors.map((line: any) => {
          return {
            minX: Math.min(line.start.pctX, line.end.pctX),
            minY: Math.min(line.start.pctY, line.end.pctY),
            maxX: Math.max(line.start.pctX, line.end.pctX),
            maxY: Math.max(line.start.pctY, line.end.pctY),
            lineData: line
          };
        });
        
        return formattedData;
      } catch (err: any) {
        console.warn('Vector snapping unavailable for this sheet:', err.message);
        throw err;
      }
    },
    enabled: !!sheetId,
    staleTime: Infinity,
    retry: 1
  });
}

export function useStatuses(sheetId: string, unitIds: string[]) {
  const validUnitIds = unitIds?.filter(id => !String(id).startsWith('temp_')) || [];
  
  return useQuery({
    queryKey: queryKeys.statuses(sheetId, validUnitIds),
    queryFn: async (): Promise<StatusLog[]> => {
      if (!sheetId || validUnitIds.length === 0) return [];
      
      const { data, error } = await supabase.from('status_logs').select('*').in('unit_id', validUnitIds);

      if (error) throw error;
      
      const latestStatusMap: Record<string, StatusLog> = {};
      data.forEach(log => {
        const key = `${log.unit_id}_${log.track}_${log.milestone}`;
        // Prefer client_timestamp (written at mutation time) over server created_at.
        // Prevents non-deterministic ordering when bulk ops share the same server timestamp.
        const logTime = new Date(log.client_timestamp || log.created_at || 0).getTime();
        const existingTime = new Date(latestStatusMap[key]?.client_timestamp || latestStatusMap[key]?.created_at || 0).getTime();
        if (!latestStatusMap[key] || logTime >= existingTime) {
          latestStatusMap[key] = log;
        }
      });
      return Object.values(latestStatusMap);
    },
    enabled: !!sheetId && validUnitIds.length > 0,
    placeholderData: keepPreviousData
  });
}

export function useAllProjectUnits(sheetIds: string[]) {
  return useQuery({
    queryKey: queryKeys.allProjectUnits(sheetIds),
    queryFn: async (): Promise<Unit[]> => {
      if (!sheetIds || sheetIds.length === 0) return [];
      const { data, error } = await supabase.from('units').select('*').in('sheet_id', sheetIds);
      if (error) throw error;
      return data as unknown as Unit[];
    },
    enabled: !!sheetIds && sheetIds.length > 0
  });
}

export function useAllProjectStatuses(unitIds: string[]) {
  const validUnitIds = unitIds?.filter(id => !String(id).startsWith('temp_')) || [];
  return useQuery({
    queryKey: queryKeys.allProjectStatuses(validUnitIds),
    queryFn: async (): Promise<StatusLog[]> => {
      if (validUnitIds.length === 0) return [];
      
      const { data, error } = await supabase.from('status_logs').select('*').in('unit_id', validUnitIds);
      if (error) throw error;
      
      const latestStatusMap: Record<string, StatusLog> = {};
      data.forEach(log => {
        const key = `${log.unit_id}_${log.track}_${log.milestone}`;
        // Prefer client_timestamp (written at mutation time) over server created_at.
        // Prevents non-deterministic ordering when bulk ops share the same server timestamp.
        const logTime = new Date(log.client_timestamp || log.created_at || 0).getTime();
        const existingTime = new Date(latestStatusMap[key]?.client_timestamp || latestStatusMap[key]?.created_at || 0).getTime();
        if (!latestStatusMap[key] || logTime >= existingTime) {
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

export function useCreateUnit(sheetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (newUnit: Partial<Unit> & { status_logs?: any }) => {
      const { status_logs, ...dbUnit } = newUnit;
      const { data, error } = await supabase.from('units').insert([dbUnit as any]).select().single();
      if (error) throw error;
      return data as Unit;
    },
    onMutate: async (newUnit) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.units(sheetId) });
      const tempId = `temp_${Date.now()}`;
      const tempUnit = { ...newUnit, id: tempId } as Unit;
      queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, old => old ? [...old, tempUnit] : [tempUnit]);
      return {};
    },
    onError: () => {},
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.units(sheetId) });
      // Invalidate all project units prefix
      queryClient.invalidateQueries({ queryKey: ['all_project_units'] });
    }
  });
}

export function useUpdateUnitGeometry(sheetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ unitId, polygon_coordinates }: UpdateUnitGeometryVars) => {
      const { data, error } = await supabase.from('units').update({ polygon_coordinates: polygon_coordinates as any }).eq('id', unitId).select().single();
      if (error) throw error;
      return data;
    },
    onMutate: async ({ unitId, polygon_coordinates }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.units(sheetId) });
      queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, old => {
        if (!old) return old;
        return old.map(u => u.id === unitId ? { ...u, polygon_coordinates: polygon_coordinates as any } : u);
      });
      return {};
    },
    onError: () => {},
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.units(sheetId) });
      queryClient.invalidateQueries({ queryKey: ['all_project_units'] });
    }
  });
}

export function useUpdateUnitFields(sheetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ unitId, updates }: { unitId: string, updates: Partial<Unit> & { status_logs?: any } }) => {
      const { status_logs, ...dbUpdates } = updates;
      const { data, error } = await supabase.from('units').update(dbUpdates as any).eq('id', unitId).select().single();
      if (error) throw error;
      return data;
    },
    onMutate: async ({ unitId, updates }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.units(sheetId) });
      queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, old => {
        if (!old) return old;
        return old.map(u => u.id === unitId ? { ...u, ...updates } as Unit : u);
      });
      return {};
    },
    onError: () => {},
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.units(sheetId) });
      queryClient.invalidateQueries({ queryKey: ['all_project_units'] });
    }
  });
}

export function useDeleteUnit(sheetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (unitId: string) => {
      await supabase.from('status_logs').delete().eq('unit_id', unitId);
      const { error } = await supabase.from('units').delete().eq('id', unitId);
      if (error) throw error;
    },
    onMutate: async (unitId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.units(sheetId) });
      queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, old => old ? old.filter(u => u.id !== unitId) : old);
      return {};
    },
    onError: () => {},
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.units(sheetId) });
      queryClient.invalidateQueries({ queryKey: ['statuses', sheetId] });
      queryClient.invalidateQueries({ queryKey: ['all_project_units'] });
    }
  });
}

export function useUpdateStatus(sheetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (newLogData: UpdateStatusVars) => {
      const safeData = { ...newLogData } as any;
      if (safeData.logged_date === null) delete safeData.logged_date;

      delete safeData.created_at;
      delete safeData.id;
      safeData.client_timestamp = new Date().toISOString();

      const { data, error } = await supabase.from('status_logs').insert([safeData]).select().single();
      if (error) throw error;
      return data;
    },
    onMutate: async (newLogData) => {
      await queryClient.cancelQueries({ queryKey: ['statuses', sheetId] });
      await queryClient.cancelQueries({ queryKey: ['all_project_statuses'] });
      
      const optimisticLog = { 
        ...newLogData, 
        id: `temp_${Date.now()}`, 
        created_at: new Date().toISOString() 
      } as StatusLog;

      queryClient.setQueriesData<StatusLog[]>({ queryKey: ['statuses', sheetId] }, old => {
        if (!old) return old;
        const filtered = old.filter(s => !(s.unit_id === newLogData.unit_id && s.track === newLogData.track && s.milestone === newLogData.milestone));
        return [...filtered, optimisticLog];
      });

      queryClient.setQueriesData<StatusLog[]>({ queryKey: ['all_project_statuses'] }, old => {
        if (!old) return old;
        const filtered = old.filter(s => !(s.unit_id === newLogData.unit_id && s.track === newLogData.track && s.milestone === newLogData.milestone));
        return [...filtered, optimisticLog];
      });

      return {};
    },
    onError: () => {},
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['statuses', sheetId] });
      queryClient.invalidateQueries({ queryKey: ['all_project_statuses'] });
    }
  });
}

export function useClearStatus(sheetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ unitId, track, milestone }: { unitId: string, track: string, milestone: string }) => {
      const newLog = {
          unit_id: unitId,
          track: track,
          milestone: milestone,
          temporal_state: 'none' as TemporalState,
          client_timestamp: new Date().toISOString()
      };
      const { error } = await supabase.from('status_logs').insert([newLog as any]);
      if (error) throw error;
    },
    onMutate: async ({ unitId, track, milestone }) => {
      await queryClient.cancelQueries({ queryKey: ['statuses', sheetId] });
      await queryClient.cancelQueries({ queryKey: ['all_project_statuses'] });
      
      const optimisticLog = { 
        unit_id: unitId, 
        track, 
        milestone, 
        temporal_state: 'none' as TemporalState, 
        id: `temp_clear_${Date.now()}`, 
        created_at: new Date().toISOString(),
        status_color: 'rgba(0,0,0,0)',
        planned_start_date: null,
        planned_end_date: null,
        logged_date: new Date().toISOString(),
        client_timestamp: null
      } as StatusLog;

      queryClient.setQueriesData<StatusLog[]>({ queryKey: ['statuses', sheetId] }, old => {
        if (!old) return old;
        const filtered = old.filter(s => !(s.unit_id === unitId && s.track === track && s.milestone === milestone));
        return [...filtered, optimisticLog];
      });
      
      queryClient.setQueriesData<StatusLog[]>({ queryKey: ['all_project_statuses'] }, old => {
        if (!old) return old;
        const filtered = old.filter(s => !(s.unit_id === unitId && s.track === track && s.milestone === milestone));
        return [...filtered, optimisticLog];
      });

      return {};
    },
    onError: () => {},
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['statuses', sheetId] });
      queryClient.invalidateQueries({ queryKey: ['all_project_statuses'] });
    }
  });
}

export function useUpdateMilestone(projectId: string, sheetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, oldName, newName, newColor }: { id: string, oldName: string, newName: string, newColor: string }) => {
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
      queryClient.invalidateQueries({ queryKey: queryKeys.milestones(projectId) });
      queryClient.invalidateQueries({ queryKey: ['statuses'] });
      queryClient.invalidateQueries({ queryKey: ['all_project_statuses'] });
    }
  });
}

export function useBulkUpdateStatus(sheetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ unitIds, milestone, color, temporal_state, track, planned_start_date, planned_end_date, logged_date, bottlenecks }: BulkUpdateStatusVars) => {
      const CHUNK_SIZE = 800;
      
      for (let i = 0; i < unitIds.length; i += CHUNK_SIZE) {
        const chunkIds = unitIds.slice(i, i + CHUNK_SIZE);
        
        if (milestone === '__KEEP_EXISTING__') {
          if (temporal_state !== '__KEEP_EXISTING__') {
            const newLogs: any[] = [];

            if (bottlenecks && bottlenecks.length > 0) {
              for (const id of chunkIds) {
                const b = bottlenecks.find(b => b.unit_id === id);
                if (b) {
                  newLogs.push({
                     unit_id: id,
                     milestone: b.milestone,
                     status_color: b.status_color || '',
                     temporal_state,
                     track,
                     planned_start_date: planned_start_date !== undefined ? planned_start_date : b.planned_start_date,
                     planned_end_date: planned_end_date !== undefined ? planned_end_date : b.planned_end_date,
                     logged_date: logged_date !== undefined ? logged_date : b.logged_date
                  });
                }
              }
            } else {
              const { data: latestLogs, error: logError } = await supabase.from('status_logs')
                .select('*')
                .in('unit_id', chunkIds)
                .eq('track', track);
              
              if (logError) throw logError;
              
              const latestStatusMap: Record<string, StatusLog> = {};
              latestLogs.forEach(log => {
                const key = `${log.unit_id}_${log.track}_${log.milestone}`;
                if (!latestStatusMap[key] || new Date(log.created_at || 0) >= new Date(latestStatusMap[key].created_at || 0)) {
                  latestStatusMap[key] = log;
                }
              });
              
              for (const id of chunkIds) {
                const existingArray = Object.values(latestStatusMap).filter(s => s.unit_id === id);
                for (const existing of existingArray) {
                    newLogs.push({
                       unit_id: id,
                       milestone: existing.milestone,
                       status_color: existing.status_color,
                       temporal_state,
                       track,
                       planned_start_date: planned_start_date !== undefined ? planned_start_date : existing.planned_start_date,
                       planned_end_date: planned_end_date !== undefined ? planned_end_date : existing.planned_end_date,
                       logged_date: logged_date !== undefined ? logged_date : existing.logged_date
                    });
                }
              }
            }

            if (newLogs.length > 0) {
              const today = new Date().toISOString().split('T')[0];
              const clientTimestamp = new Date().toISOString();
              const safeNewLogs = newLogs.map(l => {
                const copy = { ...l };
                if (copy.logged_date === null) copy.logged_date = today;
                delete copy.created_at;
                delete copy.id;
                copy.client_timestamp = clientTimestamp;
                return copy;
              });
              const { error: insertError } = await supabase.from('status_logs').insert(safeNewLogs);
              if (insertError) throw insertError;
            }
          }
        } else {
          if (milestone !== null && temporal_state !== '__KEEP_EXISTING__') {
            const finalLoggedDate = logged_date !== undefined ? logged_date : (temporal_state === 'completed' ? new Date().toISOString().split('T')[0] : null);
            const clientTimestamp = new Date().toISOString();
            const newLogs = chunkIds.map(id => {
              const baseLog = {
                unit_id: id,
                milestone,
                status_color: color,
                temporal_state,
                track,
                planned_start_date: planned_start_date || null,
                planned_end_date: planned_end_date || null,
                logged_date: finalLoggedDate,
                client_timestamp: clientTimestamp
              };
              const today = new Date().toISOString().split('T')[0];
              if (baseLog.logged_date === null) baseLog.logged_date = today;
              return baseLog;
            });
            
            const { error: insertError } = await supabase.from('status_logs').insert(newLogs as any);
            if (insertError) throw insertError;
          }
        }
      }
    },
    onMutate: async ({ unitIds, milestone, color, temporal_state, track, planned_start_date, planned_end_date, logged_date }) => {
      await queryClient.cancelQueries({ queryKey: ['statuses', sheetId] });
      await queryClient.cancelQueries({ queryKey: ['all_project_statuses'] });
      
      const updateCache = (old: StatusLog[] | undefined) => {
        if (!old) return old;
        
        if (milestone === '__KEEP_EXISTING__') {
          if (temporal_state === '__KEEP_EXISTING__') return old;
          return old.map(s => {
            if (unitIds.includes(s.unit_id as string) && s.track === track) {
              return { 
                  ...s, 
                  temporal_state: temporal_state as TemporalState,
                  planned_start_date: planned_start_date !== undefined ? planned_start_date : s.planned_start_date,
                  planned_end_date: planned_end_date !== undefined ? planned_end_date : s.planned_end_date,
                  logged_date: logged_date !== undefined ? logged_date : s.logged_date
              };
            }
            return s;
          });
        }
        
        const filtered = old.filter(s => !(unitIds.includes(s.unit_id as string) && s.track === track && s.milestone === milestone));
        
        if (milestone === null || temporal_state === '__KEEP_EXISTING__') {
          return filtered;
        }
        
        const finalLoggedDate = logged_date !== undefined ? logged_date : (temporal_state === 'completed' ? new Date().toISOString().split('T')[0] : null);
        const now = new Date().toISOString();
        const optimisticLogs = unitIds.map(id => ({
          id: `temp_${id}_${Date.now()}`,
          unit_id: id,
          milestone,
          status_color: color,
          temporal_state: temporal_state as TemporalState,
          track,
          planned_start_date: planned_start_date || null,
          planned_end_date: planned_end_date || null,
          logged_date: finalLoggedDate,
          created_at: now,
          client_timestamp: now
        } as StatusLog));
        return [...filtered, ...optimisticLogs];
      };

      queryClient.setQueriesData<StatusLog[]>({ queryKey: ['statuses', sheetId] }, updateCache);
      queryClient.setQueriesData<StatusLog[]>({ queryKey: ['all_project_statuses'] }, updateCache);

      return {};
    },
    onError: () => {},
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['statuses', sheetId] });
      queryClient.invalidateQueries({ queryKey: ['all_project_statuses'] });
    }
  });
}

export function useBulkInsertStatusLogs(sheetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (logsArray: StatusLog[]) => {
      const today = new Date().toISOString().split('T')[0];
      const clientTimestamp = new Date().toISOString();
      const safeLogs = logsArray.map(log => {
        const copy = { ...log } as any;
        if (copy.logged_date === null) {
          copy.logged_date = today;
        }
        delete copy.created_at;
        delete copy.id;
        copy.client_timestamp = clientTimestamp;
        return copy;
      });

      const CHUNK_SIZE = 800;
      for (let i = 0; i < safeLogs.length; i += CHUNK_SIZE) {
        const chunk = safeLogs.slice(i, i + CHUNK_SIZE);
        const { error } = await supabase.from('status_logs').insert(chunk);
        if (error) throw error;
      }
    },
    onMutate: async (logsArray) => {
      await queryClient.cancelQueries({ queryKey: ['statuses', sheetId] });
      await queryClient.cancelQueries({ queryKey: ['all_project_statuses'] });
      
      const updateCache = (old: StatusLog[] | undefined) => {
        if (!old) return old;
        
        const keysToRemove = new Set(logsArray.map(l => `${l.unit_id}_${l.track}_${l.milestone}`));
        const filtered = old.filter(s => !keysToRemove.has(`${s.unit_id}_${s.track}_${s.milestone}`));
        
        const optimisticLogs = logsArray.map((l, idx) => ({
          ...l,
          id: `temp_${Date.now()}_${idx}`,
          created_at: new Date().toISOString()
        } as StatusLog));
        return [...filtered, ...optimisticLogs];
      };

      queryClient.setQueriesData<StatusLog[]>({ queryKey: ['statuses', sheetId] }, updateCache);
      queryClient.setQueriesData<StatusLog[]>({ queryKey: ['all_project_statuses'] }, updateCache);
      return {};
    },
    onError: () => {},
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['statuses', sheetId] });
      queryClient.invalidateQueries({ queryKey: ['all_project_statuses'] });
    }
  });
}

export function useUpdateSheetScopes(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ sheetId, active_scopes }: { sheetId: string, active_scopes: any }) => {
      const { data, error } = await supabase.from('sheets').update({ active_scopes }).eq('id', sheetId).select().single();
      if (error) throw error;
      return data;
    },
    onMutate: async ({ sheetId, active_scopes }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.sheets(projectId) });
      queryClient.setQueriesData<Sheet[]>({ queryKey: queryKeys.sheets(projectId) }, old => {
        if (!old) return old;
        return old.map(s => s.id === sheetId ? { ...s, active_scopes } as Sheet : s);
      });
      return {};
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.sheets(projectId) })
  });
}

export function useUpdateSheetScale(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ sheetId, scale_preset, scale_ratio }: { sheetId: string, scale_preset: string, scale_ratio: number }) => {
      const { data, error } = await supabase.from('sheets').update({ scale_preset, scale_ratio }).eq('id', sheetId).select().single();
      if (error) throw error;
      return data;
    },
    onMutate: async ({ sheetId, scale_preset, scale_ratio }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.sheets(projectId) });
      queryClient.setQueriesData<Sheet[]>({ queryKey: queryKeys.sheets(projectId) }, old => {
        if (!old) return old;
        return old.map(s => s.id === sheetId ? { ...s, scale_preset, scale_ratio } as Sheet : s);
      });
      return {};
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.sheets(projectId) })
  });
}

export function useUpdateSheetSchedule(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ sheetId, milestone_schedules }: { sheetId: string, milestone_schedules: any }) => {
      const { data, error } = await supabase.from('sheets').update({ milestone_schedules }).eq('id', sheetId).select().single();
      if (error) throw error;
      return data;
    },
    onMutate: async ({ sheetId, milestone_schedules }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.sheets(projectId) });
      queryClient.setQueriesData<Sheet[]>({ queryKey: queryKeys.sheets(projectId) }, old => {
        if (!old) return old;
        return old.map(s => s.id === sheetId ? { ...s, milestone_schedules } as Sheet : s);
      });
      return {};
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.sheets(projectId) })
  });
}

export function useReorderMilestones(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updatedMilestones: Milestone[]) => {
      const CHUNK_SIZE = 800;
      for (const m of updatedMilestones) {
        const { error } = await supabase.from('project_milestones')
          .update({ sequence_order: m.sequence_order })
          .eq('id', m.id);
        if (error) throw error;
      }
    },
    onMutate: async (updatedMilestones) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.milestones(projectId) });
      queryClient.setQueriesData<Milestone[]>({ queryKey: queryKeys.milestones(projectId) }, old => {
        if (!old) return old;
        const updatesMap: Record<string, number | null> = {};
        updatedMilestones.forEach(um => updatesMap[um.id] = um.sequence_order);
        
        return old.map(m => {
          if (updatesMap[m.id] !== undefined) {
            return { ...m, sequence_order: updatesMap[m.id] };
          }
          return m;
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
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.milestones(projectId) })
  });
}

export function useReorderSheets(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updatedSheets: Sheet[]) => {
      for (const sheet of updatedSheets) {
        const { error } = await supabase.from('sheets')
          .update({ sequence_order: sheet.sequence_order })
          .eq('id', sheet.id);
        if (error) throw error;
      }
    },
    onMutate: async (updatedSheets) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.sheets(projectId) });
      queryClient.setQueriesData<Sheet[]>({ queryKey: queryKeys.sheets(projectId) }, old => {
        if (!old) return old;
        const updatesMap: Record<string, number | null> = {};
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
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.sheets(projectId) })
  });
}

export function useUpdateWalkSequence(sheetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sequenceUpdates: { id: string, walk_sequence: number | null }[]) => {
      const CHUNK_SIZE = 800;
      for (let i = 0; i < sequenceUpdates.length; i += CHUNK_SIZE) {
        const chunk = sequenceUpdates.slice(i, i + CHUNK_SIZE);
        for (const update of chunk) {
          const { error } = await supabase
            .from('units')
            // Using any here as walk_sequence is not formally defined in the public schema provided, 
            // but is present in the logic map.
            .update({ walk_sequence: update.walk_sequence } as any)
            .eq('id', update.id);
          if (error) throw error;
        }
      }
    },
    onMutate: async (sequenceUpdates) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.units(sheetId) });
      queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, old => {
        if (!old) return old;
        const updateMap = new Map(sequenceUpdates.map(u => [u.id, u.walk_sequence]));
        return old.map(u => 
          updateMap.has(u.id) ? { ...u, walk_sequence: updateMap.get(u.id) } as unknown as Unit : u
        );
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.units(sheetId) });
      queryClient.invalidateQueries({ queryKey: ['all_project_units'] });
    }
  });
}

export function useUpdateProjectMemberRole(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string, role: string }) => {
      const { data, error } = await supabase
        .from('project_members')
        .update({ role })
        .eq('id', memberId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onMutate: async ({ memberId, role }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.projectMembers(projectId) });
      
      const previousMembers = queryClient.getQueryData<MemberWithProfile[]>(queryKeys.projectMembers(projectId));
      
      queryClient.setQueriesData<MemberWithProfile[]>({ queryKey: queryKeys.projectMembers(projectId) }, old => {
        if (!old) return old;
        return old.map(m => m.id === memberId ? { ...m, role } : m);
      });
      
      return { previousMembers };
    },
    onError: (err, newRole, context) => {
      if (context?.previousMembers) {
        queryClient.setQueryData(queryKeys.projectMembers(projectId), context.previousMembers);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projectMembers(projectId) });
    }
  });
}

export function useStatusHistory(unitIds: string[]) {
  const validUnitIds = unitIds?.filter(id => !String(id).startsWith('temp_')) || [];
  return useQuery({
    queryKey: queryKeys.statusHistory(...validUnitIds),
    queryFn: async (): Promise<Pick<StatusLog, 'unit_id' | 'milestone' | 'track' | 'logged_date'>[]> => {
      if (validUnitIds.length === 0) return [];
      const { data, error } = await supabase
        .from('status_logs')
        .select('unit_id, milestone, track, logged_date')
        .in('unit_id', validUnitIds)
        .eq('temporal_state', 'completed')
        .not('logged_date', 'is', null)
        .order('logged_date', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: validUnitIds.length > 0,
    staleTime: 1000 * 60 * 5,
    placeholderData: keepPreviousData,
  });
}

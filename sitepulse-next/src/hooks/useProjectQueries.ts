import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { extractVectorsService } from '@/services/api';
import { paginateAll } from '@/utils/pagination';
import { queryKeys } from '@/types/queryKeys';
import type {
  Project, Sheet, Unit, Milestone, StatusLog, Profile, ProjectMember,
  TemporalState, MilestoneOverride, ProjectContact, ProjectContactInsert,
  ScaleCalibration
} from '@/types/domain';
import { isOpeningEdgeArray } from '@/types/domain';
import type { Database, Json } from '@/types/database.types';
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
      // Re-pointed to status_audit_log: the append-only audit table preserves
      // full state-change history, unlike status_logs which is now slot-unique.
      const { data, error } = await supabase.from('status_audit_log')
        .select('*')
        .eq('unit_id', unitId)
        .order('changed_at', { ascending: false });
      if (error) throw error;
      return data as unknown as StatusLog[];
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

// ==== Project Contacts ====
// A shared project-level contact directory (one row per person, grouped by
// company). Managed in the Settings menu; READ = any member, WRITE = privileged
// roles (enforced by RLS — see 20260623_project_contacts.sql). Mutations mirror
// the milestone-hook conventions: optimistic cache update + invalidate.

// The editable fields a Settings form provides. id / project_id / created_by /
// timestamps are set by the hook or the DB, never by the caller.
export type ProjectContactFields = Omit<
  ProjectContactInsert,
  'id' | 'project_id' | 'created_by' | 'created_at' | 'updated_at'
>;

export function useProjectContacts(projectId: string) {
  return useQuery({
    queryKey: queryKeys.projectContacts(projectId),
    queryFn: async (): Promise<ProjectContact[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase.from('project_contacts')
        .select('*')
        .eq('project_id', projectId)
        .order('company', { ascending: true })
        .order('last_name', { ascending: true, nullsFirst: false })
        .order('first_name', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data;
    },
    enabled: !!projectId
  });
}

export function useCreateProjectContact(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (fields: ProjectContactFields): Promise<ProjectContact> => {
      const { data, error } = await supabase.from('project_contacts')
        .insert({ ...fields, project_id: projectId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onMutate: async (fields) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.projectContacts(projectId) });
      const now = new Date().toISOString();
      const optimistic: ProjectContact = {
        id: `temp_${Date.now()}`,
        project_id: projectId,
        company: fields.company,
        first_name: fields.first_name ?? null,
        last_name: fields.last_name ?? null,
        job_title: fields.job_title ?? null,
        mobile_phone: fields.mobile_phone ?? null,
        email: fields.email ?? null,
        procore_id: fields.procore_id ?? null,
        created_by: null,
        created_at: now,
        updated_at: now
      };
      queryClient.setQueriesData<ProjectContact[]>({ queryKey: queryKeys.projectContacts(projectId) }, old =>
        old ? [...old, optimistic] : [optimistic]);
      return {};
    },
    onError: () => {},
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.projectContacts(projectId) })
  });
}

export function useUpdateProjectContact(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string, updates: Partial<ProjectContactFields> }): Promise<ProjectContact> => {
      const { data, error } = await supabase.from('project_contacts')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.projectContacts(projectId) });
      queryClient.setQueriesData<ProjectContact[]>({ queryKey: queryKeys.projectContacts(projectId) }, old => {
        if (!old) return old;
        return old.map(c => c.id === id ? { ...c, ...updates } as ProjectContact : c);
      });
      return {};
    },
    onError: () => {},
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.projectContacts(projectId) })
  });
}

export function useDeleteProjectContact(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_contacts').delete().eq('id', id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.projectContacts(projectId) });
      queryClient.setQueriesData<ProjectContact[]>({ queryKey: queryKeys.projectContacts(projectId) }, old =>
        old ? old.filter(c => c.id !== id) : old);
      return {};
    },
    onError: () => {},
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.projectContacts(projectId) })
  });
}

// Bulk-import contacts (Phase 2 — Procore CSV). Upserts on the table's
// UNIQUE(project_id, email) so re-importing the same file UPDATES people with an
// email instead of duplicating them. NULL emails are distinct under that key, so
// blank-email rows each insert as their own row (by design — see the plan).
//
// De-dupe within the payload first: a single `INSERT … ON CONFLICT` command
// cannot touch the same (project_id, email) twice ("cannot affect row a second
// time"), so two rows sharing a non-null email in one file are collapsed to the
// last occurrence (the same end state the UNIQUE key would force anyway). The
// chunked upsert mirrors the 800-row bulk-status pattern.
export function useImportProjectContacts(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contacts: ProjectContactFields[]): Promise<number> => {
      // Collapse duplicate non-null emails (keep last); keep every null-email row.
      const byEmail = new Map<string, ProjectContactFields>();
      const noEmail: ProjectContactFields[] = [];
      for (const c of contacts) {
        const email = c.email?.trim();
        if (email) byEmail.set(email.toLowerCase(), c);
        else noEmail.push(c);
      }
      const deduped = [...byEmail.values(), ...noEmail];

      const rows = deduped.map(c => ({ ...c, project_id: projectId }));
      const CHUNK_SIZE = 800;
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const { error } = await supabase
          .from('project_contacts')
          .upsert(rows.slice(i, i + CHUNK_SIZE), { onConflict: 'project_id,email' });
        if (error) throw error;
      }
      return rows.length;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.projectContacts(projectId) })
  });
}

export function useMilestoneOverrides(projectId: string) {
  return useQuery({
    queryKey: queryKeys.milestoneOverrides(projectId),
    queryFn: async (): Promise<MilestoneOverride[]> => {
      if (!projectId) return [];
      // Inner-join filter scopes the fetch to this project's milestones.
      const { data, error } = await supabase
        .from('milestone_applicability_overrides')
        .select('*, project_milestones!inner(project_id)')
        .eq('project_milestones.project_id', projectId);
      if (error) throw error;
      // Strip the embedded join object so the cache stays a flat Row array.
      return (data || []).map(({ project_milestones, ...row }: any) => row as MilestoneOverride);
    },
    enabled: !!projectId
  });
}

/**
 * Narrow units' `opening_edges` JSONB (Phase 4a) on EVERY read — not just a fresh
 * fetch. The units query is persisted to IndexedDB (offline-first), so a drawing
 * cached BEFORE this column existed rehydrates with rows that lack the field; a
 * consumer that trusts the non-null `Unit['opening_edges']` type would then read
 * `undefined.length` and crash. Running this in React Query's `select` (not the
 * queryFn) applies it to rehydrated + optimistic cache too (AGENTS.md §6). Defined
 * at module scope so the select stays referentially stable (no extra re-renders),
 * and only the rows that actually need fixing get a new object (ref-stable otherwise).
 */
function selectUnitsWithOpeningEdges(rows: Unit[]): Unit[] {
  return rows.map((u) => (isOpeningEdgeArray(u.opening_edges) ? u : { ...u, opening_edges: [] }));
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
    enabled: !!sheetId,
    select: selectUnitsWithOpeningEdges,
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
      if (!session) {
        console.warn('[useSnappingVectors] No active session — vector snapping disabled');
        return null;
      }

      // Helper to format raw vector JSON into RBush-compatible items
      const formatVectors = (vectors: any[]): SnappingVectorLine[] => {
        return vectors.map((line: any) => ({
          minX: Math.min(line.start.pctX, line.end.pctX),
          minY: Math.min(line.start.pctY, line.end.pctY),
          maxX: Math.max(line.start.pctX, line.end.pctX),
          maxY: Math.max(line.start.pctY, line.end.pctY),
          lineData: line
        }));
      };

      try {
        // P1: Check cached vectors in sheet_vectors table first
        const { data: cachedRow } = await supabase
          .from('sheet_vectors')
          .select('vectors')
          .eq('sheet_id', sheetId)
          .maybeSingle();

        if (cachedRow?.vectors && Array.isArray(cachedRow.vectors)) {
          return cachedRow.vectors.length > 0 ? formatVectors(cachedRow.vectors as any[]) : [];
        }

        // Cache miss — extract from backend API
        const json = await extractVectorsService(sheetId, session.access_token);
        const formattedData = formatVectors(json.vectors);

        // Write-through: cache the raw vectors in the database for next time (fire-and-forget)
        if (json.vectors && json.vectors.length > 0) {
          void (async () => {
            try {
              await supabase
                .from('sheet_vectors')
                .upsert(
                  { sheet_id: sheetId, vectors: json.vectors as unknown as import('@/types/database.types').Json },
                  { onConflict: 'sheet_id' }
                );
            } catch (err: any) {
              console.error('[sheet_vectors] Write-through cache upsert failed:', err.message);
            }
          })();
        }
        
        return formattedData;
      } catch (err: any) {
        console.warn('Vector snapping unavailable for this sheet:', err.message);
        return null;
      }
    },
    enabled: !!sheetId,
    staleTime: Infinity,
    retry: (failureCount, error) => {
      // Retry once for transient fetch failures, not for 404/401
      if (failureCount < 1 && (error as Error)?.message?.includes('Failed to fetch')) return true;
      return false;
    },
    retryDelay: 5000,
  });
}

export function useStatuses(sheetId: string, unitIds: string[]) {
  const validUnitIds = unitIds?.filter(id => !String(id).startsWith('temp_')) || [];
  
  return useQuery({
    queryKey: queryKeys.statuses(sheetId, validUnitIds),
    queryFn: async (): Promise<StatusLog[]> => {
      if (!sheetId || validUnitIds.length === 0) return [];
      // Paginate: a single dense sheet (units × milestones) can exceed PostgREST's
      // 1000-row cap, which would otherwise truncate logs and show stale statuses.
      // The slot-unique constraint (unit_id, track, milestone) means no dedup needed.
      return fetchAllIn<StatusLog>('status_logs', 'unit_id', validUnitIds);
    },
    enabled: !!sheetId && validUnitIds.length > 0,
    placeholderData: keepPreviousData
  });
}

/**
 * Fetch every row of `table` whose `column` is in `values`, defeating PostgREST's
 * per-request row cap (1000 by default) AND its request-URL length limit.
 *
 * The id list is sliced into chunks (so the `.in(...)` URL stays well under header
 * limits), and each chunk is paged with `.range()` under a stable `.order('id')`
 * until exhausted. Without this, the all-levels views silently truncate once a
 * project exceeds 1000 status rows — completed milestones beyond the cap read back
 * as "not started" (see paginateAll). Used only for the cross-sheet aggregations.
 */
async function fetchAllIn<T>(
  table: 'status_logs' | 'units',
  column: 'unit_id' | 'sheet_id',
  values: string[]
): Promise<T[]> {
  const ID_CHUNK = 200; // keep each .in(...) URL comfortably under the ~8KB header limit
  const out: T[] = [];
  for (let i = 0; i < values.length; i += ID_CHUNK) {
    const slice = values.slice(i, i + ID_CHUNK);
    const rows = await paginateAll<T>(async (from, size) => {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .in(column, slice)
        .order('id', { ascending: true })
        .range(from, from + size - 1);
      if (error) throw error;
      return (data ?? []) as unknown as T[];
    });
    out.push(...rows);
  }
  return out;
}

export function useAllProjectUnits(sheetIds: string[]) {
  return useQuery({
    queryKey: queryKeys.allProjectUnits(sheetIds),
    queryFn: async (): Promise<Unit[]> => {
      if (!sheetIds || sheetIds.length === 0) return [];
      return fetchAllIn<Unit>('units', 'sheet_id', sheetIds);
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
      // With the slot-unique constraint (unit_id, track, milestone), the DB guarantees
      // one row per slot, so paginated chunks never overlap. No dedup needed.
      return fetchAllIn<StatusLog>('status_logs', 'unit_id', validUnitIds);
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
      // client_timestamp comes from PendingChange.capturedAt (offline-capture time).
      // For immediate (online) mutations, stamp here as a fallback.
      if (!safeData.client_timestamp) {
        safeData.client_timestamp = new Date().toISOString();
      }

      const { data, error } = await supabase
        .rpc('upsert_status_log', { log_data: safeData })
        .single();
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
      const { error } = await supabase.rpc('upsert_status_log', { log_data: newLog });
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
        // Scope the name-match to THIS project's units — milestones are linked
        // by name string, and other projects may have a same-named milestone.
        const { data: logs, error: fetchErr } = await supabase
          .from('status_logs')
          .select('id, units!inner(sheets!inner(project_id))')
          .eq('milestone', oldName)
          .eq('units.sheets.project_id', projectId);
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

export function useSetMilestoneApplicability(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ milestoneId, unitId, isApplicable }: { milestoneId: string, unitId: string, isApplicable: boolean }) => {
      const { data: { session } } = await supabase.auth.getSession();
      // Idempotent slot upsert — safe for offline mutation replay.
      const { data, error } = await supabase
        .from('milestone_applicability_overrides')
        .upsert({
          milestone_id: milestoneId,
          unit_id: unitId,
          is_applicable: isApplicable,
          created_by: session?.user?.id || null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'milestone_id,unit_id' })
        .select()
        .single();
      if (error) throw error;
      return data as MilestoneOverride;
    },
    onMutate: async ({ milestoneId, unitId, isApplicable }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.milestoneOverrides(projectId) });
      queryClient.setQueriesData<MilestoneOverride[]>({ queryKey: queryKeys.milestoneOverrides(projectId) }, old => {
        if (!old) return old;
        const filtered = old.filter(o => !(o.milestone_id === milestoneId && o.unit_id === unitId));
        const optimistic = {
          id: `temp_${Date.now()}`,
          milestone_id: milestoneId,
          unit_id: unitId,
          is_applicable: isApplicable,
          created_by: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        } as MilestoneOverride;
        return [...filtered, optimistic];
      });
      return {};
    },
    onError: () => {},
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.milestoneOverrides(projectId) })
  });
}

export function useBulkSetApplicability(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ milestoneId, unitIds, isApplicable }: { milestoneId: string, unitIds: string[], isApplicable: boolean }) => {
      const { data: { session } } = await supabase.auth.getSession();
      const now = new Date().toISOString();
      const rows = unitIds.map(unitId => ({
        milestone_id: milestoneId,
        unit_id: unitId,
        is_applicable: isApplicable,
        created_by: session?.user?.id || null,
        updated_at: now
      }));
      const CHUNK_SIZE = 800;
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const { error } = await supabase
          .from('milestone_applicability_overrides')
          .upsert(rows.slice(i, i + CHUNK_SIZE), { onConflict: 'milestone_id,unit_id' });
        if (error) throw error;
      }
    },
    onMutate: async ({ milestoneId, unitIds, isApplicable }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.milestoneOverrides(projectId) });
      queryClient.setQueriesData<MilestoneOverride[]>({ queryKey: queryKeys.milestoneOverrides(projectId) }, old => {
        if (!old) return old;
        const unitSet = new Set(unitIds);
        const filtered = old.filter(o => !(o.milestone_id === milestoneId && unitSet.has(o.unit_id)));
        const now = new Date().toISOString();
        const optimistic = unitIds.map((unitId, idx) => ({
          id: `temp_${Date.now()}_${idx}`,
          milestone_id: milestoneId,
          unit_id: unitId,
          is_applicable: isApplicable,
          created_by: null,
          created_at: now,
          updated_at: now
        } as MilestoneOverride));
        return [...filtered, ...optimistic];
      });
      return {};
    },
    onError: () => {},
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.milestoneOverrides(projectId) })
  });
}

export function useUpdateMilestoneRules(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, applies_to_unit_types }: { id: string, applies_to_unit_types: string[] | null }) => {
      const { data, error } = await supabase
        .from('project_milestones')
        .update({ applies_to_unit_types })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as Milestone;
    },
    onMutate: async ({ id, applies_to_unit_types }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.milestones(projectId) });
      queryClient.setQueriesData<Milestone[]>({ queryKey: queryKeys.milestones(projectId) }, old => {
        if (!old) return old;
        return old.map(m => m.id === id ? { ...m, applies_to_unit_types } as Milestone : m);
      });
      return {};
    },
    onError: () => {},
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.milestones(projectId) })
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
              const { error: upsertError } = await supabase.from('status_logs').upsert(safeNewLogs, { onConflict: 'unit_id,track,milestone' });
              if (upsertError) throw upsertError;
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
            
            const { error: upsertError } = await supabase.from('status_logs').upsert(newLogs as any, { onConflict: 'unit_id,track,milestone' });
            if (upsertError) throw upsertError;
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
        const { error } = await supabase.from('status_logs').upsert(chunk, { onConflict: 'unit_id,track,milestone' });
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

/**
 * Read a single sheet by primary key. The universal way the scale tooling reads
 * the active drawing's scale: it works on BOTH the live map (sheet lives in the
 * project-scoped `sheets` cache) and the workbench (sheet lives in the
 * container-scoped `workbenchSheets` cache, and there's no `projectId` route
 * param) — a PK read needs neither. Kept in sync optimistically + on settle by
 * {@link useUpdateSheetScale}.
 */
export function useSheetById(sheetId: string | null | undefined) {
  return useQuery({
    queryKey: ['sheet', sheetId ?? ''] as const,
    queryFn: async (): Promise<Sheet | null> => {
      if (!sheetId) return null;
      const { data, error } = await supabase.from('sheets').select('*').eq('id', sheetId).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!sheetId,
  });
}

/**
 * The scale write. One mutation for the whole scale story (Scale, Measure &
 * Production Rates — Phase 2): the legacy `scale_preset` / `scale_ratio` (kept in
 * sync for back-compat + the SettingsMenu dropdown) PLUS the canonical
 * `scale_units_per_px`, `scale_unit`, and `scale_calibration` provenance. The
 * three new fields are optional so the legacy SettingsMenu call site (preset +
 * ratio only) still type-checks; only supplied fields are written.
 */
export interface UpdateSheetScaleVars {
  sheetId: string;
  scale_preset: string;
  scale_ratio: number;
  scale_units_per_px?: number | null;
  scale_unit?: string | null;
  scale_calibration?: ScaleCalibration | null;
}

export function useUpdateSheetScale(projectId: string) {
  const queryClient = useQueryClient();
  // The partial written to BOTH the DB and the two caches. Only include the new
  // fields when the caller supplied them, so the legacy path stays untouched.
  const buildPatch = (v: UpdateSheetScaleVars): Partial<Sheet> => {
    const p: Partial<Sheet> = { scale_preset: v.scale_preset, scale_ratio: v.scale_ratio };
    if (v.scale_units_per_px !== undefined) p.scale_units_per_px = v.scale_units_per_px;
    if (v.scale_unit !== undefined) p.scale_unit = v.scale_unit;
    if (v.scale_calibration !== undefined) p.scale_calibration = v.scale_calibration as unknown as Json;
    return p;
  };
  return useMutation({
    mutationFn: async (vars: UpdateSheetScaleVars) => {
      const patch = buildPatch(vars) as Database['public']['Tables']['sheets']['Update'];
      const { data, error } = await supabase.from('sheets').update(patch).eq('id', vars.sheetId).select().single();
      if (error) throw error;
      return data;
    },
    onMutate: async (vars) => {
      const patch = buildPatch(vars);
      await queryClient.cancelQueries({ queryKey: queryKeys.sheets(projectId) });
      await queryClient.cancelQueries({ queryKey: ['sheet', vars.sheetId] });
      queryClient.setQueriesData<Sheet[]>({ queryKey: queryKeys.sheets(projectId) }, old => {
        if (!old) return old;
        return old.map(s => s.id === vars.sheetId ? { ...s, ...patch } as Sheet : s);
      });
      queryClient.setQueryData<Sheet | null>(['sheet', vars.sheetId], old =>
        old ? ({ ...old, ...patch } as Sheet) : old);
      return {};
    },
    onSettled: (_data, _err, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets(projectId) });
      queryClient.invalidateQueries({ queryKey: ['sheet', vars.sheetId] });
    }
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
      // Re-pointed to status_audit_log: the audit table has the full append-only
      // history of completed milestones, used by the dashboard timeline chart.
      const { data, error } = await supabase
        .from('status_audit_log')
        .select('unit_id, milestone, track, logged_date, client_timestamp, user_id')
        .in('unit_id', validUnitIds)
        .eq('temporal_state', 'completed')
        .not('logged_date', 'is', null)
        .order('logged_date', { ascending: true });
      if (error) throw error;
      return data as unknown as Pick<StatusLog, 'unit_id' | 'milestone' | 'track' | 'logged_date'>[];
    },
    enabled: validUnitIds.length > 0,
    staleTime: 1000 * 60 * 5,
    placeholderData: keepPreviousData,
  });
}

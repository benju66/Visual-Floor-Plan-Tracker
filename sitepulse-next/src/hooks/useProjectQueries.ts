import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { paginateAll } from '@/utils/pagination';
import { queryKeys } from '@/types/queryKeys';
import type {
  Project, Sheet, Unit, Activity, StatusLog, Profile, ProjectMember,
  TemporalState, ActivityOverride, ProjectContact, ProjectContactInsert,
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

export function useUnitHistory(unitId: string, enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.unitHistory(unitId),
    queryFn: async (): Promise<StatusLog[]> => {
      if (!unitId) return [];
      // Re-pointed to status_audit_log: the append-only audit table preserves
      // full state-change history, unlike status_logs which is now slot-unique.
      // Map its `activity_name` snapshot onto the domain `activityName` field.
      const { data, error } = await supabase.from('status_audit_log')
        .select('*')
        .eq('unit_id', unitId)
        .order('changed_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(r => ({ ...r, activityName: r.activity_name })) as unknown as StatusLog[];
    },
    // `enabled` lets a caller defer the fetch until it's actually needed — the List's
    // expanded rows pass their near-viewport presence so "expand all" doesn't fire N
    // history queries at once (List View Performance — Phase 2). Default true keeps
    // every existing caller (Unit History modal, inspector) fetching eagerly.
    enabled: !!unitId && enabled
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

// ==== Project Contacts ====
// A shared project-level contact directory (one row per person, grouped by
// company). Managed in the Settings menu; READ = any member, WRITE = privileged
// roles (enforced by RLS — see 20260623_project_contacts.sql). Mutations mirror
// the activity-hook conventions: optimistic cache update + invalidate.

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

export function useStatuses(sheetId: string, unitIds: string[]) {
  const validUnitIds = unitIds?.filter(id => !String(id).startsWith('temp_')) || [];
  
  return useQuery({
    queryKey: queryKeys.statuses(sheetId, validUnitIds),
    queryFn: async (): Promise<StatusLog[]> => {
      if (!sheetId || validUnitIds.length === 0) return [];
      // Paginate: a single dense sheet (units × activities) can exceed PostgREST's
      // 1000-row cap, which would otherwise truncate logs and show stale statuses.
      // The slot-unique constraint (unit_id, activity_id) means no dedup needed.
      return fetchStatusLogsForUnits(validUnitIds);
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
 * project exceeds 1000 status rows — completed activities beyond the cap read back
 * as "not started" (see paginateAll). Exported for every cross-sheet/cross-unit
 * aggregation read (dashboard, workbench corpus, sheet delete) — any new
 * `.in(<ids>)` read over an unbounded id list should go through here.
 */
export async function fetchAllIn<T>(
  table: 'status_logs' | 'units',
  column: 'unit_id' | 'sheet_id',
  values: string[],
  select: string = '*'
): Promise<T[]> {
  const ID_CHUNK = 200; // keep each .in(...) URL comfortably under the ~8KB header limit
  const out: T[] = [];
  for (let i = 0; i < values.length; i += ID_CHUNK) {
    const slice = values.slice(i, i + ID_CHUNK);
    const rows = await paginateAll<T>(async (from, size) => {
      const { data, error } = await supabase
        .from(table)
        .select(select)
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

/**
 * status_logs keys by `activity_id` (the stable id). The status pipeline still
 * correlates + displays by the activity's NAME, so every read joins `activities(name)`
 * and flattens it onto a synthesized `activityName` field — keeping `StatusLog` shape-
 * compatible with the rest of the app while the DB stays id-keyed (Scheduling
 * Foundation Slice A, Phase 1). Renaming an activity changes only this synthesized
 * name on the next read; the stored history is never touched.
 */
type StatusRowWithActivity = Omit<StatusLog, 'activityName'> & { activities: { name: string } | null };
async function fetchStatusLogsForUnits(unitIds: string[]): Promise<StatusLog[]> {
  const rows = await fetchAllIn<StatusRowWithActivity>(
    'status_logs', 'unit_id', unitIds, '*, activities(name)'
  );
  return rows.map(({ activities, ...r }) => ({ ...r, activityName: activities?.name ?? '' } as StatusLog));
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
      // With the slot-unique constraint (unit_id, activity_id), the DB guarantees
      // one row per slot, so paginated chunks never overlap. No dedup needed.
      return fetchStatusLogsForUnits(validUnitIds);
    },
    enabled: validUnitIds.length > 0,
    placeholderData: keepPreviousData
  });
}

// ==== Mutations ====

// The unit-CRUD mutations below are ONLINE-ONLY (they never enter the offline
// queue — that is status_logs territory, AGENTS §2), so a failure is final and
// the optimistic cache edit MUST be rolled back: without it a failed create
// leaves a phantom, unsaveable location on the canvas and a failed delete hides
// a location that still exists. Each hook snapshots every matching cache entry
// in onMutate (getQueriesData — setQueriesData partial-matches, so restore must
// too) and restores the snapshot in onError; error MESSAGING stays at the call
// sites (the map handlers already toast). The onSettled invalidation then
// re-confirms server truth whenever it can reach the server.

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
      const prev = queryClient.getQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) });
      const tempId = `temp_${Date.now()}`;
      const tempUnit = { ...newUnit, id: tempId } as Unit;
      queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, old => old ? [...old, tempUnit] : [tempUnit]);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.prev?.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.units(sheetId) });
      // Invalidate all project units prefix
      queryClient.invalidateQueries({ queryKey: queryKeys.allProjectUnitsAll() });
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
      const prev = queryClient.getQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) });
      queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, old => {
        if (!old) return old;
        return old.map(u => u.id === unitId ? { ...u, polygon_coordinates: polygon_coordinates as any } : u);
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.prev?.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.units(sheetId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.allProjectUnitsAll() });
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
      const prev = queryClient.getQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) });
      queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, old => {
        if (!old) return old;
        return old.map(u => u.id === unitId ? { ...u, ...updates } as Unit : u);
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.prev?.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.units(sheetId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.allProjectUnitsAll() });
    }
  });
}

/**
 * Danger-zone bulk clear of `units.unit_type` across a whole project (Settings →
 * Location Types). Replaces the old per-unit `useUpdateUnitFields('')` fan-out,
 * which fired one unhandled PATCH per location simultaneously, pointed its
 * optimistic edits/invalidations at a nonexistent `units('')` cache, and
 * reported nothing on failure. Chunked (200 ids/request — the same URL-limit
 * rule as fetchAllIn), error-checked, and deliberately NOT optimistic — on
 * settle the `['units']` prefix invalidation refetches every sheet's list to
 * server truth. Returns the number of locations cleared.
 */
export function useClearProjectUnitTypes() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (unitIds: string[]): Promise<number> => {
      const ID_CHUNK = 200;
      for (let i = 0; i < unitIds.length; i += ID_CHUNK) {
        const { error } = await supabase
          .from('units')
          .update({ unit_type: null })
          .in('id', unitIds.slice(i, i + ID_CHUNK));
        if (error) throw error;
      }
      return unitIds.length;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.unitsAll() });
      queryClient.invalidateQueries({ queryKey: queryKeys.allProjectUnitsAll() });
    }
  });
}

/**
 * Bulk-refresh `units.computed_area` for a drawing (Scale, Measure & Production
 * Rates — Phase 3, "Recalculate areas"). The caller (ScaleControl) has already
 * recomputed each area from the sheet's current `scale_units_per_px`; this hook
 * only writes them. Each write is a plain `units.computed_area` column update via
 * the same online path as the other unit mutations — NOT `status_logs`, NOT the
 * offline `pendingChanges` buffer (AGENTS.md §2; online-first is intentional).
 *
 * Sequential writes keep it simple and cache-consistent — a sheet holds at most a
 * few dozen units. Returns the number of rows written.
 */
export interface RecalculateAreaUpdate {
  unitId: string;
  computed_area: number | null;
}

export function useRecalculateSheetAreas(sheetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (updates: RecalculateAreaUpdate[]): Promise<number> => {
      for (const { unitId, computed_area } of updates) {
        const { error } = await supabase.from('units').update({ computed_area }).eq('id', unitId);
        if (error) throw error;
      }
      return updates.length;
    },
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.units(sheetId) });
      const prev = queryClient.getQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) });
      const byId = new Map(updates.map(u => [u.unitId, u.computed_area]));
      queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, old => {
        if (!old) return old;
        return old.map(u => byId.has(u.id) ? { ...u, computed_area: byId.get(u.id) ?? null } : u);
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.prev?.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.units(sheetId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.allProjectUnitsAll() });
    }
  });
}

export function useDeleteUnit(sheetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (unitId: string) => {
      // The status rows go first (FK-safe) and their delete error must surface
      // too — a failed log delete followed by a "successful" mutation would
      // leave the slot rows orphaned while the UI reports the unit deleted.
      const { error: logError } = await supabase.from('status_logs').delete().eq('unit_id', unitId);
      if (logError) throw logError;
      const { error } = await supabase.from('units').delete().eq('id', unitId);
      if (error) throw error;
    },
    onMutate: async (unitId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.units(sheetId) });
      const prev = queryClient.getQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) });
      queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, old => old ? old.filter(u => u.id !== unitId) : old);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.prev?.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.units(sheetId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.statusesBySheet(sheetId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.allProjectUnitsAll() });
    }
  });
}

export function useUpdateStatus(sheetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (newLogData: UpdateStatusVars) => {
      const safeData = { ...newLogData } as any;
      // Phase 5 (Status Sequencing DB backstop): upsert_status_log now PRESERVES a field
      // whose JSON key is ABSENT and only CLEARS one that is present-but-null/empty. So we
      // must NOT drop a null logged_date — dropping it would turn an explicit "clear the
      // completion date" into a silent preserve. commitUnitActivity always sends logged_date
      // explicitly (a real value, or null to clear), so leaving the key present is exactly
      // the intent. (present-null and present-'' are equivalent clears in the RPC.)

      delete safeData.created_at;
      delete safeData.id;
      // `activityName` is the activity NAME, carried only for the optimistic cache
      // entry's display — the RPC keys by activity_id, so strip it before the call.
      // (`milestone` is stripped too: pendingChanges captured before the
      // milestone→activity rename can replay with the legacy key.)
      delete safeData.activityName;
      delete safeData.milestone;
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
      await queryClient.cancelQueries({ queryKey: queryKeys.statusesBySheet(sheetId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.allProjectStatusesAll() });
      
      const optimisticLog = { 
        ...newLogData, 
        id: `temp_${Date.now()}`, 
        created_at: new Date().toISOString() 
      } as StatusLog;

      queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.statusesBySheet(sheetId) }, old => {
        if (!old) return old;
        const filtered = old.filter(s => !(s.unit_id === newLogData.unit_id && s.activity_id === newLogData.activity_id));
        return [...filtered, optimisticLog];
      });

      queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.allProjectStatusesAll() }, old => {
        if (!old) return old;
        const filtered = old.filter(s => !(s.unit_id === newLogData.unit_id && s.activity_id === newLogData.activity_id));
        return [...filtered, optimisticLog];
      });

      return {};
    },
    onError: () => {},
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.statusesBySheet(sheetId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.allProjectStatusesAll() });
    }
  });
}

export function useClearStatus(sheetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ unitId, track, activityId }: { unitId: string, track: string, activityId: string, activityName?: string }) => {
      const newLog = {
          unit_id: unitId,
          track: track,
          activity_id: activityId,
          temporal_state: 'none' as TemporalState,
          // Clearing a slot to Not Started is a FULL reset. Post-Phase-5, upsert_status_log
          // PRESERVES any field we omit, so we must send these explicitly-empty to keep wiping
          // the slot's color + dates — a 'none' slot must not carry a stale color or a
          // planned/completion/actual-start date. '' is the RPC's present-but-empty clear
          // (NULLIF(...,'') → NULL). Before Phase 5 the same reset happened by omission
          // (absent = clear); now it is intentional and explicit.
          status_color: '',
          planned_start_date: '',
          planned_end_date: '',
          logged_date: '',
          actual_start_date: '',
          client_timestamp: new Date().toISOString()
      };
      const { error } = await supabase.rpc('upsert_status_log', { log_data: newLog });
      if (error) throw error;
    },
    onMutate: async ({ unitId, track, activityId, activityName }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.statusesBySheet(sheetId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.allProjectStatusesAll() });

      const optimisticLog = {
        unit_id: unitId,
        track,
        activity_id: activityId,
        activityName: activityName ?? '',
        temporal_state: 'none' as TemporalState,
        id: `temp_clear_${Date.now()}`,
        created_at: new Date().toISOString(),
        status_color: 'rgba(0,0,0,0)',
        planned_start_date: null,
        planned_end_date: null,
        logged_date: new Date().toISOString(),
        client_timestamp: null
      } as StatusLog;

      queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.statusesBySheet(sheetId) }, old => {
        if (!old) return old;
        const filtered = old.filter(s => !(s.unit_id === unitId && s.activity_id === activityId));
        return [...filtered, optimisticLog];
      });

      queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.allProjectStatusesAll() }, old => {
        if (!old) return old;
        const filtered = old.filter(s => !(s.unit_id === unitId && s.activity_id === activityId));
        return [...filtered, optimisticLog];
      });

      return {};
    },
    onError: () => {},
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.statusesBySheet(sheetId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.allProjectStatusesAll() });
    }
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

export function useBulkUpdateStatus(sheetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ unitIds, activityName, activity_id, color, temporal_state, track, planned_start_date, planned_end_date, logged_date, bottlenecks }: BulkUpdateStatusVars) => {
      const CHUNK_SIZE = 800;

      // '__KEEP_EXISTING__' updates the temporal_state of each unit's existing slot; a
      // real bulk-apply carries the resolved activity_id (the stable slot key). A null
      // activityName/activity_id with no keep sentinel is a no-op (matches prior behavior).
      const keepExisting = activityName === '__KEEP_EXISTING__';

      for (let i = 0; i < unitIds.length; i += CHUNK_SIZE) {
        const chunkIds = unitIds.slice(i, i + CHUNK_SIZE);

        if (keepExisting) {
          if (temporal_state !== '__KEEP_EXISTING__') {
            // Write rows for the (unit_id, activity_id) upsert — always fully
            // formed here (both branches pick explicit fields; id/created_at
            // never ride a write). client_timestamp is stamped on the safe copy.
            type SlotWrite = Pick<StatusLog,
              'unit_id' | 'activity_id' | 'status_color' | 'temporal_state' | 'track' |
              'planned_start_date' | 'planned_end_date' | 'logged_date'
            > & { client_timestamp?: StatusLog['client_timestamp'] };
            const newLogs: SlotWrite[] = [];

            if (bottlenecks && bottlenecks.length > 0) {
              for (const id of chunkIds) {
                const b = bottlenecks.find(b => b.unit_id === id);
                if (b) {
                  newLogs.push({
                     unit_id: id,
                     activity_id: b.activity_id,
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
              // Chunked + paginated readback (fetchAllIn): the old single
              // `.in(unit_id, <up to 800 ids>)` blew the ~8KB request-URL limit
              // AND silently truncated at PostgREST's 1000-row cap — slots past
              // the cap vanished from latestStatusMap, so those units were
              // skipped by the bulk update while the toast still reported
              // "N locations updated". Track is filtered client-side (fetchAllIn
              // is generic over the id column only).
              const allLogs = await fetchAllIn<StatusLog>('status_logs', 'unit_id', chunkIds);
              const latestLogs = allLogs.filter(l => l.track === track);

              const latestStatusMap: Record<string, StatusLog> = {};
              latestLogs.forEach(log => {
                const key = `${log.unit_id}_${log.activity_id}`;
                if (!latestStatusMap[key] || new Date(log.created_at || 0) >= new Date(latestStatusMap[key].created_at || 0)) {
                  latestStatusMap[key] = log as unknown as StatusLog;
                }
              });

              for (const id of chunkIds) {
                const existingArray = Object.values(latestStatusMap).filter(s => s.unit_id === id);
                for (const existing of existingArray) {
                    newLogs.push({
                       unit_id: id,
                       activity_id: existing.activity_id,
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
                const copy = { ...l, client_timestamp: clientTimestamp };
                // Today is stamped ONLY for a genuinely-new completion (state is
                // 'completed' and no date survived the merge) — a bulk "mark Planned/
                // Ongoing" must never fabricate a completion date (mirrors
                // commitUnitActivity's single-path rule).
                if (copy.logged_date === null && temporal_state === 'completed') copy.logged_date = today;
                return copy;
              });
              const { error: upsertError } = await supabase.from('status_logs').upsert(safeNewLogs, { onConflict: 'unit_id,activity_id' });
              if (upsertError) throw upsertError;
            }
          }
        } else {
          if (activity_id && temporal_state !== '__KEEP_EXISTING__') {
            // Completion date: honor a caller-supplied value; otherwise today ONLY for a
            // completion, explicit-null for every other state (present-clears — a slot
            // re-marked planned/ongoing must not keep, or gain, a completion date).
            const finalLoggedDate = logged_date !== undefined ? logged_date : (temporal_state === 'completed' ? new Date().toISOString().split('T')[0] : null);
            const clientTimestamp = new Date().toISOString();
            const newLogs = chunkIds.map(id => {
              const baseLog: Record<string, unknown> = {
                unit_id: id,
                activity_id: activity_id as string,
                status_color: color,
                temporal_state,
                track,
                logged_date: finalLoggedDate,
                client_timestamp: clientTimestamp
              };
              // Omit-preserves, present-clears (the Phase-5 RPC contract, applied to the
              // bulk upsert): an undefined planned date is OMITTED so the conflict-update
              // leaves the stored window untouched; an explicit value/null/'' is sent to
              // set/clear it. Keys stay uniform across the chunk (they derive from one
              // caller arg), which PostgREST bulk writes require.
              if (planned_start_date !== undefined) baseLog.planned_start_date = planned_start_date || null;
              if (planned_end_date !== undefined) baseLog.planned_end_date = planned_end_date || null;
              return baseLog;
            });

            const { error: upsertError } = await supabase.from('status_logs').upsert(newLogs as any, { onConflict: 'unit_id,activity_id' });
            if (upsertError) throw upsertError;
          }
        }
      }
    },
    onMutate: async ({ unitIds, activityName, activity_id, color, temporal_state, track, planned_start_date, planned_end_date, logged_date }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.statusesBySheet(sheetId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.allProjectStatusesAll() });

      const updateCache = (old: StatusLog[] | undefined) => {
        if (!old) return old;

        if (activityName === '__KEEP_EXISTING__') {
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
        
        // Prior rows for this slot, read BEFORE filtering: an omitted planned date
        // preserves the stored window in the cache exactly as the omit-preserves
        // upsert does in the DB (keeps cache and server in agreement).
        const priorBySlot = new Map<string, StatusLog>();
        for (const s of old) {
          if (unitIds.includes(s.unit_id as string) && s.activity_id === activity_id) priorBySlot.set(s.unit_id as string, s);
        }
        const filtered = old.filter(s => !(unitIds.includes(s.unit_id as string) && s.activity_id === activity_id));

        if (activityName === null || activity_id == null || temporal_state === '__KEEP_EXISTING__') {
          return filtered;
        }

        const finalLoggedDate = logged_date !== undefined ? logged_date : (temporal_state === 'completed' ? new Date().toISOString().split('T')[0] : null);
        const now = new Date().toISOString();
        const optimisticLogs = unitIds.map(id => ({
          id: `temp_${id}_${Date.now()}`,
          unit_id: id,
          activity_id,
          activityName,
          status_color: color,
          temporal_state: temporal_state as TemporalState,
          track,
          planned_start_date: planned_start_date !== undefined ? (planned_start_date || null) : (priorBySlot.get(id)?.planned_start_date ?? null),
          planned_end_date: planned_end_date !== undefined ? (planned_end_date || null) : (priorBySlot.get(id)?.planned_end_date ?? null),
          logged_date: finalLoggedDate,
          created_at: now,
          client_timestamp: now
        } as StatusLog));
        return [...filtered, ...optimisticLogs];
      };

      queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.statusesBySheet(sheetId) }, updateCache);
      queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.allProjectStatusesAll() }, updateCache);

      return {};
    },
    onError: () => {},
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.statusesBySheet(sheetId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.allProjectStatusesAll() });
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
        // The feeders (import / cascade / ripple) deliberately carry prior progress
        // through (`prior?.logged_date ?? null`) under the contract that a schedule
        // write never fabricates progress. Today is stamped ONLY when the row itself
        // records a completion missing its date; null on any other state stays null.
        if (copy.logged_date === null && copy.temporal_state === 'completed') {
          copy.logged_date = today;
        }
        delete copy.created_at;
        delete copy.id;
        // `activityName` is the synthesized display name, not a status_logs column.
        // (`milestone` too — the legacy pre-rename key, defensively stripped.)
        delete copy.activityName;
        delete copy.milestone;
        copy.client_timestamp = clientTimestamp;
        return copy;
      });

      const CHUNK_SIZE = 800;
      for (let i = 0; i < safeLogs.length; i += CHUNK_SIZE) {
        const chunk = safeLogs.slice(i, i + CHUNK_SIZE);
        const { error } = await supabase.from('status_logs').upsert(chunk, { onConflict: 'unit_id,activity_id' });
        if (error) throw error;
      }
    },
    onMutate: async (logsArray) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.statusesBySheet(sheetId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.allProjectStatusesAll() });

      const updateCache = (old: StatusLog[] | undefined) => {
        if (!old) return old;

        const keysToRemove = new Set(logsArray.map(l => `${l.unit_id}_${l.activity_id}`));
        const filtered = old.filter(s => !keysToRemove.has(`${s.unit_id}_${s.activity_id}`));
        
        const optimisticLogs = logsArray.map((l, idx) => ({
          ...l,
          id: `temp_${Date.now()}_${idx}`,
          created_at: new Date().toISOString()
        } as StatusLog));
        return [...filtered, ...optimisticLogs];
      };

      queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.statusesBySheet(sheetId) }, updateCache);
      queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.allProjectStatusesAll() }, updateCache);
      return {};
    },
    onError: () => {},
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.statusesBySheet(sheetId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.allProjectStatusesAll() });
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
    queryKey: queryKeys.sheet(sheetId ?? ''),
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
      await queryClient.cancelQueries({ queryKey: queryKeys.sheet(vars.sheetId) });
      queryClient.setQueriesData<Sheet[]>({ queryKey: queryKeys.sheets(projectId) }, old => {
        if (!old) return old;
        return old.map(s => s.id === vars.sheetId ? { ...s, ...patch } as Sheet : s);
      });
      queryClient.setQueryData<Sheet | null>(queryKeys.sheet(vars.sheetId), old =>
        old ? ({ ...old, ...patch } as Sheet) : old);
      return {};
    },
    onSettled: (_data, _err, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sheet(vars.sheetId) });
    }
  });
}

export function useUpdateSheetSchedule(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ sheetId, activity_schedules }: { sheetId: string, activity_schedules: any }) => {
      const { data, error } = await supabase.from('sheets').update({ activity_schedules }).eq('id', sheetId).select().single();
      if (error) throw error;
      return data;
    },
    onMutate: async ({ sheetId, activity_schedules }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.sheets(projectId) });
      queryClient.setQueriesData<Sheet[]>({ queryKey: queryKeys.sheets(projectId) }, old => {
        if (!old) return old;
        return old.map(s => s.id === sheetId ? { ...s, activity_schedules } as Sheet : s);
      });
      return {};
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.sheets(projectId) })
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
      queryClient.invalidateQueries({ queryKey: queryKeys.allProjectUnitsAll() });
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

export type StatusHistoryEvent = Pick<StatusLog, 'unit_id' | 'activity_id' | 'activityName' | 'track' | 'logged_date'>;

export function useStatusHistory(unitIds: string[]) {
  const validUnitIds = unitIds?.filter(id => !String(id).startsWith('temp_')) || [];
  return useQuery({
    queryKey: queryKeys.statusHistory(...validUnitIds),
    queryFn: async (): Promise<StatusHistoryEvent[]> => {
      if (validUnitIds.length === 0) return [];
      // Re-pointed to status_audit_log: the audit table has the full append-only
      // history of completed activities, used by the dashboard timeline chart AND
      // (Scheduling Analytics Phase 6) the production-rate math, which needs the
      // stable `activity_id` to join a completion to its cost code / subcontractor.
      // Map its `activity_name` snapshot onto the domain `activityName` field.
      //
      // Chunked + paginated (the fetchAllIn pattern, inlined for the audit-table
      // filters): the dashboard calls this with EVERY unit id in the project, so a
      // single `.in(...)` blows the ~8KB request-URL limit past ~200 ids (hard
      // failure → empty timeline) and silently truncates at PostgREST's 1000-row
      // cap (pace / weekly velocity / Monte Carlo quietly undercount). Ordering is
      // re-applied client-side because chunks return independently.
      type AuditRow = {
        unit_id: string; activity_id: string; activity_name: string; track: string;
        logged_date: string; client_timestamp: string | null; user_id: string | null;
      };
      const ID_CHUNK = 200; // keep each .in(...) URL comfortably under the header limit
      const rows: AuditRow[] = [];
      for (let i = 0; i < validUnitIds.length; i += ID_CHUNK) {
        const slice = validUnitIds.slice(i, i + ID_CHUNK);
        const chunkRows = await paginateAll<AuditRow>(async (from, size) => {
          const { data, error } = await supabase
            .from('status_audit_log')
            .select('unit_id, activity_id, activity_name, track, logged_date, client_timestamp, user_id')
            .in('unit_id', slice)
            .eq('temporal_state', 'completed')
            .not('logged_date', 'is', null)
            .order('id', { ascending: true })
            .range(from, from + size - 1);
          if (error) throw error;
          return (data ?? []) as unknown as AuditRow[];
        });
        rows.push(...chunkRows);
      }
      rows.sort((a, b) => (a.logged_date < b.logged_date ? -1 : a.logged_date > b.logged_date ? 1 : 0));
      return rows.map(({ activity_name, ...r }) => ({ ...r, activityName: activity_name })) as unknown as StatusHistoryEvent[];
    },
    enabled: validUnitIds.length > 0,
    staleTime: 1000 * 60 * 5,
    placeholderData: keepPreviousData,
  });
}

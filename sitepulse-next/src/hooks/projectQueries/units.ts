import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import type { Unit } from '@/types/domain';
import { isOpeningEdgeArray } from '@/types/domain';
import type { UpdateUnitGeometryVars } from '@/types/mutations';
import { fetchAllIn } from './shared';

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

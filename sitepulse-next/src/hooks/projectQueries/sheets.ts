import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import type { Sheet, ScaleCalibration } from '@/types/domain';
import type { Database, Json } from '@/types/database.types';

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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import {
  isGridlineArray,
  type Gridline,
  type SheetGridlines,
  type SheetGridlinesInsert,
} from '@/types/domain';
import { GRIDLINE_MODEL_VERSION, type GridlineRowPayload } from '@/utils/gridlineParse';
import { ANNOTATION_SPEC_VERSION } from '@/utils/traceCapture';

/**
 * Read a sheet's confirmed gridlines (AI Tracing Assist — Phase 3b). Cache-first,
 * like `useSheetMetadata` (staleTime: Infinity; the "accept all" write invalidates
 * this key). Narrows the two JSONB columns (`gridlines`, `suggested_gridlines`) at
 * THIS query boundary via {@link isGridlineArray} so no `Json` reaches component
 * props (AGENTS.md §6). Returns `null` when there's no row yet (no grids captured)
 * or no session — the canvas then draws nothing and the panel starts empty. A
 * malformed JSONB degrades to an empty array, never a throw.
 */
export function useSheetGridlines(sheetId: string | null) {
  const { data = null, isLoading, isFetching, error } = useQuery({
    queryKey: queryKeys.sheetGridlines(sheetId as string),
    queryFn: async (): Promise<SheetGridlines | null> => {
      if (!sheetId) return null;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;

      const { data: row, error: readErr } = await supabase
        .from('sheet_gridlines')
        .select('*')
        .eq('sheet_id', sheetId)
        .maybeSingle();
      if (readErr) {
        console.warn('[useSheetGridlines] read failed:', readErr.message);
        return null;
      }
      if (!row) return null;

      return {
        ...row,
        gridlines: isGridlineArray(row.gridlines) ? row.gridlines : [],
        suggested_gridlines: isGridlineArray(row.suggested_gridlines)
          ? row.suggested_gridlines
          : null,
      } as SheetGridlines;
    },
    enabled: !!sheetId,
    staleTime: Infinity,
  });

  return { gridlines: data, isLoading, isFetching, error };
}

/**
 * Upsert a sheet's confirmed gridlines — the Phase-3b "accept all" path. A
 * verified-capture write keyed 1:1 by sheet_id that REPLACES the whole array (the
 * caller passes the already-merged existing+new payload from
 * `mapPendingGridlinesToRow`, so this is a plain whole-row upsert, not a partial
 * append). Stamps Milestone-1 provenance on the row itself (mirroring
 * `useUpsertSheetMetadata`): gridlines aren't `units`/polygons, so — like the title
 * block — they're not logged to the room-shaped `trace_events`. The frozen
 * `suggested_gridlines` preserves the original machine proposal for training.
 *
 * RLS (owner/admin/pm member of the sheet's project) governs the write; no
 * container kind-guard is needed because the row is keyed to the sheet the user is
 * viewing. Online-first; invalidates only `sheetGridlines(sheetId)`.
 */
export function useUpsertSheetGridlines(sheetId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    retry: false,
    mutationFn: async (payload: GridlineRowPayload): Promise<SheetGridlines> => {
      const row: SheetGridlinesInsert = {
        sheet_id: sheetId,
        gridlines: payload.gridlines as SheetGridlinesInsert['gridlines'],
        suggested_gridlines: payload.suggested as SheetGridlinesInsert['suggested_gridlines'],
        source: payload.source,
        // model_version only when a proposal existed (any machine read).
        model_version: payload.source === 'human' ? null : GRIDLINE_MODEL_VERSION,
        // A human just confirmed these via "accept all", so they are reviewed.
        review_status: 'confirmed',
        spec_version: ANNOTATION_SPEC_VERSION,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('sheet_gridlines')
        .upsert(row, { onConflict: 'sheet_id' })
        .select()
        .single();
      if (error) throw error;

      return {
        ...data,
        gridlines: isGridlineArray(data.gridlines) ? data.gridlines : [],
        suggested_gridlines: isGridlineArray(data.suggested_gridlines)
          ? data.suggested_gridlines
          : null,
      } as SheetGridlines;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheetGridlines(sheetId) });
    },
  });
}

/** Re-export for convenience (the tracer maps pending → payload before calling). */
export type { Gridline };

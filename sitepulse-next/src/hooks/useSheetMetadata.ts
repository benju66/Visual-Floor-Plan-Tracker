import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import {
  isPercentRect,
  isTitleBlockFields,
  type PercentRect,
  type SheetMetadata,
  type SheetMetadataInsert,
  type TitleBlockFields,
} from '@/types/domain';
import { deriveTitleBlockSource, TITLE_BLOCK_MODEL_VERSION } from '@/utils/titleBlockParse';
import { ANNOTATION_SPEC_VERSION } from '@/utils/traceCapture';

/**
 * Read a sheet's confirmed title-block facts (AI Tracing Assist — Phase 3a).
 * Cache-first, like `useSheetText` (staleTime: Infinity; the confirm/save write
 * invalidates this key). Narrows the two JSONB columns (`title_block_bbox`,
 * `suggested_fields`) at THIS query boundary via the domain guards so no `Json`
 * reaches component props (AGENTS.md §6). Returns `null` when there's no row yet
 * (the title block hasn't been read) or no session — the UI then shows an empty
 * state and offers the "Read title block" tool. Never throws.
 */
export function useSheetMetadata(sheetId: string | null) {
  const { data = null, isLoading, isFetching, error } = useQuery({
    queryKey: queryKeys.sheetMetadata(sheetId as string),
    queryFn: async (): Promise<SheetMetadata | null> => {
      if (!sheetId) return null;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;

      const { data: row, error: readErr } = await supabase
        .from('sheet_metadata')
        .select('*')
        .eq('sheet_id', sheetId)
        .maybeSingle();
      if (readErr) {
        console.warn('[useSheetMetadata] read failed:', readErr.message);
        return null;
      }
      if (!row) return null;

      return {
        ...row,
        title_block_bbox: isPercentRect(row.title_block_bbox) ? row.title_block_bbox : null,
        suggested_fields: isTitleBlockFields(row.suggested_fields) ? row.suggested_fields : null,
      } as SheetMetadata;
    },
    enabled: !!sheetId,
    staleTime: Infinity,
  });

  return { metadata: data, isLoading, isFetching, error };
}

/** The values a title-block confirmation banks (the M1 capture for this tool). */
export interface SaveSheetMetadataInput {
  /** The fields the human confirmed (any may be null/blank). */
  fields: TitleBlockFields;
  /** The percent-space box the human dragged over the title block (provenance). */
  box: PercentRect | null;
  /**
   * The FROZEN original machine proposal, or `null` for a fully-manual entry.
   * Drives the `source` (ai_accepted/ai_edited vs human) and is stored verbatim in
   * `suggested_fields` so the suggested-vs-final correction signal is durable.
   */
  proposal: TitleBlockFields | null;
}

/** Trim a confirmed field to its stored form; a blank string becomes null. */
function cleanField(v: string | null): string | null {
  const t = (v ?? '').trim();
  return t.length > 0 ? t : null;
}

/**
 * Upsert a sheet's confirmed title-block facts — the Phase-3a "confirm" path. A
 * verified-capture write keyed 1:1 by sheet_id: it stamps Milestone-1 provenance
 * on the row itself (mirroring how `units` carry provenance), since the title
 * block isn't a `units`/polygon row and so isn't logged to `trace_events`
 * (room-shaped). `source` is `human` for manual entry, else `ai_accepted` /
 * `ai_edited` per {@link deriveTitleBlockSource}; the frozen `suggested_fields`
 * and the dragged box are stored for training. Refuses an all-blank save.
 *
 * RLS (owner/admin/pm member of the sheet's project) governs the write; no
 * container kind-guard is needed here because the row is keyed to the sheet the
 * user is viewing — there's no parent to mis-target (unlike the unit-create path).
 * Online-first; invalidates only the `sheetMetadata(sheetId)` key.
 */
export function useUpsertSheetMetadata(sheetId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    retry: false,
    mutationFn: async (input: SaveSheetMetadataInput): Promise<SheetMetadata> => {
      const sheetNumber = cleanField(input.fields.sheetNumber);
      const sheetName = cleanField(input.fields.sheetName);
      const architectFirm = cleanField(input.fields.architectFirm);
      if (!sheetNumber && !sheetName && !architectFirm) {
        throw new Error('Enter at least one title-block field before saving.');
      }

      const source = deriveTitleBlockSource(input.proposal, input.fields);
      const row: SheetMetadataInsert = {
        sheet_id: sheetId,
        sheet_number: sheetNumber,
        sheet_name: sheetName,
        architect_firm: architectFirm,
        title_block_bbox: (input.box ?? null) as SheetMetadataInsert['title_block_bbox'],
        source,
        // model_version only when a proposal existed (the parser produced it).
        model_version: input.proposal ? TITLE_BLOCK_MODEL_VERSION : null,
        suggested_fields: (input.proposal ?? null) as SheetMetadataInsert['suggested_fields'],
        // A human just confirmed these values, so they are reviewed.
        review_status: 'confirmed',
        spec_version: ANNOTATION_SPEC_VERSION,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('sheet_metadata')
        .upsert(row, { onConflict: 'sheet_id' })
        .select()
        .single();
      if (error) throw error;

      return {
        ...data,
        title_block_bbox: isPercentRect(data.title_block_bbox) ? data.title_block_bbox : null,
        suggested_fields: isTitleBlockFields(data.suggested_fields) ? data.suggested_fields : null,
      } as SheetMetadata;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheetMetadata(sheetId) });
    },
  });
}

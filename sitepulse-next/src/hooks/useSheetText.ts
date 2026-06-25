import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { extractTextService } from '@/services/api';
import { queryKeys } from '@/types/queryKeys';
import { isTextWordArray, type TextWord } from '@/types/domain';

/**
 * Loads a sheet's cached PDF text words with the SAME three-layer cache as
 * `useSnappingVectors` (AI Tracing Assist — Phase 1 shipped the cache; this is the
 * Phase-2 consumer):
 *   1. `sheet_text` Supabase table (durable, shared, write-through cached)
 *   2. backend `/extract-text/{sheetId}` (PyMuPDF) fallback on cache MISS
 *   3. TanStack Query in-memory cache (staleTime: Infinity)
 *
 * Returns RAW, IDB-serializable JSON (`TextWord[]`) — the `text` JSONB is narrowed
 * at THIS query boundary via `isTextWordArray` so no `Json` reaches component props
 * (AGENTS.md §6). A cached row with an empty array is a scanned sheet / OCR
 * candidate, NOT an error: it returns `[]` (no suggestion) and never falls through
 * to the backend. `null` means "could not load" (no session / network error) — the
 * trace flow degrades silently to no auto-fill.
 */
export function useSheetText(sheetId: string | null) {
  const { data = null, isLoading, isFetching, error } = useQuery({
    queryKey: queryKeys.sheetText(sheetId as string),
    queryFn: async (): Promise<TextWord[] | null> => {
      if (!sheetId) return null;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.warn('[useSheetText] No active session — room-name auto-fill disabled');
        return null;
      }

      try {
        const { data: cachedRow } = await supabase
          .from('sheet_text')
          .select('text')
          .eq('sheet_id', sheetId)
          .maybeSingle();

        // A row exists (even an empty array — scanned sheet): trust the cache and
        // never re-extract. Narrow the JSONB here; malformed text degrades to [].
        if (cachedRow && cachedRow.text != null) {
          return isTextWordArray(cachedRow.text) ? cachedRow.text : [];
        }

        // Cache miss (no row): extract via the backend, which write-throughs into
        // sheet_text server-side (an empty list IS cached there as the OCR flag).
        const json = await extractTextService(sheetId, session.access_token);
        const words = isTextWordArray(json.text) ? json.text : [];

        // Belt-and-suspenders client write-through (mirrors useSnappingVectors) —
        // only for non-empty results; the server already cached the empty case.
        if (words.length > 0) {
          void (async () => {
            try {
              await supabase
                .from('sheet_text')
                .upsert({ sheet_id: sheetId, text: words as never }, { onConflict: 'sheet_id' });
            } catch (err) {
              console.error('[sheet_text] Write-through cache upsert failed:', err);
            }
          })();
        }

        return words;
      } catch (err) {
        console.warn('Room-name auto-fill unavailable for this sheet:', err);
        return null;
      }
    },
    enabled: !!sheetId,
    staleTime: Infinity,
  });

  return { words: data, isLoading, isFetching, error, hasText: !!data && data.length > 0 };
}

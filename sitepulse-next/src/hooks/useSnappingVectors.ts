import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { extractVectorsService } from '@/services/api';
import { queryKeys } from '@/types/queryKeys';
import type { PercentPoint } from '@/types/domain';

export interface SnappingVectorLine {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  lineData: {
    start: PercentPoint;
    end: PercentPoint;
  };
}

/**
 * Loads the architectural snapping vectors for a sheet with a three-layer cache:
 *   1. `sheet_vectors` Supabase table (durable, shared across users)
 *   2. backend `/extract-vectors` (PyMuPDF) fallback on cache miss, with write-through
 *   3. TanStack Query in-memory cache (staleTime: Infinity)
 *
 * Returns RAW JSON (`SnappingVectorLine[]`). Per AGENTS.md §5/§6 the RBush spatial
 * index is instantiated by the consumer (useCanvasSnapping) in a deferred effect and
 * is NEVER stored in the Query cache (it is not JSON-serializable). Snapping itself
 * is performed synchronously on the main thread via getSnappedCoordinate() — fast
 * enough for 60fps and required by Konva's synchronous dragBoundFunc.
 */
export function useSnappingVectors(sheetId: string | null) {
  const { data: vectors = null, isLoading, isFetching, error } = useQuery({
    queryKey: queryKeys.snappingVectors(sheetId as string),
    queryFn: async (): Promise<SnappingVectorLine[] | null> => {
      if (!sheetId) return null;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.warn('[useSnappingVectors] No active session — vector snapping disabled');
        return null;
      }

      const formatVectors = (vectorsList: any[]): SnappingVectorLine[] => {
        return vectorsList.map((line: any) => ({
          minX: Math.min(line.start.pctX, line.end.pctX),
          minY: Math.min(line.start.pctY, line.end.pctY),
          maxX: Math.max(line.start.pctX, line.end.pctX),
          maxY: Math.max(line.start.pctY, line.end.pctY),
          lineData: line
        }));
      };

      try {
        const { data: cachedRow } = await supabase
          .from('sheet_vectors')
          .select('vectors')
          .eq('sheet_id', sheetId)
          .maybeSingle();

        if (cachedRow?.vectors && Array.isArray(cachedRow.vectors)) {
          return cachedRow.vectors.length > 0 ? formatVectors(cachedRow.vectors as any[]) : [];
        }

        const json = await extractVectorsService(sheetId, session.access_token);
        const formattedData = formatVectors(json.vectors);

        if (json.vectors && json.vectors.length > 0) {
          void (async () => {
            try {
              await supabase
                .from('sheet_vectors')
                .upsert(
                  { sheet_id: sheetId, vectors: json.vectors as any },
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
      // Retry once for a transient network failure (e.g. getSession's fetch),
      // never for a 404/401 — those won't recover on a retry.
      if (failureCount < 1 && (error as Error)?.message?.includes('Failed to fetch')) return true;
      return false;
    },
    retryDelay: 5000,
  });

  return { vectors, isLoading, isFetching, error, hasVectors: !!vectors && vectors.length > 0 };
}

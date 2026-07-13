import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import { fetchAllIn } from './useProjectQueries';
import { mergeWorkbenchSidecar } from '@/utils/workbench';
import type { CorpusLabel } from '@/utils/workbenchStats';
import type { Project, Sheet, WorkbenchSheet, WorkbenchDrawing } from '@/types/domain';

// Dedicated, filter-applying read hooks for the Location Labeling Workbench.
// These are the ONLY sanctioned way to read workbench data: each one always
// scopes to the single hidden `kind='workbench'` container, so a workbench row
// can never leak into a live-project surface or `progressAnalytics` (the
// load-bearing contamination guard — AGENTS.md §2 / plan § Contamination guard).

/**
 * Resolve the single hidden workbench container, lazily creating it on first
 * privileged visit. Delegates to the server route (`/api/workbench/container`),
 * which find-or-creates with the service-role key server-side — the scoping to
 * `kind='workbench'` lives there, never in widened client RLS.
 *
 * Self-correcting reads (Phase 6 hardening — plan § Container query robustness):
 * the whole TanStack cache is persisted to IndexedDB, so a wrong/deleted value
 * for this key would otherwise be served forever (Phase 5 found it pointing at a
 * *live* project after a poisoned cache). Two guards fix that here so reads
 * recover on their own, not just the write-site guards in `useWorkbenchActions`:
 *   1. the queryFn asserts the route returned a real `kind='workbench'` row, so
 *      a non-workbench value can never enter the cache in the first place; and
 *   2. we drop the old `staleTime: Infinity` — a persisted value is now revalidated
 *      on mount (served instantly, re-resolved via the route in the background), so
 *      any stale/poisoned entry self-heals on the next visit. The container id is
 *      stable, so a clean revalidation returns the same id and nothing downstream churns.
 */
export function useWorkbenchContainer(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.workbenchContainer(),
    queryFn: async (): Promise<Project> => {
      const res = await fetch('/api/workbench/container', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to resolve the workbench container');
      }
      const container = (await res.json()) as Project;
      // Defence in depth: never cache a non-workbench container under this key.
      if (container.kind !== 'workbench') {
        throw new Error('Resolved container is not a workbench container.');
      }
      return container;
    },
    enabled: !!userId,
  });
}

/**
 * The container's drawings — `sheets` rows under the container, each joined to
 * its 1:1 `workbench_sheets` sidecar metadata. ALWAYS scoped to the container by
 * `project_id`, so it cannot return live-project sheets.
 *
 * Soft-delete (Phase 8b): a drawing is ARCHIVED when its sidecar's `deleted_at`
 * is set. By default this hook EXCLUDES archived drawings (the library + the
 * corpus-health counts only ever see the active corpus). Pass
 * `{ includeArchived: true }` for the "Show archived" path — same container
 * scoping, just no archived filter (a single flag, not a forked hook). A drawing
 * with no sidecar yet is always active (it has no `deleted_at`). The filter is
 * applied in JS after the merge because `deleted_at` lives on the embedded
 * sidecar, and a left-join embed can't cleanly express "sidecar is NULL OR
 * sidecar.deleted_at IS NULL" in one PostgREST filter; the workbench corpus is
 * small, so this is correct and cheap.
 *
 * The `includeArchived` flag is appended to the cache key (the base 2-element
 * `workbenchSheets(containerId)` key stays the invalidation PREFIX, so an
 * archive/restore invalidation hits BOTH the active and the show-archived
 * variants via partial matching).
 */
export function useWorkbenchSheets(
  containerId: string | undefined,
  options?: { includeArchived?: boolean },
) {
  const includeArchived = options?.includeArchived ?? false;
  return useQuery({
    queryKey: [...queryKeys.workbenchSheets(containerId ?? ''), includeArchived] as const,
    queryFn: async (): Promise<WorkbenchDrawing[]> => {
      if (!containerId) return [];
      const { data, error } = await supabase
        .from('sheets')
        .select('*, workbench_sheets(*)')
        .eq('project_id', containerId)
        .order('sequence_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      const drawings = (data ?? []).map((row) => {
        const { workbench_sheets, ...sheet } = row as Sheet & {
          workbench_sheets: WorkbenchSheet | WorkbenchSheet[] | null;
        };
        return mergeWorkbenchSidecar(sheet as Sheet, workbench_sheets);
      });
      return includeArchived
        ? drawings
        : drawings.filter((d) => !d.workbench?.deleted_at);
    },
    enabled: !!containerId,
  });
}

/**
 * The container's labels aggregated for the corpus-health strip (Phase 8a),
 * returned grouped by `sheet_id` so {@link summarizeCorpus} can run the per-drawing
 * Definition-of-Done check.
 *
 * Container-scoped by design (the contamination guard): it resolves the
 * container's OWN sheet ids first, then reads only `units` whose `sheet_id` is in
 * that set — never an all-project/units rollup query. Only the three columns the
 * stats math needs are selected. Read-only; no JSONB, no live-surface reach.
 */
export function useWorkbenchCorpusUnits(containerId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.workbenchCorpusUnits(containerId ?? ''),
    queryFn: async (): Promise<Record<string, CorpusLabel[]>> => {
      if (!containerId) return {};

      const { data: sheetRows, error: sheetErr } = await supabase
        .from('sheets')
        .select('id')
        .eq('project_id', containerId);
      if (sheetErr) throw sheetErr;

      const sheetIds = (sheetRows ?? []).map((r) => r.id);
      if (sheetIds.length === 0) return {};

      // Chunked + paginated (fetchAllIn): a container past 1000 labels used to
      // silently truncate here, quietly degrading the corpus-health stats and
      // naming suggestions. Same three columns as before.
      const data = await fetchAllIn<{
        sheet_id: string | null; unit_number: string | null;
        top_level_role: string | null; subtype_id: string | null;
      }>('units', 'sheet_id', sheetIds, 'sheet_id, unit_number, top_level_role, subtype_id');

      const bySheet: Record<string, CorpusLabel[]> = {};
      for (const row of data ?? []) {
        if (!row.sheet_id) continue;
        (bySheet[row.sheet_id] ??= []).push({
          unit_number: row.unit_number,
          top_level_role: row.top_level_role,
          subtype_id: row.subtype_id,
        });
      }
      return bySheet;
    },
    enabled: !!containerId,
  });
}

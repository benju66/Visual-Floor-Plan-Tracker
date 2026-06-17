import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import { mergeWorkbenchSidecar } from '@/utils/workbench';
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
 * `project_id`, so it cannot return live-project sheets. Empty until Phase 5
 * adds PDF ingest.
 */
export function useWorkbenchSheets(containerId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.workbenchSheets(containerId ?? ''),
    queryFn: async (): Promise<WorkbenchDrawing[]> => {
      if (!containerId) return [];
      const { data, error } = await supabase
        .from('sheets')
        .select('*, workbench_sheets(*)')
        .eq('project_id', containerId)
        .order('sequence_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => {
        const { workbench_sheets, ...sheet } = row as Sheet & {
          workbench_sheets: WorkbenchSheet | WorkbenchSheet[] | null;
        };
        return mergeWorkbenchSidecar(sheet as Sheet, workbench_sheets);
      });
    },
    enabled: !!containerId,
  });
}

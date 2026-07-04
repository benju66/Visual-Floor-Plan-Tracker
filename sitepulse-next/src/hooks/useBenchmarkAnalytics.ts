import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import { paginateAll } from '@/utils/pagination';
import { isStringArray } from '@/types/domain';
import type { BenchmarkDataset } from '@/utils/benchmark';

/**
 * useBenchmarkDataset — the RLS-scoped cross-project read behind per-GC
 * benchmarking (Scheduling Analytics Slice B, Phase 6c). Assembles a compact
 * snapshot of the signed-in user's OWN projects' scheduling data so the pure
 * `benchmark.ts` math can compare a sub / cost code across their jobs.
 *
 * PRIVACY IS RLS-DRIVEN, not client-side (mirrors {@link useNamingVocabulary}):
 * every SELECT below returns ONLY rows in projects the user is a member of — the
 * `projects` / `activities` policies filter by membership, and `units` /
 * `status_audit_log` / overrides walk unit → sheet → project_members. So the
 * dataset can never contain another tenant's work; nothing is pooled across
 * customers. Reads are PAGINATED (units / history / overrides) to defeat
 * PostgREST's 1000-row cap — without it a big tenant would silently benchmark on
 * only the first 1000 rows (the 1000-row-cap note).
 *
 * READ-ONLY + online-first + best-effort: no session or any error degrades to an
 * empty dataset ("no benchmark"), never a throw that breaks the dashboard. The
 * result is raw IDB-serializable JSON (no Map/Set) — AGENTS.md §6. It is only
 * fetched when the benchmark panel mounts (`enabled`) and warm-cached, since this
 * is a heavier cross-project read than the per-project dashboard queries.
 */

const EMPTY_DATASET: BenchmarkDataset = {
  projects: [], sheets: [], activities: [], units: [], history: [], overrides: [], costCodeByDict: {},
};

export function useBenchmarkDataset(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.benchmarkDataset(),
    enabled,
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<BenchmarkDataset> => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return EMPTY_DATASET;

      try {
        // Global activity dictionary → cost code map (RLS: any member can read).
        const [{ data: projects, error: pErr }, { data: dict, error: dErr }] = await Promise.all([
          supabase.from('projects').select('id, name'),
          supabase.from('activity_dictionary').select('id, cost_code_id'),
        ]);
        if (pErr) throw pErr;
        if (dErr) throw dErr;

        const costCodeByDict: Record<string, string | null> = {};
        for (const d of dict ?? []) costCodeByDict[d.id] = d.cost_code_id;

        const [{ data: sheets, error: shErr }, { data: activities, error: aErr }] = await Promise.all([
          supabase.from('sheets').select('id, project_id'),
          supabase.from('activities').select('id, project_id, subcontractor_id, dictionary_id, applies_to_unit_types'),
        ]);
        if (shErr) throw shErr;
        if (aErr) throw aErr;

        // Paginated reads (defeat the 1000-row cap). Stable .order('id') per page.
        const units = await paginateAll<BenchmarkDataset['units'][number]>(async (from, size) => {
          const { data, error } = await supabase
            .from('units')
            .select('id, sheet_id, unit_type, computed_area')
            .order('id', { ascending: true })
            .range(from, from + size - 1);
          if (error) throw error;
          return (data ?? []) as BenchmarkDataset['units'];
        });

        const history = await paginateAll<BenchmarkDataset['history'][number]>(async (from, size) => {
          const { data, error } = await supabase
            .from('status_audit_log')
            .select('unit_id, activity_id, logged_date')
            .eq('temporal_state', 'completed')
            .not('logged_date', 'is', null)
            .order('id', { ascending: true })
            .range(from, from + size - 1);
          if (error) throw error;
          return (data ?? []) as BenchmarkDataset['history'];
        });

        const overridesRaw = await paginateAll<{ activity_id: string; unit_id: string; is_applicable: boolean }>(async (from, size) => {
          const { data, error } = await supabase
            .from('activity_applicability_overrides')
            .select('activity_id, unit_id, is_applicable')
            .order('id', { ascending: true })
            .range(from, from + size - 1);
          if (error) throw error;
          return (data ?? []) as { activity_id: string; unit_id: string; is_applicable: boolean }[];
        });

        return {
          projects: (projects ?? []).map(p => ({ id: p.id, name: p.name })),
          sheets: (sheets ?? []).map(s => ({ id: s.id, project_id: s.project_id })),
          activities: (activities ?? []).map(a => ({
            id: a.id,
            project_id: a.project_id,
            subcontractor_id: a.subcontractor_id,
            dictionary_id: a.dictionary_id,
            // Narrow the JSONB applies_to_unit_types at the boundary (AGENTS.md §6).
            applies_to_unit_types: isStringArray(a.applies_to_unit_types) ? a.applies_to_unit_types : null,
          })),
          units,
          history,
          overrides: overridesRaw,
          costCodeByDict,
        };
      } catch (err) {
        console.warn('Benchmark dataset unavailable (benchmarking disabled):', err);
        return EMPTY_DATASET;
      }
    },
  });
}

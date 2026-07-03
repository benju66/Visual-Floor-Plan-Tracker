import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import { normalizeCode, deriveDivision, type CostCodeDraft } from '@/utils/costCodes';
import type { CostCode, CostCodeStatus } from '@/types/domain';

/**
 * The global cost-code catalog (Scheduling Analytics Slice B, Phase 5) — the scheduling
 * cousin of `useSubtypes`/`useActivityDictionary`: a GLOBAL governed table, read by any
 * project member, written only by privileged members (owner/admin/pm — enforced by RLS,
 * never anon). No JSONB columns, so nothing to narrow at the boundary. Writes are
 * online-first (admin authoring, never the offline queue).
 */

/** Turn a Postgres `code`-UNIQUE collision (23505) into a friendly Error for the admin UI. */
function asFriendlyCodeError(error: { code?: string }, code: string): Error {
  if (error.code === '23505') {
    return new Error(`A cost code “${code}” already exists.`);
  }
  return error as Error;
}

/** Read the whole catalog, ordered by sort_order then code. Warm-cached (rarely changes). */
export function useCostCodes() {
  return useQuery({
    queryKey: queryKeys.costCodes(),
    queryFn: async (): Promise<CostCode[]> => {
      const { data, error } = await supabase
        .from('cost_codes')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('code', { ascending: true });
      if (error) throw error;
      return (data ?? []) as CostCode[];
    },
    staleTime: 1000 * 60 * 10,
  });
}

export interface UpsertCostCodeInput {
  /** Present → update that row; absent → insert a new code. */
  id?: string;
  code: string;
  description?: string | null;
  division?: string | null;
  code_type?: string | null;
  unit_of_measure?: string;
  status?: CostCodeStatus;
  sort_order?: number;
}

/**
 * Add a new code or edit an existing one. The code is normalized (trim/collapse) before
 * write so it round-trips the plain UNIQUE(code) constraint; a duplicate surfaces as a
 * friendly Error. On insert, the division is derived from the code when not supplied.
 * Bumps updated_at. Mirrors `useUpsertSubtype`.
 */
export function useUpsertCostCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertCostCodeInput): Promise<CostCode> => {
      const code = normalizeCode(input.code);
      const fields = {
        code,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.division !== undefined ? { division: input.division } : {}),
        ...(input.code_type !== undefined ? { code_type: input.code_type } : {}),
        ...(input.unit_of_measure !== undefined ? { unit_of_measure: input.unit_of_measure } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.sort_order !== undefined ? { sort_order: input.sort_order } : {}),
        updated_at: new Date().toISOString(),
      };

      if (input.id) {
        const { data, error } = await supabase
          .from('cost_codes')
          .update(fields)
          .eq('id', input.id)
          .select()
          .single();
        if (error) throw asFriendlyCodeError(error, code);
        return data as CostCode;
      }

      const { data, error } = await supabase
        .from('cost_codes')
        .insert({ status: 'active', division: input.division ?? deriveDivision(code), ...fields })
        .select()
        .single();
      if (error) throw asFriendlyCodeError(error, code);
      return data as CostCode;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.costCodes() }),
  });
}

/**
 * Set a code's governance status (active / deprecated) — the deprecate/restore action.
 * Optimistic: the list updates immediately and rolls back on error. Mirrors
 * `useSetSubtypeStatus`.
 */
export function useSetCostCodeStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CostCodeStatus }): Promise<CostCode> => {
      const { data, error } = await supabase
        .from('cost_codes')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as CostCode;
    },
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.costCodes() });
      const prev = queryClient.getQueryData<CostCode[]>(queryKeys.costCodes());
      queryClient.setQueryData<CostCode[]>(queryKeys.costCodes(), old =>
        old?.map(c => (c.id === id ? { ...c, status } : c)),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.costCodes(), ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.costCodes() }),
  });
}

/**
 * Idempotent bulk import of parsed catalog drafts. Upserts on the `code` conflict target
 * so re-importing the same list makes NO duplicates (only refreshes description/type/
 * division of existing codes and adds new ones). Returns the number of rows written.
 * The parse/normalize/dedupe already happened in `parseCostCodeCatalog`; this only writes.
 */
export function useImportCostCodes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (drafts: CostCodeDraft[]): Promise<number> => {
      if (drafts.length === 0) return 0;
      const rows = drafts.map((d, i) => ({
        code: normalizeCode(d.code),
        description: d.description,
        code_type: d.code_type,
        division: d.division ?? deriveDivision(d.code),
        sort_order: (i + 1) * 10,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase
        .from('cost_codes')
        .upsert(rows, { onConflict: 'code' });
      if (error) throw error;
      return rows.length;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.costCodes() }),
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import type { Company, CompanyStatus } from '@/types/domain';

/**
 * The global company/subcontractor directory (Scheduling Analytics Slice B, Phase 5) —
 * the tenant-wide vendor identity a project activity points at via
 * activities.subcontractor_id. Same governed-dictionary posture as `useCostCodes`:
 * GLOBAL, read by any member, written only by privileged members (owner/admin/pm — RLS,
 * never anon). Online-first. No JSONB → nothing to narrow.
 */

function asFriendlyCompanyError(error: { code?: string }, name: string): Error {
  if (error.code === '23505') {
    return new Error(`A company named “${name}” already exists.`);
  }
  return error as Error;
}

/** Read the directory, active-first then by name. Warm-cached (rarely changes). */
export function useCompanies() {
  return useQuery({
    queryKey: queryKeys.companies(),
    queryFn: async (): Promise<Company[]> => {
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Company[];
    },
    staleTime: 1000 * 60 * 10,
  });
}

export interface UpsertCompanyInput {
  /** Present → update that row; absent → insert a new company. */
  id?: string;
  name: string;
  trade?: string | null;
  status?: CompanyStatus;
  sort_order?: number;
}

/**
 * Add a new company or edit an existing one (name/trade/status). The name is trimmed;
 * a duplicate surfaces as a friendly Error (UNIQUE). Bumps updated_at. Mirrors
 * `useUpsertSubtype`.
 */
export function useUpsertCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertCompanyInput): Promise<Company> => {
      const name = input.name.trim();
      const fields = {
        name,
        ...(input.trade !== undefined ? { trade: input.trade } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.sort_order !== undefined ? { sort_order: input.sort_order } : {}),
        updated_at: new Date().toISOString(),
      };

      if (input.id) {
        const { data, error } = await supabase
          .from('companies')
          .update(fields)
          .eq('id', input.id)
          .select()
          .single();
        if (error) throw asFriendlyCompanyError(error, name);
        return data as Company;
      }

      const { data, error } = await supabase
        .from('companies')
        .insert({ status: 'active', ...fields })
        .select()
        .single();
      if (error) throw asFriendlyCompanyError(error, name);
      return data as Company;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.companies() }),
  });
}

/**
 * Add-or-reuse a company by name (for the "add a new sub inline" flow in the activity
 * editor): insert it, and if the name already exists (UNIQUE) reuse that row so a sub is
 * one tenant-wide record and the pick never fails on a duplicate. Mirrors
 * `useProposePendingSubtype`.
 */
export function useAddOrGetCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, trade }: { name: string; trade?: string | null }): Promise<Company> => {
      const trimmed = name.trim();
      const { data, error } = await supabase
        .from('companies')
        .insert({ name: trimmed, trade: trade ?? null, status: 'active' })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          const { data: existing, error: fetchErr } = await supabase
            .from('companies')
            .select('*')
            .eq('name', trimmed)
            .single();
          if (fetchErr) throw fetchErr;
          return existing as Company;
        }
        throw error;
      }
      return data as Company;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.companies() }),
  });
}

/**
 * Set a company's governance status (active / deprecated) — deprecate/restore. Optimistic;
 * rolls back on error. Mirrors `useSetSubtypeStatus`.
 */
export function useSetCompanyStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CompanyStatus }): Promise<Company> => {
      const { data, error } = await supabase
        .from('companies')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as Company;
    },
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.companies() });
      const prev = queryClient.getQueryData<Company[]>(queryKeys.companies());
      queryClient.setQueryData<Company[]>(queryKeys.companies(), old =>
        old?.map(c => (c.id === id ? { ...c, status } : c)),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.companies(), ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.companies() }),
  });
}

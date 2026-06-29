import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import { paginateAll } from '@/utils/pagination';
import {
  buildNamingVocabulary,
  EMPTY_VOCABULARY,
  type ConfirmedRoom,
  type NamingVocabulary,
} from '@/utils/namingVocabulary';

/**
 * Load the company-wide learned naming vocabulary (Trace Naming & Type Assist
 * Phase 2). Reads every CONFIRMED room the signed-in user can see — `unit_number`
 * + `subtype_id`, across every project they're a member of — and folds it into a
 * plain-JSON frequency model ({@link buildNamingVocabulary}) the suggestion engine
 * uses to (C) keep real name words / drop learned noise and (D2) guess the type a
 * name most often pairs with.
 *
 * SCOPING IS RLS-DRIVEN, not client-side: the `units` SELECT policy already walks
 * units → sheets → project_members, so a plain `select` returns ONLY rooms in the
 * user's own projects (their workbench container + live maps) — never another
 * tenant's. The read is PAGINATED via the shared {@link paginateAll} helper because
 * PostgREST caps a SELECT at 1000 rows; without it the model would silently learn
 * from only the first 1000 rooms (AGENTS.md / the 1000-row-cap note).
 *
 * Only `unit_number` + `subtype_id` are read — NOT the historical `top_level_role`.
 * D2 resolves its learned `subtype_id` against the LIVE dictionary and takes the role
 * from there, so a sub-type's governed role is always authoritative and never derived
 * from a stale per-room copy (AGENTS.md §4: `top_level_role` is governed centrally).
 *
 * Best-effort + online-only, exactly like `useSheetText`: no session, an offline
 * device, or any query error all degrade to the EMPTY vocabulary ("no learning"),
 * so a failed lookup can never block or break a trace. The returned model is RAW,
 * IDB-serializable JSON (no `Map`/`Set`) — AGENTS.md §6.
 */
export function useNamingVocabulary() {
  const { data = EMPTY_VOCABULARY, isLoading, isFetching, error } = useQuery({
    queryKey: queryKeys.namingVocabulary(),
    queryFn: async (): Promise<NamingVocabulary> => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.warn('[useNamingVocabulary] No active session — naming learning disabled');
        return EMPTY_VOCABULARY;
      }

      try {
        // Page through every confirmed room the user can see (RLS scopes the set).
        // A stable `.order('id')` keeps pages non-overlapping; `paginateAll` stops on
        // the first short page. Only the three learning columns are selected.
        const rooms = await paginateAll<ConfirmedRoom>(async (from, size) => {
          const { data, error: pageError } = await supabase
            .from('units')
            .select('unit_number, subtype_id')
            .order('id', { ascending: true })
            .range(from, from + size - 1);
          if (pageError) throw pageError;
          return (data ?? []) as ConfirmedRoom[];
        });

        return buildNamingVocabulary(rooms);
      } catch (err) {
        console.warn('Naming vocabulary unavailable (learning disabled):', err);
        return EMPTY_VOCABULARY;
      }
    },
    // Changes only as the user confirms more rooms; keep it warm within a session.
    staleTime: 1000 * 60 * 5,
  });

  return { vocabulary: data, isLoading, isFetching, error };
}

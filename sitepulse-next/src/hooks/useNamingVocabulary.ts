import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import { paginateAll } from '@/utils/pagination';
import { excludeUntrainableRooms } from '@/utils/trainingGate';
import {
  buildNamingVocabulary,
  EMPTY_VOCABULARY,
  type ConfirmedRoom,
  type NamingVocabulary,
} from '@/utils/namingVocabulary';

/** A confirmed room plus the `sheet_id` used to attribute it to a project (for opt-out filtering). */
type ConfirmedRoomRow = ConfirmedRoom & { sheet_id: string | null };

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
 * Only `unit_number` + `subtype_id` feed the model — NOT the historical `top_level_role`.
 * D2 resolves its learned `subtype_id` against the LIVE dictionary and takes the role
 * from there, so a sub-type's governed role is always authoritative and never derived
 * from a stale per-room copy (AGENTS.md §4: `top_level_role` is governed centrally).
 * `sheet_id` is also read, but only to honour the per-project AI-training opt-out
 * (Global Settings → Projects): rooms in a project flagged `ai_training_enabled = false`
 * are excluded from the model. Default-ON, so an un-flagged corpus learns exactly as before.
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
        // Per-project AI-training opt-out: collect the sheet ids of any project the
        // user can see that is opted OUT (`ai_training_enabled = false`), so their
        // rooms can be excluded below. RLS scopes both reads to the user's projects.
        // The COMMON case is zero opted-out projects → the sheets query is skipped and
        // the set stays empty, so learning is byte-for-byte unchanged from before.
        const excludedSheetIds = new Set<string>();
        const { data: offProjects, error: offErr } = await supabase
          .from('projects')
          .select('id')
          .eq('ai_training_enabled', false);
        if (offErr) throw offErr;
        const offProjectIds = (offProjects ?? []).map((p) => p.id);
        if (offProjectIds.length > 0) {
          const { data: offSheets, error: sheetsErr } = await supabase
            .from('sheets')
            .select('id')
            .in('project_id', offProjectIds);
          if (sheetsErr) throw sheetsErr;
          for (const s of offSheets ?? []) excludedSheetIds.add(s.id as string);
        }

        // Page through every confirmed room the user can see (RLS scopes the set).
        // A stable `.order('id')` keeps pages non-overlapping; `paginateAll` stops on
        // the first short page. `sheet_id` rides along only to filter out opted-out
        // projects (it is not part of the learning signal).
        const rawRooms = await paginateAll<ConfirmedRoomRow>(async (from, size) => {
          const { data, error: pageError } = await supabase
            .from('units')
            .select('unit_number, subtype_id, sheet_id')
            .order('id', { ascending: true })
            .range(from, from + size - 1);
          if (pageError) throw pageError;
          return (data ?? []) as ConfirmedRoomRow[];
        });

        const rooms = excludeUntrainableRooms(rawRooms, excludedSheetIds);
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

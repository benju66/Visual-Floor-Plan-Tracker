import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import { narrowActivityDictionaryRow } from '@/utils/activityDictionary';
import { addAliasToList } from '@/utils/subtypes';
import { isStringArray } from '@/types/domain';
import type {
  ActivityDictionaryEntry,
  ActivityDictionaryStatus,
  ActivityType,
  ProjectType,
} from '@/types/domain';

/**
 * The activity dictionary is the scheduling twin of the sub-type dictionary
 * (`src/hooks/useSubtypes.ts`): a GLOBAL governed table, read by any project member,
 * written only by privileged members (`owner`/`admin`/`pm` — enforced by RLS, never
 * `anon`). These hooks mirror the sub-type hooks 1:1 (query shape, propose-on-conflict
 * reuse, optimistic status toggle, alias append) so the two dictionaries behave
 * identically. JSONB columns are narrowed at the boundary via
 * {@link narrowActivityDictionaryRow} (no raw `Json` into props — AGENTS.md §6).
 */

/**
 * Turn a Postgres `name`-UNIQUE collision (23505) into a friendly Error the admin UI
 * can show inline; re-throws anything else unchanged. Mirrors `asFriendlyDictionaryError`
 * in `useSubtypes.ts`.
 */
function asFriendlyDictionaryError(error: { code?: string }, name: string): Error {
  if (error.code === '23505') {
    return new Error(`An activity named “${name}” already exists in the dictionary.`);
  }
  return error as Error;
}

/**
 * Read the global governed activity dictionary. NOT project-scoped — the same canonical
 * "MEP Rough-In" is shared across every project — so the query is keyed globally and
 * shared. Warm-cached (the dictionary changes rarely). Mirrors {@link useSubtypes}.
 */
export function useActivityDictionary() {
  return useQuery({
    queryKey: queryKeys.activityDictionary(),
    queryFn: async (): Promise<ActivityDictionaryEntry[]> => {
      const { data, error } = await supabase
        .from('activity_dictionary')
        .select('*')
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []).map(narrowActivityDictionaryRow);
    },
    staleTime: 1000 * 60 * 10,
  });
}

/**
 * Propose a new "Other (pending)" activity (non-blocking governance). Inserts a
 * `status='pending'` row with the captured note; if the name already exists (UNIQUE),
 * reuses that dictionary entry so a proposal never duplicates or blocks. Writes are
 * RLS-restricted to privileged members — a denial throws and is handled gracefully by
 * the caller (see `activityPickToFields`, which then saves the activity unlinked, in the
 * review queue). Never widened to `anon`. Mirrors `useProposePendingSubtype`.
 */
export function useProposePendingActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, note }: { name: string; note: string }): Promise<ActivityDictionaryEntry> => {
      const trimmedName = name.trim();
      const { data, error } = await supabase
        .from('activity_dictionary')
        .insert({
          name: trimmedName,
          status: 'pending',
          proposed_note: note.trim() || null,
          default_project_types: [],
        })
        .select()
        .single();

      if (error) {
        // 23505 = unique_violation on `name`: reuse the existing entry.
        if (error.code === '23505') {
          const { data: existing, error: fetchErr } = await supabase
            .from('activity_dictionary')
            .select('*')
            .eq('name', trimmedName)
            .single();
          if (fetchErr) throw fetchErr;
          return narrowActivityDictionaryRow(existing);
        }
        throw error;
      }
      return narrowActivityDictionaryRow(data);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.activityDictionary() }),
  });
}

// ---------------------------------------------------------------------------
// Dictionary-admin writes (online-first, RLS-restricted to privileged members:
// owner/admin/pm — never `anon`). Mirror the sub-type admin hooks. The Phase-3
// Schedule-view management surface uses these; Phase 2 wires the propose path.
// ---------------------------------------------------------------------------

export interface UpsertActivityDictionaryInput {
  /** Present → update that row; absent → insert a new entry. */
  id?: string;
  name: string;
  /** Optional default track/phase hint (grouping only). */
  track?: string | null;
  type?: ActivityType;
  defaultProjectTypes?: ProjectType[];
  /** New rows default to `active`; pass to override (e.g. promote on save). */
  status?: ActivityDictionaryStatus;
}

/**
 * Add a new dictionary entry or edit an existing one (name, default track, type,
 * project-type scoping, and optionally status). A duplicate `name` surfaces as a friendly
 * Error (the column is UNIQUE). Bumps `updated_at`. Mirrors `useUpsertSubtype`.
 */
export function useUpsertActivityDictionaryEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertActivityDictionaryInput): Promise<ActivityDictionaryEntry> => {
      const name = input.name.trim();
      const fields = {
        name,
        ...(input.track !== undefined ? { track: input.track } : {}),
        ...(input.type ? { type: input.type } : {}),
        ...(input.defaultProjectTypes ? { default_project_types: input.defaultProjectTypes } : {}),
        ...(input.status ? { status: input.status } : {}),
        updated_at: new Date().toISOString(),
      };

      if (input.id) {
        const { data, error } = await supabase
          .from('activity_dictionary')
          .update(fields)
          .eq('id', input.id)
          .select()
          .single();
        if (error) throw asFriendlyDictionaryError(error, name);
        return narrowActivityDictionaryRow(data);
      }

      const { data, error } = await supabase
        .from('activity_dictionary')
        .insert({ status: 'active', ...fields })
        .select()
        .single();
      if (error) throw asFriendlyDictionaryError(error, name);
      return narrowActivityDictionaryRow(data);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.activityDictionary() }),
  });
}

/**
 * Set an entry's governance status (active / pending / deprecated) — the review-queue
 * actions (promote, deprecate). Optimistic: the list recolors immediately and rolls back
 * on error. Mirrors `useSetSubtypeStatus`.
 */
export function useSetActivityDictionaryStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ActivityDictionaryStatus }): Promise<ActivityDictionaryEntry> => {
      const { data, error } = await supabase
        .from('activity_dictionary')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return narrowActivityDictionaryRow(data);
    },
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.activityDictionary() });
      const prev = queryClient.getQueryData<ActivityDictionaryEntry[]>(queryKeys.activityDictionary());
      queryClient.setQueryData<ActivityDictionaryEntry[]>(queryKeys.activityDictionary(), old =>
        old?.map(e => (e.id === id ? { ...e, status } : e)),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.activityDictionary(), ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.activityDictionary() }),
  });
}

/**
 * Append an alias name → an existing canonical entry (e.g. "Rough-Ins" → "MEP Rough-In"),
 * so both spellings resolve to one thing. Reads the current `aliases[]` from the warm cache
 * (falling back to a fetch) and writes the de-duplicated next list via the shared
 * {@link addAliasToList}. Used for ad-hoc aliasing and by the review queue's "fold a pending
 * proposal into an existing entry" action. Mirrors `useAddSubtypeAlias`.
 */
export function useAddActivityAlias() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, alias }: { id: string; alias: string }): Promise<ActivityDictionaryEntry> => {
      const cached = queryClient
        .getQueryData<ActivityDictionaryEntry[]>(queryKeys.activityDictionary())
        ?.find(e => e.id === id);
      let current = cached?.aliases;
      if (!current) {
        const { data, error } = await supabase.from('activity_dictionary').select('aliases').eq('id', id).single();
        if (error) throw error;
        current = isStringArray(data.aliases) ? data.aliases : [];
      }
      const nextAliases = addAliasToList(current, alias);

      const { data, error } = await supabase
        .from('activity_dictionary')
        .update({ aliases: nextAliases, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return narrowActivityDictionaryRow(data);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.activityDictionary() }),
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import { narrowPlaybook } from '@/utils/playbooks';
import type { PlaybookActivityRow, PlaybookEdgeRef } from '@/utils/playbooks';
import type { Database } from '@/types/database.types';
import type { PlaybookItem, PlaybookWithItems, ProjectType } from '@/types/domain';

/**
 * Playbook query + mutation hooks (Scheduling Foundation Slice A, Phase 5).
 *
 * Playbooks are a GLOBAL, company-wide governed library — read by any project member,
 * written only by privileged members (owner/admin/pm, enforced by RLS, never anon) —
 * so the read is keyed globally + shared, exactly like {@link useActivityDictionary}.
 * ONLINE-FIRST authoring (never the offline mutation queue): a playbook is schedule
 * metadata, not field progress. Applying a playbook reuses the bulk-INSERT technique
 * (one multi-row insert with explicit sequence_order — never a loop of single inserts)
 * and then bulk-inserts the FS edges it implies.
 */

type PlaybookRow = Database['public']['Tables']['playbooks']['Row'];

/**
 * Read the global playbook library, each playbook joined with its ordered items.
 * NOT project-scoped (the same recipe is shared across every project). Warm-cached —
 * playbooks change rarely. The one JSONB column is narrowed via {@link narrowPlaybook}.
 */
export function usePlaybooks() {
  return useQuery({
    queryKey: queryKeys.playbooks(),
    queryFn: async (): Promise<PlaybookWithItems[]> => {
      const { data, error } = await supabase
        .from('playbooks')
        .select('*, items:playbook_items(*)')
        .order('name', { ascending: true });
      if (error) throw error;
      type Raw = PlaybookRow & { items: PlaybookItem[] | null };
      return ((data ?? []) as unknown as Raw[]).map((row) => {
        const { items, ...pb } = row;
        return {
          ...narrowPlaybook(pb),
          items: [...(items ?? [])].sort((a, b) => a.sequence_order - b.sequence_order),
        };
      });
    },
    staleTime: 1000 * 60 * 10,
  });
}

// ---------------------------------------------------------------------------
// Apply a playbook → seed a project's activities + FS dependencies (privileged).
// The caller computes the pure {@link applyPlaybook} result and passes the ordered
// activity rows + index-keyed edges in; this hook does the two bulk writes.
// ---------------------------------------------------------------------------

export interface ApplyPlaybookVars {
  activities: PlaybookActivityRow[];
  edges: PlaybookEdgeRef[];
}

export interface ApplyPlaybookOutcome {
  created: number;
  edges: number;
}

export function useApplyPlaybook(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ activities, edges }: ApplyPlaybookVars): Promise<ApplyPlaybookOutcome> => {
      if (activities.length === 0) return { created: 0, edges: 0 };

      // 1. One bulk INSERT with explicit sequence_order (the wizard's bulk technique —
      //    never a per-row loop, which would collide on a stale maxOrder), returning ids.
      const { data: inserted, error } = await supabase
        .from('activities')
        .insert(activities.map((a) => ({ ...a, project_id: projectId })))
        .select('id, name, track');
      if (error) throw error;
      const rows = inserted ?? [];

      // 2. Map each emitted activity → its new id by (name, track). This pair is unique
      //    among emitted rows (dictionary names are globally unique + the apply logic
      //    de-dupes), so the match is robust regardless of INSERT...RETURNING order.
      const idByKey = new Map<string, string>();
      for (const r of rows) idByKey.set(`${r.name}\u0000${r.track ?? ''}`, r.id);
      const idForIndex = (i: number): string | undefined => {
        const a = activities[i];
        return idByKey.get(`${a.name}\u0000${a.track ?? ''}`);
      };

      // 3. Bulk-insert the FS edges (drop any whose endpoint id didn't resolve).
      const { data: { session } } = await supabase.auth.getSession();
      const edgeRows = edges
        .map((e) => {
          const predecessor_activity_id = idForIndex(e.predecessorIndex);
          const successor_activity_id = idForIndex(e.successorIndex);
          if (!predecessor_activity_id || !successor_activity_id) return null;
          return {
            predecessor_activity_id,
            successor_activity_id,
            lag_days: Math.trunc(e.lagDays),
            created_by: session?.user?.id || null,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      if (edgeRows.length > 0) {
        const { error: edgeErr } = await supabase.from('activity_dependencies').insert(edgeRows);
        if (edgeErr) throw edgeErr;
      }
      return { created: rows.length, edges: edgeRows.length };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.activities(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.activityDependencies(projectId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Save the current project's activities (+ FS edges) as a reusable playbook
// (privileged authoring — the v1 way to create a playbook).
// ---------------------------------------------------------------------------

export interface SaveProjectAsPlaybookVars {
  name: string;
  description?: string | null;
  defaultProjectTypes?: ProjectType[];
}

export interface SaveProjectAsPlaybookResult {
  playbookId: string;
  itemCount: number;
  /** Activities left out because they aren't linked to the dictionary yet. */
  skippedUnlinked: number;
}

export function useSaveProjectAsPlaybook(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      name,
      description = null,
      defaultProjectTypes = [],
    }: SaveProjectAsPlaybookVars): Promise<SaveProjectAsPlaybookResult> => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Give the playbook a name.');

      // 1. Read the project's activities (ordered) + its FS dependency edges.
      const { data: acts, error: actsErr } = await supabase
        .from('activities')
        .select('id, name, track, color, sequence_order, dictionary_id')
        .eq('project_id', projectId)
        .order('sequence_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (actsErr) throw actsErr;
      const activities = acts ?? [];

      // A governed playbook item MUST reference a dictionary entry — leave unlinked
      // activities out (honestly reported), rather than silently inventing links.
      const linked = activities.filter((a) => a.dictionary_id);
      const skippedUnlinked = activities.length - linked.length;
      if (linked.length === 0) {
        throw new Error(
          'None of this project’s activities are linked to the company dictionary yet — link them in the Activities panel, then save as a playbook.',
        );
      }

      const activityIds = activities.map((a) => a.id);
      let deps: { predecessor_activity_id: string; successor_activity_id: string; lag_days: number }[] = [];
      if (activityIds.length > 0) {
        const { data: depData, error: depErr } = await supabase
          .from('activity_dependencies')
          .select('predecessor_activity_id, successor_activity_id, lag_days')
          .in('successor_activity_id', activityIds);
        if (depErr) throw depErr;
        deps = depData ?? [];
      }

      // 2. Pre-assign each linked activity a client-side playbook_item id, so
      //    predecessor_item_id can be wired in ONE bulk insert (no second update pass).
      const itemIdByActivityId = new Map<string, string>();
      for (const a of linked) itemIdByActivityId.set(a.id, crypto.randomUUID());

      // One predecessor per item (the v1 model): among linked activities, keep the first.
      const predByActivity = new Map<string, { predId: string; lag: number }>();
      for (const d of deps) {
        if (!itemIdByActivityId.has(d.successor_activity_id)) continue;
        if (!itemIdByActivityId.has(d.predecessor_activity_id)) continue;
        if (predByActivity.has(d.successor_activity_id)) continue;
        predByActivity.set(d.successor_activity_id, { predId: d.predecessor_activity_id, lag: d.lag_days ?? 0 });
      }

      // 3. Insert the playbook row (friendly duplicate-name error).
      const { data: { session } } = await supabase.auth.getSession();
      const { data: pbRow, error: pbErr } = await supabase
        .from('playbooks')
        .insert({
          name: trimmed,
          description: description?.trim() || null,
          default_project_types: defaultProjectTypes,
          created_by: session?.user?.id || null,
        })
        .select('id')
        .single();
      if (pbErr) {
        if ((pbErr as { code?: string }).code === '23505') {
          throw new Error(`A playbook named “${trimmed}” already exists.`);
        }
        throw pbErr;
      }
      const playbookId = pbRow.id;

      // 4. One bulk INSERT of the items, predecessor_item_id wired via the client ids.
      const itemRows = linked.map((a, i) => {
        const pred = predByActivity.get(a.id);
        return {
          id: itemIdByActivityId.get(a.id)!,
          playbook_id: playbookId,
          dictionary_id: a.dictionary_id as string,
          sequence_order: i,
          track: a.track,
          color: a.color,
          predecessor_item_id: pred ? itemIdByActivityId.get(pred.predId) ?? null : null,
          lag_days: pred ? Math.trunc(pred.lag) : 0,
        };
      });
      const { error: itemErr } = await supabase.from('playbook_items').insert(itemRows);
      if (itemErr) {
        // Roll back the husk playbook so a failed items insert leaves nothing behind.
        await supabase.from('playbooks').delete().eq('id', playbookId);
        throw itemErr;
      }

      return { playbookId, itemCount: itemRows.length, skippedUnlinked };
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.playbooks() }),
  });
}

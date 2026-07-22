import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { paginateAll } from '@/utils/pagination';
import { queryKeys } from '@/types/queryKeys';
import type { StatusLog } from '@/types/domain';

export function useUnitHistory(unitId: string, enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.unitHistory(unitId),
    queryFn: async (): Promise<StatusLog[]> => {
      if (!unitId) return [];
      // Re-pointed to status_audit_log: the append-only audit table preserves
      // full state-change history, unlike status_logs which is now slot-unique.
      // Map its `activity_name` snapshot onto the domain `activityName` field.
      const { data, error } = await supabase.from('status_audit_log')
        .select('*')
        .eq('unit_id', unitId)
        .order('changed_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(r => ({ ...r, activityName: r.activity_name })) as unknown as StatusLog[];
    },
    // `enabled` lets a caller defer the fetch until it's actually needed — the List's
    // expanded rows pass their near-viewport presence so "expand all" doesn't fire N
    // history queries at once (List View Performance — Phase 2). Default true keeps
    // every existing caller (Unit History modal, inspector) fetching eagerly.
    enabled: !!unitId && enabled
  });
}

export type StatusHistoryEvent = Pick<StatusLog, 'unit_id' | 'activity_id' | 'activityName' | 'track' | 'logged_date'>;

export function useStatusHistory(unitIds: string[]) {
  const validUnitIds = unitIds?.filter(id => !String(id).startsWith('temp_')) || [];
  return useQuery({
    queryKey: queryKeys.statusHistory(...validUnitIds),
    queryFn: async (): Promise<StatusHistoryEvent[]> => {
      if (validUnitIds.length === 0) return [];
      // Re-pointed to status_audit_log: the audit table has the full append-only
      // history of completed activities, used by the dashboard timeline chart AND
      // (Scheduling Analytics Phase 6) the production-rate math, which needs the
      // stable `activity_id` to join a completion to its cost code / subcontractor.
      // Map its `activity_name` snapshot onto the domain `activityName` field.
      //
      // Chunked + paginated (the fetchAllIn pattern, inlined for the audit-table
      // filters): the dashboard calls this with EVERY unit id in the project, so a
      // single `.in(...)` blows the ~8KB request-URL limit past ~200 ids (hard
      // failure → empty timeline) and silently truncates at PostgREST's 1000-row
      // cap (pace / weekly velocity / Monte Carlo quietly undercount). Ordering is
      // re-applied client-side because chunks return independently.
      type AuditRow = {
        unit_id: string; activity_id: string; activity_name: string; track: string;
        logged_date: string; client_timestamp: string | null; user_id: string | null;
      };
      const ID_CHUNK = 200; // keep each .in(...) URL comfortably under the header limit
      const rows: AuditRow[] = [];
      for (let i = 0; i < validUnitIds.length; i += ID_CHUNK) {
        const slice = validUnitIds.slice(i, i + ID_CHUNK);
        const chunkRows = await paginateAll<AuditRow>(async (from, size) => {
          const { data, error } = await supabase
            .from('status_audit_log')
            .select('unit_id, activity_id, activity_name, track, logged_date, client_timestamp, user_id')
            .in('unit_id', slice)
            .eq('temporal_state', 'completed')
            .not('logged_date', 'is', null)
            .order('id', { ascending: true })
            .range(from, from + size - 1);
          if (error) throw error;
          return (data ?? []) as unknown as AuditRow[];
        });
        rows.push(...chunkRows);
      }
      rows.sort((a, b) => (a.logged_date < b.logged_date ? -1 : a.logged_date > b.logged_date ? 1 : 0));
      return rows.map(({ activity_name, ...r }) => ({ ...r, activityName: activity_name })) as unknown as StatusHistoryEvent[];
    },
    enabled: validUnitIds.length > 0,
    staleTime: 1000 * 60 * 5,
    placeholderData: keepPreviousData,
  });
}

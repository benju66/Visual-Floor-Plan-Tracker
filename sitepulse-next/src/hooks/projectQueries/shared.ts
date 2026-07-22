import { supabase } from '@/supabaseClient';
import { paginateAll } from '@/utils/pagination';
import type { StatusLog } from '@/types/domain';

/**
 * Fetch every row of `table` whose `column` is in `values`, defeating PostgREST's
 * per-request row cap (1000 by default) AND its request-URL length limit.
 *
 * The id list is sliced into chunks (so the `.in(...)` URL stays well under header
 * limits), and each chunk is paged with `.range()` under a stable `.order('id')`
 * until exhausted. Without this, the all-levels views silently truncate once a
 * project exceeds 1000 status rows — completed activities beyond the cap read back
 * as "not started" (see paginateAll). Exported for every cross-sheet/cross-unit
 * aggregation read (dashboard, workbench corpus, sheet delete) — any new
 * `.in(<ids>)` read over an unbounded id list should go through here.
 */
export async function fetchAllIn<T>(
  table: 'status_logs' | 'units',
  column: 'unit_id' | 'sheet_id',
  values: string[],
  select: string = '*'
): Promise<T[]> {
  const ID_CHUNK = 200; // keep each .in(...) URL comfortably under the ~8KB header limit
  const out: T[] = [];
  for (let i = 0; i < values.length; i += ID_CHUNK) {
    const slice = values.slice(i, i + ID_CHUNK);
    const rows = await paginateAll<T>(async (from, size) => {
      const { data, error } = await supabase
        .from(table)
        .select(select)
        .in(column, slice)
        .order('id', { ascending: true })
        .range(from, from + size - 1);
      if (error) throw error;
      return (data ?? []) as unknown as T[];
    });
    out.push(...rows);
  }
  return out;
}

/**
 * status_logs keys by `activity_id` (the stable id). The status pipeline still
 * correlates + displays by the activity's NAME, so every read joins `activities(name)`
 * and flattens it onto a synthesized `activityName` field — keeping `StatusLog` shape-
 * compatible with the rest of the app while the DB stays id-keyed (Scheduling
 * Foundation Slice A, Phase 1). Renaming an activity changes only this synthesized
 * name on the next read; the stored history is never touched.
 */
type StatusRowWithActivity = Omit<StatusLog, 'activityName'> & { activities: { name: string } | null };
export async function fetchStatusLogsForUnits(unitIds: string[]): Promise<StatusLog[]> {
  const rows = await fetchAllIn<StatusRowWithActivity>(
    'status_logs', 'unit_id', unitIds, '*, activities(name)'
  );
  return rows.map(({ activities, ...r }) => ({ ...r, activityName: activities?.name ?? '' } as StatusLog));
}

import type { StatusLogInsert, TemporalState, PercentPoint, StatusLog } from './domain';

// The status_logs write payload keys by `activity_id` (from StatusLogInsert). The
// optional `activityName` is carried ONLY for the optimistic cache entry's display
// (StatusLog synthesizes it on read); it is stripped before the RPC call.
export interface UpdateStatusVars extends Omit<StatusLogInsert, 'id' | 'created_at'> {
  activityName?: string;
}

export interface BulkUpdateStatusVars {
  unitIds: string[];
  /** Control sentinels + the activity NAME (used for optimistic display). */
  activityName: string | '__KEEP_EXISTING__' | null;
  /** The stable slot key. Resolved from the activity name when it is a real activity. */
  activity_id?: string | null;
  color: string;
  temporal_state: TemporalState | '__KEEP_EXISTING__';
  track: string;
  planned_start_date?: string | null;
  planned_end_date?: string | null;
  logged_date?: string | null;
  bottlenecks?: StatusLog[];
}

export interface UpdateUnitGeometryVars {
  unitId: string;
  polygon_coordinates: PercentPoint[];
}

import type { StatusLogInsert, TemporalState, PercentPoint, StatusLog, PendingChange } from './domain';

/**
 * The extras a status commit can carry (map quick modals, inspector date edits,
 * and the offline replay path). Exactly the offline queue's typed
 * `PendingChange['extraProps']` plus the two sync-time additions:
 * `client_timestamp` (capture-time stamp from handleApplyAll) and
 * `temporal_state` (the quick modal pinning the state on an activity change).
 * This is the type `commitUnitActivity` / `handleQuickUpdate` accept — these
 * write paths were `any` and let shape drift (e.g. a stray legacy key) compile.
 */
export type CommitStatusExtraProps = PendingChange['extraProps'] & {
  client_timestamp?: string | null;
  temporal_state?: TemporalState;
};

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
  /** Null for keep-existing/clear sentinels (each slot keeps its own color). */
  color: string | null;
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

import type { Activity, PendingChange, PendingChangesMap, StatusLog, TemporalState, Unit } from '@/types/domain';
import { pendingChangeKey } from './pendingChangeKey';

/**
 * One drill-in row for the pending queue (Save Visibility — Phase 2).
 *
 * Both surfaces — the mobile `PendingReviewDrawer` and the desktop FAB popover — render
 * the SAME rows, so the "what's queued" shape is built ONCE here instead of forked inline
 * in each component. Carries the underlying `change` so a per-item Retry can feed it
 * straight back into `handleRetryItem` (→ `onApplyPendingChanges([change])`).
 */
export interface PendingItem {
  /** The canonical `${unit.id}_${activityName}` key — matches `failedKeys` exactly. */
  key: string;
  unitId: string;
  unitNumber: string;
  unit: Unit;
  log: StatusLog | null;
  activityName: string;
  activityColor: string;
  activityObj?: Pick<Activity, 'id' | 'name' | 'color' | 'track'>;
  state: TemporalState;
  /** True when this row comes from the per-activity timeline buffer, not the primary. */
  isTimeline: boolean;
  /** True when a primary AND a timeline edit target the same slot (timeline wins). */
  hasConflict: boolean;
  /** The underlying staged change — the exact payload a single-item retry re-applies. */
  change: PendingChange;
}

const DEFAULT_ACTIVITY_COLOR = '#94a3b8';

function toItem(change: PendingChange, isTimeline: boolean, hasConflict: boolean): PendingItem {
  const activityName = change.extraProps?.activityObj?.name || change.log?.activityName || 'Primary';
  return {
    key: pendingChangeKey(change),
    unitId: change.unit.id,
    unitNumber: change.unit.unit_number,
    unit: change.unit,
    log: change.log,
    activityName,
    activityColor: change.extraProps?.activityObj?.color || change.log?.status_color || DEFAULT_ACTIVITY_COLOR,
    activityObj: change.extraProps?.activityObj,
    state: change.state,
    isTimeline,
    hasConflict,
    change,
  };
}

/**
 * Fold the two staging buffers into one row per slot, deduped by {@link pendingChangeKey}.
 * A timeline edit OVERRIDES a primary edit on the same slot (mirrors `handleApplyAll`'s
 * dedupe, where timeline is applied last), flagging the row `hasConflict` so the UI can
 * warn the primary card update was superseded.
 */
export function buildPendingItems(
  pendingChanges: PendingChangesMap,
  pendingTimelineChanges: PendingChangesMap,
): PendingItem[] {
  const map = new Map<string, PendingItem>();
  for (const change of Object.values(pendingChanges)) {
    map.set(pendingChangeKey(change), toItem(change, false, false));
  }
  for (const change of Object.values(pendingTimelineChanges)) {
    const key = pendingChangeKey(change);
    map.set(key, toItem(change, true, map.has(key)));
  }
  return Array.from(map.values());
}

import type { PendingChange } from '@/types/domain';

/**
 * The one canonical key for a staged status change (Save Visibility — Phase 1).
 *
 * `${unit.id}_${activityName}` was previously duplicated inline in three places in
 * `useFieldData` — `pendingCount` (dedupe), `handleApplyAll` (dedupe → `finalChanges`),
 * and the per-item `checkpoint`. Extracting it guarantees the failed-key set is keyed
 * IDENTICALLY to the dedupe/checkpoint, so a failed apply result maps back to the exact
 * same slot the queue counts and drains (no drift between "counted", "applied", and
 * "flagged failed").
 *
 * Activity resolution matches the dedupe path exactly: the staged activity object's name
 * (the offline-replay slot identity), else the base log's synthesized `activityName`, else
 * the `'Primary'` sentinel for a location-level change that carries no activity. Unit ids
 * are UUIDs (no `_`), so a consumer can recover the unit id by slicing at the first `_`.
 *
 * Only `unit` / `log` / `extraProps` are read, so this also accepts the partial an edit
 * handler has on hand (`{ unit, log, extraProps }`) — not just a full {@link PendingChange}.
 */
export function pendingChangeKey(change: Pick<PendingChange, 'unit' | 'log' | 'extraProps'>): string {
  const activityName = change.extraProps?.activityObj?.name || change.log?.activityName || 'Primary';
  return `${change.unit.id}_${activityName}`;
}

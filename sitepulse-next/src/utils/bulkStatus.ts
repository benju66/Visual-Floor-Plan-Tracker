import type { Unit, StatusLog, Milestone, TemporalState, PendingChange, PendingChangesMap } from '@/types/domain';

/**
 * Pure builder that turns a bulk status action ("set <milestone> = <state> on these units")
 * into a map of staged {@link PendingChange} entries — the SAME timeline-staging shape used by
 * `useFieldData.handleTimelineUpdate`, keyed `${unitId}_${milestone}`.
 *
 * Because the output merges into `pendingTimelineChanges`, a bulk edit replays through the
 * existing per-item offline queue (`handleApplyAll` → `onApplyPendingChanges` → `commitUnitMilestone`)
 * and is therefore offline-durable with no new sync path. This is the engine behind the
 * "carpet's done on all of floor 4" scenario.
 *
 * Pure + deterministic: `capturedAt` is passed in (not read from the clock) so it is testable and
 * so a single bulk action stamps one consistent capture time across every unit.
 */
export interface BulkStatusInput {
  unitIds: string[];
  units: Unit[];
  /** Raw current-state logs across the working scope (one row per unit×track×milestone). */
  currentLogs: StatusLog[];
  milestone: Pick<Milestone, 'name' | 'color' | 'track'>;
  state: TemporalState;
  /** ISO offline-capture timestamp, stamped once per bulk action. */
  capturedAt: string;
  /** Optional planned/actual dates. `undefined` = leave unset (omitted from extraProps). */
  startDate?: string | null;
  endDate?: string | null;
  loggedDate?: string | null;
}

export function buildBulkStatusChanges(input: BulkStatusInput): PendingChangesMap {
  const { unitIds, units, currentLogs, milestone, state, capturedAt, startDate, endDate, loggedDate } = input;

  const unitsById = new Map(units.map((u) => [u.id, u]));
  const out: PendingChangesMap = {};

  for (const id of unitIds) {
    const unit = unitsById.get(id);
    if (!unit) continue; // unknown id (e.g. stale selection) — skip silently

    const baseLog =
      currentLogs.find(
        (l) => l.unit_id === id && l.milestone === milestone.name && l.track === milestone.track
      ) ?? null;

    const extraProps: PendingChange['extraProps'] = { milestoneObj: milestone };
    if (startDate !== undefined) extraProps.startDate = startDate;
    if (endDate !== undefined) extraProps.endDate = endDate;
    if (loggedDate !== undefined) extraProps.loggedDate = loggedDate;

    out[`${id}_${milestone.name}`] = { unit, log: baseLog, state, capturedAt, extraProps };
  }

  return out;
}

import type { Unit, StatusLog, TemporalState } from '@/types/domain';

/**
 * Pure filtering + selection logic for the Locations & Status management workspace.
 *
 * Kept framework-free and side-effect-free so it is unit-testable and reusable by the
 * desktop grid, the bulk "select all matching" action, and (later) the all-levels scope.
 * The workspace UI state that drives these functions lives in `useManageStore`.
 */

/** Token used to match locations that have no assignee. */
export const UNASSIGNED = '__unassigned__';

/** Facet values for the temporal-state filter. `not_started` covers no-log / 'none'. */
export type StateFacet = Exclude<TemporalState, 'none'> | 'not_started';

export interface ManageFilters {
  /** Free-text match against unit_number and unit_type (case-insensitive substring). */
  query: string;
  /** unit_type whitelist. Empty = all types. */
  types: string[];
  /** Current-milestone name whitelist. Empty = all milestones. */
  milestones: string[];
  /** Temporal-state facet whitelist. Empty = all states. */
  states: StateFacet[];
  /** assigned_to id whitelist; use UNASSIGNED for "no assignee". Empty = all. */
  assignees: string[];
  /** When true, keep only rows flagged behind schedule / out of sequence. */
  behindSchedule: boolean;
}

/** A unit paired with its current (bottleneck) status for the active track. */
export interface LocationRow {
  unit: Unit;
  log: (StatusLog & { outOfSequence?: unknown[] }) | null;
  /** Caller-computed schedule-variance flag (from progressAnalytics) — keeps this util decoupled. */
  isBehind?: boolean;
}

/** A fresh, mutation-safe empty filter set (do not share a single reference across stores). */
export function emptyFilters(): ManageFilters {
  return { query: '', types: [], milestones: [], states: [], assignees: [], behindSchedule: false };
}

/** True when the filter set imposes no constraints (every row passes). */
export function isEmptyFilters(f: ManageFilters): boolean {
  return (
    f.query.trim() === '' &&
    f.types.length === 0 &&
    f.milestones.length === 0 &&
    f.states.length === 0 &&
    f.assignees.length === 0 &&
    !f.behindSchedule
  );
}

/** Collapse a row's status into a single state facet. No/`none` log → 'not_started'. */
export function rowStateFacet(row: LocationRow): StateFacet {
  const s = row.log?.temporal_state;
  return s && s !== 'none' ? (s as StateFacet) : 'not_started';
}

/** Number of active facets — handy for a "Clear filters (N)" affordance. */
export function activeFilterCount(f: ManageFilters): number {
  let n = 0;
  if (f.query.trim() !== '') n++;
  if (f.types.length) n++;
  if (f.milestones.length) n++;
  if (f.states.length) n++;
  if (f.assignees.length) n++;
  if (f.behindSchedule) n++;
  return n;
}

export function matchesFilters(row: LocationRow, f: ManageFilters): boolean {
  const { unit, log } = row;

  const q = f.query.trim().toLowerCase();
  if (q) {
    const hay = `${unit.unit_number ?? ''} ${unit.unit_type ?? ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }

  if (f.types.length && !f.types.includes(unit.unit_type ?? '')) return false;

  if (f.milestones.length && !f.milestones.includes(log?.milestone ?? '')) return false;

  if (f.states.length && !f.states.includes(rowStateFacet(row))) return false;

  if (f.assignees.length) {
    const who = unit.assigned_to ?? UNASSIGNED;
    if (!f.assignees.includes(who)) return false;
  }

  if (f.behindSchedule && row.isBehind !== true) return false;

  return true;
}

/** Apply a filter set to a list of rows (preserves input order). */
export function filterLocations(rows: LocationRow[], f: ManageFilters): LocationRow[] {
  if (isEmptyFilters(f)) return rows;
  return rows.filter((r) => matchesFilters(r, f));
}

/** Unit ids of every row matching the filter set — backs the "select all matching" action. */
export function selectAllMatchingIds(rows: LocationRow[], f: ManageFilters): string[] {
  return filterLocations(rows, f).map((r) => r.unit.id);
}

import { describe, it, expect } from 'vitest';
import type { Unit, StatusLog } from '@/types/domain';
import {
  emptyFilters,
  isEmptyFilters,
  activeFilterCount,
  rowStateFacet,
  matchesFilters,
  filterLocations,
  selectAllMatchingIds,
  UNASSIGNED,
  type LocationRow,
  type ManageFilters,
} from './locationFilters';

function unit(p: Partial<Unit> & { id: string }): Unit {
  return { unit_number: '', unit_type: null, assigned_to: null, ...p } as unknown as Unit;
}
function log(p: Partial<StatusLog>): StatusLog {
  return { milestone: '', temporal_state: 'none', ...p } as unknown as StatusLog;
}
function row(u: Partial<Unit> & { id: string }, l: Partial<StatusLog> | null = null, isBehind?: boolean): LocationRow {
  return { unit: unit(u), log: l ? log(l) : null, isBehind };
}

const ROWS: LocationRow[] = [
  row({ id: '1', unit_number: '204', unit_type: 'Apartment', assigned_to: 'jane' }, { milestone: 'Carpet', temporal_state: 'ongoing' }),
  row({ id: '2', unit_number: '205', unit_type: 'Apartment', assigned_to: null }, { milestone: 'Drywall', temporal_state: 'planned' }, true),
  row({ id: '3', unit_number: 'Lobby', unit_type: 'Common', assigned_to: 'alex' }, { milestone: 'Final', temporal_state: 'completed' }),
  row({ id: '4', unit_number: 'Stair B', unit_type: 'BOH', assigned_to: null }, null),
];

function withFilter(over: Partial<ManageFilters>): ManageFilters {
  return { ...emptyFilters(), ...over };
}

describe('emptyFilters / isEmptyFilters', () => {
  it('returns a fresh object each call (no shared mutation)', () => {
    const a = emptyFilters();
    const b = emptyFilters();
    expect(a).not.toBe(b);
    a.types.push('x');
    expect(b.types).toEqual([]);
  });
  it('isEmptyFilters is true for a pristine set, false once any facet is set', () => {
    expect(isEmptyFilters(emptyFilters())).toBe(true);
    expect(isEmptyFilters(withFilter({ query: 'a' }))).toBe(false);
    expect(isEmptyFilters(withFilter({ query: '   ' }))).toBe(true); // whitespace-only = empty
    expect(isEmptyFilters(withFilter({ behindSchedule: true }))).toBe(false);
  });
});

describe('rowStateFacet', () => {
  it('maps a concrete state through, and no-log / none → not_started', () => {
    expect(rowStateFacet(ROWS[0])).toBe('ongoing');
    expect(rowStateFacet(ROWS[2])).toBe('completed');
    expect(rowStateFacet(ROWS[3])).toBe('not_started');
    expect(rowStateFacet(row({ id: 'x' }, { temporal_state: 'none' }))).toBe('not_started');
  });
});

describe('matchesFilters — single facets', () => {
  it('query matches unit_number and unit_type, case-insensitive', () => {
    expect(matchesFilters(ROWS[0], withFilter({ query: '204' }))).toBe(true);
    expect(matchesFilters(ROWS[0], withFilter({ query: 'apart' }))).toBe(true);
    expect(matchesFilters(ROWS[0], withFilter({ query: 'LOBBY' }))).toBe(false);
  });
  it('types facet', () => {
    expect(matchesFilters(ROWS[0], withFilter({ types: ['Apartment'] }))).toBe(true);
    expect(matchesFilters(ROWS[2], withFilter({ types: ['Apartment'] }))).toBe(false);
  });
  it('milestones facet', () => {
    expect(matchesFilters(ROWS[0], withFilter({ milestones: ['Carpet'] }))).toBe(true);
    expect(matchesFilters(ROWS[1], withFilter({ milestones: ['Carpet'] }))).toBe(false);
    expect(matchesFilters(ROWS[3], withFilter({ milestones: ['Carpet'] }))).toBe(false); // no log
  });
  it('states facet incl not_started', () => {
    expect(matchesFilters(ROWS[0], withFilter({ states: ['ongoing'] }))).toBe(true);
    expect(matchesFilters(ROWS[3], withFilter({ states: ['not_started'] }))).toBe(true);
    expect(matchesFilters(ROWS[0], withFilter({ states: ['not_started'] }))).toBe(false);
  });
  it('assignees facet incl UNASSIGNED token', () => {
    expect(matchesFilters(ROWS[0], withFilter({ assignees: ['jane'] }))).toBe(true);
    expect(matchesFilters(ROWS[1], withFilter({ assignees: ['jane'] }))).toBe(false);
    expect(matchesFilters(ROWS[1], withFilter({ assignees: [UNASSIGNED] }))).toBe(true);
    expect(matchesFilters(ROWS[0], withFilter({ assignees: [UNASSIGNED] }))).toBe(false);
  });
  it('behindSchedule facet', () => {
    expect(matchesFilters(ROWS[1], withFilter({ behindSchedule: true }))).toBe(true);
    expect(matchesFilters(ROWS[0], withFilter({ behindSchedule: true }))).toBe(false);
  });
});

describe('matchesFilters — combined facets are AND-ed', () => {
  it('requires every active facet to pass', () => {
    const f = withFilter({ types: ['Apartment'], states: ['ongoing'] });
    expect(matchesFilters(ROWS[0], f)).toBe(true);  // Apartment + ongoing
    expect(matchesFilters(ROWS[1], f)).toBe(false); // Apartment but planned
  });
});

describe('filterLocations / selectAllMatchingIds', () => {
  it('empty filter returns all rows (same reference, preserves order)', () => {
    expect(filterLocations(ROWS, emptyFilters())).toBe(ROWS);
  });
  it('filters and selects matching ids', () => {
    const f = withFilter({ types: ['Apartment'] });
    expect(filterLocations(ROWS, f).map((r) => r.unit.id)).toEqual(['1', '2']);
    expect(selectAllMatchingIds(ROWS, f)).toEqual(['1', '2']);
  });
  it('select-all-matching across the not_started + unassigned cohort', () => {
    expect(selectAllMatchingIds(ROWS, withFilter({ states: ['not_started'], assignees: [UNASSIGNED] }))).toEqual(['4']);
  });
});

describe('activeFilterCount', () => {
  it('counts each active facet once', () => {
    expect(activeFilterCount(emptyFilters())).toBe(0);
    expect(activeFilterCount(withFilter({ query: 'a', types: ['x'], behindSchedule: true }))).toBe(3);
  });
});

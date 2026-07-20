import { describe, it, expect } from 'vitest';
import { queryKeys } from './queryKeys';

/**
 * Byte-identity guard for the Frontend Structure (W3) Phase 1 queryKeys sweep.
 *
 * Phase 1 routed ~62 hand-written react-query cache keys through the central
 * factory. Because a key written in one file must EXACTLY match the key read in
 * another (and prefix builders must be an exact leading slice of the full key
 * they partial-match), a single differing element silently breaks cache
 * invalidation. These tests pin every NEW builder to the exact array literal it
 * replaced, and pin every prefix builder to be the leading slice of its
 * variadic sibling. If a future edit drifts one element, this fails loudly.
 */
describe('queryKeys — Phase 1 sweep byte-identity', () => {
  it('sheet(sheetId) emits the exact single-sheet literal', () => {
    expect(queryKeys.sheet('s1')).toEqual(['sheet', 's1']);
  });

  it('prefix builders emit their exact legacy literals', () => {
    expect(queryKeys.statusesBySheet('s1')).toEqual(['statuses', 's1']);
    expect(queryKeys.statusesAll()).toEqual(['statuses']);
    expect(queryKeys.allProjectStatusesAll()).toEqual(['all_project_statuses']);
    expect(queryKeys.allProjectUnitsAll()).toEqual(['all_project_units']);
    expect(queryKeys.unitsAll()).toEqual(['units']);
    expect(queryKeys.activitiesAll()).toEqual(['activities']);
    expect(queryKeys.projectMembersAll()).toEqual(['project_members']);
  });
});

describe('queryKeys — prefix builders are exact leading slices of the full keys', () => {
  // This is the property that makes prefix invalidation/reads work: react-query
  // partial-matches a stored full key against the shorter prefix, so the prefix
  // MUST be a byte-identical head of the full builder's output.
  it('statusesBySheet(sheetId) is the 2-element head of statuses(sheetId, unitIds)', () => {
    const full = queryKeys.statuses('s1', ['u1', 'u2']);
    expect(queryKeys.statusesBySheet('s1')).toEqual(full.slice(0, 2));
  });

  it('statusesAll() is the 1-element head of statuses(sheetId, unitIds)', () => {
    const full = queryKeys.statuses('s1', ['u1']);
    expect(queryKeys.statusesAll()).toEqual(full.slice(0, 1));
  });

  it('allProjectStatusesAll() is the 1-element head of allProjectStatuses(unitIds)', () => {
    const full = queryKeys.allProjectStatuses(['u1', 'u2']);
    expect(queryKeys.allProjectStatusesAll()).toEqual(full.slice(0, 1));
  });

  it('allProjectUnitsAll() is the 1-element head of allProjectUnits(sheetIds)', () => {
    const full = queryKeys.allProjectUnits(['s1', 's2']);
    expect(queryKeys.allProjectUnitsAll()).toEqual(full.slice(0, 1));
  });

  it('unitsAll() is the 1-element head of units(sheetId)', () => {
    expect(queryKeys.unitsAll()).toEqual(queryKeys.units('s1').slice(0, 1));
  });

  it('activitiesAll() is the 1-element head of activities(projectId)', () => {
    expect(queryKeys.activitiesAll()).toEqual(queryKeys.activities('p1').slice(0, 1));
  });

  it('projectMembersAll() is the 1-element head of projectMembers(projectId)', () => {
    expect(queryKeys.projectMembersAll()).toEqual(queryKeys.projectMembers('p1').slice(0, 1));
  });

  it('sheet(sheetId) matches the shape sheets(projectId) does NOT (distinct prefix)', () => {
    // `sheet` (singular, by PK) and `sheets` (plural, by project) are different
    // caches — guard against anyone collapsing them.
    expect(queryKeys.sheet('x')[0]).toBe('sheet');
    expect(queryKeys.sheets('x')[0]).toBe('sheets');
  });
});

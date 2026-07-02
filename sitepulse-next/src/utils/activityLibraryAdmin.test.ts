import { describe, it, expect } from 'vitest';
import {
  filterActivitiesForAdmin,
  groupActivitiesByTrack,
  NO_SCOPE_LABEL,
} from './activityLibraryAdmin';
import type { ActivityDictionaryEntry, ActivityDictionaryStatus } from '@/types/domain';

function entry(
  name: string,
  opts: Partial<Pick<ActivityDictionaryEntry, 'status' | 'track' | 'aliases'>> = {},
): ActivityDictionaryEntry {
  return {
    id: name,
    name,
    track: opts.track ?? null,
    type: 'task',
    status: opts.status ?? 'active',
    aliases: opts.aliases ?? [],
    default_project_types: [],
    cost_code_id: null,
    proposed_note: null,
    created_by: null,
    created_at: null,
    updated_at: null,
  };
}

describe('filterActivitiesForAdmin', () => {
  const entries = [
    entry('Framing', { status: 'active' }),
    entry('MEP Rough-In', { status: 'active', aliases: ['Rough-Ins'] }),
    entry('Old Thing', { status: 'deprecated' }),
    entry('Other (pending)', { status: 'pending' }),
  ];

  it("keeps every status when filter is 'all'", () => {
    expect(filterActivitiesForAdmin(entries, 'all', '')).toHaveLength(4);
  });

  it('filters by a specific status', () => {
    const status: ActivityDictionaryStatus = 'active';
    expect(filterActivitiesForAdmin(entries, status, '').map((e) => e.name)).toEqual([
      'Framing',
      'MEP Rough-In',
    ]);
  });

  it('matches the query against name (case-insensitive)', () => {
    expect(filterActivitiesForAdmin(entries, 'all', 'fram').map((e) => e.name)).toEqual(['Framing']);
  });

  it('matches the query against an alias (finds the canonical entry)', () => {
    expect(filterActivitiesForAdmin(entries, 'all', 'rough-ins').map((e) => e.name)).toEqual(['MEP Rough-In']);
  });

  it('combines status + query', () => {
    expect(filterActivitiesForAdmin(entries, 'deprecated', 'old').map((e) => e.name)).toEqual(['Old Thing']);
  });
});

describe('groupActivitiesByTrack', () => {
  it('groups by track, named alphabetically, untagged last (labelled), items sorted by name', () => {
    const entries = [
      entry('Paint', { track: 'Production' }),
      entry('Framing', { track: 'Production' }),
      entry('City Inspection', { track: 'Inspections' }),
      entry('Loose Activity'), // no track
    ];
    const grouped = groupActivitiesByTrack(entries);
    expect(grouped.map((g) => g.label)).toEqual(['Inspections', 'Production', NO_SCOPE_LABEL]);
    // Items within a group are name-sorted.
    expect(grouped.find((g) => g.track === 'Production')!.items.map((e) => e.name)).toEqual([
      'Framing',
      'Paint',
    ]);
  });

  it('treats whitespace-only track as untagged', () => {
    const grouped = groupActivitiesByTrack([entry('X', { track: '  ' })]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].label).toBe(NO_SCOPE_LABEL);
  });

  it('returns an empty array for no entries', () => {
    expect(groupActivitiesByTrack([])).toEqual([]);
  });
});

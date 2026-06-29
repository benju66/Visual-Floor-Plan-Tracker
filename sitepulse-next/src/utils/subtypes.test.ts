import { describe, it, expect } from 'vitest';
import {
  narrowSubtypeRow,
  taxonomyResultToUnitFields,
  orderedSubtypesByRole,
  addAliasToList,
  filterSubtypesForAdmin,
  groupSubtypesByRole,
  restrictSubtypesToProjectType,
  fuzzyRankSubtypes,
  matchSubtypeForName,
  recentSubtypeIdsFromUnits,
  type TaxonomyResult,
} from './subtypes';
import type { Subtype } from '@/types/domain';
import { PROJECT_TYPES } from '@/utils/locationTaxonomy';

function makeSubtype(over: Partial<Subtype> = {}): Subtype {
  return {
    id: over.id ?? 'id-1',
    name: over.name ?? 'Classroom',
    top_level_role: over.top_level_role ?? 'program',
    status: over.status ?? 'active',
    aliases: over.aliases ?? [],
    default_project_types: over.default_project_types ?? [],
    proposed_note: over.proposed_note ?? null,
    created_by: over.created_by ?? null,
    created_at: over.created_at ?? null,
  };
}

describe('narrowSubtypeRow', () => {
  it('narrows valid JSONB columns through unchanged', () => {
    const row = {
      id: 'a',
      name: 'Lab',
      top_level_role: 'program',
      status: 'active',
      aliases: ['Laboratory'],
      default_project_types: ['Healthcare', 'Industrial'],
      proposed_note: null,
      created_by: null,
      created_at: null,
    };
    const out = narrowSubtypeRow(row as never);
    expect(out.aliases).toEqual(['Laboratory']);
    expect(out.default_project_types).toEqual(['Healthcare', 'Industrial']);
  });

  it('degrades malformed JSONB to empty arrays instead of throwing', () => {
    const row = {
      id: 'b',
      name: 'Weird',
      top_level_role: 'other',
      status: 'active',
      aliases: null, // not an array
      default_project_types: ['NotARealProjectType'], // bad element
      proposed_note: null,
      created_by: null,
      created_at: null,
    };
    const out = narrowSubtypeRow(row as never);
    expect(out.aliases).toEqual([]);
    expect(out.default_project_types).toEqual([]);
  });
});

describe('taxonomyResultToUnitFields', () => {
  const reject = async () => { throw new Error('should not be called'); };

  it('maps an existing sub-type pick straight through', async () => {
    const result: TaxonomyResult = { kind: 'subtype', subtypeId: 's1', name: 'Patient Room', role: 'program' };
    const fields = await taxonomyResultToUnitFields(result, reject);
    expect(fields).toEqual({ unit_type: 'Patient Room', top_level_role: 'program', subtype_id: 's1' });
  });

  it('uses the proposed sub-type when an Other-pending write succeeds', async () => {
    const result: TaxonomyResult = { kind: 'pending', role: 'support', name: 'Generator Room' };
    const proposed = makeSubtype({ id: 'new-id', name: 'Generator Room', top_level_role: 'support', status: 'pending' });
    const fields = await taxonomyResultToUnitFields(result, async () => proposed);
    expect(fields).toEqual({ unit_type: 'Generator Room', top_level_role: 'support', subtype_id: 'new-id' });
  });

  it('degrades to role + free name (subtype_id null) when the propose write is denied', async () => {
    const result: TaxonomyResult = { kind: 'pending', role: 'other', name: 'Mystery Space' };
    const fields = await taxonomyResultToUnitFields(result, reject);
    expect(fields).toEqual({ unit_type: 'Mystery Space', top_level_role: 'other', subtype_id: null });
  });
});

describe('orderedSubtypesByRole', () => {
  const dict: Subtype[] = [
    makeSubtype({ id: '1', name: 'Classroom', top_level_role: 'program', default_project_types: ['Educational'] }),
    makeSubtype({ id: '2', name: 'Patient Room', top_level_role: 'program', default_project_types: ['Healthcare'] }),
    makeSubtype({ id: '3', name: 'Corridor', top_level_role: 'common', default_project_types: ['Educational', 'Healthcare'] }),
    makeSubtype({ id: '4', name: 'Mechanical', top_level_role: 'support', default_project_types: ['Educational', 'Healthcare'] }),
    makeSubtype({ id: '5', name: 'Other (pending)', top_level_role: 'other', status: 'pending' }),
    makeSubtype({ id: '6', name: 'Deprecated Thing', top_level_role: 'program', status: 'deprecated' }),
  ];

  it('buckets active sub-types into the 4 canonical roles', () => {
    const groups = orderedSubtypesByRole(dict, 'Educational');
    expect(groups.program.map(s => s.name)).toContain('Classroom');
    expect(groups.common.map(s => s.name)).toEqual(['Corridor']);
    expect(groups.support.map(s => s.name)).toEqual(['Mechanical']);
  });

  it('excludes non-active (pending/deprecated) entries', () => {
    const groups = orderedSubtypesByRole(dict, 'Educational');
    const allNames = Object.values(groups).flat().map(s => s.name);
    expect(allNames).not.toContain('Other (pending)');
    expect(allNames).not.toContain('Deprecated Thing');
  });

  it('orders the matching project type’s defaults first within a role', () => {
    const groups = orderedSubtypesByRole(dict, 'Educational');
    // Classroom (Educational default) sorts ahead of Patient Room (Healthcare-only).
    expect(groups.program.map(s => s.name)).toEqual(['Classroom', 'Patient Room']);
  });

  it('keeps natural order and still buckets when project type is null', () => {
    const groups = orderedSubtypesByRole(dict, null);
    expect(groups.program.map(s => s.name)).toEqual(['Classroom', 'Patient Room']);
    expect(groups.common.map(s => s.name)).toEqual(['Corridor']);
  });
});

describe('addAliasToList', () => {
  it('appends a trimmed alias name', () => {
    expect(addAliasToList(['Laboratory'], '  Lab Room ')).toEqual(['Laboratory', 'Lab Room']);
  });

  it('is a no-op for a blank name (returns a copy)', () => {
    const input = ['Laboratory'];
    const out = addAliasToList(input, '   ');
    expect(out).toEqual(['Laboratory']);
    expect(out).not.toBe(input); // immutable
  });

  it('does not duplicate an existing alias (case-insensitive)', () => {
    expect(addAliasToList(['Laboratory'], 'laboratory')).toEqual(['Laboratory']);
  });
});

describe('filterSubtypesForAdmin', () => {
  const dict: Subtype[] = [
    makeSubtype({ id: '1', name: 'Classroom', status: 'active' }),
    makeSubtype({ id: '2', name: 'Generator Room', status: 'pending' }),
    makeSubtype({ id: '3', name: 'Salon Studio', status: 'active', aliases: ['Salon Suite'] }),
    makeSubtype({ id: '4', name: 'Old Thing', status: 'deprecated' }),
  ];

  it('keeps every status when filter is "all"', () => {
    expect(filterSubtypesForAdmin(dict, 'all', '')).toHaveLength(4);
  });

  it('filters to a single status', () => {
    expect(filterSubtypesForAdmin(dict, 'pending', '').map(s => s.name)).toEqual(['Generator Room']);
  });

  it('matches the query against the name (case-insensitive)', () => {
    expect(filterSubtypesForAdmin(dict, 'all', 'room').map(s => s.name)).toEqual(['Classroom', 'Generator Room']);
  });

  it('matches the query against an alias so a synonym finds its canonical home', () => {
    expect(filterSubtypesForAdmin(dict, 'all', 'salon suite').map(s => s.name)).toEqual(['Salon Studio']);
  });
});

describe('groupSubtypesByRole', () => {
  it('buckets every status into canonical roles, preserving order', () => {
    const dict: Subtype[] = [
      makeSubtype({ id: '1', name: 'Classroom', top_level_role: 'program', status: 'active' }),
      makeSubtype({ id: '2', name: 'Pending Prog', top_level_role: 'program', status: 'pending' }),
      makeSubtype({ id: '3', name: 'Corridor', top_level_role: 'common', status: 'deprecated' }),
    ];
    const groups = groupSubtypesByRole(dict);
    expect(groups.program.map(s => s.name)).toEqual(['Classroom', 'Pending Prog']);
    expect(groups.common.map(s => s.name)).toEqual(['Corridor']);
    expect(groups.support).toEqual([]);
  });

  it('skips rows with an unrecognised role instead of throwing', () => {
    const dict = [makeSubtype({ id: 'x', name: 'Weird', top_level_role: 'nonsense' as never })];
    const groups = groupSubtypesByRole(dict);
    expect(Object.values(groups).flat()).toEqual([]);
  });
});

describe('restrictSubtypesToProjectType', () => {
  const universal = makeSubtype({ id: 'u', name: 'Corridor', default_project_types: [...PROJECT_TYPES] });
  const housing = makeSubtype({ id: 'h', name: 'Dwelling Unit', default_project_types: ['Housing'] });
  const healthcare = makeSubtype({ id: 'k', name: 'Dental Operatory', default_project_types: ['Healthcare'] });
  const dict = [universal, housing, healthcare];

  it('keeps universal types and the project type’s own, drops other verticals', () => {
    const out = restrictSubtypesToProjectType(dict, 'Housing').map(s => s.name);
    expect(out).toEqual(['Corridor', 'Dwelling Unit']); // Dental Operatory dropped
  });

  it('forces in a kept id even when it would be filtered out', () => {
    const out = restrictSubtypesToProjectType(dict, 'Housing', new Set(['k'])).map(s => s.name);
    expect(out).toEqual(['Corridor', 'Dwelling Unit', 'Dental Operatory']);
  });

  it('returns the list unchanged when the project type is null', () => {
    expect(restrictSubtypesToProjectType(dict, null)).toBe(dict);
  });
});

describe('fuzzyRankSubtypes', () => {
  const dict = [
    makeSubtype({ id: '1', name: 'Lab' }),
    makeSubtype({ id: '2', name: 'Teaching Lab' }),
    makeSubtype({ id: '3', name: 'Collaboration Area' }),
    makeSubtype({ id: '4', name: 'Salon Studio', aliases: ['Salon Suite'] }),
  ];

  it('ranks exact/prefix above word-start above substring', () => {
    expect(fuzzyRankSubtypes(dict, 'lab').map(s => s.name))
      .toEqual(['Lab', 'Teaching Lab', 'Collaboration Area']);
  });

  it('matches against an alias so a synonym finds its canonical type', () => {
    expect(fuzzyRankSubtypes(dict, 'suite').map(s => s.name)).toEqual(['Salon Studio']);
  });

  it('returns a copy unchanged for a blank query', () => {
    const out = fuzzyRankSubtypes(dict, '   ');
    expect(out.map(s => s.name)).toEqual(dict.map(s => s.name));
    expect(out).not.toBe(dict);
  });

  it('excludes non-matches', () => {
    expect(fuzzyRankSubtypes(dict, 'zzz')).toEqual([]);
  });
});

describe('matchSubtypeForName', () => {
  const dict = [
    makeSubtype({ id: 'office', name: 'Office' }),
    makeSubtype({ id: 'dwelling', name: 'Dwelling Unit', aliases: ['Unit', 'Apt'] }),
    makeSubtype({ id: 'guest', name: 'Guestroom' }),
    makeSubtype({ id: 'lab', name: 'Lab', aliases: ['Laboratory'] }),
  ];

  it('finds a type by a word-start match inside the room name ("OFFICE 110" → Office)', () => {
    expect(matchSubtypeForName(dict, 'OFFICE 110')?.id).toBe('office');
  });

  it('matches via an owner ALIAS so "UNIT 101" resolves to Dwelling Unit', () => {
    expect(matchSubtypeForName(dict, 'UNIT 101')?.id).toBe('dwelling');
  });

  it('reaches a housing/hotel type the keyword seed ignores ("GUESTROOM 204" → Guestroom)', () => {
    expect(matchSubtypeForName(dict, 'GUESTROOM 204')?.id).toBe('guest');
  });

  it('rejects a loose substring/subsequence hit by default (no "Lab" from "COLLABORATION")', () => {
    // "lab" only occurs mid-word in "collaboration" — rank 3, above the word-start cap.
    expect(matchSubtypeForName(dict, 'COLLABORATION 5')).toBeNull();
  });

  it('honours a relaxed maxRank when the caller opts in', () => {
    expect(matchSubtypeForName(dict, 'COLLABORATION 5', 3)?.id).toBe('lab');
  });

  it('ignores non-active rows (only selectable types are ever pre-selected)', () => {
    const pendingOnly = [makeSubtype({ id: 'p', name: 'Office', status: 'pending' })];
    expect(matchSubtypeForName(pendingOnly, 'OFFICE 110')).toBeNull();
  });

  it('returns null for a blank / null name', () => {
    expect(matchSubtypeForName(dict, '')).toBeNull();
    expect(matchSubtypeForName(dict, '   ')).toBeNull();
    expect(matchSubtypeForName(dict, null)).toBeNull();
  });

  it('returns null when no dictionary name/alias matches', () => {
    expect(matchSubtypeForName(dict, '417')).toBeNull();
  });
});

describe('recentSubtypeIdsFromUnits', () => {
  const units = [
    { subtype_id: 'a', created_at: '2026-01-03T00:00:00Z' },
    { subtype_id: 'b', created_at: '2026-01-02T00:00:00Z' },
    { subtype_id: 'a', created_at: '2026-01-01T00:00:00Z' }, // older dup of 'a'
    { subtype_id: null, created_at: '2026-01-04T00:00:00Z' }, // ignored (no type)
  ];

  it('de-dupes to most-recent-first, ignoring typeless locations', () => {
    expect(recentSubtypeIdsFromUnits(units)).toEqual(['a', 'b']);
  });

  it('respects the cap', () => {
    expect(recentSubtypeIdsFromUnits(units, 1)).toEqual(['a']);
  });

  it('returns [] when nothing has a type', () => {
    expect(recentSubtypeIdsFromUnits([{ subtype_id: null, created_at: null }])).toEqual([]);
  });
});

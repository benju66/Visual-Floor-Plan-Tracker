import { describe, it, expect } from 'vitest';
import {
  narrowSubtypeRow,
  taxonomyResultToUnitFields,
  orderedSubtypesByRole,
  addAliasToList,
  filterSubtypesForAdmin,
  groupSubtypesByRole,
  type TaxonomyResult,
} from './subtypes';
import type { Subtype } from '@/types/domain';

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

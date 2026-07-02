import { describe, it, expect } from 'vitest';
import {
  narrowActivityDictionaryRow,
  resolveActivityByName,
  searchActivityDictionary,
  activitiesForProjectType,
  activityPickToFields,
  filterActivityDictionaryForAdmin,
  PENDING_ACTIVITY_NAME,
  type ActivityPickResult,
} from './activityDictionary';
import type { ActivityDictionaryEntry } from '@/types/domain';

function makeEntry(over: Partial<ActivityDictionaryEntry> = {}): ActivityDictionaryEntry {
  return {
    id: over.id ?? 'id-1',
    name: over.name ?? 'MEP Rough-In',
    track: over.track ?? 'Production',
    type: over.type ?? 'task',
    status: over.status ?? 'active',
    aliases: over.aliases ?? [],
    default_project_types: over.default_project_types ?? [],
    cost_code_id: over.cost_code_id ?? null,
    proposed_note: over.proposed_note ?? null,
    created_by: over.created_by ?? null,
    created_at: over.created_at ?? null,
    updated_at: over.updated_at ?? null,
  };
}

describe('narrowActivityDictionaryRow', () => {
  it('narrows valid JSONB columns through unchanged', () => {
    const row = {
      id: 'a',
      name: 'MEP Rough-In',
      track: 'Production',
      type: 'task',
      status: 'active',
      aliases: ['Rough-Ins', 'MEP Rough-ins Completed'],
      default_project_types: ['Housing', 'Hotel'],
      cost_code_id: null,
      proposed_note: null,
      created_by: null,
      created_at: null,
      updated_at: null,
    };
    const out = narrowActivityDictionaryRow(row as never);
    expect(out.aliases).toEqual(['Rough-Ins', 'MEP Rough-ins Completed']);
    expect(out.default_project_types).toEqual(['Housing', 'Hotel']);
  });

  it('degrades malformed JSONB to empty arrays instead of throwing', () => {
    const row = {
      id: 'b',
      name: 'Weird',
      track: null,
      type: 'task',
      status: 'active',
      aliases: 'not-an-array',
      default_project_types: ['NotAProjectType', 42],
      cost_code_id: null,
      proposed_note: null,
      created_by: null,
      created_at: null,
      updated_at: null,
    };
    const out = narrowActivityDictionaryRow(row as never);
    expect(out.aliases).toEqual([]);
    expect(out.default_project_types).toEqual([]);
  });
});

describe('resolveActivityByName', () => {
  const dict = [
    makeEntry({ id: 'r', name: 'MEP Rough-In', aliases: ['Rough-Ins', 'MEP Rough-ins Completed'] }),
    makeEntry({ id: 'f', name: 'Framing', track: 'Inspections' }),
    makeEntry({ id: 'p', name: PENDING_ACTIVITY_NAME, status: 'pending' }),
    makeEntry({ id: 'd', name: 'Old Step', status: 'deprecated', aliases: ['Legacy'] }),
  ];

  it('matches the canonical name case-insensitively and trimmed', () => {
    expect(resolveActivityByName(dict, '  framing ')?.id).toBe('f');
  });

  it('resolves an alias to the same canonical entry (the whole point)', () => {
    expect(resolveActivityByName(dict, 'Rough-Ins')?.id).toBe('r');
    expect(resolveActivityByName(dict, 'mep rough-ins completed')?.id).toBe('r');
  });

  it('never resolves to a non-active entry (pending sentinel or deprecated)', () => {
    expect(resolveActivityByName(dict, PENDING_ACTIVITY_NAME)).toBeNull();
    expect(resolveActivityByName(dict, 'Legacy')).toBeNull();
  });

  it('returns null for a blank/unknown name', () => {
    expect(resolveActivityByName(dict, '')).toBeNull();
    expect(resolveActivityByName(dict, '   ')).toBeNull();
    expect(resolveActivityByName(dict, 'Nonexistent')).toBeNull();
  });
});

describe('searchActivityDictionary', () => {
  const dict = [
    makeEntry({ id: 'a', name: 'Framing' }),
    makeEntry({ id: 'b', name: 'Final Cleaning Completed' }),
    makeEntry({ id: 'c', name: 'MEP Rough-In', aliases: ['Rough-Ins'] }),
  ];

  it('returns a copy unchanged for a blank query', () => {
    const out = searchActivityDictionary(dict, '   ');
    expect(out).toEqual(dict);
    expect(out).not.toBe(dict);
  });

  it('ranks exact > prefix > substring', () => {
    const dict2 = [
      makeEntry({ id: 'sub', name: 'Pre-Final Walkthrough' }), // substring "final"
      makeEntry({ id: 'exact', name: 'Final' }),               // exact
      makeEntry({ id: 'prefix', name: 'Final Cleaning' }),     // prefix
    ];
    const out = searchActivityDictionary(dict2, 'Final').map(e => e.id);
    expect(out).toEqual(['exact', 'prefix', 'sub']);
  });

  it('matches across aliases so a synonym surfaces its canonical entry', () => {
    const out = searchActivityDictionary(dict, 'rough-ins').map(e => e.id);
    expect(out).toEqual(['c']);
  });

  it('drops non-matches', () => {
    expect(searchActivityDictionary(dict, 'zzz')).toEqual([]);
  });
});

describe('activitiesForProjectType', () => {
  const dict = [
    makeEntry({ id: 'housing', name: 'Dwelling Fit-Out', default_project_types: ['Housing'] }),
    makeEntry({ id: 'universal', name: 'Framing', default_project_types: [] }),
    makeEntry({ id: 'hotel', name: 'Guestroom Turnover', default_project_types: ['Hotel'] }),
  ];

  it('orders defaults for the project type first, stable within groups', () => {
    const out = activitiesForProjectType('Housing', dict).map(e => e.id);
    expect(out).toEqual(['housing', 'universal', 'hotel']);
  });

  it('never restricts — every entry is still present', () => {
    const out = activitiesForProjectType('Hotel', dict);
    expect(out).toHaveLength(3);
    expect(out.map(e => e.id).sort()).toEqual(['hotel', 'housing', 'universal']);
  });

  it('keeps natural order (a copy) when project type is null', () => {
    const out = activitiesForProjectType(null, dict);
    expect(out.map(e => e.id)).toEqual(['housing', 'universal', 'hotel']);
    expect(out).not.toBe(dict);
  });
});

describe('activityPickToFields', () => {
  const proposeShouldNotRun = async (): Promise<ActivityDictionaryEntry> => {
    throw new Error('propose should not be called for an existing entry');
  };

  it('maps an existing entry pick straight to fields (no propose)', async () => {
    const result: ActivityPickResult = {
      kind: 'entry',
      dictionaryId: 'r',
      name: 'MEP Rough-In',
      track: 'Production',
      type: 'task',
    };
    const out = await activityPickToFields(result, proposeShouldNotRun);
    expect(out).toEqual({ name: 'MEP Rough-In', dictionary_id: 'r', track: 'Production', type: 'task' });
  });

  it('proposes a pending entry and links to its id', async () => {
    const result: ActivityPickResult = { kind: 'pending', name: 'Novel Step', track: 'Production' };
    const propose = async () => makeEntry({ id: 'new-pending', name: 'Novel Step', track: 'Production', status: 'pending' });
    const out = await activityPickToFields(result, propose);
    expect(out).toEqual({ name: 'Novel Step', dictionary_id: 'new-pending', track: 'Production', type: 'task' });
  });

  it('degrades to an unlinked field set (dictionary_id null) when the propose write is denied', async () => {
    const result: ActivityPickResult = { kind: 'pending', name: 'Blocked Step', track: 'Exterior' };
    const propose = async (): Promise<ActivityDictionaryEntry> => {
      throw new Error('RLS: not a privileged member');
    };
    const out = await activityPickToFields(result, propose);
    expect(out).toEqual({ name: 'Blocked Step', dictionary_id: null, track: 'Exterior', type: 'task' });
  });
});

describe('filterActivityDictionaryForAdmin', () => {
  const dict = [
    makeEntry({ id: 'a', name: 'Framing', status: 'active' }),
    makeEntry({ id: 'p', name: PENDING_ACTIVITY_NAME, status: 'pending' }),
    makeEntry({ id: 'r', name: 'MEP Rough-In', status: 'active', aliases: ['Rough-Ins'] }),
  ];

  it('keeps every status when filter is "all"', () => {
    expect(filterActivityDictionaryForAdmin(dict, 'all', '').map(e => e.id)).toEqual(['a', 'p', 'r']);
  });

  it('filters by status', () => {
    expect(filterActivityDictionaryForAdmin(dict, 'pending', '').map(e => e.id)).toEqual(['p']);
  });

  it('matches free text across name and aliases', () => {
    expect(filterActivityDictionaryForAdmin(dict, 'all', 'rough-ins').map(e => e.id)).toEqual(['r']);
    expect(filterActivityDictionaryForAdmin(dict, 'all', 'fram').map(e => e.id)).toEqual(['a']);
  });
});

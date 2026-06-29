import { describe, it, expect } from 'vitest';
import { suggestAliasCandidates } from './aliasSuggestions';
import { buildNamingVocabulary } from './namingVocabulary';
import type { Subtype } from '@/types/domain';

function subtype(id: string, name: string, role: Subtype['top_level_role'], aliases: string[] = []): Subtype {
  return {
    id,
    name,
    top_level_role: role,
    status: 'active',
    aliases,
    default_project_types: [],
    proposed_note: null,
    created_by: null,
    created_at: null,
  };
}

const DICT: Subtype[] = [
  subtype('sub-dwelling', 'Dwelling Unit', 'program'),
  subtype('sub-office', 'Office', 'program'),
];

describe('suggestAliasCandidates', () => {
  it('proposes an alias for a strong pairing the dictionary cannot reach', () => {
    const vocab = buildNamingVocabulary([
      { unit_number: 'UNIT 101', subtype_id: 'sub-dwelling' },
      { unit_number: 'UNIT 102', subtype_id: 'sub-dwelling' },
      { unit_number: 'UNIT 103', subtype_id: 'sub-dwelling' },
    ]);
    const out = suggestAliasCandidates(vocab, DICT);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      token: 'unit',
      alias: 'Unit',
      subtypeId: 'sub-dwelling',
      subtypeName: 'Dwelling Unit',
      support: 3,
      total: 3,
      key: 'sub-dwelling::unit',
    });
  });

  it('does NOT propose a token the dictionary already resolves (D1 reaches it)', () => {
    const vocab = buildNamingVocabulary([
      { unit_number: 'OFFICE 110', subtype_id: 'sub-office' },
      { unit_number: 'OFFICE 111', subtype_id: 'sub-office' },
      { unit_number: 'OFFICE 112', subtype_id: 'sub-office' },
    ]);
    // "office" already matches the canonical name, so no alias is needed.
    expect(suggestAliasCandidates(vocab, DICT)).toEqual([]);
  });

  it('does NOT propose a token that is already an existing alias', () => {
    const dict: Subtype[] = [subtype('sub-dwelling', 'Dwelling Unit', 'program', ['Unit'])];
    const vocab = buildNamingVocabulary([
      { unit_number: 'UNIT 1', subtype_id: 'sub-dwelling' },
      { unit_number: 'UNIT 2', subtype_id: 'sub-dwelling' },
      { unit_number: 'UNIT 3', subtype_id: 'sub-dwelling' },
    ]);
    expect(suggestAliasCandidates(vocab, dict)).toEqual([]);
  });

  it('respects the minimum-support threshold', () => {
    const vocab = buildNamingVocabulary([
      { unit_number: 'UNIT 101', subtype_id: 'sub-dwelling' },
      { unit_number: 'UNIT 102', subtype_id: 'sub-dwelling' },
    ]); // only 2 < default 3
    expect(suggestAliasCandidates(vocab, DICT)).toEqual([]);
    // ...but a lower threshold surfaces it.
    expect(suggestAliasCandidates(vocab, DICT, { minSupport: 2 })).toHaveLength(1);
  });

  it('requires a clear majority — an evenly-split token is not proposed', () => {
    const vocab = buildNamingVocabulary([
      { unit_number: 'SUITE 1', subtype_id: 'sub-dwelling' },
      { unit_number: 'SUITE 2', subtype_id: 'sub-dwelling' },
      { unit_number: 'SUITE 3', subtype_id: 'sub-office' },
      { unit_number: 'SUITE 4', subtype_id: 'sub-office' },
    ]); // 2 vs 2 → share 0.5 < 0.6
    expect(suggestAliasCandidates(vocab, DICT)).toEqual([]);
  });

  it('skips a learned pairing that points at a non-active / removed sub-type', () => {
    const vocab = buildNamingVocabulary([
      { unit_number: 'POD 1', subtype_id: 'sub-gone' },
      { unit_number: 'POD 2', subtype_id: 'sub-gone' },
      { unit_number: 'POD 3', subtype_id: 'sub-gone' },
    ]);
    expect(suggestAliasCandidates(vocab, DICT)).toEqual([]);
  });

  it('keeps an acronym alias uppercase', () => {
    const dict: Subtype[] = [subtype('sub-tele', 'Telecom', 'support')];
    const vocab = buildNamingVocabulary([
      { unit_number: 'MDF 1', subtype_id: 'sub-tele' },
      { unit_number: 'MDF 2', subtype_id: 'sub-tele' },
      { unit_number: 'MDF 3', subtype_id: 'sub-tele' },
    ]);
    const out = suggestAliasCandidates(vocab, dict);
    expect(out).toHaveLength(1);
    expect(out[0].alias).toBe('MDF');
  });

  it('returns an empty list for an empty / absent vocabulary', () => {
    expect(suggestAliasCandidates(buildNamingVocabulary([]), DICT)).toEqual([]);
    expect(suggestAliasCandidates(null, DICT)).toEqual([]);
  });
});

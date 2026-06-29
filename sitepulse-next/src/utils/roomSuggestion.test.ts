import { describe, it, expect } from 'vitest';
import {
  buildRoomSuggestion,
  suggestionToPick,
  suggestedLabelFromSuggestion,
  deriveSuggestionSource,
  type RoomSuggestion,
} from './roomSuggestion';
import type { PercentPoint, Subtype, TextWord } from '@/types/domain';
import type { TaxonomyResult } from '@/utils/subtypes';
import { buildNamingVocabulary } from '@/utils/namingVocabulary';

// A minimal active dictionary covering the seed names the keyword map can resolve.
function subtype(id: string, name: string, role: Subtype['top_level_role']): Subtype {
  return {
    id,
    name,
    top_level_role: role,
    status: 'active',
    aliases: [],
    default_project_types: [],
    proposed_note: null,
    created_by: null,
    created_at: null,
  };
}

const DICT: Subtype[] = [
  subtype('sub-office', 'Office', 'program'),
  subtype('sub-kitchen', 'Kitchen', 'support'),
  subtype('sub-restroom', 'Public Restroom', 'common'),
];

const room: PercentPoint[] = [
  { pctX: 0.2, pctY: 0.2 },
  { pctX: 0.8, pctY: 0.2 },
  { pctX: 0.8, pctY: 0.8 },
  { pctX: 0.2, pctY: 0.8 },
];
const word = (text: string, pctX: number, pctY: number): TextWord => ({ text, pctX, pctY });

describe('buildRoomSuggestion', () => {
  it('combines name match + resolved taxonomy into a full suggestion', () => {
    const s = buildRoomSuggestion(room, [word('OFFICE', 0.5, 0.48), word('110', 0.5, 0.52)], DICT);
    expect(s).toEqual({
      unitNumber: 'Office 110',
      role: 'program',
      subtypeId: 'sub-office',
      subtypeName: 'Office',
    });
  });

  it('suggests a name with NO type when no keyword matches', () => {
    const s = buildRoomSuggestion(room, [word('417', 0.5, 0.5)], DICT);
    expect(s).toEqual({ unitNumber: '417', role: null, subtypeId: null, subtypeName: null });
  });

  it('keeps role + name but leaves subtypeId null when the seed is absent from the dictionary', () => {
    const s = buildRoomSuggestion(room, [word('KITCHEN', 0.5, 0.5)], []); // empty dict
    expect(s).toEqual({ unitNumber: 'Kitchen', role: 'support', subtypeId: null, subtypeName: 'Kitchen' });
  });

  it('returns null when nothing can be suggested (no interior words)', () => {
    expect(buildRoomSuggestion(room, [word('OUTSIDE', 0.95, 0.95)], DICT)).toBeNull();
    expect(buildRoomSuggestion(room, [], DICT)).toBeNull();
    expect(buildRoomSuggestion(room, null, DICT)).toBeNull();
  });

  it('routes the type guess through a live ALIAS — "UNIT 101" → Dwelling Unit (lever D1)', () => {
    const dict: Subtype[] = [{ ...subtype('sub-dwelling', 'Dwelling Unit', 'program'), aliases: ['Unit'] }];
    const s = buildRoomSuggestion(room, [word('UNIT', 0.45, 0.5), word('101', 0.55, 0.5)], dict);
    expect(s).toEqual({
      unitNumber: 'Unit 101',
      role: 'program',
      subtypeId: 'sub-dwelling',
      subtypeName: 'Dwelling Unit',
    });
  });

  it('reaches a housing/hotel type the keyword seed lacks, straight from the dictionary', () => {
    const dict: Subtype[] = [subtype('sub-guest', 'Guestroom', 'program')];
    const s = buildRoomSuggestion(room, [word('GUESTROOM', 0.5, 0.5)], dict);
    expect(s?.subtypeId).toBe('sub-guest');
    expect(s?.role).toBe('program');
  });

  it('prefers the live dictionary over the keyword seed when an owner alias differs', () => {
    // The keyword seed maps OFFICE → "Office"; an owner alias re-pointing "Office" to
    // a different live type must win (the dictionary is the source of truth).
    const dict: Subtype[] = [{ ...subtype('sub-private', 'Private Office', 'program'), aliases: ['Office'] }];
    const s = buildRoomSuggestion(room, [word('OFFICE', 0.5, 0.5)], dict);
    expect(s?.subtypeId).toBe('sub-private');
    expect(s?.subtypeName).toBe('Private Office');
  });

  it('falls back to the keyword seed when the dictionary has no matching name/alias', () => {
    // "CONFERENCE" word-start-matches no single-word dictionary name here, so the seed
    // (CONFERENCE → "Conference Room") resolves against the live row.
    const dict: Subtype[] = [subtype('sub-conf', 'Conference Room', 'program')];
    const s = buildRoomSuggestion(room, [word('CONFERENCE', 0.4, 0.5), word('200', 0.6, 0.5)], dict);
    expect(s?.subtypeId).toBe('sub-conf');
    expect(s?.subtypeName).toBe('Conference Room');
  });
});

describe('buildRoomSuggestion — vocabulary-aware (Phase 2, levers C + D2)', () => {
  // A dictionary with Dwelling Unit present but NO "Unit" alias — so D1 cannot reach
  // it from the name "UNIT 5B" on its own. Learning (D2) must.
  const dict: Subtype[] = [
    subtype('sub-dwelling', 'Dwelling Unit', 'program'),
    subtype('sub-office', 'Office', 'program'),
  ];

  it('D2: proposes the most-paired type when the dictionary alias would not match alone', () => {
    // Confirm a few "UNIT NNN" rooms as Dwelling Unit, then trace another "UNIT".
    const vocab = buildNamingVocabulary([
      { unit_number: 'UNIT 101', subtype_id: 'sub-dwelling' },
      { unit_number: 'UNIT 102', subtype_id: 'sub-dwelling' },
    ]);
    // Sanity: without learning, D1 leaves the type unguessed for this name.
    const noLearn = buildRoomSuggestion(room, [word('UNIT', 0.45, 0.5), word('201', 0.55, 0.5)], dict);
    expect(noLearn?.subtypeId).toBeNull();
    // With learning, D2 fills it in, resolved to the live row.
    const s = buildRoomSuggestion(room, [word('UNIT', 0.45, 0.5), word('201', 0.55, 0.5)], dict, vocab);
    expect(s).toEqual({
      unitNumber: 'Unit 201',
      role: 'program',
      subtypeId: 'sub-dwelling',
      subtypeName: 'Dwelling Unit',
    });
  });

  it('D2: never overrides a resolved D1 dictionary match', () => {
    // History pairs "OFFICE" with Dwelling Unit (noise), but D1 resolves OFFICE → Office.
    const vocab = buildNamingVocabulary([{ unit_number: 'OFFICE 1', subtype_id: 'sub-dwelling' }]);
    const s = buildRoomSuggestion(room, [word('OFFICE', 0.5, 0.5)], dict, vocab);
    expect(s?.subtypeId).toBe('sub-office');
  });

  it('D2: does not pre-select a learned subtype that is no longer a LIVE active row', () => {
    const vocab = buildNamingVocabulary([{ unit_number: 'UNIT 9', subtype_id: 'sub-removed' }]);
    const s = buildRoomSuggestion(room, [word('UNIT', 0.45, 0.5), word('9', 0.55, 0.5)], dict, vocab);
    expect(s?.subtypeId).toBeNull();
    expect(s?.unitNumber).toBe('Unit 9');
  });

  it('lever C: drops a learned-noise token from the suggested name', () => {
    // "NIC" was never confirmed as a name; "OFFICE" has been. The vocabulary scrubs it.
    const vocab = buildNamingVocabulary([
      { unit_number: 'OFFICE 110', subtype_id: 'sub-office' },
      { unit_number: 'OFFICE 112', subtype_id: 'sub-office' },
    ]);
    const s = buildRoomSuggestion(
      room,
      [word('OFFICE', 0.45, 0.5), word('NIC', 0.6, 0.5), word('210', 0.52, 0.55)],
      dict,
      vocab,
    );
    expect(s?.unitNumber).toBe('Office 210');
  });

  it('an empty vocabulary leaves the Phase-1 suggestion unchanged', () => {
    const vocab = buildNamingVocabulary([]);
    const withEmpty = buildRoomSuggestion(room, [word('OFFICE', 0.5, 0.48), word('110', 0.5, 0.52)], DICT, vocab);
    const without = buildRoomSuggestion(room, [word('OFFICE', 0.5, 0.48), word('110', 0.5, 0.52)], DICT);
    expect(withEmpty).toEqual(without);
  });
});

describe('suggestionToPick', () => {
  it('pre-selects a fully-resolved dictionary sub-type', () => {
    const s: RoomSuggestion = { unitNumber: 'OFFICE 110', role: 'program', subtypeId: 'sub-office', subtypeName: 'Office' };
    expect(suggestionToPick(s)).toEqual({ kind: 'subtype', subtypeId: 'sub-office', name: 'Office', role: 'program' });
  });

  it('returns null for a role-only (unresolved) suggestion — never auto-proposes a pending entry', () => {
    const s: RoomSuggestion = { unitNumber: 'KITCHEN', role: 'support', subtypeId: null, subtypeName: 'Kitchen' };
    expect(suggestionToPick(s)).toBeNull();
  });

  it('returns null for a name-only suggestion', () => {
    const s: RoomSuggestion = { unitNumber: '417', role: null, subtypeId: null, subtypeName: null };
    expect(suggestionToPick(s)).toBeNull();
  });
});

describe('suggestedLabelFromSuggestion — the frozen original proposal', () => {
  it('freezes name + type and defaults the never-suggested flags', () => {
    const s: RoomSuggestion = { unitNumber: 'OFFICE 110', role: 'program', subtypeId: 'sub-office', subtypeName: 'Office' };
    expect(suggestedLabelFromSuggestion(s)).toEqual({
      unit_number: 'OFFICE 110',
      unit_type: 'Office',
      top_level_role: 'program',
      subtype_id: 'sub-office',
      spans_levels: false,
      level_note: null,
      has_void: false,
    });
  });

  it('carries nulls through for a name-only suggestion', () => {
    const s: RoomSuggestion = { unitNumber: '417', role: null, subtypeId: null, subtypeName: null };
    const label = suggestedLabelFromSuggestion(s);
    expect(label.unit_number).toBe('417');
    expect(label.unit_type).toBeNull();
    expect(label.top_level_role).toBeNull();
    expect(label.subtype_id).toBeNull();
  });
});

describe('deriveSuggestionSource — accept vs edit', () => {
  const original: RoomSuggestion = { unitNumber: 'OFFICE 110', role: 'program', subtypeId: 'sub-office', subtypeName: 'Office' };
  const keptPick: TaxonomyResult = { kind: 'subtype', subtypeId: 'sub-office', name: 'Office', role: 'program' };

  it('is ai_accepted when name AND type are kept exactly', () => {
    expect(deriveSuggestionSource(original, 'OFFICE 110', keptPick)).toBe('ai_accepted');
  });

  it('treats a whitespace-only name difference as accepted (normalized compare)', () => {
    expect(deriveSuggestionSource(original, '  OFFICE   110 ', keptPick)).toBe('ai_accepted');
  });

  it('is ai_edited when the name changed', () => {
    expect(deriveSuggestionSource(original, 'OFFICE 112', keptPick)).toBe('ai_edited');
  });

  it('is ai_edited when the type changed', () => {
    const otherPick: TaxonomyResult = { kind: 'subtype', subtypeId: 'sub-kitchen', name: 'Kitchen', role: 'support' };
    expect(deriveSuggestionSource(original, 'OFFICE 110', otherPick)).toBe('ai_edited');
  });

  it('is ai_edited when the user supplies a type the suggestion lacked', () => {
    const nameOnly: RoomSuggestion = { unitNumber: '417', role: null, subtypeId: null, subtypeName: null };
    const pick: TaxonomyResult = { kind: 'subtype', subtypeId: 'sub-restroom', name: 'Public Restroom', role: 'common' };
    expect(deriveSuggestionSource(nameOnly, '417', pick)).toBe('ai_edited');
  });

  it('is ai_accepted when a role-only suggestion is kept as a matching pending pick', () => {
    const roleOnly: RoomSuggestion = { unitNumber: 'KITCHEN', role: 'support', subtypeId: null, subtypeName: 'Kitchen' };
    const pendingPick: TaxonomyResult = { kind: 'pending', role: 'support', name: 'Kitchen' };
    expect(deriveSuggestionSource(roleOnly, 'KITCHEN', pendingPick)).toBe('ai_accepted');
  });

  // The live project map's type is optional (Phase 4), so a saved room may carry no
  // pick at all — deriveSuggestionSource must tolerate a null finalPick.
  it('is ai_accepted when a name-only suggestion is saved with no type (null pick)', () => {
    const nameOnly: RoomSuggestion = { unitNumber: '417', role: null, subtypeId: null, subtypeName: null };
    expect(deriveSuggestionSource(nameOnly, '417', null)).toBe('ai_accepted');
  });

  it('is ai_edited when a typed suggestion is saved with the type dropped (null pick)', () => {
    expect(deriveSuggestionSource(original, 'OFFICE 110', null)).toBe('ai_edited');
  });

  it('is ai_edited when a name-only suggestion is saved under a different name (null pick)', () => {
    const nameOnly: RoomSuggestion = { unitNumber: '417', role: null, subtypeId: null, subtypeName: null };
    expect(deriveSuggestionSource(nameOnly, '418', null)).toBe('ai_edited');
  });
});

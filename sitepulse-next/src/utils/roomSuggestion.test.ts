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
      unitNumber: 'OFFICE 110',
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
    expect(s).toEqual({ unitNumber: 'KITCHEN', role: 'support', subtypeId: null, subtypeName: 'Kitchen' });
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
      unitNumber: 'UNIT 101',
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
});

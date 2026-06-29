import { describe, it, expect } from 'vitest';
import {
  buildNamingVocabulary,
  subtypeIdFromVocabulary,
  normalizeNameToken,
  isNameToken,
  nameTokensOf,
  EMPTY_VOCABULARY,
  type ConfirmedRoom,
} from './namingVocabulary';

const room = (unit_number: string | null, subtype_id: string | null = null): ConfirmedRoom => ({
  unit_number,
  subtype_id,
});

describe('normalizeNameToken', () => {
  it('lower-cases and strips surrounding punctuation, keeping internal marks', () => {
    expect(normalizeNameToken('OFFICE')).toBe('office');
    expect(normalizeNameToken('(OFFICE)')).toBe('office');
    expect(normalizeNameToken('OFFICE,')).toBe('office');
    expect(normalizeNameToken("WOMEN'S")).toBe("women's");
    expect(normalizeNameToken('5B')).toBe('5b');
    expect(normalizeNameToken('---')).toBe('');
  });
});

describe('isNameToken — name words only (letters, no digits)', () => {
  it('accepts pure alphabetic words', () => {
    expect(isNameToken('office')).toBe(true);
    expect(isNameToken("women's")).toBe(true);
  });
  it('rejects numbers and alphanumeric designators (the "Number" half)', () => {
    expect(isNameToken('110')).toBe(false);
    expect(isNameToken('5b')).toBe(false);
    expect(isNameToken('')).toBe(false);
  });
});

describe('nameTokensOf', () => {
  it('keeps name words and drops the room number', () => {
    expect(nameTokensOf('OFFICE 110')).toEqual(['office']);
    expect(nameTokensOf('417 WOMEN')).toEqual(['women']);
    expect(nameTokensOf('UNIT 5B')).toEqual(['unit']);
  });
  it('returns [] for blank / number-only / nullish names', () => {
    expect(nameTokensOf('417')).toEqual([]);
    expect(nameTokensOf('   ')).toEqual([]);
    expect(nameTokensOf(null)).toEqual([]);
    expect(nameTokensOf(undefined)).toEqual([]);
  });
});

describe('buildNamingVocabulary', () => {
  it('counts name tokens across confirmed rooms (number tokens excluded)', () => {
    const v = buildNamingVocabulary([room('OFFICE 110'), room('OFFICE 112'), room('417 WOMEN')]);
    expect(v.nameTokenCounts).toEqual({ office: 2, women: 1 });
  });

  it('learns name → subtype pairings only for rooms with a subtype_id', () => {
    const v = buildNamingVocabulary([
      room('UNIT 101', 'sub-dwelling'),
      room('UNIT 102', 'sub-dwelling'),
      room('UNIT 103', null), // no type → counts the token, but no pairing
    ]);
    expect(v.nameTokenCounts).toEqual({ unit: 3 });
    expect(v.nameToSubtype).toEqual({ unit: { 'sub-dwelling': 2 } });
  });

  it('accumulates competing subtypes per token', () => {
    const v = buildNamingVocabulary([
      room('OFFICE 1', 'sub-office'),
      room('OFFICE 2', 'sub-office'),
      room('OFFICE 3', 'sub-private'),
    ]);
    expect(v.nameToSubtype.office).toEqual({ 'sub-office': 2, 'sub-private': 1 });
  });

  it('tolerates empty / garbage input → an empty but valid model (never throws)', () => {
    expect(buildNamingVocabulary([])).toEqual({ nameTokenCounts: {}, nameToSubtype: {} });
    expect(buildNamingVocabulary(null)).toEqual({ nameTokenCounts: {}, nameToSubtype: {} });
    expect(buildNamingVocabulary(undefined)).toEqual({ nameTokenCounts: {}, nameToSubtype: {} });
    // Models an untyped boundary (e.g. malformed cached rows) — the guards must hold.
    const garbage = [
      null,
      undefined,
      {},
      { unit_number: 42 },
      room('   '),
      room('110'),
    ] as unknown as ConfirmedRoom[];
    expect(buildNamingVocabulary(garbage)).toEqual({ nameTokenCounts: {}, nameToSubtype: {} });
  });

  it('NEVER emits a Map/Set — the model round-trips through JSON unchanged (AGENTS.md §6)', () => {
    const v = buildNamingVocabulary([room('UNIT 101', 'sub-dwelling'), room('OFFICE 110', 'sub-office')]);
    const roundTripped = JSON.parse(JSON.stringify(v));
    expect(roundTripped).toEqual(v);
    expect(v.nameTokenCounts instanceof Map).toBe(false);
    expect(v.nameToSubtype instanceof Map).toBe(false);
    expect(Object.getPrototypeOf(v.nameTokenCounts)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(v.nameToSubtype.unit)).toBe(Object.prototype);
  });
});

describe('subtypeIdFromVocabulary — lever D2 lookup', () => {
  const v = buildNamingVocabulary([
    room('UNIT 101', 'sub-dwelling'),
    room('UNIT 102', 'sub-dwelling'),
    room('UNIT 103', 'sub-dwelling'),
    room('OFFICE 1', 'sub-office'),
  ]);

  it('proposes the most-paired subtype for the candidate name', () => {
    expect(subtypeIdFromVocabulary(v, 'UNIT 5B')).toBe('sub-dwelling');
    expect(subtypeIdFromVocabulary(v, 'OFFICE 200')).toBe('sub-office');
  });

  it('returns null when no name token has any learned pairing', () => {
    expect(subtypeIdFromVocabulary(v, 'LOBBY')).toBeNull();
    expect(subtypeIdFromVocabulary(v, '417')).toBeNull();
    expect(subtypeIdFromVocabulary(v, null)).toBeNull();
  });

  it('returns null for an empty / missing vocabulary', () => {
    expect(subtypeIdFromVocabulary(EMPTY_VOCABULARY, 'UNIT 101')).toBeNull();
    expect(subtypeIdFromVocabulary(null, 'UNIT 101')).toBeNull();
    expect(subtypeIdFromVocabulary(undefined, 'UNIT 101')).toBeNull();
  });

  it('breaks ties deterministically by lexically-smallest subtype_id', () => {
    const tied = buildNamingVocabulary([room('SUITE 1', 'sub-zebra'), room('SUITE 2', 'sub-alpha')]);
    expect(subtypeIdFromVocabulary(tied, 'SUITE 9')).toBe('sub-alpha');
  });
});

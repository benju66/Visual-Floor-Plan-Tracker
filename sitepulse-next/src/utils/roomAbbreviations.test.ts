import { describe, it, expect } from 'vitest';
import { expandRoomName, ROOM_ABBREVIATIONS, ACRONYM_KEEP } from './roomAbbreviations';

describe('expandRoomName', () => {
  it('expands a standard abbreviation and keeps the room number', () => {
    expect(expandRoomName('STOR 101')).toBe('Storage 101');
    expect(expandRoomName('CONF 200')).toBe('Conference 200');
    expect(expandRoomName('MECH')).toBe('Mechanical');
  });

  it('matches abbreviations regardless of case or trailing punctuation', () => {
    expect(expandRoomName('stor')).toBe('Storage');
    expect(expandRoomName('ELEC.')).toBe('Electrical');
  });

  it('keeps true acronyms uppercase rather than Title-Casing them', () => {
    expect(expandRoomName('MDF')).toBe('MDF');
    expect(expandRoomName('IDF 2')).toBe('IDF 2');
    expect(expandRoomName('AV CLOSET')).toBe('AV Closet');
  });

  it('Title-Cases ordinary words it does not recognize', () => {
    expect(expandRoomName('OFFICE 110')).toBe('Office 110');
    expect(expandRoomName('CONFERENCE ROOM 200')).toBe('Conference Room 200');
  });

  it('only expands whole words, never a substring of a real word', () => {
    // "STORAGE" already spelled out must not be mangled; "CORRIDOR" must not hit "corr".
    expect(expandRoomName('STORAGE')).toBe('Storage');
    expect(expandRoomName('CORRIDOR')).toBe('Corridor');
  });

  it('leaves a designator token verbatim even if it looks abbreviation-like', () => {
    expect(expandRoomName('GAR-2')).toBe('GAR-2'); // has a digit → untouched
  });

  it('the abbreviation map and acronym set never overlap (expand XOR keep)', () => {
    for (const key of ACRONYM_KEEP) {
      expect(ROOM_ABBREVIATIONS[key]).toBeUndefined();
    }
  });
});

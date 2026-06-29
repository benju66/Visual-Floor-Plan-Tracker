import { describe, it, expect } from 'vitest';
import { matchRoomName } from './roomNameMatch';
import type { PercentPoint, TextWord } from '@/types/domain';

// A square room covering the middle of the sheet (0.2..0.8 in both axes).
const room: PercentPoint[] = [
  { pctX: 0.2, pctY: 0.2 },
  { pctX: 0.8, pctY: 0.2 },
  { pctX: 0.8, pctY: 0.8 },
  { pctX: 0.2, pctY: 0.8 },
];

const word = (text: string, pctX: number, pctY: number): TextWord => ({ text, pctX, pctY });

describe('matchRoomName', () => {
  it('matches a single interior word (inside)', () => {
    const result = matchRoomName(room, [word('STORAGE', 0.5, 0.5)]);
    expect(result?.unitNumber).toBe('STORAGE');
  });

  it('ignores words outside the polygon (outside)', () => {
    const result = matchRoomName(room, [
      word('OFFICE', 0.5, 0.5),
      word('CORRIDOR', 0.95, 0.95), // outside the room
    ]);
    expect(result?.unitNumber).toBe('OFFICE');
  });

  it('returns null when no word falls inside (boundary / blank room)', () => {
    expect(matchRoomName(room, [word('ELSEWHERE', 0.05, 0.05)])).toBeNull();
    expect(matchRoomName(room, [])).toBeNull();
    expect(matchRoomName(room, null)).toBeNull();
  });

  it('excludes a door tag so it is not mistaken for the space number (door-tag case)', () => {
    // Commercial space: name + number near the center, a door tag near a wall.
    const result = matchRoomName(room, [
      word('OFFICE', 0.5, 0.48),
      word('110', 0.5, 0.52),
      word('105A', 0.25, 0.25), // door tag — inside the polygon but must be dropped
    ]);
    expect(result?.unitNumber).toBe('OFFICE 110');
    expect(result?.words.some((w) => w.text === '105A')).toBe(false);
  });

  it('joins a space number + name in reading order (commercial wrinkle "417 WOMEN")', () => {
    // Two words on the same line: number left, name right → "417 WOMEN".
    const result = matchRoomName(room, [
      word('WOMEN', 0.55, 0.5),
      word('417', 0.45, 0.5),
    ]);
    expect(result?.unitNumber).toBe('417 WOMEN');
  });

  it('orders stacked label lines top-to-bottom', () => {
    const result = matchRoomName(room, [
      word('110', 0.5, 0.55),
      word('OFFICE', 0.5, 0.45),
    ]);
    expect(result?.unitNumber).toBe('OFFICE 110');
  });

  it('falls back to a door-tag-shaped word when it is the only interior text', () => {
    // A small room whose only label happens to match the door-tag pattern — better a
    // confirmable draft than no suggestion.
    const result = matchRoomName(room, [word('214B', 0.5, 0.5)]);
    expect(result?.unitNumber).toBe('214B');
  });

  it('drops a square-footage note (the value AND its unit) — "250 SF"', () => {
    // Name + number on one line; the SF callout on the line just below.
    const result = matchRoomName(room, [
      word('OFFICE', 0.4, 0.5),
      word('110', 0.6, 0.5),
      word('250', 0.4, 0.53),
      word('SF', 0.5, 0.53),
    ]);
    expect(result?.unitNumber).toBe('OFFICE 110');
    expect(result?.words.some((w) => w.text === '250' || w.text === 'SF')).toBe(false);
  });

  it('drops a dimension token (feet/inch marks) — "10\'-0\\""', () => {
    const result = matchRoomName(room, [
      word('CONFERENCE', 0.4, 0.45),
      word('201', 0.6, 0.45),
      word("10'-0\"", 0.5, 0.65),
    ]);
    expect(result?.unitNumber).toBe('CONFERENCE 201');
  });

  it('drops an equipment/MEP tag — "EF-1"', () => {
    // Both words are the only two lines, so line-limiting alone would keep EF-1;
    // it survives only the noise filter dropping it.
    const result = matchRoomName(room, [
      word('MECH', 0.5, 0.5),
      word('EF-1', 0.3, 0.3),
    ]);
    expect(result?.unitNumber).toBe('MECH');
  });

  it('keeps only the 1–2 lines nearest the centroid (drops far-away interior text)', () => {
    // A plain alphabetic stray near the top edge — no noise filter would catch it, so
    // only centroid line-limiting can drop it.
    const result = matchRoomName(room, [
      word('EXISTING', 0.5, 0.22),
      word('OFFICE', 0.5, 0.5),
      word('110', 0.5, 0.55),
    ]);
    expect(result?.unitNumber).toBe('OFFICE 110');
    expect(result?.words.some((w) => w.text === 'EXISTING')).toBe(false);
  });

  it('falls back to a confirmable draft when ALL interior text is noise', () => {
    // An SF-only room: nothing survives the noise filter, so we keep the raw interior
    // rather than suggest nothing.
    const result = matchRoomName(room, [word('250', 0.45, 0.5), word('SF', 0.55, 0.5)]);
    expect(result?.unitNumber).toBe('250 SF');
  });
});

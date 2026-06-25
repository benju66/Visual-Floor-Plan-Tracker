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
});

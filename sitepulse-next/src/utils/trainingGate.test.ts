import { describe, it, expect } from 'vitest';
import { isProjectTrainingEnabled, excludeUntrainableRooms } from '@/utils/trainingGate';

describe('isProjectTrainingEnabled (default-ON, explicit-false opts out)', () => {
  it('returns true for an enabled project', () => {
    expect(isProjectTrainingEnabled({ ai_training_enabled: true })).toBe(true);
  });

  it('returns false ONLY for an explicit false', () => {
    expect(isProjectTrainingEnabled({ ai_training_enabled: false })).toBe(false);
  });

  it('defaults to true when the flag is missing (legacy row read pre-column)', () => {
    expect(isProjectTrainingEnabled({})).toBe(true);
  });

  it('defaults to true for a null flag value', () => {
    expect(isProjectTrainingEnabled({ ai_training_enabled: null })).toBe(true);
  });

  it('defaults to true for a null / undefined project (transient read gap)', () => {
    expect(isProjectTrainingEnabled(null)).toBe(true);
    expect(isProjectTrainingEnabled(undefined)).toBe(true);
  });
});

describe('excludeUntrainableRooms', () => {
  const rooms = [
    { unit_number: 'A', subtype_id: 's1', sheet_id: 'sheet-keep' },
    { unit_number: 'B', subtype_id: 's2', sheet_id: 'sheet-drop' },
    { unit_number: 'C', subtype_id: null, sheet_id: 'sheet-keep' },
    { unit_number: 'D', subtype_id: 's3', sheet_id: null },
  ];

  it('returns all rooms (a copy) when the exclusion set is empty', () => {
    const out = excludeUntrainableRooms(rooms, new Set());
    expect(out).toHaveLength(4);
    expect(out).not.toBe(rooms); // never returns the same reference
  });

  it('drops only rooms whose sheet_id is excluded', () => {
    const out = excludeUntrainableRooms(rooms, new Set(['sheet-drop']));
    expect(out.map((r) => r.unit_number)).toEqual(['A', 'C', 'D']);
  });

  it('keeps rooms with a null sheet_id (cannot be attributed to a project)', () => {
    const out = excludeUntrainableRooms(rooms, new Set(['sheet-drop', 'sheet-keep']));
    expect(out.map((r) => r.unit_number)).toEqual(['D']);
  });

  it('does not mutate the input array', () => {
    const copy = rooms.slice();
    excludeUntrainableRooms(rooms, new Set(['sheet-drop']));
    expect(rooms).toEqual(copy);
  });
});

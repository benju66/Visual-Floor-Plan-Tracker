import { describe, it, expect } from 'vitest';
import {
  stripStatusWriteFields,
  withFallbackClientTimestamp,
  stampCompletionDate,
  resolvePlannedDate,
  resolvePlannedWindow,
} from './statusWrite';

const NOW = '2026-07-22T12:00:00.000Z';
const TODAY = '2026-07-22';

describe('stripStatusWriteFields', () => {
  it('removes exactly id, created_at, activityName, and milestone — nothing else', () => {
    const input = {
      id: 'row-1',
      created_at: '2026-07-01T00:00:00Z',
      activityName: 'Framing',
      milestone: 'Framing', // legacy pre-rename key from an old offline capture
      unit_id: 'u1',
      activity_id: 'a1',
      temporal_state: 'completed',
      track: 'Production',
      status_color: '#123456',
      logged_date: '2026-07-20',
      planned_start_date: null,
      client_timestamp: '2026-07-20T08:00:00Z',
    };
    expect(stripStatusWriteFields(input)).toEqual({
      unit_id: 'u1',
      activity_id: 'a1',
      temporal_state: 'completed',
      track: 'Production',
      status_color: '#123456',
      logged_date: '2026-07-20',
      planned_start_date: null,
      client_timestamp: '2026-07-20T08:00:00Z',
    });
  });

  it('is a no-op copy when none of the stripped keys are present', () => {
    const input = { unit_id: 'u1', activity_id: 'a1', temporal_state: 'none' };
    expect(stripStatusWriteFields(input)).toEqual(input);
  });

  it('never mutates its input', () => {
    const input = { id: 'x', activityName: 'A', unit_id: 'u1' };
    stripStatusWriteFields(input);
    expect(input).toEqual({ id: 'x', activityName: 'A', unit_id: 'u1' });
  });
});

describe('withFallbackClientTimestamp', () => {
  it('stamps when client_timestamp is absent', () => {
    expect(withFallbackClientTimestamp({ unit_id: 'u1' }, NOW)).toEqual({
      unit_id: 'u1',
      client_timestamp: NOW,
    });
  });

  it('stamps when client_timestamp is null or empty (falsy check, matching the inline `!` it replaced)', () => {
    expect(withFallbackClientTimestamp({ client_timestamp: null }, NOW).client_timestamp).toBe(NOW);
    expect(withFallbackClientTimestamp({ client_timestamp: '' }, NOW).client_timestamp).toBe(NOW);
  });

  it('honors an existing capture-time value untouched (AGENTS §2 capture-time rule)', () => {
    const captured = { unit_id: 'u1', client_timestamp: '2026-07-20T08:00:00Z' };
    const out = withFallbackClientTimestamp(captured, NOW);
    expect(out.client_timestamp).toBe('2026-07-20T08:00:00Z');
    expect(out).toBe(captured); // returned as-is, no copy needed
  });

  it('never mutates its input when stamping', () => {
    const input: Record<string, unknown> = { unit_id: 'u1' };
    withFallbackClientTimestamp(input, NOW);
    expect(input).toEqual({ unit_id: 'u1' });
  });
});

describe('stampCompletionDate', () => {
  it('stamps today ONLY for a completion missing its date (logged_date === null)', () => {
    const row = { unit_id: 'u1', temporal_state: 'completed', logged_date: null };
    expect(stampCompletionDate(row, TODAY)).toEqual({
      unit_id: 'u1',
      temporal_state: 'completed',
      logged_date: TODAY,
    });
  });

  it('never fabricates a completion date for other states — null stays null', () => {
    for (const state of ['none', 'planned', 'ongoing']) {
      const row = { temporal_state: state, logged_date: null };
      expect(stampCompletionDate(row, TODAY).logged_date).toBeNull();
    }
  });

  it('keeps a caller-supplied completion date (never overwrites progress)', () => {
    const row = { temporal_state: 'completed', logged_date: '2026-07-01' };
    expect(stampCompletionDate(row, TODAY).logged_date).toBe('2026-07-01');
  });

  it('strict-null check: undefined or empty logged_date does NOT trigger the stamp', () => {
    const noDate: { temporal_state: string; logged_date?: unknown } = { temporal_state: 'completed' };
    expect(stampCompletionDate(noDate, TODAY).logged_date).toBeUndefined();
    expect(stampCompletionDate({ temporal_state: 'completed', logged_date: '' }, TODAY).logged_date).toBe('');
  });

  it('never mutates its input', () => {
    const row = { temporal_state: 'completed', logged_date: null };
    stampCompletionDate(row, TODAY);
    expect(row.logged_date).toBeNull();
  });
});

describe('resolvePlannedDate (post-W3: status taps must not clobber planned dates)', () => {
  const SHEET = '2026-01-01';
  const STORED = '2026-05-05';

  describe('the edit CARRIES the field — behaves exactly like the old `carried || sheetWindow || null` chain', () => {
    it('a carried date wins over the sheet window and the stored date', () => {
      expect(resolvePlannedDate('2026-06-10', SHEET, STORED)).toBe('2026-06-10');
    });

    it('a carried empty (null or "") falls through to the sheet window — NOT the stored date', () => {
      expect(resolvePlannedDate(null, SHEET, STORED)).toBe(SHEET);
      expect(resolvePlannedDate('', SHEET, STORED)).toBe(SHEET);
    });

    it('a carried empty with no sheet window resolves to null — a date edit/clear is never preserved-away', () => {
      expect(resolvePlannedDate(null, null, STORED)).toBeNull();
      expect(resolvePlannedDate('', undefined, STORED)).toBeNull();
    });
  });

  describe('the edit does NOT carry the field (a status tap) — sheet window, else PRESERVE the stored date', () => {
    it('uses the sheet window when the level has one', () => {
      expect(resolvePlannedDate(undefined, SHEET, STORED)).toBe(SHEET);
    });

    it('PRESERVES the stored date when the level has no schedule window (the bug fix)', () => {
      expect(resolvePlannedDate(undefined, null, STORED)).toBe(STORED);
      expect(resolvePlannedDate(undefined, undefined, STORED)).toBe(STORED);
    });

    it('resolves to null only when there is genuinely nothing to preserve', () => {
      expect(resolvePlannedDate(undefined, null, null)).toBeNull();
      expect(resolvePlannedDate(undefined, undefined, undefined)).toBeNull();
    });
  });
});

describe('resolvePlannedWindow', () => {
  it("a status tap on a no-schedule level preserves BOTH stored planned dates (the owner's reported bug)", () => {
    const out = resolvePlannedWindow(
      {}, // no dates carried (a swipe / PLN·ONG·✓ / quick modal)
      null, // level has no activity_schedules window
      { planned_start_date: '2026-05-05', planned_end_date: '2026-05-20' },
    );
    expect(out).toEqual({ planned_start_date: '2026-05-05', planned_end_date: '2026-05-20' });
  });

  it('a carried date-cell edit sets the carried values and leaves the sibling untouched', () => {
    const out = resolvePlannedWindow(
      { startDate: '2026-06-01', endDate: '2026-06-30' },
      { start_date: '2026-01-01', end_date: '2026-01-31' },
      { planned_start_date: '2026-05-05', planned_end_date: '2026-05-20' },
    );
    expect(out).toEqual({ planned_start_date: '2026-06-01', planned_end_date: '2026-06-30' });
  });

  it('start and end resolve independently', () => {
    // start carried, end not carried → end preserves its stored value
    const out = resolvePlannedWindow(
      { startDate: '2026-06-01' },
      null,
      { planned_start_date: '2026-05-05', planned_end_date: '2026-05-20' },
    );
    expect(out).toEqual({ planned_start_date: '2026-06-01', planned_end_date: '2026-05-20' });
  });

  it('tolerates a null/undefined sheet window and a null stored row', () => {
    expect(resolvePlannedWindow({}, null, null)).toEqual({ planned_start_date: null, planned_end_date: null });
    expect(resolvePlannedWindow({}, undefined, undefined)).toEqual({ planned_start_date: null, planned_end_date: null });
  });
});

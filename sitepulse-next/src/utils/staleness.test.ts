import { describe, it, expect } from 'vitest';
import { lastActivityIso, formatAge } from './staleness';
import type { StatusLog } from '@/types/domain';

// Only the two timestamp fields matter here; cast a partial to the row shape.
const row = (client_timestamp: string | null, created_at: string | null = null) =>
  ({ client_timestamp, created_at } as Pick<StatusLog, 'client_timestamp' | 'created_at'>);

describe('lastActivityIso', () => {
  it('returns null for no rows', () => {
    expect(lastActivityIso([])).toBeNull();
  });

  it('returns null when no row carries a usable timestamp', () => {
    expect(lastActivityIso([row(null, null), row(null, null)])).toBeNull();
  });

  it('picks the max client_timestamp across a unit rows', () => {
    const iso = lastActivityIso([
      row('2026-07-01T10:00:00Z'),
      row('2026-07-05T08:30:00Z'), // newest
      row('2026-07-03T22:00:00Z'),
    ]);
    expect(iso).toBe('2026-07-05T08:30:00Z');
  });

  it('falls back to created_at when client_timestamp is missing', () => {
    const iso = lastActivityIso([
      row(null, '2026-07-02T12:00:00Z'),
      row('2026-07-01T12:00:00Z'),
    ]);
    expect(iso).toBe('2026-07-02T12:00:00Z');
  });

  it('ignores unparseable timestamps', () => {
    const iso = lastActivityIso([row('not-a-date'), row('2026-07-04T00:00:00Z')]);
    expect(iso).toBe('2026-07-04T00:00:00Z');
  });
});

describe('formatAge', () => {
  const today = '2026-07-20T12:00:00Z';

  it('returns — for null', () => {
    expect(formatAge(null, today)).toBe('—');
  });

  it('returns — for unparseable input', () => {
    expect(formatAge('nope', today)).toBe('—');
    expect(formatAge(today, 'nope')).toBe('—');
  });

  it('returns today for same-day and future stamps', () => {
    expect(formatAge('2026-07-20T09:00:00Z', today)).toBe('today');
    expect(formatAge('2026-07-25T09:00:00Z', today)).toBe('today'); // future clamps
  });

  it('reports whole days below a week', () => {
    expect(formatAge('2026-07-19T12:00:00Z', today)).toBe('1d');
    expect(formatAge('2026-07-17T12:00:00Z', today)).toBe('3d');
    expect(formatAge('2026-07-14T12:00:00Z', today)).toBe('6d');
  });

  it('crosses to weeks at exactly 7 days', () => {
    expect(formatAge('2026-07-13T12:00:00Z', today)).toBe('1w'); // 7d
    expect(formatAge('2026-07-06T12:00:00Z', today)).toBe('2w'); // 14d
    expect(formatAge('2026-06-30T12:00:00Z', today)).toBe('2w'); // 20d
    expect(formatAge('2026-06-29T12:00:00Z', today)).toBe('3w'); // 21d
  });
});

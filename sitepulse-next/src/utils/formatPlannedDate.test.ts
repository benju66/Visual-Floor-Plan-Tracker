import { describe, it, expect } from 'vitest';
import { formatPlannedDate } from './formatPlannedDate';

describe('formatPlannedDate', () => {
  it('renders an em dash for unset values', () => {
    expect(formatPlannedDate(null)).toBe('—');
    expect(formatPlannedDate(undefined)).toBe('—');
    expect(formatPlannedDate('')).toBe('—');
  });

  it('renders a short local form for a YYYY-MM-DD date', () => {
    expect(formatPlannedDate('2026-07-07')).toBe('Jul 7, 2026');
    expect(formatPlannedDate('2025-12-31')).toBe('Dec 31, 2025');
    expect(formatPlannedDate('2026-01-01')).toBe('Jan 1, 2026');
  });

  it('does not shift a day across timezones (no UTC-midnight parse)', () => {
    // A naive `new Date('2026-07-07')` is UTC midnight → "Jul 6" west of GMT.
    expect(formatPlannedDate('2026-07-07')).toContain('7,');
  });

  it('tolerates a timestamp suffix (takes the date part)', () => {
    expect(formatPlannedDate('2026-07-07T00:00:00Z')).toBe('Jul 7, 2026');
  });

  it('degrades malformed or out-of-range input to an em dash', () => {
    expect(formatPlannedDate('not a date')).toBe('—');
    expect(formatPlannedDate('07/07/2026')).toBe('—');
    expect(formatPlannedDate('2026-13-01')).toBe('—');
    expect(formatPlannedDate('2026-02-30')).toBe('—');
  });
});

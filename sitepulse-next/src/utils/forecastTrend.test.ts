import { describe, it, expect } from 'vitest';
import { forecastTrend, forecastSlipDays, type SlotCompletion } from './forecastTrend';
import { parseDay, mondayOf } from './progressAnalytics';

const DAY_MS = 86_400_000;
const TODAY = parseDay('2026-06-29') as Date;

/** Monday ISO of the week `weeksAgo` before today's week — mirrors the util's vantage math. */
function weekMonday(weeksAgo: number): string {
  const cm = mondayOf(TODAY);
  return new Date(Date.parse(`${cm}T12:00:00Z`) - weeksAgo * 7 * DAY_MS).toISOString().slice(0, 10);
}

/** `count` distinct-slot completions dated on the Monday `weeksAgo` weeks back. */
function completionsInWeek(weeksAgo: number, count: number, tag: string): SlotCompletion[] {
  const date = weekMonday(weeksAgo);
  return Array.from({ length: count }, (_, i) => ({ slotKey: `${tag}-${weeksAgo}-${i}`, date }));
}

describe('forecastTrend', () => {
  it('returns one point per vantage week, newest asOf === today', () => {
    const points = forecastTrend({ totalSlots: 50, completions: [], today: TODAY, vantageWeeks: 8 });
    expect(points).toHaveLength(8);
    expect(points[points.length - 1].asOf).toBe('2026-06-29');
  });

  it('suppresses every vantage as no-pace when there are no completions', () => {
    const points = forecastTrend({ totalSlots: 50, completions: [], today: TODAY });
    expect(points.every(p => p.forecastDate === null && p.suppressed === 'no-pace')).toBe(true);
    expect(forecastSlipDays(points)).toBeNull();
  });

  it('suppresses as small-sample below the slot threshold', () => {
    const points = forecastTrend({ totalSlots: 5, completions: [], today: TODAY });
    expect(points.every(p => p.suppressed === 'small-sample')).toBe(true);
  });

  it('reports complete once the backlog is exhausted as-of every vantage', () => {
    // 12 slots, all completed long before the oldest vantage → remaining 0 everywhere.
    const completions: SlotCompletion[] = Array.from({ length: 12 }, (_, i) => ({ slotKey: `s${i}`, date: '2026-01-05' }));
    const points = forecastTrend({ totalSlots: 12, completions, today: TODAY });
    expect(points.every(p => p.suppressed === 'complete' && p.forecastDate === null)).toBe(true);
  });

  it('counts a re-completed slot ONCE (append-only dedupe by earliest date)', () => {
    // 12 distinct slots but 13 rows (one slot logged twice). If dedupe works,
    // completedAsOf = 12, remaining = 1 (not 0) → no-pace, NOT complete.
    const rows: SlotCompletion[] = [
      ...Array.from({ length: 12 }, (_, i) => ({ slotKey: `s${i}`, date: '2026-01-05' })),
      { slotKey: 's0', date: '2026-01-20' }, // duplicate slot — must not re-count
    ];
    const points = forecastTrend({ totalSlots: 13, completions: rows, today: TODAY });
    expect(points.every(p => p.suppressed === 'no-pace')).toBe(true); // remaining 1 > 0, no recent pace
  });

  it('shows the projected finish sliding later as the pace collapses', () => {
    // High pace in the older weeks, low (but non-zero) pace recently → the finish
    // estimate drifts later across vantages: a positive net slip.
    const completions: SlotCompletion[] = [];
    for (let w = 12; w >= 6; w--) completions.push(...completionsInWeek(w, 10, 'fast')); // 70 fast
    for (let w = 5; w >= 0; w--) completions.push(...completionsInWeek(w, 1, 'slow'));    // 6 slow
    const points = forecastTrend({ totalSlots: 100, completions, today: TODAY, vantageWeeks: 8 });

    const dated = points.filter(p => p.forecastDate);
    expect(dated.length).toBeGreaterThanOrEqual(2);
    const slip = forecastSlipDays(points);
    expect(slip).not.toBeNull();
    expect(slip as number).toBeGreaterThan(0);
    // The last vantage projects a later finish than the first.
    expect((dated[dated.length - 1].forecastDate as string) > (dated[0].forecastDate as string)).toBe(true);
  });
});

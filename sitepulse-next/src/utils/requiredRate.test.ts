import { describe, it, expect } from 'vitest';
import { requiredRate, paceGap, assessPace } from './requiredRate';
import { parseDay } from './progressAnalytics';

const d = (s: string) => parseDay(s) as Date;

describe('requiredRate', () => {
  it('computes SF/week to hit a future deadline', () => {
    // 1400 SF, 14 days (2 weeks) → 700 SF/week.
    expect(requiredRate(1400, d('2026-06-01'), d('2026-06-15'))).toBeCloseTo(700, 6);
  });
  it('returns 0 when nothing remains', () => {
    expect(requiredRate(0, d('2026-06-01'), d('2026-06-15'))).toBe(0);
    expect(requiredRate(-5, d('2026-06-01'), d('2026-06-15'))).toBe(0);
  });
  it('returns null with no target date', () => {
    expect(requiredRate(1000, d('2026-06-01'), null)).toBeNull();
  });
  it('returns null when the deadline is today or past (no positive rate can hit it)', () => {
    expect(requiredRate(1000, d('2026-06-15'), d('2026-06-15'))).toBeNull();
    expect(requiredRate(1000, d('2026-06-15'), d('2026-06-10'))).toBeNull();
  });
});

describe('paceGap', () => {
  it('is on pace when actual ≥ required', () => {
    expect(paceGap(700, 700)).toEqual({ ratio: 1, onPace: true, extraCrews: 0 });
  });
  it('estimates crews to add when behind (current pace ≈ 1 crew)', () => {
    // required 700, actual 350 → need 2× → +1 crew.
    expect(paceGap(350, 700)).toMatchObject({ onPace: false, extraCrews: 1 });
    // required 700, actual 300 → ceil(2.33)=3× → +2 crews.
    expect(paceGap(300, 700)).toMatchObject({ onPace: false, extraCrews: 2 });
  });
  it('is all-null when there is no required rate', () => {
    expect(paceGap(500, null)).toEqual({ ratio: null, onPace: null, extraCrews: null });
  });
  it('treats a non-positive requirement as trivially on pace', () => {
    expect(paceGap(500, 0)).toEqual({ ratio: null, onPace: true, extraCrews: 0 });
  });
  it('reports behind with no crew estimate when there is no observed pace', () => {
    expect(paceGap(0, 700)).toEqual({ ratio: 0, onPace: false, extraCrews: null });
  });
});

describe('assessPace', () => {
  const today = d('2026-06-01');

  it('is complete when nothing remains', () => {
    const a = assessPace({ remaining: 0, actualPerWeek: 100, today, targetDate: d('2026-06-30') });
    expect(a.status).toBe('complete');
    expect(a.extraCrews).toBe(0);
  });

  it('is no-pace when there is remaining work but no observed rate', () => {
    const a = assessPace({ remaining: 1000, actualPerWeek: null, today, targetDate: d('2026-06-30') });
    expect(a.status).toBe('no-pace');
    expect(a.forecastDate).toBeNull();
  });

  it('is no-target when work remains and there is a pace but no deadline', () => {
    const a = assessPace({ remaining: 1000, actualPerWeek: 500, today, targetDate: null });
    expect(a.status).toBe('no-target');
    expect(a.forecastDate).toBe('2026-06-15'); // 2 weeks at 500/wk
  });

  it('is overdue when the deadline has passed and work remains', () => {
    const a = assessPace({ remaining: 1000, actualPerWeek: 500, today: d('2026-06-20'), targetDate: d('2026-06-10') });
    expect(a.status).toBe('overdue');
  });

  it('is behind with a forecast date, days-late and a crew count', () => {
    // remaining 1400, pace 350/wk → 4 weeks → finish Jun 29; target Jun 15 → 14 days late.
    const a = assessPace({ remaining: 1400, actualPerWeek: 350, today, targetDate: d('2026-06-15') });
    expect(a.status).toBe('behind');
    expect(a.forecastDate).toBe('2026-06-29');
    expect(a.daysLate).toBe(14);
    expect(a.requiredPerWeek).toBeCloseTo(700, 6);
    expect(a.extraCrews).toBe(1);
  });

  it('is ahead when the forecast finishes before the deadline', () => {
    // remaining 700, pace 700/wk → 1 week → Jun 8; target Jun 30 → ahead.
    const a = assessPace({ remaining: 700, actualPerWeek: 700, today, targetDate: d('2026-06-30') });
    expect(a.status).toBe('ahead');
    expect(a.forecastDate).toBe('2026-06-08');
    expect(a.daysLate).toBeLessThan(0);
    expect(a.extraCrews).toBe(0);
  });

  it('is on-pace when the forecast lands exactly on the deadline', () => {
    const a = assessPace({ remaining: 700, actualPerWeek: 700, today, targetDate: d('2026-06-08') });
    expect(a.status).toBe('on-pace');
    expect(a.daysLate).toBe(0);
  });
});

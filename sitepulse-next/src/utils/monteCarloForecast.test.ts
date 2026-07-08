import { describe, it, expect } from 'vitest';
import {
  mulberry32,
  simulateFinishBand,
  bandForRollup,
  type ForecastBand,
} from './monteCarloForecast';
import {
  projectForecastDate,
  parseDay,
  SMALL_SAMPLE_SLOTS,
  type GroupRollup,
} from './progressAnalytics';

const TODAY = parseDay('2026-06-29') as Date;
const SEED = 1337;

/** A GroupRollup with sensible defaults; override only what a test cares about. */
function makeRollup(partial: Partial<GroupRollup>): GroupRollup {
  return {
    unitCount: 0,
    totalSlots: 0,
    completedSlots: 0,
    ongoingSlots: 0,
    completionPct: 0,
    plannedByTodayPct: null,
    plannedCoverage: 0,
    avgBehindDays: null,
    stalledUnitIds: [],
    weekly: [],
    paceThisWeek: 0,
    trailingAvg: null,
    forecastDate: null,
    forecastSuppressed: null,
    ...partial,
  };
}

describe('mulberry32', () => {
  it('is deterministic — same seed yields the same stream', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces different streams for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it('returns values in [0, 1)', () => {
    const r = mulberry32(99);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('simulateFinishBand — determinism', () => {
  it('same seed → identical band', () => {
    const input = {
      remaining: 30,
      totalSlots: 60,
      fullWeekCounts: [3, 7, 2, 8, 4, 5],
      today: TODAY,
      seed: SEED,
    };
    const first = simulateFinishBand(input);
    const second = simulateFinishBand(input);
    expect(first).toEqual(second);
    expect(first.suppressed).toBeNull();
  });
});

describe('simulateFinishBand — ordering', () => {
  it('p10 ≤ p50 ≤ p90 (dates sort lexicographically)', () => {
    const band = simulateFinishBand({
      remaining: 40,
      totalSlots: 80,
      fullWeekCounts: [1, 6, 2, 9, 3, 7],
      today: TODAY,
      seed: SEED,
    });
    expect(band.suppressed).toBeNull();
    expect(band.p10).not.toBeNull();
    expect((band.p10 as string) <= (band.p50 as string)).toBe(true);
    expect((band.p50 as string) <= (band.p90 as string)).toBe(true);
  });

  it('holds ordering across a range of seeds', () => {
    for (const seed of [1, 2, 7, 100, 55555]) {
      const band = simulateFinishBand({
        remaining: 25,
        totalSlots: 50,
        fullWeekCounts: [2, 5, 1, 8, 3, 4],
        today: TODAY,
        seed,
      });
      expect((band.p10 as string) <= (band.p50 as string)).toBe(true);
      expect((band.p50 as string) <= (band.p90 as string)).toBe(true);
    }
  });
});

describe('simulateFinishBand — suppression parity with projectForecastDate', () => {
  // Every scenario the point forecast suppresses, the band must suppress with
  // the identical code (AGENTS.md §3: suppress, never fake).
  const scenarios: { name: string; remaining: number; totalSlots: number; fullWeekCounts: number[] }[] = [
    { name: 'complete (nothing remaining)', remaining: 0, totalSlots: 20, fullWeekCounts: [5, 5, 5, 5, 5, 5] },
    { name: 'complete (over-completed)', remaining: -3, totalSlots: 20, fullWeekCounts: [5, 5, 5] },
    { name: 'small-sample (below threshold)', remaining: 5, totalSlots: SMALL_SAMPLE_SLOTS - 1, fullWeekCounts: [3, 3, 3] },
    { name: 'no-pace (all-zero window)', remaining: 20, totalSlots: 40, fullWeekCounts: [0, 0, 0, 0, 0, 0] },
    { name: 'no-pace (zero median)', remaining: 20, totalSlots: 40, fullWeekCounts: [0, 0, 0, 0, 5, 5] },
  ];

  for (const s of scenarios) {
    it(`suppresses ${s.name} identically to the point forecast`, () => {
      const point = projectForecastDate({
        remaining: s.remaining,
        totalSlots: s.totalSlots,
        fullWeekCounts: s.fullWeekCounts,
        today: TODAY,
      });
      const band = simulateFinishBand({ ...s, today: TODAY, seed: SEED });
      // Precondition: the point forecast really does suppress in this scenario.
      expect(point.forecastSuppressed).not.toBeNull();
      expect(band.suppressed).toBe(point.forecastSuppressed);
      expect(band.p10).toBeNull();
      expect(band.p50).toBeNull();
      expect(band.p90).toBeNull();
    });
  }

  it('emits a band when the point forecast does NOT suppress', () => {
    const point = projectForecastDate({
      remaining: 20,
      totalSlots: 40,
      fullWeekCounts: [4, 5, 6, 5, 4, 5],
      today: TODAY,
    });
    expect(point.forecastSuppressed).toBeNull();
    const band = simulateFinishBand({
      remaining: 20,
      totalSlots: 40,
      fullWeekCounts: [4, 5, 6, 5, 4, 5],
      today: TODAY,
      seed: SEED,
    });
    expect(band.suppressed).toBeNull();
    expect(band.p50).not.toBeNull();
  });
});

describe('simulateFinishBand — constant pace collapses to the point forecast', () => {
  it('a steady window with an exactly-divisible backlog gives one date', () => {
    const remaining = 20;
    const fullWeekCounts = [5, 5, 5, 5, 5, 5]; // 5/wk → 4 weeks exactly
    const band = simulateFinishBand({ remaining, totalSlots: 40, fullWeekCounts, today: TODAY, seed: SEED });
    const point = projectForecastDate({ remaining, totalSlots: 40, fullWeekCounts, today: TODAY });

    // Zero variance in the draws → the band collapses to a single date...
    expect(band.p10).toBe(band.p50);
    expect(band.p50).toBe(band.p90);
    // ...which is exactly the median-pace point forecast.
    expect(band.p50).toBe(point.forecastDate);
  });

  it('brackets the point forecast when pace varies', () => {
    const remaining = 30;
    const fullWeekCounts = [2, 6, 3, 8, 4, 7];
    const band = simulateFinishBand({ remaining, totalSlots: 60, fullWeekCounts, today: TODAY, seed: SEED });
    const point = projectForecastDate({ remaining, totalSlots: 60, fullWeekCounts, today: TODAY });
    // The point forecast sits inside the simulated 80% range.
    expect((band.p10 as string) <= (point.forecastDate as string)).toBe(true);
    expect((point.forecastDate as string) <= (band.p90 as string)).toBe(true);
  });
});

describe('simulateFinishBand — erratic pace censors to no-pace', () => {
  it('suppresses as no-pace when >10% of iterations never finish within maxWeeks', () => {
    // Median > 0 (so the POINT forecast still produces a date), but the backlog
    // is far larger than maxWeeks of pace can clear → every iteration censors.
    const point = projectForecastDate({
      remaining: 1000,
      totalSlots: 1000,
      fullWeekCounts: [0, 0, 0, 1, 1, 1],
      today: TODAY,
    });
    expect(point.forecastSuppressed).toBeNull(); // the point forecast is NOT suppressed here

    const band = simulateFinishBand({
      remaining: 1000,
      totalSlots: 1000,
      fullWeekCounts: [0, 0, 0, 1, 1, 1],
      today: TODAY,
      seed: SEED,
      maxWeeks: 5,
    });
    expect(band.suppressed).toBe('no-pace');
    expect(band.p50).toBeNull();
  });
});

describe('bandForRollup', () => {
  it('drops the current partial week and derives remaining from the rollup', () => {
    // Last weekly entry is the current partial week (count 3) — excluded.
    const rollup = makeRollup({
      totalSlots: 40,
      completedSlots: 20,
      weekly: [
        { weekStart: '2026-05-11', count: 5 },
        { weekStart: '2026-05-18', count: 5 },
        { weekStart: '2026-05-25', count: 5 },
        { weekStart: '2026-06-01', count: 5 },
        { weekStart: '2026-06-08', count: 5 },
        { weekStart: '2026-06-15', count: 5 },
        { weekStart: '2026-06-22', count: 3 }, // current partial — dropped
      ],
    });
    const viaAdapter = bandForRollup(rollup, TODAY, SEED);
    const direct = simulateFinishBand({
      remaining: 20,
      totalSlots: 40,
      fullWeekCounts: [5, 5, 5, 5, 5, 5],
      today: TODAY,
      seed: SEED,
    });
    expect(viaAdapter).toEqual(direct);
  });

  it('suppresses complete when the rollup has no remaining slots', () => {
    const rollup = makeRollup({
      totalSlots: 30,
      completedSlots: 30,
      weekly: [
        { weekStart: '2026-06-08', count: 4 },
        { weekStart: '2026-06-15', count: 4 },
        { weekStart: '2026-06-22', count: 2 },
      ],
    });
    const band: ForecastBand = bandForRollup(rollup, TODAY, SEED);
    expect(band.suppressed).toBe('complete');
    expect(band.p50).toBeNull();
  });
});

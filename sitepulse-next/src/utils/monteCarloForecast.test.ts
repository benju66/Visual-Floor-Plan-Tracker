import { describe, it, expect } from 'vitest';
import {
  mulberry32,
  simulateFinishBand,
  bandForRollup,
  activityRisk,
  bestPaceMove,
  MIN_MOVE_DAYS,
  FORECAST_BAND_SEED,
  type ForecastBand,
} from './monteCarloForecast';
import {
  projectForecastDate,
  parseDay,
  SMALL_SAMPLE_SLOTS,
  type GroupRollup,
} from './progressAnalytics';
import { buildApplicabilityIndex } from './applicability';
import type { Activity, StatusLog, Unit } from '@/types/domain';

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

// ---------------------------------------------------------------------------
// P3 — activityRisk
// ---------------------------------------------------------------------------

/** An Activity fixture; `appliesTo` null = applies to every unit type. */
function act(name: string, order: number, appliesTo: string[] | null = null): Activity {
  return {
    id: `ms-${name}`,
    project_id: 'p1',
    name,
    color: '#123456',
    track: 'Production',
    sequence_order: order,
    created_at: '2026-01-01T00:00:00Z',
    applies_to_unit_types: appliesTo,
  } as Activity;
}

/** A current-state StatusLog for one unit × activity. */
function stat(unit_id: string, activityName: string, extra: Partial<StatusLog> = {}): StatusLog {
  return {
    id: `s-${unit_id}-${activityName}`,
    unit_id,
    activityName,
    status_color: '#123456',
    temporal_state: 'none',
    track: 'Production',
    planned_start_date: null,
    planned_end_date: null,
    logged_date: null,
    client_timestamp: null,
    created_at: '2026-06-01T08:00:00Z',
    ...extra,
  } as StatusLog;
}

/** ISO 'YYYY-MM-DD' `n` days before TODAY (2026-06-29). */
function isoBefore(n: number): string {
  return new Date(TODAY.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

/** `perWeek` completed events for `activityId` in each of the last `weeks` full weeks. */
function weeklyHistory(
  activityId: string,
  perWeek: number,
  unitIds: string[],
  weeks = 6,
): { unit_id: string; activity_id: string; logged_date: string; track: string }[] {
  const out: { unit_id: string; activity_id: string; logged_date: string; track: string }[] = [];
  let idx = 0;
  for (let w = 1; w <= weeks; w++) {
    for (let k = 0; k < perWeek; k++) {
      out.push({ unit_id: unitIds[idx % unitIds.length], activity_id: activityId, logged_date: isoBefore(w * 7), track: 'Production' });
      idx++;
    }
  }
  return out;
}

describe('activityRisk', () => {
  const UNITS: Pick<Unit, 'id' | 'unit_type'>[] = Array.from({ length: 15 }, (_, i) => ({ id: `u${i + 1}`, unit_type: 'Apartment' }));
  const UNIT_IDS = UNITS.map(u => u.id);
  const ACTS = [act('Framing', 1), act('Drywall', 2), act('Paint', 3)];

  // Drywall: 12 open + a planned finish already in the past → its 80% range ends
  //   well AFTER plan (high positive riskDays). Framing: nearly done + a far-future
  //   planned finish → range ends before plan (negative). Paint: no pace history at
  //   all → suppressed, listed but never ranked.
  const STATUSES: StatusLog[] = [
    ...UNIT_IDS.map((u, i) => stat(u, 'Drywall', { temporal_state: i < 3 ? 'completed' : 'none', planned_end_date: '2026-06-15' })),
    ...UNIT_IDS.map((u, i) => stat(u, 'Framing', { temporal_state: i < 12 ? 'completed' : 'none', planned_end_date: '2026-12-31' })),
    // Paint: no status rows → all not-started, no planned dates.
  ];
  const HISTORY = [
    ...weeklyHistory('ms-Drywall', 3, UNIT_IDS),
    ...weeklyHistory('ms-Framing', 3, UNIT_IDS),
    // Paint: none.
  ];

  const input = { activities: ACTS, units: UNITS, statuses: STATUSES, history: HISTORY, track: 'Production', today: TODAY, seed: SEED };

  it('is deterministic — same seed yields an identical ranking', () => {
    expect(activityRisk(input)).toEqual(activityRisk(input));
  });

  it('ranks the genuinely-behind activity first (worst-first by riskDays)', () => {
    const ranked = activityRisk(input);
    expect(ranked).toHaveLength(3);
    expect(ranked[0].name).toBe('Drywall');
    expect(ranked[0].riskDays).not.toBeNull();
    expect(ranked[0].riskDays as number).toBeGreaterThan(0);
    // Drywall's planned finish is the max across its dated slots.
    expect(ranked[0].plannedFinish).toBe('2026-06-15');
    expect(ranked[0].remainingSlots).toBe(12);

    const framing = ranked.find(r => r.name === 'Framing');
    expect(framing?.riskDays as number).toBeLessThan(0); // comfortably ahead of a far-future plan
  });

  it('lists thin-history activities as suppressed — never fake-ranked', () => {
    const paint = activityRisk(input).find(r => r.name === 'Paint');
    expect(paint).toBeDefined();
    expect(paint?.band.suppressed).not.toBeNull();
    expect(paint?.riskDays).toBeNull();
    // ...and it sorts to the bottom, below every rankable activity.
    const ranked = activityRisk(input);
    expect(ranked[ranked.length - 1].name).toBe('Paint');
  });

  it('respects applicability — N/A units never enter the slot count', () => {
    const mixedUnits: Pick<Unit, 'id' | 'unit_type'>[] = [
      ...Array.from({ length: 12 }, (_, i) => ({ id: `a${i + 1}`, unit_type: 'Apartment' })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: `r${i + 1}`, unit_type: 'Retail' })),
    ];
    const dry = act('Drywall', 1, ['Apartment']); // applies to Apartment only
    const index = buildApplicabilityIndex([dry], []);
    const apartmentIds = mixedUnits.filter(u => u.unit_type === 'Apartment').map(u => u.id);
    const statuses = apartmentIds.map(u => stat(u, 'Drywall'));
    const history = weeklyHistory('ms-Drywall', 2, apartmentIds);

    const [risk] = activityRisk({
      activities: [dry], units: mixedUnits, statuses, history, applicabilityIndex: index,
      track: 'Production', today: TODAY, seed: SEED,
    });
    // 12 Apartment slots — the 3 Retail units are N/A and excluded.
    expect(risk.remainingSlots).toBe(12);
  });

  it('uses the shared FORECAST_BAND_SEED path without throwing', () => {
    const ranked = activityRisk({ ...input, seed: FORECAST_BAND_SEED });
    expect(ranked.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// P4 — bestPaceMove
// ---------------------------------------------------------------------------

/** A level rollup from its FULL-week pace + slot counts (a trailing partial week is appended and later dropped). */
function level(fullWeeks: number[], totalSlots: number, completedSlots: number): GroupRollup {
  const weekly = [...fullWeeks, 0].map((count, i) => ({ weekStart: `w${i}`, count }));
  return makeRollup({ totalSlots, completedSlots, weekly });
}

describe('bestPaceMove', () => {
  it('evaluates but finds no move on uniform pace (no level is faster)', () => {
    const rollups = {
      a: level([3, 3, 3, 3, 3, 3], 40, 10),
      b: level([3, 3, 3, 3, 3, 3], 40, 10),
    };
    const res = bestPaceMove({ levelRollups: rollups, today: TODAY, seed: SEED });
    expect(res.move).toBeNull();
    expect(res.evaluated).toBe(true); // two comparable levels — we DID look
  });

  it('does not evaluate with fewer than two unsuppressed levels', () => {
    // One healthy level + one complete (suppressed) level → only one contender.
    const rollups = {
      a: level([4, 4, 4, 4, 4, 4], 40, 12),
      done: level([4, 4, 4, 4, 4, 4], 20, 20), // remaining 0 → band 'complete', filtered out
    };
    const res = bestPaceMove({ levelRollups: rollups, today: TODAY, seed: SEED });
    expect(res.move).toBeNull();
    expect(res.evaluated).toBe(false); // nothing comparable → stay silent, don't claim "no move helps"
    // And truly empty input.
    expect(bestPaceMove({ levelRollups: {}, today: TODAY, seed: SEED })).toEqual({ move: null, evaluated: false });
  });

  it('finds the transplant that pulls the project finish in the most', () => {
    const rollups = {
      fast: level([10, 10, 10, 10, 10, 10], 40, 34), // remaining 6, ~1 wk
      slow: level([2, 2, 2, 2, 2, 2], 40, 4),         // remaining 36, ~18 wks — gates the project
    };
    const { move, evaluated } = bestPaceMove({ levelRollups: rollups, today: TODAY, seed: SEED });
    expect(evaluated).toBe(true);
    expect(move).not.toBeNull();
    expect(move!.fromSheetId).toBe('fast'); // donor = the faster level
    expect(move!.toSheetId).toBe('slow');   // recipient = the lagging level
    expect(move!.daysSaved).toBeGreaterThanOrEqual(MIN_MOVE_DAYS);
    expect(move!.projectedFinish).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('is deterministic — same seed yields the identical result', () => {
    const rollups = {
      fast: level([9, 9, 9, 9, 9, 9], 40, 30),
      slow: level([1, 1, 1, 1, 1, 1], 40, 5),
    };
    const a = bestPaceMove({ levelRollups: rollups, today: TODAY, seed: SEED });
    const b = bestPaceMove({ levelRollups: rollups, today: TODAY, seed: SEED });
    expect(a).toEqual(b);
  });

  it('evaluates but finds no move when speeding one level cannot beat a tied bottleneck', () => {
    // Two levels tie as the slowest; a third is fast. Speeding up either tied
    // level leaves the other gating the finish → 0 days saved → below the floor.
    const rollups = {
      a: level([1, 1, 1, 1, 1, 1], 40, 30), // remaining 10, ~10 wks
      b: level([1, 1, 1, 1, 1, 1], 40, 30), // remaining 10, ~10 wks (tied)
      c: level([10, 10, 10, 10, 10, 10], 40, 35), // fast, remaining 5, ~1 wk
    };
    const res = bestPaceMove({ levelRollups: rollups, today: TODAY, seed: SEED });
    expect(res.move).toBeNull();
    expect(res.evaluated).toBe(true);
  });
});

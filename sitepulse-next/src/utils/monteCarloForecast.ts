import {
  projectForecastDate,
  FORECAST_WINDOW_WEEKS,
} from '@/utils/progressAnalytics';
import type { GroupRollup } from '@/utils/progressAnalytics';

/**
 * monteCarloForecast — the honest confidence band around the point forecast
 * (Schedule That Thinks, Phase 1). It resamples a scope's OWN recent weekly
 * completion counts a thousand times (a bootstrap Monte Carlo simulation) and
 * reads the spread off the results: "Projected Aug 20 · likely Aug 14–29".
 *
 * This is an ADDITIVE layer beside {@link projectForecastDate} — it never
 * replaces or modifies the deterministic point forecast (AGENTS.md §3). The two
 * share the SAME trailing window and the SAME `today + ceil(weeks*7)` day math,
 * and the band inherits every one of the point forecast's suppression cases
 * (complete / small-sample / no-pace) by delegating that decision to it, so a
 * band can never appear where the point date honestly shows nothing.
 *
 * Determinism is non-negotiable: `today` and `seed` are always passed in — there
 * is no `Date.now()` and no `Math.random()` anywhere in this module, so the same
 * seed yields the identical band across every re-render (pinned by test).
 */

const DAY_MS = 86_400_000;

/** Confidence level of the band: the 10th–90th percentile spread (fixed 80% in v1). */
export const BAND_LOW_PERCENTILE = 0.1;
export const BAND_HIGH_PERCENTILE = 0.9;
/**
 * The one fixed app-side seed the dashboard passes to every band. A constant
 * seed means the shown numbers are stable across re-renders (no jitter), and any
 * component that falls back to computing its own band uses the SAME one — so the
 * hero and the FloorPulse rows never disagree for the same scope.
 */
export const FORECAST_BAND_SEED = 20260707;
/** Iterations behind the fixed 80% band — quoted in the tooltip method sentence. */
export const BAND_ITERATIONS = 1000;
/**
 * If more than this fraction of iterations never finish within `maxWeeks`, the
 * project's pace is too erratic to bound honestly — the band suppresses as
 * 'no-pace' rather than reporting a censored (and misleadingly wide) range.
 */
export const CENSOR_SUPPRESS_FRACTION = 0.1;

/**
 * A confidence band around a projected finish. Dates are ISO 'YYYY-MM-DD'
 * strings on the same calendar the point forecast uses; all three are null when
 * `suppressed` is set. `suppressed` mirrors {@link GroupRollup.forecastSuppressed}
 * exactly (plus the erratic-pace censor case, reported as 'no-pace').
 */
export interface ForecastBand {
  /** Optimistic finish — the 10th-percentile (P10) simulated date. */
  p10: string | null;
  /** Median simulated finish (P50). */
  p50: string | null;
  /** Pessimistic finish — the 90th-percentile (P90) simulated date. */
  p90: string | null;
  suppressed: 'complete' | 'small-sample' | 'no-pace' | null;
}

/**
 * mulberry32 — a tiny, fast, seeded PRNG. Deterministic: the same `seed`
 * produces the same stream of numbers in [0, 1). Used so the dashboard shows
 * stable band numbers across re-renders and so tests can pin exact output.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nearest-rank percentile of an ASCENDING-sorted array (p in [0, 1]). */
function percentileOf(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(p * sorted.length) - 1;
  const idx = Math.min(sorted.length - 1, Math.max(0, rank));
  return sorted[idx];
}

/** Whole weeks → an ISO finish date, using the EXACT day math of {@link projectForecastDate}. */
function weeksToDate(weeks: number, today: Date): string {
  return new Date(today.getTime() + Math.ceil(weeks * 7) * DAY_MS).toISOString().slice(0, 10);
}

export interface SimulateFinishBandInput {
  /** Applicable slots still to complete (totalSlots − completedSlots). */
  remaining: number;
  /** Total applicable slots — the small-sample denominator (mirrors the point forecast). */
  totalSlots: number;
  /**
   * Contiguous weekly completion counts (INCLUDING zero weeks), oldest→newest,
   * EXCLUDING the current partial week — the same input the point forecast takes.
   * The bootstrap draws from the trailing {@link FORECAST_WINDOW_WEEKS} of them.
   */
  fullWeekCounts: number[];
  today: Date;
  /** Bootstrap iterations (default 1,000). */
  iterations?: number;
  /** Seed for {@link mulberry32} — required for determinism. */
  seed: number;
  /** Safety ceiling on simulated weeks; iterations that hit it are censored (default 520 ≈ 10y). */
  maxWeeks?: number;
}

/**
 * Bootstrap the finish-date distribution and read off the P10/P50/P90 band.
 *
 * Method: the pace window is the trailing {@link FORECAST_WINDOW_WEEKS} of
 * `fullWeekCounts` (the same window the point forecast's median uses). Each
 * iteration draws weekly counts from that window WITH REPLACEMENT until
 * `remaining` slots are exhausted, recording the whole-week count to finish; an
 * iteration that never finishes within `maxWeeks` is censored. Percentiles of
 * the recorded weeks become dates via the same `today + ceil(weeks*7)` math the
 * point forecast uses.
 *
 * Suppression parity (pinned by test): the base decision is delegated to
 * {@link projectForecastDate}, so EVERY case it suppresses ('complete' /
 * 'small-sample' / 'no-pace') suppresses the band identically. On top of that,
 * if more than {@link CENSOR_SUPPRESS_FRACTION} of iterations censor, the band
 * suppresses as 'no-pace' (the recent pace is too erratic to bound honestly).
 */
export function simulateFinishBand({
  remaining,
  totalSlots,
  fullWeekCounts,
  today,
  iterations = BAND_ITERATIONS,
  seed,
  maxWeeks = 520,
}: SimulateFinishBandInput): ForecastBand {
  // Inherit the point forecast's suppression exactly — the band never shows a
  // range where the point date honestly shows nothing (AGENTS.md §3).
  const { forecastSuppressed } = projectForecastDate({ remaining, totalSlots, fullWeekCounts, today });
  if (forecastSuppressed) {
    return { p10: null, p50: null, p90: null, suppressed: forecastSuppressed };
  }

  // Same trailing window as the median-pace point forecast. By parity above,
  // the median of this window is > 0, so it holds at least one positive week
  // and the bootstrap makes progress (no infinite loop, no empty window).
  const windowSize = Math.min(FORECAST_WINDOW_WEEKS, fullWeekCounts.length);
  const window = fullWeekCounts.slice(-windowSize);

  const rand = mulberry32(seed);
  const weeksToFinish: number[] = [];
  let censored = 0;

  for (let i = 0; i < iterations; i++) {
    let done = 0;
    let weeks = 0;
    while (done < remaining && weeks < maxWeeks) {
      done += window[Math.floor(rand() * window.length)];
      weeks++;
    }
    if (done < remaining) censored++;
    weeksToFinish.push(weeks);
  }

  if (censored / iterations > CENSOR_SUPPRESS_FRACTION) {
    return { p10: null, p50: null, p90: null, suppressed: 'no-pace' };
  }

  weeksToFinish.sort((a, b) => a - b);
  return {
    p10: weeksToDate(percentileOf(weeksToFinish, BAND_LOW_PERCENTILE), today),
    p50: weeksToDate(percentileOf(weeksToFinish, 0.5), today),
    p90: weeksToDate(percentileOf(weeksToFinish, BAND_HIGH_PERCENTILE), today),
    suppressed: null,
  };
}

/**
 * Convenience adapter from a lifted {@link GroupRollup} to a {@link ForecastBand}
 * — mirrors {@link projectForecastDate}'s inputs as `summarizeGroup` derives them:
 * the pace window is `weekly` minus the current partial week, and `remaining` is
 * `totalSlots − completedSlots`. The dashboard calls this per scope + per level.
 */
export function bandForRollup(rollup: GroupRollup, today: Date, seed: number): ForecastBand {
  const fullWeeks = rollup.weekly.slice(0, -1); // exclude the current partial week (mirrors summarizeGroup)
  return simulateFinishBand({
    remaining: rollup.totalSlots - rollup.completedSlots,
    totalSlots: rollup.totalSlots,
    fullWeekCounts: fullWeeks.map(w => w.count),
    today,
    seed,
  });
}

/**
 * The one-sentence method note shown in every band tooltip — calibrated, not
 * falsely precise. Quotes the REAL pace window + iteration count so the copy can
 * never drift from the constants the simulation actually uses.
 */
export function bandMethodSentence(): string {
  return `80% confidence range from ${FORECAST_WINDOW_WEEKS} weeks of this project's actual pace, simulated ${BAND_ITERATIONS.toLocaleString('en-US')} times.`;
}

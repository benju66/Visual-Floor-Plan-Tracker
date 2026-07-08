import {
  projectForecastDate,
  FORECAST_WINDOW_WEEKS,
  summarizeGroup,
  scopePlannedFinish,
  orderedTrackActivities,
  parseDay,
  dayDiff,
} from '@/utils/progressAnalytics';
import type { GroupRollup, CompletionEvent } from '@/utils/progressAnalytics';
import { isActivityApplicable, EMPTY_APPLICABILITY_INDEX } from '@/utils/applicability';
import type { ApplicabilityIndex } from '@/utils/applicability';
import type { Activity, StatusLog, Unit } from '@/types/domain';

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

// ---------------------------------------------------------------------------
// P3 — Risk Radar: which activities put the finish date most at risk
// ---------------------------------------------------------------------------

/**
 * One activity's schedule-risk row for the Risk Radar (Schedule That Thinks P3).
 * `band` is the activity's OWN confidence band; it is suppressed exactly as the
 * point forecast would be (thin history / no pace / complete), and a suppressed
 * activity is never ranked — only listed as "not enough history yet".
 */
export interface ActivityRisk {
  activityId: string;
  name: string;
  /** Applicable slots still open for this activity in the current scope. */
  remainingSlots: number;
  /** The activity's own finish band (suppressed when its pace history is too thin). */
  band: ForecastBand;
  /** Latest planned finish across the activity's applicable slots (ISO), or null. */
  plannedFinish: string | null;
  /**
   * The worst-first ranking key. With a planned finish AND an honest band it is
   * P90 vs that planned finish (+ = the 80% range ends AFTER the plan → at risk,
   * − = the whole range beats the plan). With no planned finish it falls back to
   * the band width (p10→p90) — wider = more uncertain. NULL when the band is
   * suppressed: such activities are listed, never fake-ranked (AGENTS.md §3).
   */
  riskDays: number | null;
}

export interface ActivityRiskInput {
  activities: Activity[];
  /** In-scope units (`unit_type` needed for applicability). */
  units: Pick<Unit, 'id' | 'unit_type'>[];
  /** Current-state logs (scoped internally by the `units` set). */
  statuses: StatusLog[];
  /** Completed audit events; must carry `activity_id` for per-activity pace. */
  history: (CompletionEvent & { activity_id?: string | null })[];
  applicabilityIndex?: ApplicabilityIndex;
  track: string;
  today: Date;
  /** Seed for the per-activity bootstrap — use {@link FORECAST_BAND_SEED}. */
  seed: number;
}

/**
 * Rank the track's activities by how much they threaten their planned finish.
 *
 * Each activity's band is computed by REUSING the tested rollup + bootstrap
 * ({@link summarizeGroup} → {@link bandForRollup}) scoped to that one activity:
 * `history` is pre-filtered to the activity's completions so `weekly` is the
 * activity's own pace, and a single-activity list makes `totalSlots` the count
 * of its APPLICABLE (unit × activity) slots — N/A slots never enter any count
 * (AGENTS.md §3). Nothing here forks the simulation or the point-forecast math.
 *
 * Ranked worst-first: rankable activities (dated band) by descending
 * `riskDays`, then the suppressed ones in sequence order (stable). The caller
 * shows the top few and lists the suppressed group as "not enough history yet".
 */
export function activityRisk({
  activities, units, statuses, history,
  applicabilityIndex = EMPTY_APPLICABILITY_INDEX, track, today, seed,
}: ActivityRiskInput): ActivityRisk[] {
  const trackActivities = orderedTrackActivities(activities, track);
  const out: ActivityRisk[] = [];

  for (const activity of trackActivities) {
    // Applicable in-scope units for THIS activity.
    const applicableUnitIds = new Set<string>();
    for (const u of units) {
      if (isActivityApplicable(activity, u, applicabilityIndex)) applicableUnitIds.add(u.id);
    }
    if (applicableUnitIds.size === 0) continue; // applies to nothing in scope

    // Per-activity rollup + band via the shared math. History filtered to this
    // activity's completions so the pace window is the activity's own.
    const historyForActivity = history.filter(h => h.activity_id === activity.id);
    const rollup = summarizeGroup({
      units, statuses, activities: [activity], track, history: historyForActivity, today, applicabilityIndex,
    });
    const band = bandForRollup(rollup, today, seed);
    const remainingSlots = Math.max(0, rollup.totalSlots - rollup.completedSlots);

    // Latest planned finish across the applicable A-slots (max planned_end_date).
    const aStatuses = statuses.filter(
      s => s.track === track && s.activityName === activity.name && s.unit_id && applicableUnitIds.has(s.unit_id),
    );
    const plannedFinish = scopePlannedFinish(aStatuses, track);

    let riskDays: number | null = null;
    if (!band.suppressed && band.p90) {
      const p90 = parseDay(band.p90);
      const planned = parseDay(plannedFinish);
      if (p90 && planned) {
        riskDays = dayDiff(planned, p90); // + = the 80% range ends past the plan
      } else if (p90 && band.p10) {
        const p10 = parseDay(band.p10);
        riskDays = p10 ? dayDiff(p10, p90) : null; // no plan → band width
      }
    }

    out.push({ activityId: activity.id, name: activity.name, remainingSlots, band, plannedFinish, riskDays });
  }

  // Worst-first: rankable (riskDays !== null) by descending riskDays; suppressed
  // rows keep their sequence order after them (Array.sort is stable).
  out.sort((a, b) => {
    if (a.riskDays !== null && b.riskDays !== null) return b.riskDays - a.riskDays;
    if (a.riskDays !== null) return -1;
    if (b.riskDays !== null) return 1;
    return 0;
  });
  return out;
}

// ---------------------------------------------------------------------------
// P4 — Highest-impact move: the single pace transplant that pulls the finish in
// (owner may cut this at review)
// ---------------------------------------------------------------------------

/** Below this the pace transplant isn't worth surfacing (whole days pulled in). */
export const MIN_MOVE_DAYS = 2;

/** A single highest-impact pace transplant (Schedule That Thinks P4). */
export interface PaceMove {
  /** Donor level whose recent pace would be adopted (the faster one). */
  fromSheetId: string;
  /** Lagging level that would adopt the donor's pace. */
  toSheetId: string;
  /** Whole days the PROJECT finish is pulled in by the transplant (≥ {@link MIN_MOVE_DAYS}). */
  daysSaved: number;
  /** The new project P50 finish after the transplant (ISO 'YYYY-MM-DD'). */
  projectedFinish: string;
}

/**
 * The result of a best-move search. `move` is the transplant worth suggesting,
 * or null. `evaluated` distinguishes the TWO honest reasons `move` is null:
 * `true` = there were ≥2 levels with real bands and the search genuinely found
 * nothing that saves ≥ {@link MIN_MOVE_DAYS} (the UI can say "no meaningful
 * move"); `false` = there weren't two comparable levels to evaluate at all (the
 * UI stays silent — claiming "no move helps" would be a conclusion never reached).
 */
export interface PaceMoveResult {
  move: PaceMove | null;
  evaluated: boolean;
}

export interface BestPaceMoveInput {
  /** The lifted per-level rollups already computed in ProjectDashboard (keyed by sheet id). */
  levelRollups: Record<string, GroupRollup>;
  today: Date;
  /** Seed for every band + transplant — use {@link FORECAST_BAND_SEED}. */
  seed: number;
}

/**
 * The single most valuable pace transplant across levels: "if {lagging level}
 * matched {faster level}'s recent pace, the projected finish moves up ~N days."
 *
 * The project finish at median is the LATEST level P50 (its slowest level gates
 * it). For every (recipient, donor) level pair, the donor's recent weekly window
 * is transplanted onto the recipient's remaining backlog and re-simulated with
 * the SAME bootstrap ({@link simulateFinishBand}); the recipient's own
 * `totalSlots` is kept so small-sample parity is unchanged. Only a genuine
 * speed-up counts, and the project finish only moves when the transplant hits
 * the level that actually gates it — so this returns the pair that pulls the
 * PROJECT P50 in the most.
 *
 * Honesty (AGENTS.md §3): only levels with an UNSUPPRESSED band (a dated P50)
 * can be a donor or a recipient — a suppressed level has no pace to lend and no
 * finish to pull in. Returns `{ move: null, evaluated: false }` when fewer than
 * two such levels exist (nothing to compare), or `{ move: null, evaluated: true }`
 * when it compared them and no transplant saves ≥ {@link MIN_MOVE_DAYS} days.
 */
export function bestPaceMove({ levelRollups, today, seed }: BestPaceMoveInput): PaceMoveResult {
  const contenders = Object.entries(levelRollups)
    .map(([sheetId, rollup]) => ({
      sheetId,
      rollup,
      band: bandForRollup(rollup, today, seed),
      fullWeekCounts: rollup.weekly.slice(0, -1).map(w => w.count),
      remaining: Math.max(0, rollup.totalSlots - rollup.completedSlots),
    }))
    .filter(c => c.band.suppressed === null && c.band.p50 !== null);

  // Fewer than two comparable levels → we could not evaluate any transplant.
  if (contenders.length < 2) return { move: null, evaluated: false };

  // Project finish at median pace = the latest level P50.
  const baseline = contenders.reduce<string>((m, c) => (c.band.p50! > m ? c.band.p50! : m), contenders[0].band.p50!);

  let best: PaceMove | null = null;
  for (const recipient of contenders) {
    for (const donor of contenders) {
      if (donor.sheetId === recipient.sheetId) continue;

      // Transplant the donor's PACE onto the recipient's remaining backlog.
      const moved = simulateFinishBand({
        remaining: recipient.remaining,
        totalSlots: recipient.rollup.totalSlots,
        fullWeekCounts: donor.fullWeekCounts,
        today,
        seed,
      });
      if (moved.suppressed || !moved.p50) continue;
      if (moved.p50 >= recipient.band.p50!) continue; // donor isn't faster for this backlog

      // New project finish: recipient now at moved.p50, every other level unchanged.
      let newProjectP50 = moved.p50;
      for (const other of contenders) {
        if (other.sheetId === recipient.sheetId) continue;
        if (other.band.p50! > newProjectP50) newProjectP50 = other.band.p50!;
      }

      const daysSaved = dayDiff(parseDay(newProjectP50)!, parseDay(baseline)!); // baseline − new
      if (daysSaved < MIN_MOVE_DAYS) continue;
      if (best === null || daysSaved > best.daysSaved) {
        best = { fromSheetId: donor.sheetId, toSheetId: recipient.sheetId, daysSaved, projectedFinish: newProjectP50 };
      }
    }
  }
  // Compared ≥2 levels: `best` is the move (or null = genuinely nothing helps).
  return { move: best, evaluated: true };
}

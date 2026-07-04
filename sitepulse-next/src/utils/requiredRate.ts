import { parseDay, dayDiff } from '@/utils/progressAnalytics';

/**
 * requiredRate — pure "are we on pace?" math for Scheduling Analytics (Slice B,
 * Phase 6). Given the remaining quantity (SF) and a target finish date, what
 * SF/week is REQUIRED to hit it — and how does that compare to the actual
 * production rate (from productionRates.ts)? Translates the gap into the pitch's
 * plain-English action: "~N weeks late at this pace — needs +M crews".
 *
 * Deterministic + framework-free; callers pass `today`. Suppresses (returns null,
 * never a fabricated number) when there is no future deadline or no observed pace.
 */

const DAY_MS = 86_400_000;

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * SF/week required to finish `remainingQty` by `targetDate`, measured from `today`.
 * - `remainingQty <= 0` → 0 (nothing left to do).
 * - no `targetDate`, or the deadline is today/past → null (no positive weekly rate
 *   can hit a non-future deadline; the caller reports "overdue" instead).
 */
export function requiredRate(remainingQty: number, today: Date, targetDate: Date | null): number | null {
  if (remainingQty <= 0) return 0;
  if (!targetDate) return null;
  const daysLeft = dayDiff(today, targetDate);
  if (daysLeft <= 0) return null;
  return remainingQty / (daysLeft / 7);
}

export interface PaceGap {
  /** actual / required (null when nothing is required or no pace). */
  ratio: number | null;
  /** actual ≥ required (null when there is no required rate to compare against). */
  onPace: boolean | null;
  /**
   * Crews to ADD to hit the deadline, modelling the current pace as ~1 crew:
   * `ceil(required / actual) - 1`. 0 when on pace. null when there is no observed
   * pace to scale from (can't say how many crews reproduce zero output).
   */
  extraCrews: number | null;
}

/** Compare an observed rate to a required rate → the staffing gap. */
export function paceGap(actualRate: number, required: number | null): PaceGap {
  if (required === null) return { ratio: null, onPace: null, extraCrews: null };
  if (required <= 0) return { ratio: null, onPace: true, extraCrews: 0 };
  if (actualRate <= 0) return { ratio: 0, onPace: false, extraCrews: null };
  const ratio = actualRate / required;
  const onPace = actualRate >= required;
  return { ratio, onPace, extraCrews: onPace ? 0 : Math.max(0, Math.ceil(required / actualRate) - 1) };
}

export type PaceStatus =
  | 'complete'   // nothing remaining
  | 'no-target'  // remaining work but no planned deadline to measure against
  | 'no-pace'    // remaining work but no observed production rate
  | 'overdue'    // deadline today/past and work remains
  | 'ahead'      // forecast finish is before the deadline
  | 'on-pace'    // at pace, forecast finish ≤ deadline
  | 'behind';    // at pace, forecast finish after the deadline

export interface PaceAssessment {
  /** Remaining quantity in the caller's measure (locations or SF). */
  remaining: number;
  /** 'YYYY-MM-DD' or null. */
  targetDate: string | null;
  /** Quantity/week needed to hit the deadline, or null. */
  requiredPerWeek: number | null;
  /** Quantity/week observed, or null when there is no pace. */
  actualPerWeek: number | null;
  /** When the remaining SF finishes at the actual pace, or null. */
  forecastDate: string | null;
  /** forecast − target in days (>0 = late), or null. */
  daysLate: number | null;
  status: PaceStatus;
  /** Crews to add to hit the deadline (see {@link PaceGap.extraCrews}). */
  extraCrews: number | null;
}

/**
 * The composed "required-rate-vs-actual" read for one axis (a cost code / sub):
 * remaining SF + a deadline + an observed pace → the forecast finish, the days
 * late, and the staffing action. Honest throughout — every "can't say" path is a
 * distinct status, never a fabricated date.
 */
export function assessPace(input: {
  remaining: number;
  actualPerWeek: number | null;
  today: Date;
  targetDate: Date | null;
}): PaceAssessment {
  const { remaining, actualPerWeek, today, targetDate } = input;
  const targetIso = targetDate ? isoOf(targetDate) : null;

  if (remaining <= 0) {
    return { remaining: 0, targetDate: targetIso, requiredPerWeek: 0, actualPerWeek: actualPerWeek ?? null, forecastDate: null, daysLate: null, status: 'complete', extraCrews: 0 };
  }

  const req = requiredRate(remaining, today, targetDate);

  let forecastDate: string | null = null;
  if (actualPerWeek && actualPerWeek > 0) {
    const weeksLeft = remaining / actualPerWeek;
    forecastDate = isoOf(new Date(today.getTime() + Math.ceil(weeksLeft * 7) * DAY_MS));
  }

  let daysLate: number | null = null;
  if (forecastDate && targetIso) {
    daysLate = dayDiff(parseDay(targetIso) as Date, parseDay(forecastDate) as Date);
  }

  const gap = paceGap(actualPerWeek && actualPerWeek > 0 ? actualPerWeek : 0, req);

  let status: PaceStatus;
  if (!actualPerWeek || actualPerWeek <= 0) status = 'no-pace';
  else if (!targetDate) status = 'no-target';
  else if (dayDiff(today, targetDate) <= 0) status = 'overdue';
  else if (daysLate !== null && daysLate > 0) status = 'behind';
  else if (daysLate !== null && daysLate < 0) status = 'ahead';
  else status = 'on-pace';

  return {
    remaining,
    targetDate: targetIso,
    requiredPerWeek: req,
    actualPerWeek: actualPerWeek ?? null,
    forecastDate,
    daysLate,
    status,
    extraCrews: gap.extraCrews,
  };
}

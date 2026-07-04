import { parseDay, mondayOf, projectForecastDate } from '@/utils/progressAnalytics';
import type { GroupRollup } from '@/utils/progressAnalytics';

/**
 * forecastTrend — the slipping-forecast line for Scheduling Analytics (Slice B,
 * Phase 6). It replays {@link projectForecastDate} (the exact median-pace math
 * summarizeGroup uses — shared, NOT forked, AGENTS.md §3) as-of a series of past
 * weekly vantage points, so you can see whether the projected finish has been
 * sliding later over time.
 *
 * Deterministic + framework-free; the caller passes `today` and the dated slot
 * completions. Suppression is inherited from {@link projectForecastDate}
 * (complete / small-sample / no-pace) — a vantage with no trustworthy projection
 * carries a null forecast, never a fabricated one.
 */

const DAY_MS = 86_400_000;
const FORECAST_WINDOW_WEEKS = 6;

/** A slot's completion: its stable key (`${unitId}_${activityId}`) + logged date. */
export interface SlotCompletion {
  slotKey: string;
  /** 'YYYY-MM-DD' */
  date: string;
}

export interface ForecastPoint {
  /** The vantage date the projection was made from ('YYYY-MM-DD'). */
  asOf: string;
  /** The projected finish as-of that vantage, or null when suppressed. */
  forecastDate: string | null;
  suppressed: GroupRollup['forecastSuppressed'];
}

export interface ForecastTrendInput {
  /** Current total applicable slot count (the denominator — same as summarizeGroup). */
  totalSlots: number;
  /** Dated slot completions (a slot may appear more than once — earliest wins). */
  completions: SlotCompletion[];
  today: Date;
  /** How many weekly vantage points to sample, oldest→newest (default 8). */
  vantageWeeks?: number;
}

/**
 * The forecast-finish projection as-of each of the last N weekly vantage points.
 * At each vantage `t`:
 *   - "completed as-of t" = slots whose EARLIEST completion is on/before t
 *     (append-only re-completions never re-count — a slot is done once);
 *   - "remaining" = totalSlots − completedAsOf;
 *   - the pace window = the {@link FORECAST_WINDOW_WEEKS} full weeks before t's week;
 *   - {@link projectForecastDate} turns that into the finish estimate as-of t.
 */
export function forecastTrend(input: ForecastTrendInput): ForecastPoint[] {
  const { totalSlots, completions, today } = input;
  const vantageWeeks = input.vantageWeeks ?? 8;

  // Earliest completion per slot — the date it first became "done".
  const firstBySlot = new Map<string, string>();
  for (const c of completions) {
    if (!c.date) continue;
    const d = c.date.slice(0, 10);
    const prev = firstBySlot.get(c.slotKey);
    if (!prev || d < prev) firstBySlot.set(c.slotKey, d);
  }
  const doneDates = [...firstBySlot.values()];

  const currentMonday = mondayOf(today);
  const points: ForecastPoint[] = [];

  for (let i = vantageWeeks - 1; i >= 0; i--) {
    const vMondayIso = new Date(Date.parse(`${currentMonday}T12:00:00Z`) - i * 7 * DAY_MS)
      .toISOString().slice(0, 10);
    // The newest vantage is "today"; older ones sit on their Monday.
    const vDate = i === 0 ? today : (parseDay(vMondayIso) as Date);
    const asOf = i === 0 ? today.toISOString().slice(0, 10) : vMondayIso;

    let completedAsOf = 0;
    const byWeek = new Map<string, number>();
    for (const d of doneDates) {
      const dd = parseDay(d) as Date;
      if (dd > vDate) continue;
      completedAsOf++;
      const wk = mondayOf(dd);
      // Exclude the vantage's own (partial) week — mirrors summarizeGroup's fullWeeks.
      if (wk >= vMondayIso) continue;
      byWeek.set(wk, (byWeek.get(wk) ?? 0) + 1);
    }

    // Contiguous counts (incl. zero weeks) for the full weeks before the vantage week.
    const fullWeekCounts: number[] = [];
    for (let w = FORECAST_WINDOW_WEEKS; w >= 1; w--) {
      const wkIso = new Date(Date.parse(`${vMondayIso}T12:00:00Z`) - w * 7 * DAY_MS)
        .toISOString().slice(0, 10);
      fullWeekCounts.push(byWeek.get(wkIso) ?? 0);
    }

    const remaining = totalSlots - completedAsOf;
    const { forecastDate, forecastSuppressed } = projectForecastDate({ remaining, totalSlots, fullWeekCounts, today: vDate });
    points.push({ asOf, forecastDate, suppressed: forecastSuppressed });
  }

  return points;
}

/**
 * Net slip (days) between the first and last vantage points that HAVE a forecast —
 * positive = the projected finish drifted later over the window. Null when fewer
 * than two vantages carry a forecast.
 */
export function forecastSlipDays(points: ForecastPoint[]): number | null {
  const dated = points.filter(p => p.forecastDate);
  if (dated.length < 2) return null;
  const first = parseDay(dated[0].forecastDate) as Date;
  const last = parseDay(dated[dated.length - 1].forecastDate) as Date;
  return Math.round((last.getTime() - first.getTime()) / DAY_MS);
}

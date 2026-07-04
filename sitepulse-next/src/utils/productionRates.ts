import { parseDay, dayDiff, mondayOf } from '@/utils/progressAnalytics';
import { isActivityApplicable } from '@/utils/applicability';
import type { ApplicabilityIndex } from '@/utils/applicability';

/**
 * productionRates — pure, deterministic production-rate math for Scheduling
 * Analytics (Slice B, Phase 6). Turns dated completion history into a rate per
 * cost code / subcontractor / activity, and the open (not-yet-done) backlog those
 * rates burn down.
 *
 * A rate is measured one of two ways ({@link ProductionMeasure}):
 *   - 'locations' (DEFAULT in the UI) — count of locations completed per week.
 *     Needs NO drawing scale, so it works on every project and reads naturally
 *     ("8 apartments/week"). Area-less locations still count as one unit.
 *   - 'sf' — square feet completed per week, from `units.computed_area` (the
 *     Scale work). Better for area-driven trades, but only trustworthy once the
 *     drawing is calibrated; area-less locations are excluded (SF can't be faked).
 *
 * It EXTENDS the progressAnalytics vocabulary (imports `parseDay`/`dayDiff`/
 * `mondayOf`) rather than forking it (AGENTS.md §3). Applicability is respected
 * everywhere: an N/A (unit × activity) slot never enters a rate or backlog
 * denominator. Rates are suppressed (never fabricated) on tiny samples and zero
 * elapsed span. Never call `Date.now()` here — callers pass `today` / dated rows.
 */

/** How a production rate is quantified: count of locations, or square feet. */
export type ProductionMeasure = 'locations' | 'sf';

/** Below this many dated completion events, a keyed rate is too thin to publish. */
export const MIN_RATE_EVENTS = 3;

/** Minimal completed audit-log row (from `status_audit_log`, temporal_state='completed'). */
export interface CompletedAreaRow {
  unit_id: string | null;
  activity_id: string | null;
  logged_date: string | null;
  /** Optional — when present, only 'completed' rows are counted. */
  temporal_state?: string | null;
  track?: string | null;
}

/** A location with its drawn area (the SF quantity) + type (for applicability). */
export interface RateUnit {
  id: string;
  unit_type: string | null;
  computed_area: number | null;
}

/** The normalization identity of an activity: its cost code + assigned sub. */
export interface ActivityIdentity {
  costCodeId: string | null;
  subId: string | null;
}

/** Which axis to roll a rate up by. */
export type RateKey = 'costCodeId' | 'subId' | 'activityId';

/** One completed contribution: `sqFt` of `unitId` finished on `date` for this activity (0 when area-less). */
export interface AreaEvent {
  activityId: string;
  costCodeId: string | null;
  subId: string | null;
  unitId: string;
  /** The location's drawn area, or 0 when un-scaled/area-less (used only in 'sf' mode). */
  sqFt: number;
  /** 'YYYY-MM-DD' */
  date: string;
}

/**
 * Turn completed audit rows into dated completion events (applicable only).
 *
 * - Only 'completed' rows with a unit, activity and logged_date are kept.
 * - A slot (unit × activity) contributes ONCE — the audit log is append-only and
 *   can re-complete a slot, so we keep the EARLIEST completion (a floor is not
 *   built twice).
 * - In 'sf' mode a unit with null/≤0 area is dropped (SF can't be faked); in
 *   'locations' mode every applicable completion is kept (area-less counts as one).
 * - N/A (unit × activity) slots are always dropped (never enter a denominator).
 */
export function completedAreaEvents(
  rows: CompletedAreaRow[],
  units: RateUnit[],
  identity: Record<string, ActivityIdentity>,
  applicabilityIndex: ApplicabilityIndex,
  measure: ProductionMeasure = 'sf',
): AreaEvent[] {
  const unitById = new Map(units.map(u => [u.id, u]));

  // Dedupe to the earliest completion per slot.
  const earliestBySlot = new Map<string, CompletedAreaRow>();
  for (const r of rows) {
    if (r.temporal_state != null && r.temporal_state !== 'completed') continue;
    if (!r.unit_id || !r.activity_id || !r.logged_date) continue;
    const key = `${r.unit_id}_${r.activity_id}`;
    const prev = earliestBySlot.get(key);
    if (!prev || (prev.logged_date as string) > (r.logged_date as string)) {
      earliestBySlot.set(key, r);
    }
  }

  const out: AreaEvent[] = [];
  for (const r of earliestBySlot.values()) {
    const unit = unitById.get(r.unit_id as string);
    if (!unit) continue;
    const area = unit.computed_area;
    const hasArea = area != null && area > 0;
    if (measure === 'sf' && !hasArea) continue; // no SF to attribute — suppress, don't fake
    if (!isActivityApplicable({ id: r.activity_id as string }, unit, applicabilityIndex)) continue;
    const id = identity[r.activity_id as string] ?? { costCodeId: null, subId: null };
    out.push({
      activityId: r.activity_id as string,
      costCodeId: id.costCodeId,
      subId: id.subId,
      unitId: r.unit_id as string,
      sqFt: hasArea ? (area as number) : 0,
      date: (r.logged_date as string).slice(0, 10),
    });
  }
  return out;
}

export interface RateOpts {
  /** Attach a per-ISO-week series (Mon-start), oldest→newest, for a sparkline. */
  weekly?: boolean;
  /** Override the tiny-sample floor (default {@link MIN_RATE_EVENTS}). */
  minEvents?: number;
}

export interface ProductionRate {
  /** The grouped key value (a cost code id / sub id / activity id); '' for {@link rateForEvents}. */
  key: string;
  measure: ProductionMeasure;
  /** Total quantity: locations completed ('locations') or SF completed ('sf'). */
  total: number;
  eventCount: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Whole days from first to last completion (0 for a single day / single event). */
  spanDays: number;
  /** Quantity per 7-day week over the observed span, or null when suppressed. */
  perWeek: number | null;
  suppressed: 'tiny-sample' | 'zero-span' | null;
  weekly?: { weekStart: string; value: number }[];
}

/** The quantity one event contributes under a measure: its SF, or 1 location. */
function qtyOf(e: AreaEvent, measure: ProductionMeasure): number {
  return measure === 'sf' ? e.sqFt : 1;
}

/** Production rate of one already-grouped event list. Suppresses tiny-sample / zero-span. */
export function rateForEvents(events: AreaEvent[], measure: ProductionMeasure = 'sf', opts: RateOpts = {}): ProductionRate {
  const minEvents = opts.minEvents ?? MIN_RATE_EVENTS;
  const eventCount = events.length;
  const total = events.reduce((s, e) => s + qtyOf(e, measure), 0);

  if (eventCount === 0) {
    return { key: '', measure, total: 0, eventCount: 0, firstDate: null, lastDate: null, spanDays: 0, perWeek: null, suppressed: 'tiny-sample' };
  }

  const dates = events.map(e => e.date).sort();
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  const spanDays = dayDiff(parseDay(firstDate) as Date, parseDay(lastDate) as Date);

  let suppressed: ProductionRate['suppressed'] = null;
  let perWeek: number | null = null;
  if (eventCount < minEvents) suppressed = 'tiny-sample';
  else if (spanDays <= 0) suppressed = 'zero-span';
  else perWeek = total / (spanDays / 7);

  const result: ProductionRate = { key: '', measure, total, eventCount, firstDate, lastDate, spanDays, perWeek, suppressed };

  if (opts.weekly) {
    const byWeek = new Map<string, number>();
    for (const e of events) {
      const wk = mondayOf(parseDay(e.date) as Date);
      byWeek.set(wk, (byWeek.get(wk) ?? 0) + qtyOf(e, measure));
    }
    result.weekly = [...byWeek.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([weekStart, value]) => ({ weekStart, value }));
  }
  return result;
}

/**
 * Production rate grouped by cost code / sub / activity. Events whose key is null
 * (e.g. an un-coded activity for `key='costCodeId'`) are dropped — an un-coded
 * activity gets no cost-code rate. Sorted by total quantity desc (biggest scope first).
 */
export function productionRateBy(events: AreaEvent[], key: RateKey, measure: ProductionMeasure = 'sf', opts: RateOpts = {}): ProductionRate[] {
  const groups = new Map<string, AreaEvent[]>();
  for (const e of events) {
    const k = e[key];
    if (!k) continue;
    const arr = groups.get(k);
    if (arr) arr.push(e);
    else groups.set(k, [e]);
  }
  const out: ProductionRate[] = [];
  for (const [k, evs] of groups) {
    out.push({ ...rateForEvents(evs, measure, opts), key: k });
  }
  out.sort((a, b) => b.total - a.total);
  return out;
}

// ---------------------------------------------------------------------------
// Open backlog — the remaining work a rate has to burn down (drives required-rate)
// ---------------------------------------------------------------------------

/** The current status of a slot, as needed to decide "still open" + its deadline. */
export interface SlotStatus {
  temporal_state: string | null;
  planned_end_date: string | null;
}

/** One open (not-completed, applicable) slot: its remaining SF (0 when area-less) + planned finish. */
export interface OpenSlot {
  activityId: string;
  costCodeId: string | null;
  subId: string | null;
  unitId: string;
  sqFt: number;
  plannedEnd: string | null;
}

/**
 * The open backlog: every applicable (unit × activity) slot whose current status is
 * NOT completed, carrying the unit's area (0 when area-less) and the slot's planned
 * finish. `activities` should already be filtered to the track of interest. In 'sf'
 * mode units with null/≤0 area are skipped (no SF to remain); in 'locations' mode
 * every applicable open slot is kept. N/A slots are always skipped.
 */
export function openAreaSlots(
  units: RateUnit[],
  activities: Array<{ id: string } & { track?: string | null }>,
  identity: Record<string, ActivityIdentity>,
  statusBySlot: Map<string, SlotStatus>,
  applicabilityIndex: ApplicabilityIndex,
  measure: ProductionMeasure = 'sf',
): OpenSlot[] {
  const out: OpenSlot[] = [];
  for (const unit of units) {
    const area = unit.computed_area;
    const hasArea = area != null && area > 0;
    if (measure === 'sf' && !hasArea) continue;
    for (const a of activities) {
      if (!isActivityApplicable(a, unit, applicabilityIndex)) continue;
      const st = statusBySlot.get(`${unit.id}_${a.id}`);
      if (st?.temporal_state === 'completed') continue;
      const id = identity[a.id] ?? { costCodeId: null, subId: null };
      out.push({
        activityId: a.id,
        costCodeId: id.costCodeId,
        subId: id.subId,
        unitId: unit.id,
        sqFt: hasArea ? (area as number) : 0,
        plannedEnd: st?.planned_end_date ?? null,
      });
    }
  }
  return out;
}

/** Remaining quantity + deadline for one axis. `targetDate` = latest planned finish among the open slots. */
export interface RemainingArea {
  key: string;
  /** Remaining quantity: open locations ('locations') or open SF ('sf'). */
  remaining: number;
  openSlotCount: number;
  /** Max planned_end_date across the group's open slots (null when none is dated). */
  targetDate: string | null;
}

/** Roll the open backlog up by cost code / sub / activity (null keys dropped). */
export function remainingBy(slots: OpenSlot[], key: RateKey, measure: ProductionMeasure = 'sf'): RemainingArea[] {
  const groups = new Map<string, OpenSlot[]>();
  for (const s of slots) {
    const k = s[key];
    if (!k) continue;
    const arr = groups.get(k);
    if (arr) arr.push(s);
    else groups.set(k, [s]);
  }
  const out: RemainingArea[] = [];
  for (const [k, ss] of groups) {
    let remaining = 0;
    let targetDate: string | null = null;
    for (const s of ss) {
      remaining += measure === 'sf' ? s.sqFt : 1;
      if (s.plannedEnd && (!targetDate || s.plannedEnd > targetDate)) targetDate = s.plannedEnd;
    }
    out.push({ key: k, remaining, openSlotCount: ss.length, targetDate });
  }
  return out;
}

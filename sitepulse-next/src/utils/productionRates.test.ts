import { describe, it, expect } from 'vitest';
import {
  completedAreaEvents,
  rateForEvents,
  productionRateBy,
  openAreaSlots,
  remainingBy,
  MIN_RATE_EVENTS,
  type CompletedAreaRow,
  type RateUnit,
  type ActivityIdentity,
  type AreaEvent,
  type SlotStatus,
} from './productionRates';
import { buildApplicabilityIndex, EMPTY_APPLICABILITY_INDEX } from './applicability';
import type { Activity } from '@/types/domain';

// --- fixtures ---------------------------------------------------------------

const units: RateUnit[] = [
  { id: 'u1', unit_type: 'Apartment', computed_area: 1000 },
  { id: 'u2', unit_type: 'Apartment', computed_area: 500 },
  { id: 'u3', unit_type: 'Corridor', computed_area: 200 },
  { id: 'u4', unit_type: 'Apartment', computed_area: null }, // no area — SF mode drops it
];

// Activity identity: A1 = flooring (cost code cc-floor, sub sub-A), A2 = paint (uncoded, sub-B)
const identity: Record<string, ActivityIdentity> = {
  A1: { costCodeId: 'cc-floor', subId: 'sub-A' },
  A2: { costCodeId: null, subId: 'sub-B' },
};

function row(p: Partial<CompletedAreaRow>): CompletedAreaRow {
  return { unit_id: 'u1', activity_id: 'A1', logged_date: '2026-06-01', temporal_state: 'completed', track: 'Production', ...p };
}

describe('completedAreaEvents (SF mode)', () => {
  it('maps completed rows to dated area events with cost code + sub identity', () => {
    const events = completedAreaEvents(
      [row({ unit_id: 'u1', activity_id: 'A1', logged_date: '2026-06-01' })],
      units, identity, EMPTY_APPLICABILITY_INDEX, 'sf',
    );
    expect(events).toEqual([
      { activityId: 'A1', costCodeId: 'cc-floor', subId: 'sub-A', unitId: 'u1', sqFt: 1000, date: '2026-06-01' },
    ]);
  });

  it('drops a unit with no computed_area (SF cannot be faked)', () => {
    const events = completedAreaEvents([row({ unit_id: 'u4', activity_id: 'A1' })], units, identity, EMPTY_APPLICABILITY_INDEX, 'sf');
    expect(events).toEqual([]);
  });

  it('drops non-completed rows and rows missing unit/activity/date', () => {
    const events = completedAreaEvents([
      row({ temporal_state: 'ongoing' }),
      row({ unit_id: null }),
      row({ activity_id: null }),
      row({ logged_date: null }),
    ], units, identity, EMPTY_APPLICABILITY_INDEX, 'sf');
    expect(events).toEqual([]);
  });

  it('counts a slot ONCE using the earliest completion (append-only re-completions do not double-count)', () => {
    const events = completedAreaEvents([
      row({ unit_id: 'u1', activity_id: 'A1', logged_date: '2026-06-10' }),
      row({ unit_id: 'u1', activity_id: 'A1', logged_date: '2026-06-01' }),
    ], units, identity, EMPTY_APPLICABILITY_INDEX, 'sf');
    expect(events).toHaveLength(1);
    expect(events[0].date).toBe('2026-06-01');
    expect(events[0].sqFt).toBe(1000);
  });

  it('excludes N/A (unit × activity) slots from events', () => {
    const acts = [{ id: 'A1', applies_to_unit_types: ['Apartment'] }] as Pick<Activity, 'id' | 'applies_to_unit_types'>[];
    const index = buildApplicabilityIndex(acts, []);
    const events = completedAreaEvents([
      row({ unit_id: 'u1', activity_id: 'A1' }),
      row({ unit_id: 'u3', activity_id: 'A1' }), // Corridor — N/A
    ], units, identity, index, 'sf');
    expect(events.map(e => e.unitId)).toEqual(['u1']);
  });
});

describe('completedAreaEvents (locations mode)', () => {
  it('KEEPS an area-less location (it still counts as one unit)', () => {
    const events = completedAreaEvents([row({ unit_id: 'u4', activity_id: 'A1' })], units, identity, EMPTY_APPLICABILITY_INDEX, 'locations');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ unitId: 'u4', sqFt: 0 }); // area-less → sqFt 0, but counted
  });

  it('still excludes N/A slots', () => {
    const acts = [{ id: 'A1', applies_to_unit_types: ['Apartment'] }] as Pick<Activity, 'id' | 'applies_to_unit_types'>[];
    const index = buildApplicabilityIndex(acts, []);
    const events = completedAreaEvents([
      row({ unit_id: 'u1', activity_id: 'A1' }),
      row({ unit_id: 'u3', activity_id: 'A1' }), // Corridor — N/A
      row({ unit_id: 'u4', activity_id: 'A1' }), // area-less Apartment — kept
    ], units, identity, index, 'locations');
    expect(events.map(e => e.unitId).sort()).toEqual(['u1', 'u4']);
  });
});

describe('rateForEvents', () => {
  const mk = (date: string, sqFt = 100, activityId = 'A1'): AreaEvent =>
    ({ activityId, costCodeId: 'cc-floor', subId: 'sub-A', unitId: 'u', sqFt, date });

  it('computes SF/week over the observed span', () => {
    const r = rateForEvents([mk('2026-06-01', 100), mk('2026-06-04', 300), mk('2026-06-08', 300)], 'sf');
    expect(r.measure).toBe('sf');
    expect(r.total).toBe(700);
    expect(r.spanDays).toBe(7);
    expect(r.perWeek).toBeCloseTo(700, 6);
    expect(r.suppressed).toBeNull();
  });

  it('computes locations/week (each event = one location, area ignored)', () => {
    const r = rateForEvents([mk('2026-06-01', 100), mk('2026-06-04', 0), mk('2026-06-08', 999)], 'locations');
    expect(r.measure).toBe('locations');
    expect(r.total).toBe(3);           // 3 locations, regardless of area
    expect(r.perWeek).toBeCloseTo(3, 6); // 3 over a 7-day span
  });

  it('suppresses a tiny sample (< MIN_RATE_EVENTS)', () => {
    const evs = Array.from({ length: MIN_RATE_EVENTS - 1 }, (_, i) => mk(`2026-06-0${i + 1}`));
    const r = rateForEvents(evs, 'sf');
    expect(r.suppressed).toBe('tiny-sample');
    expect(r.perWeek).toBeNull();
    expect(r.total).toBeGreaterThan(0);
  });

  it('suppresses zero span (all completions on one day)', () => {
    const r = rateForEvents([mk('2026-06-01'), mk('2026-06-01'), mk('2026-06-01')], 'sf');
    expect(r.spanDays).toBe(0);
    expect(r.suppressed).toBe('zero-span');
    expect(r.perWeek).toBeNull();
  });

  it('handles an empty list as a suppressed zero', () => {
    const r = rateForEvents([], 'sf');
    expect(r).toMatchObject({ total: 0, eventCount: 0, perWeek: null, suppressed: 'tiny-sample' });
  });

  it('attaches a weekly series when asked (Mon-start buckets)', () => {
    const r = rateForEvents([mk('2026-06-01', 100), mk('2026-06-02', 100), mk('2026-06-09', 300)], 'sf', { weekly: true });
    expect(r.weekly).toEqual([
      { weekStart: '2026-06-01', value: 200 },
      { weekStart: '2026-06-08', value: 300 },
    ]);
  });
});

describe('productionRateBy', () => {
  const events: AreaEvent[] = [
    { activityId: 'A1', costCodeId: 'cc-floor', subId: 'sub-A', unitId: 'u1', sqFt: 400, date: '2026-06-01' },
    { activityId: 'A1', costCodeId: 'cc-floor', subId: 'sub-A', unitId: 'u2', sqFt: 300, date: '2026-06-05' },
    { activityId: 'A1', costCodeId: 'cc-floor', subId: 'sub-A', unitId: 'u3', sqFt: 300, date: '2026-06-08' },
    { activityId: 'A2', costCodeId: null, subId: 'sub-B', unitId: 'u1', sqFt: 999, date: '2026-06-02' },
  ];

  it('groups by cost code (SF) and drops null-key events', () => {
    const rates = productionRateBy(events, 'costCodeId', 'sf');
    expect(rates).toHaveLength(1);
    expect(rates[0].key).toBe('cc-floor');
    expect(rates[0].total).toBe(1000);
    expect(rates[0].perWeek).toBeCloseTo(1000, 6);
  });

  it('groups by cost code (locations) — count per week', () => {
    const rates = productionRateBy(events, 'costCodeId', 'locations');
    expect(rates[0].total).toBe(3);          // 3 locations
    expect(rates[0].perWeek).toBeCloseTo(3, 6);
  });

  it('groups by sub and keeps the un-coded activity (it still has a sub)', () => {
    const rates = productionRateBy(events, 'subId', 'sf');
    expect(rates.map(r => r.key).sort()).toEqual(['sub-A', 'sub-B']);
  });

  it('sorts biggest scope (total) first', () => {
    const rates = productionRateBy(events, 'activityId', 'sf');
    expect(rates[0].key).toBe('A1'); // 1000 SF
    expect(rates[1].key).toBe('A2'); // 999 SF
  });
});

describe('openAreaSlots / remainingBy', () => {
  const activities = [{ id: 'A1', track: 'Production' }, { id: 'A2', track: 'Production' }];

  it('SF mode collects not-completed applicable slots with area, skipping area-less units', () => {
    const statusBySlot = new Map<string, SlotStatus>([
      ['u1_A1', { temporal_state: 'completed', planned_end_date: '2026-06-01' }],
      ['u1_A2', { temporal_state: 'ongoing', planned_end_date: '2026-07-01' }],
      ['u2_A1', { temporal_state: 'none', planned_end_date: '2026-06-15' }],
    ]);
    const slots = openAreaSlots(units, activities, identity, statusBySlot, EMPTY_APPLICABILITY_INDEX, 'sf');
    // u4 (area-less) excluded in SF mode; u1_A1 done.
    const keySlots = slots.map(s => `${s.unitId}_${s.activityId}`).sort();
    expect(keySlots).toEqual(['u1_A2', 'u2_A1', 'u2_A2', 'u3_A1', 'u3_A2']);
  });

  it('locations mode includes area-less open slots', () => {
    const slots = openAreaSlots(units, [{ id: 'A1', track: 'Production' }], identity, new Map(), EMPTY_APPLICABILITY_INDEX, 'locations');
    expect(slots.map(s => s.unitId).sort()).toEqual(['u1', 'u2', 'u3', 'u4']); // u4 kept
  });

  it('remainingBy (SF) sums area and takes the LATEST planned finish as the deadline', () => {
    const statusBySlot = new Map<string, SlotStatus>([
      ['u2_A1', { temporal_state: 'none', planned_end_date: '2026-06-15' }],
      ['u3_A1', { temporal_state: 'none', planned_end_date: '2026-08-01' }],
    ]);
    const slots = openAreaSlots(units, [{ id: 'A1', track: 'Production' }], identity, statusBySlot, EMPTY_APPLICABILITY_INDEX, 'sf');
    const remaining = remainingBy(slots, 'costCodeId', 'sf');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].remaining).toBe(1700); // u1 1000 + u2 500 + u3 200
    expect(remaining[0].targetDate).toBe('2026-08-01');
  });

  it('remainingBy (locations) counts open slots', () => {
    const slots = openAreaSlots(units, [{ id: 'A1', track: 'Production' }], identity, new Map(), EMPTY_APPLICABILITY_INDEX, 'locations');
    const remaining = remainingBy(slots, 'costCodeId', 'locations');
    expect(remaining[0].remaining).toBe(4); // u1..u4 all open (incl. area-less u4)
  });

  it('excludes N/A slots from the backlog', () => {
    const acts = [{ id: 'A1', applies_to_unit_types: ['Apartment'] }] as Pick<Activity, 'id' | 'applies_to_unit_types'>[];
    const index = buildApplicabilityIndex(acts, []);
    const slots = openAreaSlots(units, [{ id: 'A1', track: 'Production' }], identity, new Map(), index, 'sf');
    expect(slots.map(s => s.unitId).sort()).toEqual(['u1', 'u2']); // Corridor N/A, u4 area-less
  });
});

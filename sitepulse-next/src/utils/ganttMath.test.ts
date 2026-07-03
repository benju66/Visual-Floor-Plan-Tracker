import { describe, it, expect } from 'vitest';
import type { Activity, StatusLog, Unit } from '@/types/domain';
import type { ApplicabilityIndex } from '@/utils/applicability';
import {
  addDays,
  toDayString,
  dateToX,
  xToDate,
  snapToDay,
  barRect,
  windowBounds,
  axisTicks,
  buildScheduleRows,
  clampEndAfterStart,
  checkDependencies,
  cascadeLevelToLocations,
  type BuildScheduleRowsParams,
} from '@/utils/ganttMath';

// UTC-noon date, matching the module's parsing model.
const day = (s: string) => new Date(`${s}T12:00:00Z`);
const TODAY = day('2026-06-15'); // a Monday

const mkUnit = (
  id: string,
  unit_type: string | null = 'Apartment'
): Pick<Unit, 'id' | 'unit_number' | 'unit_type' | 'sheet_id'> => ({
  id,
  unit_number: id,
  unit_type,
  sheet_id: 'sheet1',
});

const mkMs = (name: string, sequence_order: number, color = '#111'): Activity => ({
  id: `m_${name}`,
  project_id: 'p1',
  sequence_order,
  name,
  color,
  track: 'Construction',
  type: 'task',
  applies_to_unit_types: null,
  dictionary_id: null,
  subcontractor_id: null,
  created_at: null,
});

type LogPick = Pick<
  StatusLog,
  'unit_id' | 'track' | 'activityName' | 'temporal_state' | 'planned_start_date' | 'planned_end_date' | 'logged_date' | 'status_color'
>;
const mkLog = (o: Partial<LogPick> & { unit_id: string; activityName: string }): LogPick => ({
  unit_id: o.unit_id,
  track: o.track ?? 'Construction',
  activityName: o.activityName,
  temporal_state: o.temporal_state ?? 'none',
  planned_start_date: o.planned_start_date ?? null,
  planned_end_date: o.planned_end_date ?? null,
  logged_date: o.logged_date ?? null,
  status_color: o.status_color ?? '#abc',
});

describe('day helpers', () => {
  it('addDays stays on the UTC-noon grid and toDayString inverts it', () => {
    expect(toDayString(addDays(TODAY, 3))).toBe('2026-06-18');
    expect(toDayString(addDays(TODAY, -15))).toBe('2026-05-31');
    expect(toDayString(TODAY)).toBe('2026-06-15');
  });
});

describe('date <-> pixel mapping', () => {
  const ws = day('2026-06-15');
  it('dateToX measures whole days from the window start', () => {
    expect(dateToX(ws, ws, 10)).toBe(0);
    expect(dateToX(day('2026-06-18'), ws, 10)).toBe(30);
    expect(dateToX(day('2026-06-14'), ws, 10)).toBe(-10);
  });
  it('xToDate is the inverse (nearest day) and snapToDay rounds to the grid', () => {
    expect(toDayString(xToDate(30, ws, 10))).toBe('2026-06-18');
    expect(toDayString(xToDate(34, ws, 10))).toBe('2026-06-18'); // rounds down
    expect(toDayString(xToDate(36, ws, 10))).toBe('2026-06-19'); // rounds up
    expect(snapToDay(34, 10)).toBe(30);
    expect(snapToDay(36, 10)).toBe(40);
  });
});

describe('barRect', () => {
  const ws = day('2026-06-15');
  it('spans inclusive of the end day', () => {
    expect(barRect('2026-06-15', '2026-06-17', ws, 10)).toEqual({ x: 0, width: 30 });
  });
  it('renders a one-day marker when only one endpoint is present', () => {
    expect(barRect('2026-06-16', null, ws, 10)).toEqual({ x: 10, width: 10 });
    expect(barRect(null, '2026-06-16', ws, 10)).toEqual({ x: 10, width: 10 });
  });
  it('returns null when neither endpoint is present', () => {
    expect(barRect(null, null, ws, 10)).toBeNull();
  });
  it('takes min..max when end precedes start (geometry only)', () => {
    expect(barRect('2026-06-17', '2026-06-15', ws, 10)).toEqual({ x: 0, width: 30 });
  });
});

describe('windowBounds', () => {
  it('pads around the data and includes today', () => {
    const w = windowBounds(['2026-06-20'], TODAY);
    expect(toDayString(w.start)).toBe('2026-06-08'); // min(Jun20, Jun15) - 7
    // Jun20 + 7 = Jun27, span 19 < 28, so end widens to start + 28
    expect(toDayString(w.end)).toBe('2026-07-06');
  });
  it('still produces a usable window with no dates', () => {
    const w = windowBounds([], TODAY);
    expect(toDayString(w.start)).toBe('2026-06-08');
    expect(toDayString(w.end)).toBe('2026-07-06');
  });
});

describe('axisTicks', () => {
  it('emits one month-start tick per month, year-stamped in January', () => {
    const ticks = axisTicks(day('2026-01-01'), day('2026-03-31'), 'month');
    expect(ticks.map(t => t.label)).toEqual(['Jan 2026', 'Feb', 'Mar']);
    expect(ticks.every(t => t.major)).toBe(true);
  });
  it('emits one tick per Monday for week zoom', () => {
    const ticks = axisTicks(day('2026-06-01'), day('2026-06-30'), 'week');
    expect(ticks.map(t => t.label)).toEqual(['Jun 1', 'Jun 8', 'Jun 15', 'Jun 22', 'Jun 29']);
    expect(ticks[0].major).toBe(true); // first Monday of the month
    expect(ticks[1].major).toBe(false);
  });
  it('emits one tick per day for day zoom, major on Mondays', () => {
    const ticks = axisTicks(day('2026-06-15'), day('2026-06-17'), 'day');
    expect(ticks.map(t => t.label)).toEqual(['15', '16', '17']);
    expect(ticks[0].major).toBe(true); // Jun 15 is a Monday
    expect(ticks[1].major).toBe(false);
  });
});

describe('buildScheduleRows', () => {
  const activities = [mkMs('Framing', 0, '#f00'), mkMs('Drywall', 1, '#0f0'), mkMs('Paint', 2, '#00f')];
  const units = [mkUnit('u1'), mkUnit('u2')];

  it('builds one row per unit (order preserved), bars only for dated applicable slots', () => {
    const statuses = [
      mkLog({ unit_id: 'u1', activityName: 'Framing', temporal_state: 'completed', planned_start_date: '2026-06-01', planned_end_date: '2026-06-10', status_color: '#abc' }),
      mkLog({ unit_id: 'u1', activityName: 'Drywall', temporal_state: 'ongoing', planned_end_date: '2026-06-12', status_color: '' }),
      mkLog({ unit_id: 'u1', activityName: 'Paint', temporal_state: 'none' }), // no dates -> no bar
    ];
    const params: BuildScheduleRowsParams = { units, statuses, activities, track: 'Construction', today: TODAY };
    const rows = buildScheduleRows(params);

    expect(rows.map(r => r.unitId)).toEqual(['u1', 'u2']);
    expect(rows[1].bars).toHaveLength(0); // u2 has no logs

    const u1 = rows[0];
    expect(u1.bars.map(b => b.activityName)).toEqual(['Framing', 'Drywall']); // Paint dropped (no dates)
    expect(u1.bars[0].color).toBe('#abc'); // uses the slot's status_color
    expect(u1.bars[1].color).toBe('#0f0'); // empty status_color -> activity color
    expect(u1.bars[0].overdue).toBe(false); // completed
    expect(u1.bars[1].overdue).toBe(true); // ongoing, end 06-12 < today 06-15
  });

  it('excludes N/A (inapplicable) activities even when they carry dates', () => {
    const statuses = [
      mkLog({ unit_id: 'u1', activityName: 'Paint', temporal_state: 'planned', planned_start_date: '2026-06-20', planned_end_date: '2026-06-25' }),
    ];
    const index: ApplicabilityIndex = { rules: {}, overrides: { 'm_Paint_u1': false } };
    const rows = buildScheduleRows({ units: [mkUnit('u1')], statuses, activities, track: 'Construction', today: TODAY, applicabilityIndex: index });
    expect(rows[0].bars).toHaveLength(0);
  });
});

describe('clampEndAfterStart', () => {
  it('pulls end up to start when reversed; leaves valid/empty ranges alone', () => {
    expect(clampEndAfterStart('2026-06-10', '2026-06-05')).toEqual({ start: '2026-06-10', end: '2026-06-10' });
    expect(clampEndAfterStart('2026-06-01', '2026-06-10')).toEqual({ start: '2026-06-01', end: '2026-06-10' });
    expect(clampEndAfterStart('2026-06-01', null)).toEqual({ start: '2026-06-01', end: null });
  });
});

describe('checkDependencies', () => {
  const bar = (activityName: string, sequenceOrder: number, plannedStart: string | null, plannedEnd: string | null) => ({
    activity_id: `m_${activityName}`, activityName, track: 'Construction', color: '#000', temporalState: 'planned',
    plannedStart, plannedEnd, loggedDate: null, overdue: false, sequenceOrder,
  });
  it('flags a later activity that starts before an earlier one ends', () => {
    const issues = checkDependencies([bar('Framing', 0, '2026-06-01', '2026-06-10'), bar('Drywall', 1, '2026-06-08', '2026-06-15')]);
    expect(issues).toEqual([{ activityName: 'Drywall', predecessor: 'Framing' }]);
  });
  it('passes when each activity starts on/after the prior end', () => {
    const issues = checkDependencies([bar('Framing', 0, '2026-06-01', '2026-06-10'), bar('Drywall', 1, '2026-06-11', '2026-06-15')]);
    expect(issues).toHaveLength(0);
  });
});

describe('cascadeLevelToLocations', () => {
  const activities = [mkMs('Framing', 0, '#f00'), mkMs('Drywall', 1, '#0f0')];
  const levelSchedule = {
    Framing: { start_date: '2026-07-01', end_date: '2026-07-10' },
    Drywall: { start_date: '2026-07-11', end_date: '2026-07-20' },
  };
  const units = [mkUnit('u1'), mkUnit('u2'), mkUnit('u3')];
  // u1 already has its own Framing dates; u3's Drywall is in progress but undated.
  const existing = [
    mkLog({ unit_id: 'u1', activityName: 'Framing', temporal_state: 'planned', planned_start_date: '2026-06-01', planned_end_date: '2026-06-05' }),
    mkLog({ unit_id: 'u3', activityName: 'Drywall', temporal_state: 'ongoing', logged_date: '2026-06-05', status_color: '#zzz' }),
  ];
  // Framing is N/A for u3.
  const index: ApplicabilityIndex = { rules: {}, overrides: { 'm_Framing_u3': false } };

  it('non-destructive: skips units with their own dates and N/A slots; preserves progress', () => {
    const writes = cascadeLevelToLocations({ levelSchedule, units, activities, track: 'Construction', existing, applicabilityIndex: index });
    // Framing: u1 skipped (own dates), u3 skipped (N/A) -> only u2.
    // Drywall: u1, u2 (new) + u3 (undated, so eligible) -> 3.
    expect(writes).toHaveLength(4);

    const framing = writes.filter(w => w.activity_id === 'm_Framing');
    expect(framing.map(w => w.unit_id)).toEqual(['u2']);
    expect(framing[0].planned_start_date).toBe('2026-07-01');
    expect(framing[0].temporal_state).toBe('planned'); // fresh slot

    const u3Drywall = writes.find(w => w.activity_id === 'm_Drywall' && w.unit_id === 'u3');
    expect(u3Drywall?.temporal_state).toBe('ongoing'); // progress preserved
    expect(u3Drywall?.logged_date).toBe('2026-06-05');
    expect(u3Drywall?.planned_start_date).toBe('2026-07-11'); // level dates applied
    expect(u3Drywall?.status_color).toBe('#zzz'); // existing color preserved
  });

  it('overrideExisting replaces a unit\'s own dates too', () => {
    const writes = cascadeLevelToLocations({ levelSchedule, units, activities, track: 'Construction', existing, applicabilityIndex: index, overrideExisting: true });
    // Framing now includes u1 + u2 (u3 still N/A); Drywall u1+u2+u3 -> 5.
    expect(writes).toHaveLength(5);
    const u1Framing = writes.find(w => w.activity_id === 'm_Framing' && w.unit_id === 'u1');
    expect(u1Framing?.planned_start_date).toBe('2026-07-01'); // overwritten
    expect(u1Framing?.temporal_state).toBe('planned'); // prior state preserved
  });
});

import { describe, it, expect } from 'vitest';
import { buildBaselineSnapshot, baselineDelta, mergeLevelWindows } from '@/utils/scheduleBaseline';
import { isScheduleBaselineSnapshot } from '@/types/domain';
import type { ScheduleBaselineSnapshot } from '@/types/domain';

const mkStatus = (o: {
  unit_id: string; activity_id: string; track?: string;
  planned_start_date?: string | null; planned_end_date?: string | null;
}) => ({
  unit_id: o.unit_id,
  activity_id: o.activity_id,
  track: o.track ?? 'Construction',
  planned_start_date: o.planned_start_date ?? null,
  planned_end_date: o.planned_end_date ?? null,
});

describe('buildBaselineSnapshot', () => {
  const sheets = [
    { id: 's1', activity_schedules: { Framing: { start_date: '2026-07-01', end_date: '2026-07-10' } } },
    { id: 's2', activity_schedules: {} }, // empty — excluded
    { id: 's3', activity_schedules: null },
  ] as never[];

  it('captures level windows (non-empty sheets only) and dated slots only', () => {
    const statuses = [
      mkStatus({ unit_id: 'u1', activity_id: 'a1', planned_start_date: '2026-07-01', planned_end_date: '2026-07-03' }),
      mkStatus({ unit_id: 'u2', activity_id: 'a1' }), // undated — excluded
    ];
    const snap = buildBaselineSnapshot({ sheets, statuses });
    expect(snap.version).toBe(1);
    expect(Object.keys(snap.levels)).toEqual(['s1']);
    expect(snap.locations).toEqual([
      { unit_id: 'u1', activity_id: 'a1', planned_start_date: '2026-07-01', planned_end_date: '2026-07-03' },
    ]);
    expect(isScheduleBaselineSnapshot(snap)).toBe(true); // round-trips the guard
  });

  it('filters the location layer by track when given (levels always captured whole)', () => {
    const statuses = [
      mkStatus({ unit_id: 'u1', activity_id: 'a1', planned_start_date: '2026-07-01' }),
      mkStatus({ unit_id: 'u1', activity_id: 'a2', track: 'Closeout', planned_start_date: '2026-08-01' }),
    ];
    const snap = buildBaselineSnapshot({ sheets, statuses, track: 'Construction' });
    expect(snap.locations.map((l) => l.activity_id)).toEqual(['a1']);
    expect(Object.keys(snap.levels)).toEqual(['s1']);
    const all = buildBaselineSnapshot({ sheets, statuses, track: 'all' });
    expect(all.locations).toHaveLength(2);
  });
});

describe('baselineDelta', () => {
  const snap: ScheduleBaselineSnapshot = {
    version: 1,
    track: 'all',
    levels: { s1: { Framing: { start_date: '2026-07-01', end_date: '2026-07-10' } } },
    locations: [],
  };

  it('flags a window absent from the baseline as new', () => {
    expect(baselineDelta(snap, 's1', 'Drywall', '2026-07-11', '2026-07-20').kind).toBe('new');
    expect(baselineDelta(snap, 's9', 'Framing', '2026-07-01', '2026-07-10').kind).toBe('new');
  });

  it('flags an identical window as unchanged', () => {
    const d = baselineDelta(snap, 's1', 'Framing', '2026-07-01', '2026-07-10');
    expect(d.kind).toBe('unchanged');
    expect(d.startShiftDays).toBe(0);
    expect(d.endShiftDays).toBe(0);
  });

  it('reports endpoint shifts in days for a moved window (negative = earlier)', () => {
    const later = baselineDelta(snap, 's1', 'Framing', '2026-07-08', '2026-07-17');
    expect(later.kind).toBe('moved');
    expect(later.startShiftDays).toBe(7);
    expect(later.endShiftDays).toBe(7);
    const earlier = baselineDelta(snap, 's1', 'Framing', '2026-06-29', '2026-07-10');
    expect(earlier.startShiftDays).toBe(-2);
    expect(earlier.endShiftDays).toBe(0);
  });
});

describe('mergeLevelWindows', () => {
  it('folds rows into per-sheet schedules, coalescing one-sided dates, later row wins', () => {
    const merged = mergeLevelWindows([
      { sheetId: 's1', activityName: 'Framing', start: '2026-07-01', finish: '2026-07-10' },
      { sheetId: 's1', activityName: 'Drywall', start: '2026-07-11', finish: null }, // one-sided → same-day
      { sheetId: 's2', activityName: 'Framing', start: '2026-08-01', finish: '2026-08-05' },
      { sheetId: 's1', activityName: 'Framing', start: '2026-07-02', finish: '2026-07-11' }, // later wins
      { sheetId: 's1', activityName: 'Paint', start: null, finish: null }, // dateless → dropped
    ]);
    expect(merged['s1']['Framing']).toEqual({ start_date: '2026-07-02', end_date: '2026-07-11' });
    expect(merged['s1']['Drywall']).toEqual({ start_date: '2026-07-11', end_date: '2026-07-11' });
    expect(merged['s2']['Framing']).toEqual({ start_date: '2026-08-01', end_date: '2026-08-05' });
    expect(merged['s1']['Paint']).toBeUndefined();
  });
});

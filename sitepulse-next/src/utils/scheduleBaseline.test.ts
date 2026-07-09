import { describe, it, expect } from 'vitest';
import { buildBaselineSnapshot, baselineDelta, mergeLevelWindows, resolveCurrentBaseline, baselineSlotWindow, projectDriftSinceBaseline } from '@/utils/scheduleBaseline';
import { isScheduleBaselineSnapshot } from '@/types/domain';
import type { ScheduleBaseline, ScheduleBaselineSnapshot } from '@/types/domain';

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

describe('baselineSlotWindow', () => {
  const snap: ScheduleBaselineSnapshot = {
    version: 1,
    track: 'all',
    levels: {
      s1: {
        Framing: { start_date: '2026-07-01', end_date: '2026-07-10' },
        Paint: { start_date: null, end_date: null }, // present but dateless
        Drywall: { end_date: '2026-07-20' },          // one-sided
      },
    },
    locations: [],
  };

  it('returns the frozen level window for a present slot', () => {
    expect(baselineSlotWindow(snap, 's1', 'Framing')).toEqual({ start: '2026-07-01', end: '2026-07-10' });
  });

  it('returns a one-sided window with the missing side null', () => {
    expect(baselineSlotWindow(snap, 's1', 'Drywall')).toEqual({ start: null, end: '2026-07-20' });
  });

  it('returns null for a slot the baseline never carried (→ new)', () => {
    expect(baselineSlotWindow(snap, 's1', 'Trim')).toBeNull(); // activity absent
    expect(baselineSlotWindow(snap, 's9', 'Framing')).toBeNull(); // sheet absent
  });

  it('returns null for a present-but-dateless entry', () => {
    expect(baselineSlotWindow(snap, 's1', 'Paint')).toBeNull();
  });

  it('is deterministic — same inputs, same output', () => {
    expect(baselineSlotWindow(snap, 's1', 'Framing')).toEqual(baselineSlotWindow(snap, 's1', 'Framing'));
  });
});

describe('projectDriftSinceBaseline', () => {
  const snap: ScheduleBaselineSnapshot = {
    version: 1,
    track: 'all',
    levels: {
      s1: { Framing: { start_date: '2026-07-01', end_date: '2026-07-10' } },
      s2: { Drywall: { start_date: '2026-07-05', end_date: '2026-07-20' } }, // latest end → baseline finish
    },
    locations: [
      // A later location end must NOT be used — the drift is a Layer-1 (level) read.
      { unit_id: 'u1', activity_id: 'a1', planned_start_date: null, planned_end_date: '2026-09-01' },
    ],
  };

  it('is null when the baseline froze no level window', () => {
    const empty: ScheduleBaselineSnapshot = { version: 1, track: 'all', levels: {}, locations: [] };
    expect(projectDriftSinceBaseline(empty, '2026-08-01').days).toBeNull();
  });

  it('is null when the current planned finish is missing', () => {
    expect(projectDriftSinceBaseline(snap, null).days).toBeNull();
  });

  it('is positive when the current plan finishes LATER than the baseline (slipped)', () => {
    // baseline finish = 2026-07-20 (the latest level end across sheets)
    expect(projectDriftSinceBaseline(snap, '2026-07-30').days).toBe(10);
  });

  it('is negative when the current plan finishes EARLIER than the baseline (pulled in)', () => {
    expect(projectDriftSinceBaseline(snap, '2026-07-15').days).toBe(-5);
  });

  it('is 0 when the current finish equals the baseline finish', () => {
    expect(projectDriftSinceBaseline(snap, '2026-07-20').days).toBe(0);
  });

  it('reads the baseline finish from the LEVEL layer, not a later location end', () => {
    // The location layer carries a 2026-09-01 end; the drift must ignore it and
    // use the level max (2026-07-20), so equal-to-level-max reads 0, not negative.
    expect(projectDriftSinceBaseline(snap, '2026-07-20').days).toBe(0);
  });
});

describe('resolveCurrentBaseline', () => {
  const validSnap: ScheduleBaselineSnapshot = { version: 1, track: 'all', levels: {}, locations: [] };
  const mkRow = (o: { id: string; created_at: string; snapshot?: unknown; name?: string }) => ({
    id: o.id,
    project_id: 'p1',
    name: o.name ?? 'Baseline',
    track: 'all',
    snapshot: o.snapshot ?? validSnap,
    created_by: null,
    created_at: o.created_at,
  }) as ScheduleBaseline;

  it('returns null when there are no baselines', () => {
    expect(resolveCurrentBaseline([])).toBeNull();
  });

  it('picks the newest by created_at regardless of input order', () => {
    const rows = [
      mkRow({ id: 'old', created_at: '2026-07-01T00:00:00Z', name: 'Old' }),
      mkRow({ id: 'new', created_at: '2026-07-09T00:00:00Z', name: 'New' }),
      mkRow({ id: 'mid', created_at: '2026-07-05T00:00:00Z', name: 'Mid' }),
    ];
    const current = resolveCurrentBaseline(rows);
    expect(current?.row.id).toBe('new');
    expect(current?.row.name).toBe('New');
    expect(current?.snapshot).toBe(validSnap);
  });

  it('degrades to null when the newest snapshot is malformed (never falls back to an older valid one)', () => {
    const rows = [
      mkRow({ id: 'old', created_at: '2026-07-01T00:00:00Z' }), // valid but older
      mkRow({ id: 'new', created_at: '2026-07-09T00:00:00Z', snapshot: { version: 2, junk: true } }),
    ];
    expect(resolveCurrentBaseline(rows)).toBeNull();
  });

  it('narrows a single valid baseline', () => {
    const current = resolveCurrentBaseline([mkRow({ id: 'only', created_at: '2026-07-03T00:00:00Z' })]);
    expect(current?.row.id).toBe('only');
    expect(isScheduleBaselineSnapshot(current?.snapshot)).toBe(true);
  });
});

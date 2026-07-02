import { describe, it, expect } from 'vitest';
import {
  matchTasksToActivities,
  suggestSheetForTask,
  subdivideTaskWindow,
  buildImportWrites,
  type ReconcileActivity,
  type TargetUnit,
} from './scheduleReconcile';
import type { ActivityDictionaryEntry } from '@/types/domain';
import { EMPTY_APPLICABILITY_INDEX, type ApplicabilityIndex } from '@/utils/applicability';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function activity(over: Partial<ReconcileActivity> & { id: string; name: string }): ReconcileActivity {
  return { track: 'Construction', color: '#38bdf8', dictionary_id: null, ...over };
}

function dictEntry(over: Partial<ActivityDictionaryEntry> & { id: string; name: string }): ActivityDictionaryEntry {
  return {
    status: 'active',
    aliases: [],
    default_project_types: [],
    track: null,
    type: 'task',
    cost_code_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  } as ActivityDictionaryEntry;
}

function unit(id: string, over: Partial<TargetUnit> = {}): TargetUnit {
  return { id, unit_number: id.toUpperCase(), unit_type: 'Unit', computed_area: null, walk_sequence: null, ...over };
}

const task = (uid: string, name: string, path: string[] = []) => ({ uid, name, path });

// ---------------------------------------------------------------------------
// matchTasksToActivities
// ---------------------------------------------------------------------------

describe('matchTasksToActivities', () => {
  const insulation = activity({ id: 'a-ins', name: 'Insulation' });
  const drywall = activity({ id: 'a-dw', name: 'Drywall' });
  const drywallHang = activity({ id: 'a-dwh', name: 'Drywall Hang' });
  const mepRough = activity({ id: 'a-mep', name: 'MEP Rough-In', dictionary_id: 'dict-mep' });
  const dictionary = [
    dictEntry({ id: 'dict-mep', name: 'MEP Rough-In', aliases: ['Rough-Ins', 'MEPFP Rough In'] }),
  ];

  it('matches exactly, case- and whitespace-insensitively', () => {
    const [m] = matchTasksToActivities([task('1', '  INSULATION ')], [insulation], []);
    expect(m).toEqual({ taskUid: '1', activityId: 'a-ins', matchKind: 'exact' });
  });

  it('matches through a dictionary alias to the LINKED project activity', () => {
    const [m] = matchTasksToActivities([task('2', 'ROUGH-INS')], [insulation, mepRough], dictionary);
    expect(m).toEqual({ taskUid: '2', activityId: 'a-mep', matchKind: 'alias' });
  });

  it('an alias whose entry no project activity links stays unmatched', () => {
    const [m] = matchTasksToActivities([task('3', 'ROUGH-INS')], [insulation], dictionary);
    expect(m).toEqual({ taskUid: '3', activityId: null, matchKind: null });
  });

  it('falls back to containment (fuzzy), preferring the longest activity name', () => {
    const [m] = matchTasksToActivities([task('4', 'DRYWALL HANGING - EAST')], [drywall, drywallHang], []);
    expect(m).toEqual({ taskUid: '4', activityId: 'a-dwh', matchKind: 'fuzzy' });
  });

  it('never fuzzy-matches names shorter than 4 characters', () => {
    const sog = activity({ id: 'a-sog', name: 'SOG' });
    const [contained] = matchTasksToActivities([task('5', 'SOG PLACEMENT')], [sog], []);
    expect(contained.activityId).toBeNull();
    // ...but a 3-char EXACT match still works.
    const [exact] = matchTasksToActivities([task('6', 'sog')], [sog], []);
    expect(exact).toEqual({ taskUid: '6', activityId: 'a-sog', matchKind: 'exact' });
  });

  it('leaves everything else unmatched for the human', () => {
    const [m] = matchTasksToActivities([task('7', 'MASS GRADING')], [insulation, drywall], dictionary);
    expect(m).toEqual({ taskUid: '7', activityId: null, matchKind: null });
  });
});

// ---------------------------------------------------------------------------
// suggestSheetForTask
// ---------------------------------------------------------------------------

describe('suggestSheetForTask', () => {
  const sheets = [
    { id: 's1', sheet_name: 'Level 1' },
    { id: 's2', sheet_name: 'Level 2' },
    { id: 's4', sheet_name: 'Level 4' },
  ];

  it('reads the level from the summary chain (innermost ancestor first)', () => {
    const t = { name: 'INSULATION', path: ['ORCHARD PATH III', 'INTERIOR FINISHES', 'LEVEL 4 FINISHES (19 UNITS)'] };
    expect(suggestSheetForTask(t, sheets)).toBe('s4');
  });

  it('the task own name wins over its ancestors', () => {
    const t = { name: 'WOOD FRAMING - LEVEL 2 - WALL PANELS', path: ['LEVEL 4 FINISHES (19 UNITS)'] };
    expect(suggestSheetForTask(t, sheets)).toBe('s2');
  });

  it('understands ordinal floor spellings', () => {
    const t = { name: 'FINAL PLUMBING - 4TH FLOOR', path: [] };
    expect(suggestSheetForTask(t, sheets)).toBe('s4');
  });

  it('returns null when no level is named, or when the match is ambiguous', () => {
    expect(suggestSheetForTask({ name: 'ROOFING', path: ['BUILDING ENVELOPE'] }, sheets)).toBeNull();
    const twoLevelFours = [...sheets, { id: 's4b', sheet_name: 'Bldg B — Level 4' }];
    const t = { name: 'INSULATION', path: ['LEVEL 4 FINISHES'] };
    expect(suggestSheetForTask(t, twoLevelFours)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// subdivideTaskWindow
// ---------------------------------------------------------------------------

describe('subdivideTaskWindow', () => {
  it('splits an 8-day window evenly across 4 units without area data', () => {
    const units = [unit('u1'), unit('u2'), unit('u3'), unit('u4')];
    const { windows, weighting } = subdivideTaskWindow('2025-01-01', '2025-01-08', units, 'subdivide');
    expect(weighting).toBe('even');
    expect(windows).toEqual([
      { unitId: 'u1', start: '2025-01-01', end: '2025-01-02' },
      { unitId: 'u2', start: '2025-01-03', end: '2025-01-04' },
      { unitId: 'u3', start: '2025-01-05', end: '2025-01-06' },
      { unitId: 'u4', start: '2025-01-07', end: '2025-01-08' },
    ]);
  });

  it('weights by computed_area when EVERY unit has one', () => {
    const units = [
      unit('small', { computed_area: 100, walk_sequence: 1 }),
      unit('big', { computed_area: 300, walk_sequence: 2 }),
    ];
    const { windows, weighting } = subdivideTaskWindow('2025-01-01', '2025-01-04', units, 'subdivide');
    expect(weighting).toBe('area');
    expect(windows).toEqual([
      { unitId: 'small', start: '2025-01-01', end: '2025-01-01' },
      { unitId: 'big', start: '2025-01-02', end: '2025-01-04' },
    ]);
  });

  it('degrades to an even split when ANY unit lacks area (no faked weights)', () => {
    const units = [unit('u1', { computed_area: 100 }), unit('u2', { computed_area: null })];
    const { windows, weighting } = subdivideTaskWindow('2025-01-01', '2025-01-04', units, 'subdivide');
    expect(weighting).toBe('even');
    expect(windows).toEqual([
      { unitId: 'u1', start: '2025-01-01', end: '2025-01-02' },
      { unitId: 'u2', start: '2025-01-03', end: '2025-01-04' },
    ]);
  });

  it('orders by walk_sequence (nulls last), then unit number — numerically aware', () => {
    const units = [
      unit('u-late', { unit_number: 'Unit 2', walk_sequence: null }),
      unit('u-second', { unit_number: 'Unit 10', walk_sequence: 2 }),
      unit('u-first', { unit_number: 'Unit 9', walk_sequence: 1 }),
      unit('u-last', { unit_number: 'Unit 10', walk_sequence: null }),
    ];
    const { windows } = subdivideTaskWindow('2025-01-01', '2025-01-04', units, 'subdivide');
    expect(windows.map((w) => w.unitId)).toEqual(['u-first', 'u-second', 'u-late', 'u-last']);
  });

  it('gives every unit at least its start day when the window is shorter than the crew flow', () => {
    const units = [unit('u1'), unit('u2'), unit('u3')];
    const { windows } = subdivideTaskWindow('2025-01-01', '2025-01-01', units, 'subdivide');
    expect(windows).toEqual([
      { unitId: 'u1', start: '2025-01-01', end: '2025-01-01' },
      { unitId: 'u2', start: '2025-01-01', end: '2025-01-01' },
      { unitId: 'u3', start: '2025-01-01', end: '2025-01-01' },
    ]);
  });

  it('envelope mode gives every unit the full window', () => {
    const units = [unit('u1'), unit('u2')];
    const { windows, weighting } = subdivideTaskWindow('2025-01-01', '2025-01-08', units, 'envelope');
    expect(weighting).toBe('envelope');
    expect(windows).toEqual([
      { unitId: 'u1', start: '2025-01-01', end: '2025-01-08' },
      { unitId: 'u2', start: '2025-01-01', end: '2025-01-08' },
    ]);
  });

  it('normalizes a swapped start/end and rejects unparseable dates', () => {
    const { windows } = subdivideTaskWindow('2025-01-08', '2025-01-01', [unit('u1')], 'envelope');
    expect(windows).toEqual([{ unitId: 'u1', start: '2025-01-01', end: '2025-01-08' }]);
    expect(subdivideTaskWindow('garbage', '2025-01-01', [unit('u1')], 'subdivide').windows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildImportWrites
// ---------------------------------------------------------------------------

describe('buildImportWrites', () => {
  const paint = activity({ id: 'a-paint', name: 'Painting', color: '#f59e0b' });
  const window = { uid: 't1', start: '2025-01-01', finish: '2025-01-04' };

  it('builds upsert rows with the activity id/track and a planned temporal state', () => {
    const plan = buildImportWrites(
      [{ task: window, activity: paint, units: [unit('u1'), unit('u2')], mode: 'envelope' }],
      { existing: [] },
    );
    expect(plan.writes).toHaveLength(2);
    expect(plan.affectedUnitCount).toBe(2);
    expect(plan.writes[0]).toEqual({
      unit_id: 'u1',
      track: 'Construction',
      activity_id: 'a-paint',
      status_color: '#f59e0b',
      temporal_state: 'planned',
      planned_start_date: '2025-01-01',
      planned_end_date: '2025-01-04',
      logged_date: null,
    });
  });

  it('skips slots that already have their own planned dates (non-destructive default)', () => {
    const existing = [
      {
        unit_id: 'u1',
        activity_id: 'a-paint',
        planned_start_date: '2024-12-01',
        planned_end_date: null,
        temporal_state: 'in_progress',
        logged_date: '2024-12-02',
        status_color: '#ff0000',
      },
    ];
    const plan = buildImportWrites(
      [{ task: window, activity: paint, units: [unit('u1'), unit('u2')], mode: 'envelope' }],
      { existing },
    );
    expect(plan.writes.map((w) => w.unit_id)).toEqual(['u2']);
    expect(plan.skippedExisting).toBe(1);
  });

  it('overrideExisting overwrites the window but PRESERVES progress fields', () => {
    const existing = [
      {
        unit_id: 'u1',
        activity_id: 'a-paint',
        planned_start_date: '2024-12-01',
        planned_end_date: '2024-12-05',
        temporal_state: 'completed',
        logged_date: '2024-12-04',
        status_color: '#ff0000',
      },
    ];
    const plan = buildImportWrites(
      [{ task: window, activity: paint, units: [unit('u1')], mode: 'envelope' }],
      { existing, overrideExisting: true },
    );
    expect(plan.writes).toEqual([
      {
        unit_id: 'u1',
        track: 'Construction',
        activity_id: 'a-paint',
        status_color: '#ff0000',
        temporal_state: 'completed',
        planned_start_date: '2025-01-01',
        planned_end_date: '2025-01-04',
        logged_date: '2024-12-04',
      },
    ]);
    expect(plan.skippedExisting).toBe(0);
  });

  it('never writes N/A slots (applicability respected)', () => {
    const index: ApplicabilityIndex = { rules: { 'a-paint': ['Unit'] }, overrides: {} };
    const units = [unit('u1', { unit_type: 'Unit' }), unit('u2', { unit_type: 'Corridor' })];
    const plan = buildImportWrites(
      [{ task: window, activity: paint, units, mode: 'envelope' }],
      { existing: [], applicabilityIndex: index },
    );
    expect(plan.writes.map((w) => w.unit_id)).toEqual(['u1']);
    expect(plan.skippedNotApplicable).toBe(1);
  });

  it('subdivides through the applicable units only', () => {
    const index: ApplicabilityIndex = { rules: { 'a-paint': ['Unit'] }, overrides: {} };
    const units = [
      unit('u1', { unit_type: 'Unit', unit_number: 'A' }),
      unit('skip', { unit_type: 'Corridor', unit_number: 'B' }),
      unit('u2', { unit_type: 'Unit', unit_number: 'C' }),
    ];
    const plan = buildImportWrites(
      [{ task: window, activity: paint, units, mode: 'subdivide' }],
      { existing: [], applicabilityIndex: index },
    );
    // The 4-day window splits across the TWO applicable units, 2 days each.
    expect(plan.writes).toHaveLength(2);
    expect(plan.writes[0]).toMatchObject({ unit_id: 'u1', planned_start_date: '2025-01-01', planned_end_date: '2025-01-02' });
    expect(plan.writes[1]).toMatchObject({ unit_id: 'u2', planned_start_date: '2025-01-03', planned_end_date: '2025-01-04' });
  });

  it('a dateless task writes nothing; a start-only task writes a same-day window', () => {
    const none = buildImportWrites(
      [{ task: { uid: 't', start: null, finish: null }, activity: paint, units: [unit('u1')], mode: 'envelope' }],
      { existing: [] },
    );
    expect(none.writes).toEqual([]);

    const startOnly = buildImportWrites(
      [{ task: { uid: 't', start: '2025-02-01', finish: null }, activity: paint, units: [unit('u1')], mode: 'envelope' }],
      { existing: [] },
    );
    expect(startOnly.writes[0]).toMatchObject({ planned_start_date: '2025-02-01', planned_end_date: '2025-02-01' });
  });

  it('the later assignment wins when two tasks map to the same slot', () => {
    const plan = buildImportWrites(
      [
        { task: { uid: 't1', start: '2025-01-01', finish: '2025-01-02' }, activity: paint, units: [unit('u1')], mode: 'envelope' },
        { task: { uid: 't2', start: '2025-03-01', finish: '2025-03-02' }, activity: paint, units: [unit('u1')], mode: 'envelope' },
      ],
      { existing: [] },
    );
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]).toMatchObject({ planned_start_date: '2025-03-01', planned_end_date: '2025-03-02' });
  });
});

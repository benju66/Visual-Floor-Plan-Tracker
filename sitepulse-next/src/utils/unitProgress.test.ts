import { describe, it, expect } from 'vitest';
import type { Activity, StatusLog, Unit } from '@/types/domain';
import { buildApplicabilityIndex } from './applicability';
import {
  summarizeUnit,
  summarizeSheetProgress,
  countUnitsByCurrentActivity,
} from './unitProgress';

const TRACK = 'Production';

function activity(id: string, name: string, appliesTo: string[] | null = null): Activity {
  return {
    id,
    name,
    color: 'rgba(0,0,0,0.5)',
    track: TRACK,
    sequence_order: Number(id.replace(/\D/g, '')) || 0,
    project_id: 'p1',
    applies_to_unit_types: appliesTo,
    created_at: null,
  } as Activity;
}

function unit(id: string, unit_type: string | null): Unit {
  return { id, unit_type, sheet_id: 'sheet1' } as Unit;
}

function log(unitId: string, activityName: string, state: string): StatusLog {
  return {
    id: `${unitId}_${activityName}`,
    unit_id: unitId,
    activityName: activityName,
    status_color: 'rgba(0,0,0,0.5)',
    temporal_state: state,
    track: TRACK,
    planned_start_date: null,
    planned_end_date: null,
    logged_date: null,
    client_timestamp: null,
    created_at: null,
  } as StatusLog;
}

const M = [activity('m1', 'Framing'), activity('m2', 'Drywall'), activity('m3', 'Paint')];
const EMPTY_INDEX = buildApplicabilityIndex(M, []);

describe('summarizeUnit', () => {
  it('counts completed applicable activities and reports the bottleneck stage', () => {
    const u = unit('u1', '2 Bed');
    const statuses = [log('u1', 'Framing', 'completed'), log('u1', 'Drywall', 'ongoing')];
    const s = summarizeUnit(u, statuses, M, EMPTY_INDEX, TRACK);
    expect(s.totalCount).toBe(3);
    expect(s.doneCount).toBe(1);
    expect(s.currentActivityName).toBe('Drywall');
    expect(s.stage).toBe('ongoing');
  });

  it("reports stage 'done' when every applicable activity is completed", () => {
    const u = unit('u2', 'Studio');
    const statuses = M.map(m => log('u2', m.name, 'completed'));
    const s = summarizeUnit(u, statuses, M, EMPTY_INDEX, TRACK);
    expect(s.doneCount).toBe(3);
    expect(s.stage).toBe('done');
    expect(s.currentActivityName).toBeNull();
  });

  it('excludes N/A activities (per-unit override) from the denominator', () => {
    const u = unit('u3', 'Common');
    // Drywall marked Not Applicable for this unit
    const index = buildApplicabilityIndex(M, [
      { activity_id: 'm2', unit_id: 'u3', is_applicable: false },
    ]);
    const statuses = [log('u3', 'Framing', 'completed'), log('u3', 'Paint', 'completed')];
    const s = summarizeUnit(u, statuses, M, index, TRACK);
    expect(s.totalCount).toBe(2); // Drywall excluded
    expect(s.doneCount).toBe(2);
    expect(s.stage).toBe('done');
  });

  it('respects unit-type rules but fails open for untyped units', () => {
    const rules = [activity('m1', 'Framing', ['2 Bed'])]; // applies only to 2 Bed
    const index = buildApplicabilityIndex(rules, []);
    expect(summarizeUnit(unit('a', 'Studio'), [], rules, index, TRACK).totalCount).toBe(0);
    expect(summarizeUnit(unit('b', null), [], rules, index, TRACK).totalCount).toBe(1);
  });

  it('returns an empty summary when no activities apply', () => {
    const s = summarizeUnit(unit('z', '2 Bed'), [], [], EMPTY_INDEX, TRACK);
    expect(s).toEqual({ unitId: 'z', totalCount: 0, doneCount: 0, currentActivityName: null, stage: 'none' });
  });
});

describe('summarizeSheetProgress', () => {
  it('rolls up slots and buckets across units', () => {
    const units = [unit('u1', '2 Bed'), unit('u2', 'Studio'), unit('u3', 'Common')];
    const index = buildApplicabilityIndex(M, [
      { activity_id: 'm2', unit_id: 'u3', is_applicable: false },
    ]);
    const statuses = [
      log('u1', 'Framing', 'completed'),
      log('u1', 'Drywall', 'ongoing'),
      ...M.map(m => log('u2', m.name, 'completed')),
      log('u3', 'Framing', 'completed'),
      log('u3', 'Paint', 'completed'),
    ];
    const p = summarizeSheetProgress(units, statuses, M, index, TRACK);
    expect(p.totalUnits).toBe(3);
    expect(p.slots).toEqual({ completed: 6, total: 8 });
    expect(p.percentComplete).toBe(75);
    expect(p.buckets).toEqual({ done: 2, ongoing: 1, planned: 0, none: 0 });
  });

  it('handles an empty sheet without dividing by zero', () => {
    const p = summarizeSheetProgress([], [], M, EMPTY_INDEX, TRACK);
    expect(p.percentComplete).toBe(0);
    expect(p.slots).toEqual({ completed: 0, total: 0 });
    expect(p.buckets).toEqual({ done: 0, ongoing: 0, planned: 0, none: 0 });
  });
});

describe('countUnitsByCurrentActivity', () => {
  it('tallies units by their bottleneck activity', () => {
    const units = [unit('u1', '2 Bed'), unit('u2', '2 Bed'), unit('u3', 'Studio')];
    const statuses = [
      log('u1', 'Framing', 'completed'), // bottleneck Drywall
      log('u2', 'Framing', 'ongoing'), // bottleneck Framing
      ...M.map(m => log('u3', m.name, 'completed')), // done -> no bottleneck
    ];
    const counts = countUnitsByCurrentActivity(units, statuses, M, EMPTY_INDEX, TRACK);
    expect(counts).toEqual({ Drywall: 1, Framing: 1 });
  });
});

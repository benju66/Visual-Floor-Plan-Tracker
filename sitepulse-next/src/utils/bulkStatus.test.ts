import { describe, it, expect } from 'vitest';
import type { Unit, StatusLog } from '@/types/domain';
import { buildBulkStatusChanges } from './bulkStatus';

function unit(id: string, unit_number = id): Unit {
  return { id, unit_number, unit_type: 'Apartment', assigned_to: null } as unknown as Unit;
}
function log(p: Partial<StatusLog>): StatusLog {
  return { unit_id: '', activityName: '', track: 'Production', temporal_state: 'none', ...p } as unknown as StatusLog;
}

const UNITS = [unit('1'), unit('2'), unit('3')];
const CARPET = { id: 'act-carpet', name: 'Carpet', color: '#10b981', track: 'Production' };
const CAP = '2026-06-15T12:00:00.000Z';

describe('buildBulkStatusChanges', () => {
  it('stages one timeline entry per unit, keyed `${id}_${activity}` with the activityObj + state', () => {
    const out = buildBulkStatusChanges({
      unitIds: ['1', '2'],
      units: UNITS,
      currentLogs: [],
      activity: CARPET,
      state: 'completed',
      capturedAt: CAP,
    });
    expect(Object.keys(out).sort()).toEqual(['1_Carpet', '2_Carpet']);
    expect(out['1_Carpet']).toMatchObject({
      unit: { id: '1' },
      log: null,
      state: 'completed',
      capturedAt: CAP,
      extraProps: { activityObj: CARPET },
    });
  });

  it('attaches the unit\'s existing log for that activity+track when present (else null)', () => {
    const existing = log({ unit_id: '1', activityName: 'Carpet', track: 'Production', temporal_state: 'ongoing', planned_start_date: '2026-06-01' });
    const wrongActivity = log({ unit_id: '2', activityName: 'Drywall', track: 'Production' });
    const out = buildBulkStatusChanges({
      unitIds: ['1', '2'],
      units: UNITS,
      currentLogs: [existing, wrongActivity],
      activity: CARPET,
      state: 'completed',
      capturedAt: CAP,
    });
    expect(out['1_Carpet'].log).toBe(existing);
    expect(out['2_Carpet'].log).toBeNull(); // no Carpet log for unit 2
  });

  it('does not match a log from a different track', () => {
    const inspection = log({ unit_id: '1', activityName: 'Carpet', track: 'Inspection', temporal_state: 'completed' });
    const out = buildBulkStatusChanges({
      unitIds: ['1'], units: UNITS, currentLogs: [inspection], activity: CARPET, state: 'planned', capturedAt: CAP,
    });
    expect(out['1_Carpet'].log).toBeNull();
  });

  it('includes provided dates and omits undefined ones', () => {
    const out = buildBulkStatusChanges({
      unitIds: ['1'], units: UNITS, currentLogs: [], activity: CARPET, state: 'completed', capturedAt: CAP,
      startDate: '2026-06-10', loggedDate: '2026-06-14',
    });
    const ep = out['1_Carpet'].extraProps;
    expect(ep.startDate).toBe('2026-06-10');
    expect(ep.loggedDate).toBe('2026-06-14');
    expect('endDate' in ep).toBe(false); // undefined → omitted
  });

  it('skips unknown unit ids (stale selection) without throwing', () => {
    const out = buildBulkStatusChanges({
      unitIds: ['1', 'ghost', '3'], units: UNITS, currentLogs: [], activity: CARPET, state: 'ongoing', capturedAt: CAP,
    });
    expect(Object.keys(out).sort()).toEqual(['1_Carpet', '3_Carpet']);
  });

  it('stamps one consistent capturedAt across every unit in the batch', () => {
    const out = buildBulkStatusChanges({
      unitIds: ['1', '2', '3'], units: UNITS, currentLogs: [], activity: CARPET, state: 'completed', capturedAt: CAP,
    });
    expect(Object.values(out).every((c) => c.capturedAt === CAP)).toBe(true);
  });
});

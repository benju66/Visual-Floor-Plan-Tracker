import { describe, it, expect } from 'vitest';
import type { Unit, StatusLog, Activity } from '@/types/domain';
import { deriveBottleneckStatuses } from './bottleneck';

const TRACK = 'Production';

function unit(id: string): Unit {
  return { id, unit_number: id, unit_type: 'Apartment', assigned_to: null } as unknown as Unit;
}
function activity(name: string, seq: number): Activity {
  return { id: `m_${name}`, name, track: TRACK, sequence_order: seq, color: `#${name}`, applies_to_unit_types: null } as unknown as Activity;
}
function log(unitId: string, m: string, state: string, extra: Partial<StatusLog> = {}): StatusLog {
  return { unit_id: unitId, activityName: m, track: TRACK, temporal_state: state, status_color: '#000', ...extra } as unknown as StatusLog;
}

const M = [activity('A', 0), activity('B', 1), activity('C', 2)];

describe('deriveBottleneckStatuses', () => {
  it('returns [] when no activities exist for the track', () => {
    expect(deriveBottleneckStatuses({ units: [unit('1')], statuses: [log('1', 'A', 'ongoing')], activities: [], trackingMode: TRACK })).toEqual([]);
  });

  it('excludes units that have no status logs in this track', () => {
    const out = deriveBottleneckStatuses({ units: [unit('1')], statuses: [], activities: M, trackingMode: TRACK });
    expect(out).toEqual([]);
  });

  it('bottleneck = first applicable activity that is not completed', () => {
    const out = deriveBottleneckStatuses({
      units: [unit('1')],
      statuses: [log('1', 'A', 'completed'), log('1', 'B', 'ongoing')],
      activities: M,
      trackingMode: TRACK,
    });
    expect(out).toHaveLength(1);
    expect(out[0].activityName).toBe('B');
    expect(out[0].temporal_state).toBe('ongoing');
  });

  it('synthesizes a planned status when the bottleneck activity has no log yet', () => {
    const out = deriveBottleneckStatuses({
      units: [unit('1')],
      statuses: [log('1', 'A', 'completed')], // A done, B/C have no logs
      activities: M,
      trackingMode: TRACK,
    });
    expect(out[0].activityName).toBe('B');
    expect(out[0].temporal_state).toBe('planned');
    expect(out[0].status_color).toBe('#B'); // activity B's color
  });

  it('when every activity is completed, the bottleneck is the last one', () => {
    const out = deriveBottleneckStatuses({
      units: [unit('1')],
      statuses: [log('1', 'A', 'completed'), log('1', 'B', 'completed'), log('1', 'C', 'completed')],
      activities: M,
      trackingMode: TRACK,
    });
    expect(out[0].activityName).toBe('C');
    expect(out[0].temporal_state).toBe('completed');
  });

  it('flags out-of-sequence work logged after the bottleneck', () => {
    const out = deriveBottleneckStatuses({
      units: [unit('1')],
      statuses: [log('1', 'A', 'planned'), log('1', 'C', 'completed')], // bottleneck A, but C done
      activities: M,
      trackingMode: TRACK,
    });
    expect(out[0].activityName).toBe('A');
    expect((out[0].outOfSequence ?? []).map((s) => s.activityName)).toEqual(['C']);
  });

  it('ignores logs from a different track', () => {
    const inspection = { unit_id: '1', activityName: 'A', track: 'Inspection', temporal_state: 'ongoing', status_color: '#000' } as unknown as StatusLog;
    const out = deriveBottleneckStatuses({ units: [unit('1')], statuses: [inspection], activities: M, trackingMode: TRACK });
    expect(out).toEqual([]); // no Production logs → excluded
  });

  it('preserves unit order in the output', () => {
    const out = deriveBottleneckStatuses({
      units: [unit('3'), unit('1'), unit('2')],
      statuses: [log('1', 'A', 'ongoing'), log('2', 'A', 'ongoing'), log('3', 'A', 'ongoing')],
      activities: M,
      trackingMode: TRACK,
    });
    expect(out.map((s) => s.unit_id)).toEqual(['3', '1', '2']);
  });
});

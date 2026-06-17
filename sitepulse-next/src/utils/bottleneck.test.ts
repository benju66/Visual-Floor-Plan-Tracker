import { describe, it, expect } from 'vitest';
import type { Unit, StatusLog, Milestone } from '@/types/domain';
import { deriveBottleneckStatuses } from './bottleneck';

const TRACK = 'Production';

function unit(id: string): Unit {
  return { id, unit_number: id, unit_type: 'Apartment', assigned_to: null } as unknown as Unit;
}
function milestone(name: string, seq: number): Milestone {
  return { id: `m_${name}`, name, track: TRACK, sequence_order: seq, color: `#${name}`, applies_to_unit_types: null } as unknown as Milestone;
}
function log(unitId: string, m: string, state: string, extra: Partial<StatusLog> = {}): StatusLog {
  return { unit_id: unitId, milestone: m, track: TRACK, temporal_state: state, status_color: '#000', ...extra } as unknown as StatusLog;
}

const M = [milestone('A', 0), milestone('B', 1), milestone('C', 2)];

describe('deriveBottleneckStatuses', () => {
  it('returns [] when no milestones exist for the track', () => {
    expect(deriveBottleneckStatuses({ units: [unit('1')], statuses: [log('1', 'A', 'ongoing')], milestones: [], trackingMode: TRACK })).toEqual([]);
  });

  it('excludes units that have no status logs in this track', () => {
    const out = deriveBottleneckStatuses({ units: [unit('1')], statuses: [], milestones: M, trackingMode: TRACK });
    expect(out).toEqual([]);
  });

  it('bottleneck = first applicable milestone that is not completed', () => {
    const out = deriveBottleneckStatuses({
      units: [unit('1')],
      statuses: [log('1', 'A', 'completed'), log('1', 'B', 'ongoing')],
      milestones: M,
      trackingMode: TRACK,
    });
    expect(out).toHaveLength(1);
    expect(out[0].milestone).toBe('B');
    expect(out[0].temporal_state).toBe('ongoing');
  });

  it('synthesizes a planned status when the bottleneck milestone has no log yet', () => {
    const out = deriveBottleneckStatuses({
      units: [unit('1')],
      statuses: [log('1', 'A', 'completed')], // A done, B/C have no logs
      milestones: M,
      trackingMode: TRACK,
    });
    expect(out[0].milestone).toBe('B');
    expect(out[0].temporal_state).toBe('planned');
    expect(out[0].status_color).toBe('#B'); // milestone B's color
  });

  it('when every milestone is completed, the bottleneck is the last one', () => {
    const out = deriveBottleneckStatuses({
      units: [unit('1')],
      statuses: [log('1', 'A', 'completed'), log('1', 'B', 'completed'), log('1', 'C', 'completed')],
      milestones: M,
      trackingMode: TRACK,
    });
    expect(out[0].milestone).toBe('C');
    expect(out[0].temporal_state).toBe('completed');
  });

  it('flags out-of-sequence work logged after the bottleneck', () => {
    const out = deriveBottleneckStatuses({
      units: [unit('1')],
      statuses: [log('1', 'A', 'planned'), log('1', 'C', 'completed')], // bottleneck A, but C done
      milestones: M,
      trackingMode: TRACK,
    });
    expect(out[0].milestone).toBe('A');
    expect((out[0].outOfSequence ?? []).map((s) => s.milestone)).toEqual(['C']);
  });

  it('ignores logs from a different track', () => {
    const inspection = { unit_id: '1', milestone: 'A', track: 'Inspection', temporal_state: 'ongoing', status_color: '#000' } as unknown as StatusLog;
    const out = deriveBottleneckStatuses({ units: [unit('1')], statuses: [inspection], milestones: M, trackingMode: TRACK });
    expect(out).toEqual([]); // no Production logs → excluded
  });

  it('preserves unit order in the output', () => {
    const out = deriveBottleneckStatuses({
      units: [unit('3'), unit('1'), unit('2')],
      statuses: [log('1', 'A', 'ongoing'), log('2', 'A', 'ongoing'), log('3', 'A', 'ongoing')],
      milestones: M,
      trackingMode: TRACK,
    });
    expect(out.map((s) => s.unit_id)).toEqual(['3', '1', '2']);
  });
});

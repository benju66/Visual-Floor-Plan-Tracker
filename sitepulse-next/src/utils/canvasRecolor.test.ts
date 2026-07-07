import { describe, it, expect } from 'vitest';
import { recolorForLag, recolorForMakeReady } from '@/utils/canvasRecolor';
import { parseDay, VARIANCE_COLORS } from '@/utils/progressAnalytics';
import { MAKE_READY_COLORS } from '@/utils/activityReadiness';
import { buildApplicabilityIndex } from '@/utils/applicability';
import type { Activity, ActivityDependency, StatusLog, Unit } from '@/types/domain';

const TRACK = 'Production';
const TODAY = parseDay('2026-06-12') as Date;

function act(id: string, name: string, order: number, applies_to_unit_types: string[] | null = null): Activity {
  return {
    id,
    project_id: 'p1',
    name,
    color: '#123456',
    track: TRACK,
    sequence_order: order,
    applies_to_unit_types,
    created_at: '2026-01-01T00:00:00Z',
  } as Activity;
}

function unit(id: string, unit_type = 'room'): Unit {
  return { id, unit_number: id, unit_type } as Unit;
}

function log(partial: Partial<StatusLog>): StatusLog {
  return {
    id: `log-${partial.unit_id ?? 'u'}-${partial.activity_id ?? partial.activityName ?? 'a'}`,
    unit_id: 'u1',
    activity_id: 'A',
    activityName: 'Framing',
    status_color: '#original',
    temporal_state: 'none',
    track: TRACK,
    planned_start_date: null,
    planned_end_date: null,
    logged_date: null,
    client_timestamp: null,
    created_at: '2026-06-01T08:00:00Z',
    ...partial,
  } as StatusLog;
}

function edge(predecessor: string, successor: string): ActivityDependency {
  return {
    id: `${predecessor}->${successor}`,
    predecessor_activity_id: predecessor,
    successor_activity_id: successor,
    type: 'FS',
    lag_days: 0,
    created_by: null,
    created_at: '2026-07-02T00:00:00Z',
  } as ActivityDependency;
}

// A (seq 1) → B (seq 2); A applies only to corridors, so it is N/A for a 'room'.
const ACT_A = act('A', 'Framing', 1, ['corridor']);
const ACT_B = act('B', 'Drywall', 2);
const ALL_ACTS = [ACT_A, ACT_B];
const INDEX = buildApplicabilityIndex(ALL_ACTS, []);

describe('recolorForLag', () => {
  it('recolors copies by bottleneck variance and never mutates the inputs', () => {
    const active = [log({ unit_id: 'u1', activity_id: 'B', activityName: 'Drywall' })];
    const raw = [
      // Bottleneck (Drywall) planned to finish 2026-06-01 → 11 days behind on 2026-06-12.
      log({ unit_id: 'u1', activity_id: 'B', activityName: 'Drywall', planned_end_date: '2026-06-01', temporal_state: 'in_progress' }),
    ];
    const out = recolorForLag(active, raw, [unit('u1')], [ACT_B], TRACK, undefined, TODAY);

    expect(out).not.toBe(active);
    expect(out[0]).not.toBe(active[0]);
    expect(out[0].status_color).toBe(VARIANCE_COLORS.behind8);
    // Sources keep their original colors — only the display copies are recolored.
    expect(active[0].status_color).toBe('#original');
    expect(raw[0].status_color).toBe('#original');
  });

  it('respects N/A slots: an inapplicable activity cannot become the bottleneck', () => {
    const active = [log({ unit_id: 'u1', activity_id: 'B', activityName: 'Drywall' })];
    const raw = [log({ unit_id: 'u1', activity_id: 'B', activityName: 'Drywall', temporal_state: 'completed' })];

    // With the index, Framing is N/A for u1 → Drywall is the whole track → complete.
    const withIndex = recolorForLag(active, raw, [unit('u1')], ALL_ACTS, TRACK, INDEX, TODAY);
    expect(withIndex[0].status_color).toBe(VARIANCE_COLORS.complete);

    // Without the index the N/A slot re-enters and becomes a false bottleneck.
    const withoutIndex = recolorForLag(active, raw, [unit('u1')], ALL_ACTS, TRACK, undefined, TODAY);
    expect(withoutIndex[0].status_color).not.toBe(VARIANCE_COLORS.complete);
  });

  it('only counts logs from the active track', () => {
    const active = [log({ unit_id: 'u1', activity_id: 'B', activityName: 'Drywall' })];
    const raw = [
      log({ unit_id: 'u1', activity_id: 'B', activityName: 'Drywall', temporal_state: 'completed', track: 'Closeout' }),
    ];
    const out = recolorForLag(active, raw, [unit('u1')], [ACT_B], TRACK, undefined, TODAY);
    // The completed log is on another track → no work logged, no plan → not started.
    expect(out[0].status_color).toBe(VARIANCE_COLORS.notstarted);
  });

  it('passes empty inputs through', () => {
    expect(recolorForLag([], [], [], [], TRACK, undefined, TODAY)).toEqual([]);
  });
});

describe('recolorForMakeReady', () => {
  const DEPS = [edge('A', 'B')];

  it('recolors copies by bottleneck readiness and never mutates the inputs', () => {
    const active = [log({ unit_id: 'u1', activity_id: 'A', activityName: 'Framing' })];
    const raw: StatusLog[] = [];
    // No index: Framing (incomplete, no predecessor) is the bottleneck → ready.
    const out = recolorForMakeReady(active, raw, [unit('u1')], ALL_ACTS, TRACK, DEPS, undefined);

    expect(out).not.toBe(active);
    expect(out[0]).not.toBe(active[0]);
    expect(out[0].status_color).toBe(MAKE_READY_COLORS.ready);
    expect(active[0].status_color).toBe('#original');
  });

  it('an incomplete predecessor blocks the bottleneck', () => {
    // Framing complete → Paint is the bottleneck, but Paint waits on X (never
    // completed, not in the sequence) → blocked.
    const actA = act('A', 'Framing', 1);
    const actC = act('C', 'Paint', 2);
    const active = [log({ unit_id: 'u1', activity_id: 'C', activityName: 'Paint' })];
    const raw = [log({ unit_id: 'u1', activity_id: 'A', activityName: 'Framing', temporal_state: 'completed' })];
    const out = recolorForMakeReady(active, raw, [unit('u1')], [actA, actC], TRACK, [edge('X', 'C')], undefined);
    expect(out[0].status_color).toBe(MAKE_READY_COLORS.blocked);
  });

  it('respects N/A slots: an inapplicable activity is neither the bottleneck nor a blocker', () => {
    const active = [log({ unit_id: 'u1', activity_id: 'B', activityName: 'Drywall' })];
    const raw = [log({ unit_id: 'u1', activity_id: 'B', activityName: 'Drywall', temporal_state: 'completed' })];

    // Framing is N/A for u1 ('room'): Drywall is the only applicable slot and it is
    // complete → the unit reports complete. Framing can't become the bottleneck, and
    // the A→B edge can't block (an N/A predecessor never completes, so it never blocks).
    const withIndex = recolorForMakeReady(active, raw, [unit('u1')], ALL_ACTS, TRACK, DEPS, INDEX);
    expect(withIndex[0].status_color).toBe(MAKE_READY_COLORS.complete);

    // Without the index the N/A slot re-enters as a false (ready) bottleneck.
    const withoutIndex = recolorForMakeReady(active, raw, [unit('u1')], ALL_ACTS, TRACK, DEPS, undefined);
    expect(withoutIndex[0].status_color).toBe(MAKE_READY_COLORS.ready);
  });

  it('passes a status through unchanged (same object) when its unit is unknown', () => {
    const orphan = log({ unit_id: 'ghost', activity_id: 'A' });
    const out = recolorForMakeReady([orphan], [], [unit('u1')], ALL_ACTS, TRACK, DEPS, INDEX);
    expect(out[0]).toBe(orphan);
    expect(out[0].status_color).toBe('#original');
  });

  it('passes empty inputs through', () => {
    expect(recolorForMakeReady([], [], [], [], TRACK, [], undefined)).toEqual([]);
  });
});

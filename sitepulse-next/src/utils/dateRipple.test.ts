import { describe, it, expect } from 'vitest';
import { rippleForward, buildRippleWrites, chainLevelSchedule, type PlannedWindow, type RippleDelta } from '@/utils/dateRipple';
import type { Activity, ActivityDependency, StatusLog } from '@/types/domain';

function edge(predecessor: string, successor: string, lag_days = 0, ripple_dates = true): ActivityDependency {
  return {
    id: `${predecessor}->${successor}`,
    predecessor_activity_id: predecessor,
    successor_activity_id: successor,
    type: 'FS',
    lag_days,
    ripple_dates,
    created_by: null,
    created_at: '2026-07-02T00:00:00Z',
  } as ActivityDependency;
}

function win(start: string | null, end: string | null): PlannedWindow {
  return { start, end };
}

describe('rippleForward', () => {
  it('pushes a successor that starts too early (FS: start = predFinish + 1 + lag)', () => {
    // A finishes 07-10. B currently starts 07-11 (fine at lag 0). Slip A to 07-15 →
    // B must start 07-16, preserving its 4-day duration (07-11..07-15 → 07-16..07-20).
    const edges = [edge('A', 'B')];
    const planned = new Map<string, PlannedWindow>([['B', win('2026-07-11', '2026-07-15')]]);
    const deltas = rippleForward(edges, planned, 'A', '2026-07-15');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ activityId: 'B', start: '2026-07-16', end: '2026-07-20', shiftedDays: 5 });
  });

  it('honors positive lag', () => {
    const edges = [edge('A', 'B', 3)];
    const planned = new Map<string, PlannedWindow>([['B', win('2026-07-11', '2026-07-11')]]);
    const deltas = rippleForward(edges, planned, 'A', '2026-07-15');
    // requiredStart = 07-15 + 1 + 3 = 07-19.
    expect(deltas[0]).toMatchObject({ activityId: 'B', start: '2026-07-19', end: '2026-07-19' });
  });

  it('honors negative lag (a lead — successor may overlap)', () => {
    const edges = [edge('A', 'B', -2)];
    const planned = new Map<string, PlannedWindow>([['B', win('2026-07-11', '2026-07-12')]]);
    const deltas = rippleForward(edges, planned, 'A', '2026-07-15');
    // requiredStart = 07-15 + 1 - 2 = 07-14. 07-14 > 07-11 → shift.
    expect(deltas[0]).toMatchObject({ activityId: 'B', start: '2026-07-14', end: '2026-07-15' });
  });

  it('is push-only — an earlier finish never pulls a successor back', () => {
    const edges = [edge('A', 'B')];
    const planned = new Map<string, PlannedWindow>([['B', win('2026-07-20', '2026-07-25')]]);
    // A now finishes 07-10; B already starts 07-20 (>= required 07-11) → no shift.
    expect(rippleForward(edges, planned, 'A', '2026-07-10')).toEqual([]);
  });

  it('propagates transitively down a chain A→B→C', () => {
    const edges = [edge('A', 'B'), edge('B', 'C')];
    const planned = new Map<string, PlannedWindow>([
      ['B', win('2026-07-11', '2026-07-12')],
      ['C', win('2026-07-13', '2026-07-14')],
    ]);
    const deltas = rippleForward(edges, planned, 'A', '2026-07-20');
    const byId = new Map(deltas.map((d) => [d.activityId, d]));
    expect(byId.get('B')).toMatchObject({ start: '2026-07-21', end: '2026-07-22' });
    // C follows B's NEW finish 07-22 → start 07-23.
    expect(byId.get('C')).toMatchObject({ start: '2026-07-23', end: '2026-07-24' });
  });

  it('skips undated downstream slots (no window → nothing to shift)', () => {
    const edges = [edge('A', 'B'), edge('B', 'C')];
    // B has no dates; the chain cannot compute a shift for B or C beyond it.
    const planned = new Map<string, PlannedWindow>([['C', win('2026-07-13', '2026-07-14')]]);
    expect(rippleForward(edges, planned, 'A', '2026-07-20')).toEqual([]);
  });

  it('is cycle-safe with malformed edge data', () => {
    const edges = [edge('A', 'B'), edge('B', 'A')]; // illegal loop
    const planned = new Map<string, PlannedWindow>([
      ['A', win('2026-07-01', '2026-07-02')],
      ['B', win('2026-07-11', '2026-07-12')],
    ]);
    // Should terminate and produce a finite result, not hang.
    const deltas = rippleForward(edges, planned, 'A', '2026-07-20');
    expect(Array.isArray(deltas)).toBe(true);
    expect(deltas.find((d) => d.activityId === 'B')).toMatchObject({ start: '2026-07-21' });
  });

  it('takes the latest shift when a successor is reached by multiple predecessors', () => {
    const edges = [edge('A', 'C'), edge('B', 'C')];
    const planned = new Map<string, PlannedWindow>([['C', win('2026-07-05', '2026-07-06')]]);
    // Ripple from B (finish 07-20) → C must start 07-21. A isn't slipped here.
    const deltas = rippleForward(edges, planned, 'B', '2026-07-20');
    expect(deltas[0]).toMatchObject({ activityId: 'C', start: '2026-07-21' });
  });

  it('returns nothing for an invalid finish date', () => {
    expect(rippleForward([edge('A', 'B')], new Map([['B', win('2026-07-11', null)]]), 'A', 'not-a-date')).toEqual([]);
  });

  it('ignores sequencing-only links (ripple_dates = false)', () => {
    const edges = [edge('A', 'B', 0, false)];
    const planned = new Map<string, PlannedWindow>([['B', win('2026-07-11', '2026-07-15')]]);
    // Same slip that would shift B if the link cascaded — but this link doesn't.
    expect(rippleForward(edges, planned, 'A', '2026-07-20')).toEqual([]);
  });

  it('propagates only through opted-in links in a mixed chain', () => {
    // A→B cascades, B→C does not. A slip moves B but stops there.
    const edges = [edge('A', 'B', 0, true), edge('B', 'C', 0, false)];
    const planned = new Map<string, PlannedWindow>([
      ['B', win('2026-07-11', '2026-07-12')],
      ['C', win('2026-07-13', '2026-07-14')],
    ]);
    const deltas = rippleForward(edges, planned, 'A', '2026-07-20');
    expect(deltas.map((d) => d.activityId)).toEqual(['B']);
  });
});

describe('buildRippleWrites', () => {
  const deltas: RippleDelta[] = [
    { activityId: 'B', start: '2026-07-16', end: '2026-07-20', shiftedDays: 5 },
  ];

  it('preserves prior color / state / logged_date and only rewrites the planned window', () => {
    const existing = [
      {
        unit_id: 'u1',
        activity_id: 'B',
        status_color: '#123456',
        temporal_state: 'ongoing',
        logged_date: '2026-07-12',
      } as unknown as StatusLog,
    ];
    const writes = buildRippleWrites({ unitId: 'u1', track: 'Production', deltas, existing });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      unit_id: 'u1',
      track: 'Production',
      activity_id: 'B',
      status_color: '#123456',
      temporal_state: 'ongoing',
      planned_start_date: '2026-07-16',
      planned_end_date: '2026-07-20',
      logged_date: '2026-07-12',
    });
  });

  it('falls back to activity color + planned state when the slot has no prior row', () => {
    const writes = buildRippleWrites({
      unitId: 'u1',
      track: 'Production',
      deltas,
      existing: [],
      colorByActivityId: new Map([['B', '#abcdef']]),
    });
    expect(writes[0]).toMatchObject({ status_color: '#abcdef', temporal_state: 'planned', logged_date: null });
  });

  it('never carries another location’s prior row', () => {
    const existing = [
      { unit_id: 'other', activity_id: 'B', status_color: '#999', temporal_state: 'completed', logged_date: '2026-01-01' } as unknown as StatusLog,
    ];
    const writes = buildRippleWrites({ unitId: 'u1', track: 'Production', deltas, existing });
    // 'other' row must not leak into u1's write.
    expect(writes[0].status_color).toBe('#3b82f6');
    expect(writes[0].temporal_state).toBe('planned');
  });
});

describe('chainLevelSchedule (level-layer chaining — Unified Schedule Engine Phase 3)', () => {
  const act = (name: string, sequence_order: number): Activity => ({
    id: `m_${name}`,
    project_id: 'p1',
    sequence_order,
    name,
    color: '#111',
    track: 'Construction',
    type: 'task',
    applies_to_unit_types: null,
    dictionary_id: null,
    subcontractor_id: null,
    created_at: null,
  });
  const activities = [act('Framing', 0), act('Drywall', 1), act('Paint', 2)];

  it('pushes an opted-in successor level window when the predecessor window moves later', () => {
    const saved = {
      Framing: { start_date: '2026-07-01', end_date: '2026-07-10' },
      Drywall: { start_date: '2026-07-11', end_date: '2026-07-20' },
    };
    // Framing slips 5 days → Drywall (10-day window) must start 07-16.
    const draft = { ...saved, Framing: { start_date: '2026-07-01', end_date: '2026-07-15' } };
    const { schedule, chained } = chainLevelSchedule({
      saved, draft, activities, track: 'Construction', edges: [edge('m_Framing', 'm_Drywall')],
    });
    expect(schedule['Drywall']).toEqual({ start_date: '2026-07-16', end_date: '2026-07-25' });
    expect(chained).toEqual([{ name: 'Drywall', start: '2026-07-16', end: '2026-07-25', shiftedDays: 5 }]);
    // Inputs untouched (pure).
    expect(draft['Drywall'].end_date).toBe('2026-07-20');
  });

  it('chains transitively and skips non-opted edges', () => {
    const saved = {
      Framing: { start_date: '2026-07-01', end_date: '2026-07-10' },
      Drywall: { start_date: '2026-07-11', end_date: '2026-07-12' },
      Paint: { start_date: '2026-07-13', end_date: '2026-07-14' },
    };
    const draft = { ...saved, Framing: { start_date: '2026-07-01', end_date: '2026-07-15' } };
    const rippled = chainLevelSchedule({
      saved, draft, activities, track: 'Construction',
      edges: [edge('m_Framing', 'm_Drywall'), edge('m_Drywall', 'm_Paint')],
    });
    expect(rippled.schedule['Drywall'].start_date).toBe('2026-07-16');
    expect(rippled.schedule['Paint'].start_date).toBe('2026-07-18');

    const sequencingOnly = chainLevelSchedule({
      saved, draft, activities, track: 'Construction',
      edges: [edge('m_Framing', 'm_Drywall', 0, false)],
    });
    expect(sequencingOnly.schedule['Drywall']).toEqual(saved['Drywall']);
    expect(sequencingOnly.chained).toEqual([]);
  });

  it('is push-only at the level layer and no-ops when nothing changed', () => {
    const saved = {
      Framing: { start_date: '2026-07-01', end_date: '2026-07-10' },
      Drywall: { start_date: '2026-07-20', end_date: '2026-07-25' },
    };
    // Framing PULLED earlier — Drywall already starts late enough, no shift.
    const draft = { ...saved, Framing: { start_date: '2026-07-01', end_date: '2026-07-05' } };
    const pulled = chainLevelSchedule({
      saved, draft, activities, track: 'Construction', edges: [edge('m_Framing', 'm_Drywall')],
    });
    expect(pulled.schedule['Drywall']).toEqual(saved['Drywall']);
    expect(pulled.chained).toEqual([]);

    const unchanged = chainLevelSchedule({
      saved, draft: { ...saved }, activities, track: 'Construction', edges: [edge('m_Framing', 'm_Drywall')],
    });
    expect(unchanged.chained).toEqual([]);
  });
});

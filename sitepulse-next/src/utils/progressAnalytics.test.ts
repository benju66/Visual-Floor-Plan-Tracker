import { describe, it, expect } from 'vitest';
import {
  parseDay,
  dayDiff,
  computeUnitVariance,
  varianceFill,
  varianceLabel,
  summarizeGroup,
  VARIANCE_COLORS,
} from './progressAnalytics';
import { buildApplicabilityIndex } from './applicability';
import type { Milestone, StatusLog } from '@/types/domain';

const TODAY = parseDay('2026-06-12') as Date;

function ms(name: string, order: number, track = 'Production'): Milestone {
  return {
    id: `ms-${name}`,
    project_id: 'p1',
    name,
    color: '#123456',
    track,
    sequence_order: order,
    created_at: '2026-01-01T00:00:00Z',
  } as Milestone;
}

function log(partial: Partial<StatusLog>): StatusLog {
  return {
    id: `log-${Math.abs(JSON.stringify(partial).split('').reduce((a, c) => a + c.charCodeAt(0), 0))}`,
    unit_id: 'u1',
    milestone: 'Framing',
    status_color: '#123456',
    temporal_state: 'none',
    track: 'Production',
    planned_start_date: null,
    planned_end_date: null,
    logged_date: null,
    client_timestamp: null,
    created_at: '2026-06-01T08:00:00Z',
    ...partial,
  } as StatusLog;
}

const MILESTONES = [ms('Framing', 1), ms('Drywall', 2), ms('Paint', 3)];

describe('parseDay / dayDiff', () => {
  it('parses date-only strings at UTC noon', () => {
    const d = parseDay('2026-06-12');
    expect(d?.toISOString()).toBe('2026-06-12T12:00:00.000Z');
  });
  it('returns null for null/invalid', () => {
    expect(parseDay(null)).toBeNull();
    expect(parseDay('not-a-date')).toBeNull();
  });
  it('computes whole-day differences', () => {
    expect(dayDiff(parseDay('2026-06-01')!, parseDay('2026-06-12')!)).toBe(11);
  });
});

describe('computeUnitVariance', () => {
  it('reports complete when all milestones are completed', () => {
    const logs = MILESTONES.map(m => log({ milestone: m.name, temporal_state: 'completed' }));
    const info = computeUnitVariance(logs, MILESTONES, TODAY);
    expect(info.kind).toBe('complete');
    expect(info.bottleneck).toBeNull();
  });

  it('picks the earliest incomplete milestone as bottleneck', () => {
    const logs = [
      log({ milestone: 'Framing', temporal_state: 'completed' }),
      log({ milestone: 'Paint', temporal_state: 'completed' }), // out of sequence
    ];
    const info = computeUnitVariance(logs, MILESTONES, TODAY);
    expect(info.bottleneck).toBe('Drywall');
  });

  it('is behind when the bottleneck planned finish has passed', () => {
    const logs = [
      log({ milestone: 'Framing', temporal_state: 'completed' }),
      log({ milestone: 'Drywall', temporal_state: 'ongoing', planned_end_date: '2026-06-04' }),
    ];
    const info = computeUnitVariance(logs, MILESTONES, TODAY);
    expect(info.kind).toBe('behind');
    expect(info.days).toBe(8);
  });

  it('is ahead when the bottleneck is not due to start yet', () => {
    const logs = [
      log({ milestone: 'Framing', temporal_state: 'completed' }),
      log({ milestone: 'Drywall', temporal_state: 'none', planned_start_date: '2026-06-20', planned_end_date: '2026-06-28' }),
    ];
    const info = computeUnitVariance(logs, MILESTONES, TODAY);
    expect(info.kind).toBe('ahead');
    expect(info.days).toBe(8);
  });

  it('is on pace inside the planned window', () => {
    const logs = [
      log({ milestone: 'Framing', temporal_state: 'ongoing', planned_start_date: '2026-06-08', planned_end_date: '2026-06-20' }),
    ];
    expect(computeUnitVariance(logs, MILESTONES, TODAY).kind).toBe('onpace');
  });

  it('falls back to idle time when the bottleneck has no plan dates', () => {
    const logs = [
      log({ milestone: 'Framing', temporal_state: 'completed', client_timestamp: '2026-05-29T10:00:00Z' }),
    ];
    const info = computeUnitVariance(logs, MILESTONES, TODAY);
    expect(info.kind).toBe('noplan');
    expect(info.bottleneck).toBe('Drywall');
    expect(info.idleDays).toBe(14);
  });

  it('is notstarted when nothing is logged and nothing is scheduled', () => {
    expect(computeUnitVariance([], MILESTONES, TODAY).kind).toBe('notstarted');
  });

  it('flags overdue-to-start: no work yet but planned finish passed', () => {
    const logs = [
      log({ milestone: 'Framing', temporal_state: 'none', planned_start_date: '2026-05-01', planned_end_date: '2026-05-20' }),
    ];
    const info = computeUnitVariance(logs, MILESTONES, TODAY);
    expect(info.kind).toBe('behind');
    expect(info.days).toBe(23);
  });
});

describe('varianceFill / varianceLabel', () => {
  it('ramps the behind palette by severity', () => {
    const base = { idleDays: null, bottleneck: 'Drywall', state: 'ongoing' } as const;
    expect(varianceFill({ kind: 'behind', days: 2, ...base })).toBe(VARIANCE_COLORS.behind1);
    expect(varianceFill({ kind: 'behind', days: 6, ...base })).toBe(VARIANCE_COLORS.behind4);
    expect(varianceFill({ kind: 'behind', days: 12, ...base })).toBe(VARIANCE_COLORS.behind8);
    expect(varianceFill({ kind: 'behind', days: 30, ...base })).toBe(VARIANCE_COLORS.behind15);
  });
  it('labels each kind', () => {
    expect(varianceLabel({ kind: 'behind', days: 8, idleDays: null, bottleneck: 'Drywall', state: 'ongoing' }))
      .toBe('8d behind plan');
    expect(varianceLabel({ kind: 'noplan', days: 0, idleDays: 12, bottleneck: 'Drywall', state: 'ongoing' }))
      .toBe('No plan dates · idle 12d');
  });
});

describe('summarizeGroup', () => {
  const units = Array.from({ length: 6 }, (_, i) => ({ id: `u${i + 1}`, unit_type: 'Apartment' }));

  function buildStatuses(): StatusLog[] {
    const out: StatusLog[] = [];
    // u1..u3 fully complete; u4 ongoing+behind; u5 stalled noplan; u6 untouched
    for (const id of ['u1', 'u2', 'u3']) {
      for (const m of MILESTONES) {
        out.push(log({ unit_id: id, milestone: m.name, temporal_state: 'completed', client_timestamp: '2026-06-10T08:00:00Z' }));
      }
    }
    out.push(log({ unit_id: 'u4', milestone: 'Framing', temporal_state: 'completed', client_timestamp: '2026-06-11T08:00:00Z' }));
    out.push(log({ unit_id: 'u4', milestone: 'Drywall', temporal_state: 'ongoing', planned_end_date: '2026-06-01', client_timestamp: '2026-06-11T08:00:00Z' }));
    out.push(log({ unit_id: 'u5', milestone: 'Framing', temporal_state: 'ongoing', client_timestamp: '2026-05-01T08:00:00Z' }));
    return out;
  }

  const history = [
    { unit_id: 'u1', logged_date: '2026-06-09' },
    { unit_id: 'u1', logged_date: '2026-06-09' },
    { unit_id: 'u2', logged_date: '2026-06-02' },
    { unit_id: 'u3', logged_date: '2026-05-26' },
  ];

  it('counts slots, completion %, and stalled units', () => {
    const r = summarizeGroup({
      units, statuses: buildStatuses(), milestones: MILESTONES,
      track: 'Production', history, today: TODAY,
    });
    expect(r.totalSlots).toBe(18);
    expect(r.completedSlots).toBe(10); // 3 units × 3 + u4 framing
    expect(Math.round(r.completionPct)).toBe(56);
    expect(r.stalledUnitIds).toEqual(['u5']); // 42 days idle, no plan
  });

  it('computes pace and weekly buckets from history', () => {
    const r = summarizeGroup({
      units, statuses: buildStatuses(), milestones: MILESTONES,
      track: 'Production', history, today: TODAY,
    });
    expect(r.paceThisWeek).toBe(2); // both u1 events within 7 days
    expect(r.weekly.reduce((s, w) => s + w.count, 0)).toBe(4);
  });

  it('suppresses forecast for small samples', () => {
    const r = summarizeGroup({
      units: [{ id: 'u1', unit_type: 'Apartment' }], statuses: buildStatuses(), milestones: MILESTONES,
      track: 'Production', history, today: TODAY,
    });
    expect(r.forecastSuppressed).toBe('complete'); // u1 alone is fully complete
    const r2 = summarizeGroup({
      units: [{ id: 'u4', unit_type: 'Apartment' }, { id: 'u5', unit_type: 'Apartment' }], statuses: buildStatuses(), milestones: MILESTONES,
      track: 'Production', history: [], today: TODAY,
    });
    expect(r2.forecastSuppressed).toBe('small-sample');
    expect(r2.forecastDate).toBeNull();
  });

  it('suppresses forecast when there is no pace', () => {
    const r = summarizeGroup({
      units, statuses: buildStatuses(), milestones: MILESTONES,
      track: 'Production', history: [], today: TODAY,
    });
    expect(r.forecastSuppressed).toBe('no-pace');
  });

  it('projects a finish date at median weekly pace', () => {
    // 2 completions every full week → median 2; remaining 8 slots → 4 weeks out
    const steadyHistory = [
      '2026-06-08', '2026-06-09', // current week (excluded from median window)
      '2026-06-01', '2026-06-02',
      '2026-05-25', '2026-05-26',
      '2026-05-18', '2026-05-19',
      '2026-05-11', '2026-05-12',
      '2026-05-04', '2026-05-05',
      '2026-04-27', '2026-04-28',
    ].map(d => ({ unit_id: 'u1', logged_date: d }));
    const r = summarizeGroup({
      units, statuses: buildStatuses(), milestones: MILESTONES,
      track: 'Production', history: steadyHistory, today: TODAY,
    });
    expect(r.forecastSuppressed).toBeNull();
    expect(r.forecastDate).toBe('2026-07-10'); // 8 remaining / 2 per wk = 4 wks
  });

  it('reports planned-by-today percentage on the same denominator as completion', () => {
    const statuses = buildStatuses();
    const r = summarizeGroup({
      units, statuses, milestones: MILESTONES,
      track: 'Production', history, today: TODAY,
    });
    // only u4 Drywall has a planned_end (past) → 1 of 18 slots — same denominator
    // as completionPct so the plan tick sits on the completion bar's axis.
    expect(r.plannedByTodayPct).toBeCloseTo(100 / 18, 5);
    // coverage is low (1/18), so consumers will hide the tick as untrustworthy
    expect(r.plannedCoverage).toBeCloseTo(1 / 18, 5);
  });

  it('reports full coverage when every slot is dated', () => {
    const statuses: StatusLog[] = [];
    for (const u of units) {
      for (const m of MILESTONES) {
        statuses.push(log({ unit_id: u.id, milestone: m.name, temporal_state: 'planned', planned_end_date: '2026-06-30' }));
      }
    }
    const r = summarizeGroup({
      units, statuses, milestones: MILESTONES,
      track: 'Production', history: [], today: TODAY,
    });
    expect(r.plannedCoverage).toBe(1);
    expect(r.plannedByTodayPct).toBe(0); // all planned ends are in the future
  });
});

describe('summarizeGroup / computeUnitVariance — milestone applicability (N/A)', () => {
  // Drywall applies only to Apartments, so it is N/A for the Corridor.
  const ruleMilestones: Milestone[] = MILESTONES.map(m =>
    m.name === 'Drywall' ? ({ ...m, applies_to_unit_types: ['Apartment'] } as Milestone) : m
  );
  const naUnits = [
    { id: 'c1', unit_type: 'Corridor' },
    { id: 'a1', unit_type: 'Apartment' },
  ];
  const index = buildApplicabilityIndex(ruleMilestones, []);

  it('drops N/A slots from the denominator', () => {
    const r = summarizeGroup({
      units: naUnits, statuses: [], milestones: ruleMilestones,
      track: 'Production', history: [], today: TODAY, applicabilityIndex: index,
    });
    // Corridor: Framing + Paint = 2 applicable; Apartment: 3 → 5 slots, not 6
    expect(r.totalSlots).toBe(5);
  });

  it('does not count completions on N/A milestones', () => {
    // A stale completed log on the now-N/A Drywall slot for the Corridor must not count.
    const statuses = [log({ unit_id: 'c1', milestone: 'Drywall', temporal_state: 'completed' })];
    const r = summarizeGroup({
      units: [naUnits[0]], statuses, milestones: ruleMilestones,
      track: 'Production', history: [], today: TODAY, applicabilityIndex: index,
    });
    expect(r.totalSlots).toBe(2);     // Framing + Paint only
    expect(r.completedSlots).toBe(0); // Drywall completion excluded
  });

  it('skips the N/A milestone in the bottleneck (caller passes applicable list)', () => {
    const statuses = [log({ unit_id: 'c1', milestone: 'Framing', temporal_state: 'completed' })];
    const applicable = [MILESTONES[0], MILESTONES[2]]; // Framing, Paint (Drywall N/A)
    const info = computeUnitVariance(statuses, applicable, TODAY);
    expect(info.bottleneck).toBe('Paint'); // not Drywall
  });
});

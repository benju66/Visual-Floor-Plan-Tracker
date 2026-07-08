import { describe, it, expect } from 'vitest';
import {
  parseDay,
  dayDiff,
  mondayOf,
  projectForecastDate,
  computeUnitVariance,
  varianceFill,
  varianceLabel,
  varianceCompletedColor,
  summarizeGroup,
  scopePlannedFinish,
  planVsProjected,
  clampProjectForecast,
  isStalledSwarm,
  firstOngoingIso,
  resolveActualStartIso,
  activitySchedule,
  VARIANCE_COLORS,
} from './progressAnalytics';
import { buildApplicabilityIndex } from './applicability';
import type { Activity, StatusLog } from '@/types/domain';

const TODAY = parseDay('2026-06-12') as Date;

function ms(name: string, order: number, track = 'Production'): Activity {
  return {
    id: `ms-${name}`,
    project_id: 'p1',
    name,
    color: '#123456',
    track,
    sequence_order: order,
    created_at: '2026-01-01T00:00:00Z',
  } as Activity;
}

function log(partial: Partial<StatusLog>): StatusLog {
  return {
    id: `log-${Math.abs(JSON.stringify(partial).split('').reduce((a, c) => a + c.charCodeAt(0), 0))}`,
    unit_id: 'u1',
    activityName: 'Framing',
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

const ACTIVITIES = [ms('Framing', 1), ms('Drywall', 2), ms('Paint', 3)];

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
  it('reports complete when all activities are completed', () => {
    const logs = ACTIVITIES.map(m => log({ activityName: m.name, temporal_state: 'completed' }));
    const info = computeUnitVariance(logs, ACTIVITIES, TODAY);
    expect(info.kind).toBe('complete');
    expect(info.bottleneck).toBeNull();
  });

  it('picks the earliest incomplete activity as bottleneck', () => {
    const logs = [
      log({ activityName: 'Framing', temporal_state: 'completed' }),
      log({ activityName: 'Paint', temporal_state: 'completed' }), // out of sequence
    ];
    const info = computeUnitVariance(logs, ACTIVITIES, TODAY);
    expect(info.bottleneck).toBe('Drywall');
  });

  it('is behind when the bottleneck planned finish has passed', () => {
    const logs = [
      log({ activityName: 'Framing', temporal_state: 'completed' }),
      log({ activityName: 'Drywall', temporal_state: 'ongoing', planned_end_date: '2026-06-04' }),
    ];
    const info = computeUnitVariance(logs, ACTIVITIES, TODAY);
    expect(info.kind).toBe('behind');
    expect(info.days).toBe(8);
  });

  it('is ahead when the bottleneck is not due to start yet', () => {
    const logs = [
      log({ activityName: 'Framing', temporal_state: 'completed' }),
      log({ activityName: 'Drywall', temporal_state: 'none', planned_start_date: '2026-06-20', planned_end_date: '2026-06-28' }),
    ];
    const info = computeUnitVariance(logs, ACTIVITIES, TODAY);
    expect(info.kind).toBe('ahead');
    expect(info.days).toBe(8);
  });

  it('is on pace inside the planned window', () => {
    const logs = [
      log({ activityName: 'Framing', temporal_state: 'ongoing', planned_start_date: '2026-06-08', planned_end_date: '2026-06-20' }),
    ];
    expect(computeUnitVariance(logs, ACTIVITIES, TODAY).kind).toBe('onpace');
  });

  it('falls back to idle time when the bottleneck has no plan dates', () => {
    const logs = [
      log({ activityName: 'Framing', temporal_state: 'completed', client_timestamp: '2026-05-29T10:00:00Z' }),
    ];
    const info = computeUnitVariance(logs, ACTIVITIES, TODAY);
    expect(info.kind).toBe('noplan');
    expect(info.bottleneck).toBe('Drywall');
    expect(info.idleDays).toBe(14);
  });

  it('is notstarted when nothing is logged and nothing is scheduled', () => {
    expect(computeUnitVariance([], ACTIVITIES, TODAY).kind).toBe('notstarted');
  });

  it('flags overdue-to-start: no work yet but planned finish passed', () => {
    const logs = [
      log({ activityName: 'Framing', temporal_state: 'none', planned_start_date: '2026-05-01', planned_end_date: '2026-05-20' }),
    ];
    const info = computeUnitVariance(logs, ACTIVITIES, TODAY);
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

describe('varianceCompletedColor', () => {
  it('rides the behind severity ramp when finished late (reuses varianceFill, no forked ramp)', () => {
    expect(varianceCompletedColor(2)).toBe(VARIANCE_COLORS.behind1);
    expect(varianceCompletedColor(6)).toBe(VARIANCE_COLORS.behind4);
    expect(varianceCompletedColor(12)).toBe(VARIANCE_COLORS.behind8);
    expect(varianceCompletedColor(30)).toBe(VARIANCE_COLORS.behind15);
  });
  it('is emerald when finished early and muted slate when exactly on time', () => {
    expect(varianceCompletedColor(-4)).toBe(VARIANCE_COLORS.complete);
    expect(varianceCompletedColor(0)).toBe(VARIANCE_COLORS.onpace);
  });
  it('degrades a null (no completion / no planned finish) to neutral slate, never throws', () => {
    expect(varianceCompletedColor(null)).toBe(VARIANCE_COLORS.onpace);
  });
});

describe('summarizeGroup', () => {
  const units = Array.from({ length: 6 }, (_, i) => ({ id: `u${i + 1}`, unit_type: 'Apartment' }));

  function buildStatuses(): StatusLog[] {
    const out: StatusLog[] = [];
    // u1..u3 fully complete; u4 ongoing+behind; u5 stalled noplan; u6 untouched
    for (const id of ['u1', 'u2', 'u3']) {
      for (const m of ACTIVITIES) {
        out.push(log({ unit_id: id, activityName: m.name, temporal_state: 'completed', client_timestamp: '2026-06-10T08:00:00Z' }));
      }
    }
    out.push(log({ unit_id: 'u4', activityName: 'Framing', temporal_state: 'completed', client_timestamp: '2026-06-11T08:00:00Z' }));
    out.push(log({ unit_id: 'u4', activityName: 'Drywall', temporal_state: 'ongoing', planned_end_date: '2026-06-01', client_timestamp: '2026-06-11T08:00:00Z' }));
    out.push(log({ unit_id: 'u5', activityName: 'Framing', temporal_state: 'ongoing', client_timestamp: '2026-05-01T08:00:00Z' }));
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
      units, statuses: buildStatuses(), activities: ACTIVITIES,
      track: 'Production', history, today: TODAY,
    });
    expect(r.totalSlots).toBe(18);
    expect(r.completedSlots).toBe(10); // 3 units × 3 + u4 framing
    expect(Math.round(r.completionPct)).toBe(56);
    expect(r.stalledUnitIds).toEqual(['u5']); // 42 days idle, no plan
  });

  it('computes pace and weekly buckets from history', () => {
    const r = summarizeGroup({
      units, statuses: buildStatuses(), activities: ACTIVITIES,
      track: 'Production', history, today: TODAY,
    });
    expect(r.paceThisWeek).toBe(2); // both u1 events within 7 days
    expect(r.weekly.reduce((s, w) => s + w.count, 0)).toBe(4);
  });

  it('suppresses forecast for small samples', () => {
    const r = summarizeGroup({
      units: [{ id: 'u1', unit_type: 'Apartment' }], statuses: buildStatuses(), activities: ACTIVITIES,
      track: 'Production', history, today: TODAY,
    });
    expect(r.forecastSuppressed).toBe('complete'); // u1 alone is fully complete
    const r2 = summarizeGroup({
      units: [{ id: 'u4', unit_type: 'Apartment' }, { id: 'u5', unit_type: 'Apartment' }], statuses: buildStatuses(), activities: ACTIVITIES,
      track: 'Production', history: [], today: TODAY,
    });
    expect(r2.forecastSuppressed).toBe('small-sample');
    expect(r2.forecastDate).toBeNull();
  });

  it('suppresses forecast when there is no pace', () => {
    const r = summarizeGroup({
      units, statuses: buildStatuses(), activities: ACTIVITIES,
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
      units, statuses: buildStatuses(), activities: ACTIVITIES,
      track: 'Production', history: steadyHistory, today: TODAY,
    });
    expect(r.forecastSuppressed).toBeNull();
    expect(r.forecastDate).toBe('2026-07-10'); // 8 remaining / 2 per wk = 4 wks
  });

  it('reports planned-by-today percentage on the same denominator as completion', () => {
    const statuses = buildStatuses();
    const r = summarizeGroup({
      units, statuses, activities: ACTIVITIES,
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
      for (const m of ACTIVITIES) {
        statuses.push(log({ unit_id: u.id, activityName: m.name, temporal_state: 'planned', planned_end_date: '2026-06-30' }));
      }
    }
    const r = summarizeGroup({
      units, statuses, activities: ACTIVITIES,
      track: 'Production', history: [], today: TODAY,
    });
    expect(r.plannedCoverage).toBe(1);
    expect(r.plannedByTodayPct).toBe(0); // all planned ends are in the future
  });
});

describe('summarizeGroup / computeUnitVariance — activity applicability (N/A)', () => {
  // Drywall applies only to Apartments, so it is N/A for the Corridor.
  const ruleActivities: Activity[] = ACTIVITIES.map(m =>
    m.name === 'Drywall' ? ({ ...m, applies_to_unit_types: ['Apartment'] } as Activity) : m
  );
  const naUnits = [
    { id: 'c1', unit_type: 'Corridor' },
    { id: 'a1', unit_type: 'Apartment' },
  ];
  const index = buildApplicabilityIndex(ruleActivities, []);

  it('drops N/A slots from the denominator', () => {
    const r = summarizeGroup({
      units: naUnits, statuses: [], activities: ruleActivities,
      track: 'Production', history: [], today: TODAY, applicabilityIndex: index,
    });
    // Corridor: Framing + Paint = 2 applicable; Apartment: 3 → 5 slots, not 6
    expect(r.totalSlots).toBe(5);
  });

  it('does not count completions on N/A activities', () => {
    // A stale completed log on the now-N/A Drywall slot for the Corridor must not count.
    const statuses = [log({ unit_id: 'c1', activityName: 'Drywall', temporal_state: 'completed' })];
    const r = summarizeGroup({
      units: [naUnits[0]], statuses, activities: ruleActivities,
      track: 'Production', history: [], today: TODAY, applicabilityIndex: index,
    });
    expect(r.totalSlots).toBe(2);     // Framing + Paint only
    expect(r.completedSlots).toBe(0); // Drywall completion excluded
  });

  it('skips the N/A activity in the bottleneck (caller passes applicable list)', () => {
    const statuses = [log({ unit_id: 'c1', activityName: 'Framing', temporal_state: 'completed' })];
    const applicable = [ACTIVITIES[0], ACTIVITIES[2]]; // Framing, Paint (Drywall N/A)
    const info = computeUnitVariance(statuses, applicable, TODAY);
    expect(info.bottleneck).toBe('Paint'); // not Drywall
  });
});

// The forecast projection was factored out of summarizeGroup so the Phase-6
// forecast-trend util can replay it as-of past dates. These pin its behavior
// directly (the summarizeGroup tests above are the behavior-preservation guard).
describe('mondayOf', () => {
  it('returns the Monday (UTC, Mon-start) of the given date', () => {
    expect(mondayOf(parseDay('2026-06-29') as Date)).toBe('2026-06-29'); // a Monday
    expect(mondayOf(parseDay('2026-07-05') as Date)).toBe('2026-06-29'); // the Sunday rolls back
    expect(mondayOf(parseDay('2026-07-01') as Date)).toBe('2026-06-29');
  });
});

describe('projectForecastDate', () => {
  const today = parseDay('2026-06-01') as Date;
  it('projects a finish at the median weekly pace', () => {
    // remaining 12, median 4/wk over the last full weeks → 3 weeks → Jun 22.
    const r = projectForecastDate({ remaining: 12, totalSlots: 20, fullWeekCounts: [4, 4, 4, 4], today });
    expect(r.forecastSuppressed).toBeNull();
    expect(r.forecastDate).toBe('2026-06-22');
  });
  it('suppresses complete / small-sample / no-pace honestly', () => {
    expect(projectForecastDate({ remaining: 0, totalSlots: 20, fullWeekCounts: [4], today }).forecastSuppressed).toBe('complete');
    expect(projectForecastDate({ remaining: 5, totalSlots: 8, fullWeekCounts: [4], today }).forecastSuppressed).toBe('small-sample');
    expect(projectForecastDate({ remaining: 5, totalSlots: 20, fullWeekCounts: [0, 0, 0], today }).forecastSuppressed).toBe('no-pace');
  });
});

// --- Dashboard presentation helpers (Data Storytelling P1/P2) ---
describe('scopePlannedFinish', () => {
  it('returns the latest planned_end_date on the track', () => {
    const statuses = [
      log({ track: 'Production', planned_end_date: '2026-06-10' }),
      log({ track: 'Production', planned_end_date: '2026-07-01' }),
      log({ track: 'Production', planned_end_date: null }),
      log({ track: 'Closeout', planned_end_date: '2026-12-01' }), // other track ignored
    ];
    expect(scopePlannedFinish(statuses, 'Production')).toBe('2026-07-01');
  });
  it('is null when no slot on the track carries a planned end', () => {
    expect(scopePlannedFinish([log({ track: 'Production', planned_end_date: null })], 'Production')).toBeNull();
    expect(scopePlannedFinish([], 'Production')).toBeNull();
  });
});

describe('planVsProjected', () => {
  it('is positive when the projection lands after the plan (late)', () => {
    expect(planVsProjected('2026-06-01', '2026-06-15')).toBe(14);
  });
  it('is negative when the projection beats the plan (ahead)', () => {
    expect(planVsProjected('2026-06-15', '2026-06-01')).toBe(-14);
  });
  it('is null when either date is missing', () => {
    expect(planVsProjected(null, '2026-06-01')).toBeNull();
    expect(planVsProjected('2026-06-01', null)).toBeNull();
  });
});

describe('clampProjectForecast', () => {
  it('pushes the hero later when a level finishes after it', () => {
    expect(clampProjectForecast('2026-06-10', ['2026-06-01', '2026-07-04', null]))
      .toEqual({ date: '2026-07-04', clampedToLevel: true });
  });
  it('never pulls the hero earlier than its own date', () => {
    expect(clampProjectForecast('2026-08-01', ['2026-06-01', '2026-07-04']))
      .toEqual({ date: '2026-08-01', clampedToLevel: false });
  });
  it('keeps a suppressed (null) hero null — never fabricates a date from a level', () => {
    expect(clampProjectForecast(null, ['2026-07-04'])).toEqual({ date: null, clampedToLevel: false });
  });
  it('is a no-op when no level has a forecast', () => {
    expect(clampProjectForecast('2026-06-10', [null, null])).toEqual({ date: '2026-06-10', clampedToLevel: false });
  });
  it('does not clamp on an equal level date', () => {
    expect(clampProjectForecast('2026-07-04', ['2026-07-04'])).toEqual({ date: '2026-07-04', clampedToLevel: false });
  });
});

describe('isStalledSwarm', () => {
  it('is true at/above the 60% default', () => {
    expect(isStalledSwarm(6, 10)).toBe(true);
    expect(isStalledSwarm(3, 5)).toBe(true); // exactly 60%
  });
  it('is false below the threshold', () => {
    expect(isStalledSwarm(5, 10)).toBe(false);
  });
  it('guards an empty scope', () => {
    expect(isStalledSwarm(0, 0)).toBe(false);
    expect(isStalledSwarm(3, 0)).toBe(false);
  });
  it('honors a custom threshold', () => {
    expect(isStalledSwarm(5, 10, 0.5)).toBe(true);
  });
});

// --- Per-activity schedule story (Schedule Variance Columns Phase 1) ---
describe('firstOngoingIso', () => {
  it("returns the first ongoing event's capture timestamp", () => {
    const rows = [
      { temporal_state: 'completed', client_timestamp: '2026-05-10T15:00:00Z', changed_at: '2026-05-10T15:00:00Z' },
      { temporal_state: 'ongoing', client_timestamp: '2026-04-28T07:00:00Z', changed_at: '2026-04-28T07:00:00Z' },
    ];
    expect(firstOngoingIso(rows)).toBe('2026-04-28T07:00:00Z');
  });

  it('picks the EARLIEST ongoing event regardless of input order', () => {
    const rows = [
      { temporal_state: 'ongoing', client_timestamp: '2026-06-02T09:00:00Z', changed_at: '2026-06-02T09:00:00Z' }, // a re-open
      { temporal_state: 'ongoing', client_timestamp: '2026-05-01T08:00:00Z', changed_at: '2026-05-01T08:00:00Z' }, // the true first
    ];
    expect(firstOngoingIso(rows)).toBe('2026-05-01T08:00:00Z');
  });

  it('falls back to changed_at when the ongoing event has no client_timestamp', () => {
    const rows = [
      { temporal_state: 'ongoing', client_timestamp: null, changed_at: '2026-05-01T08:00:00Z' },
    ];
    expect(firstOngoingIso(rows)).toBe('2026-05-01T08:00:00Z');
  });

  it('is null when nothing ever went ongoing (jumped straight to complete / not started)', () => {
    expect(firstOngoingIso([
      { temporal_state: 'completed', client_timestamp: '2026-05-10T15:00:00Z', changed_at: '2026-05-10T15:00:00Z' },
    ])).toBeNull();
    expect(firstOngoingIso([])).toBeNull();
  });
});

describe('resolveActualStartIso', () => {
  const ongoingEvents = [
    { temporal_state: 'ongoing', client_timestamp: '2026-04-28T07:00:00Z', changed_at: '2026-04-28T07:00:00Z' },
    { temporal_state: 'completed', client_timestamp: '2026-05-10T15:00:00Z', changed_at: '2026-05-10T15:00:00Z', logged_date: '2026-05-10' },
  ];

  it('a manually-entered actual-start WINS over everything, including a real ongoing mark', () => {
    expect(resolveActualStartIso(ongoingEvents, { enteredStart: '2026-04-20' })).toBe('2026-04-20');
  });

  it('uses the entered date even when there is no audit history at all', () => {
    expect(resolveActualStartIso([], { enteredStart: '2026-04-20' })).toBe('2026-04-20');
  });

  it('falls back to the first genuine ongoing event when nothing is entered', () => {
    expect(resolveActualStartIso(ongoingEvents, {})).toBe('2026-04-28T07:00:00Z');
    // opts is optional entirely.
    expect(resolveActualStartIso(ongoingEvents)).toBe('2026-04-28T07:00:00Z');
  });

  it('returns null (blank the guess) for a completed-but-never-ongoing slot with no entry', () => {
    // The misleading completion-day fallback is intentionally GONE — no ongoing +
    // no entered date → null, so the caller blanks Actual Started / Duration / Var Start.
    const jumpedToComplete = [
      { temporal_state: 'completed', changed_at: '2026-05-10T15:00:00Z', logged_date: '2026-05-10' },
    ];
    expect(resolveActualStartIso(jumpedToComplete, {})).toBeNull();
    expect(resolveActualStartIso(jumpedToComplete, { enteredStart: null })).toBeNull();
    expect(resolveActualStartIso([], {})).toBeNull();
  });

  it('an empty-string entered date is treated as no entry (falls through)', () => {
    expect(resolveActualStartIso(ongoingEvents, { enteredStart: '' })).toBe('2026-04-28T07:00:00Z');
  });
});

describe('activitySchedule', () => {
  it('tells the schedule story with signed durations and variances', () => {
    // Planned 10 days; started 4 days late; ran 16 days → finished 10 days late, 6 over plan.
    const m = activitySchedule({
      plannedStart: '2026-06-01', plannedEnd: '2026-06-11',
      actualStart: '2026-06-05', actualEnd: '2026-06-21',
    });
    expect(m).toEqual({
      plannedDuration: 10,
      actualDuration: 16,
      varianceStart: 4,
      varianceCompleted: 10,
      varianceDuration: 6,
    });
  });

  it('signs early starts / finishes / short runs negative', () => {
    const m = activitySchedule({
      plannedStart: '2026-06-10', plannedEnd: '2026-06-25', // planned 15
      actualStart: '2026-06-07', actualEnd: '2026-06-17',   // started 3 early, ran 10, finished 8 early
    });
    expect(m.varianceStart).toBe(-3);
    expect(m.varianceCompleted).toBe(-8);
    expect(m.actualDuration).toBe(10);
    expect(m.varianceDuration).toBe(-5);
  });

  it("counts an ongoing activity's actual duration to today (caller passes today as actualEnd)", () => {
    const m = activitySchedule({
      plannedStart: '2026-06-01', plannedEnd: '2026-06-10',
      actualStart: '2026-06-03', actualEnd: '2026-06-12', // today
    });
    expect(m.actualDuration).toBe(9);    // 6/3 → 6/12, still running
    expect(m.varianceCompleted).toBe(2); // 2 days past planned finish so far
    expect(m.varianceDuration).toBe(0);  // ran 9, planned 9
  });

  it('accepts a full ISO timestamp for actualStart (parsed date-only, timezone-stable)', () => {
    // firstOngoingIso returns a capture timestamp like '...T07:00:00Z', not a date-only string.
    const m = activitySchedule({
      plannedStart: '2026-06-01', plannedEnd: '2026-06-10',
      actualStart: '2026-06-03T07:00:00Z', actualEnd: '2026-06-12',
    });
    expect(m.varianceStart).toBe(2);
    expect(m.actualDuration).toBe(9);
  });

  it('null-propagates missing inputs instead of reporting a false 0', () => {
    // Not yet started: no actual dates → no actual duration / variances, but the plan is known.
    const notStarted = activitySchedule({
      plannedStart: '2026-06-01', plannedEnd: '2026-06-10', actualStart: null, actualEnd: null,
    });
    expect(notStarted).toEqual({
      plannedDuration: 9,
      actualDuration: null,
      varianceStart: null,
      varianceCompleted: null,
      varianceDuration: null,
    });
    // No planned window → no planned duration / start-or-completed variance, even if actuals exist.
    const noPlan = activitySchedule({
      plannedStart: null, plannedEnd: null, actualStart: '2026-06-03', actualEnd: '2026-06-12',
    });
    expect(noPlan.plannedDuration).toBeNull();
    expect(noPlan.varianceStart).toBeNull();
    expect(noPlan.varianceCompleted).toBeNull();
    expect(noPlan.varianceDuration).toBeNull();
    expect(noPlan.actualDuration).toBe(9);
  });

  it('keeps a genuine same-day window as 0, not null (a real zero, not a missing one)', () => {
    const m = activitySchedule({
      plannedStart: '2026-06-01', plannedEnd: '2026-06-01',
      actualStart: '2026-06-01', actualEnd: '2026-06-01', // jumped straight to complete in a day
    });
    expect(m.plannedDuration).toBe(0);
    expect(m.actualDuration).toBe(0);
    expect(m.varianceDuration).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import {
  readinessFor,
  unitMakeReady,
  makeReadyFill,
  makeReadyLabel,
  slotKey,
  MAKE_READY_COLORS,
  type MakeReadyInfo,
} from '@/utils/activityReadiness';
import type { ActivityDependency } from '@/types/domain';

/** Minimal FS edge builder (only the fields the readiness logic reads). */
function edge(predecessor: string, successor: string, lag_days = 0): ActivityDependency {
  return {
    id: `${predecessor}->${successor}`,
    predecessor_activity_id: predecessor,
    successor_activity_id: successor,
    type: 'FS',
    lag_days,
    created_by: null,
    created_at: '2026-07-02T00:00:00Z',
  } as ActivityDependency;
}

const U = 'unit-1';
// A→B→C chain of activities.
const deps = [edge('A', 'B'), edge('B', 'C')];

describe('readinessFor', () => {
  it('a slot with no predecessor is ready', () => {
    const r = readinessFor(U, 'A', deps, new Set());
    expect(r.status).toBe('ready');
    expect(r.blockedBy).toEqual([]);
  });

  it('a slot whose predecessor is incomplete is blocked, naming the blocker', () => {
    const r = readinessFor(U, 'B', deps, new Set());
    expect(r.status).toBe('blocked');
    expect(r.blockedBy).toEqual(['A']);
  });

  it('completing the predecessor flips the slot to ready', () => {
    const completed = new Set([slotKey(U, 'A')]);
    expect(readinessFor(U, 'B', deps, completed).status).toBe('ready');
  });

  it('a completed slot reports done regardless of predecessors', () => {
    const completed = new Set([slotKey(U, 'B')]);
    const r = readinessFor(U, 'B', deps, completed);
    expect(r.status).toBe('done');
    expect(r.blockedBy).toEqual([]);
  });

  it('reports every incomplete predecessor when there are multiple edges (DAG)', () => {
    const multi = [edge('A', 'C'), edge('B', 'C')];
    const completed = new Set([slotKey(U, 'A')]);
    const r = readinessFor(U, 'C', multi, completed);
    expect(r.status).toBe('blocked');
    expect(r.blockedBy).toEqual(['B']);
  });

  it('an N/A slot is na (not ready, not blocked)', () => {
    const applicable = new Set([slotKey(U, 'A')]); // B is N/A here
    expect(readinessFor(U, 'B', deps, new Set(), applicable).status).toBe('na');
  });

  it('an N/A predecessor never blocks — it can never complete', () => {
    // B applies, A does not. B should be ready even though A is not completed.
    const applicable = new Set([slotKey(U, 'B')]);
    const r = readinessFor(U, 'B', deps, new Set(), applicable);
    expect(r.status).toBe('ready');
    expect(r.blockedBy).toEqual([]);
  });
});

describe('unitMakeReady', () => {
  const acts = [
    { id: 'A', name: 'Framing' },
    { id: 'B', name: 'Drywall' },
    { id: 'C', name: 'Paint' },
  ];

  it('none when the location has no applicable activities', () => {
    expect(unitMakeReady(U, [], deps, new Set()).kind).toBe('none');
  });

  it('ready: bottleneck is the earliest incomplete activity with no open predecessor', () => {
    const info = unitMakeReady(U, acts, deps, new Set());
    expect(info.kind).toBe('ready');
    expect(info.bottleneckActivityId).toBe('A');
    expect(info.bottleneckName).toBe('Framing');
  });

  it('ready: bottleneck advances as work completes and its predecessor is done', () => {
    const info = unitMakeReady(U, acts, deps, new Set([slotKey(U, 'A')]));
    expect(info.kind).toBe('ready');
    expect(info.bottleneckActivityId).toBe('B');
  });

  it('complete when every applicable activity is done', () => {
    const completed = new Set([slotKey(U, 'A'), slotKey(U, 'B'), slotKey(U, 'C')]);
    const info = unitMakeReady(U, acts, deps, completed);
    expect(info.kind).toBe('complete');
    expect(info.bottleneckActivityId).toBeNull();
  });

  it('blocked: real edges override sequence order (precise out-of-sequence)', () => {
    // Sequence lists Paint FIRST, but the FS edge says Paint waits on Framing.
    // Nothing done → bottleneck is the earliest-in-sequence (Paint), which is
    // blocked by the incomplete Framing — a block the raw sequence would miss.
    const misordered = [
      { id: 'P', name: 'Paint' },
      { id: 'F', name: 'Framing' },
    ];
    const paintAfterFraming = [edge('F', 'P')];
    const info = unitMakeReady(U, misordered, paintAfterFraming, new Set());
    expect(info.kind).toBe('blocked');
    expect(info.bottleneckActivityId).toBe('P');
    expect(info.blockedBy).toEqual(['F']);
  });

  it('ready once the out-of-sequence predecessor completes', () => {
    const misordered = [
      { id: 'P', name: 'Paint' },
      { id: 'F', name: 'Framing' },
    ];
    const info = unitMakeReady(U, misordered, [edge('F', 'P')], new Set([slotKey(U, 'F')]));
    expect(info.kind).toBe('ready');
    expect(info.bottleneckActivityId).toBe('P');
  });
});

describe('make-ready encoding', () => {
  it('maps each kind to its fixed color', () => {
    const kinds: MakeReadyInfo['kind'][] = ['ready', 'blocked', 'complete', 'none'];
    for (const kind of kinds) {
      const info: MakeReadyInfo = { kind, bottleneckActivityId: null, bottleneckName: null, blockedBy: [] };
      expect(makeReadyFill(info)).toBe(MAKE_READY_COLORS[kind]);
    }
  });

  it('labels a block with the blocking predecessor name', () => {
    const info: MakeReadyInfo = {
      kind: 'blocked',
      bottleneckActivityId: 'B',
      bottleneckName: 'Drywall',
      blockedBy: ['A'],
    };
    const label = makeReadyLabel(info, new Map([['A', 'Framing']]));
    expect(label).toContain('Drywall');
    expect(label).toContain('Framing');
  });
});

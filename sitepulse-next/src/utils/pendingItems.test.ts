import { describe, it, expect } from 'vitest';
import { buildPendingItems } from './pendingItems';
import type { PendingChange, Unit } from '@/types/domain';

// Only unit.id/unit_number, log.activityName/status_color, extraProps.activityObj, and
// state are read — cast partials.
const unit = (id: string, number = id) => ({ id, unit_number: number } as Unit);
const activityObj = (name: string, color = '#abcdef') =>
  ({ id: name, name, color, track: 'Production' });
const change = (over: Partial<PendingChange>): PendingChange =>
  ({ unit: unit('u1'), log: null, state: 'completed', capturedAt: 't', extraProps: {}, ...over } as PendingChange);

describe('buildPendingItems', () => {
  it('builds a primary row keyed by pendingChangeKey and carries the change', () => {
    const c = change({ extraProps: { activityObj: activityObj('Framing') } });
    const items = buildPendingItems({ u1: c }, {});
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'u1_Framing',
      unitId: 'u1',
      unitNumber: 'u1',
      activityName: 'Framing',
      activityColor: '#abcdef',
      isTimeline: false,
      hasConflict: false,
    });
    // The exact staged payload rides along, so a per-item retry can re-apply it.
    expect(items[0].change).toBe(c);
  });

  it('builds a timeline row flagged isTimeline', () => {
    const c = change({ unit: unit('u2'), extraProps: { activityObj: activityObj('Paint') } });
    const items = buildPendingItems({}, { u2_Paint: c });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: 'u2_Paint', isTimeline: true, hasConflict: false });
  });

  it('lets a timeline edit OVERRIDE a primary edit on the SAME slot (one row, hasConflict)', () => {
    const primary = change({ state: 'planned', extraProps: { activityObj: activityObj('Framing') } });
    const timeline = change({ state: 'ongoing', extraProps: { activityObj: activityObj('Framing') } });
    const items = buildPendingItems({ u1: primary }, { u1_Framing: timeline });
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe('u1_Framing');
    expect(items[0].isTimeline).toBe(true);
    expect(items[0].hasConflict).toBe(true);
    // Timeline wins — its state + change are the row's.
    expect(items[0].state).toBe('ongoing');
    expect(items[0].change).toBe(timeline);
  });

  it('keeps a primary and a timeline edit on DIFFERENT activities of one unit as two rows', () => {
    const primary = change({ extraProps: { activityObj: activityObj('A') } });
    const timeline = change({ extraProps: { activityObj: activityObj('B') } });
    const items = buildPendingItems({ u1: primary }, { u1_B: timeline });
    expect(items.map((i) => i.key).sort()).toEqual(['u1_A', 'u1_B']);
    expect(items.every((i) => i.hasConflict === false)).toBe(true);
  });

  it('falls back through activityObj → log → Primary for the name, and to a slate swatch for color', () => {
    const items = buildPendingItems(
      { u1: change({ log: null, extraProps: {} }) },
      {},
    );
    expect(items[0].key).toBe('u1_Primary');
    expect(items[0].activityName).toBe('Primary');
    expect(items[0].activityColor).toBe('#94a3b8');
  });
});

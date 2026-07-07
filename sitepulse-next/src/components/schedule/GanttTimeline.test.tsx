import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import GanttTimeline from './GanttTimeline';

afterEach(cleanup);
import type { GanttBarModel, GanttRowModel } from '@/utils/ganttMath';

// UI Polish P3: the timeline explains an empty plan instead of showing silent
// gray rows — one banner when no visible bar carries a planned date, suppressed
// as soon as any bar exists.

function bar(overrides: Partial<GanttBarModel>): GanttBarModel {
  return {
    activity_id: 'a1',
    activityName: 'Framing',
    track: 'Production',
    color: '#3b82f6',
    temporalState: 'none',
    plannedStart: null,
    plannedEnd: null,
    loggedDate: null,
    overdue: false,
    sequenceOrder: 1,
    ...overrides,
  };
}

function row(unitId: string, bars: GanttBarModel[]): GanttRowModel {
  return { unitId, unitNumber: unitId.toUpperCase(), unitType: null, sheetId: 's1', bars };
}

const baseProps = {
  rowMeta: {},
  window: { start: new Date('2026-07-01T12:00:00Z'), end: new Date('2026-07-31T12:00:00Z') },
  zoom: 'week' as const,
  pxPerDay: 12,
  today: new Date('2026-07-07T12:00:00Z'),
  onEditDates: () => {},
};

describe('GanttTimeline empty-plan banner', () => {
  it('shows the banner (naming Level dates + Import) when no bar has planned dates', () => {
    render(
      <GanttTimeline
        {...baseProps}
        rows={[row('u1', [bar({})]), row('u2', [bar({ activity_id: 'a2', activityName: 'Drywall' })])]}
      />
    );
    expect(screen.getByText(/No planned dates yet/i)).toBeTruthy();
    expect(screen.getByText('Level dates')).toBeTruthy();
    expect(screen.getByText('Import')).toBeTruthy();
  });

  it('suppresses the banner as soon as any bar has a planned date', () => {
    render(
      <GanttTimeline
        {...baseProps}
        rows={[
          row('u1', [bar({})]),
          row('u2', [bar({ plannedStart: '2026-07-06', plannedEnd: '2026-07-10' })]),
        ]}
      />
    );
    expect(screen.queryByText(/No planned dates yet/i)).toBeNull();
  });

  it('keeps the existing no-rows empty state (no banner either)', () => {
    render(<GanttTimeline {...baseProps} rows={[]} />);
    expect(screen.getByText(/No scheduled locations to show/i)).toBeTruthy();
    expect(screen.queryByText(/No planned dates yet/i)).toBeNull();
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

afterEach(cleanup);
import FloorPulse from './FloorPulse';
import TypeScorecard from './TypeScorecard';
import type { Sheet, Unit, Activity, StatusLog } from '@/types/domain';

function ms(name: string, order: number): Activity {
  return {
    id: `ms-${name}`, project_id: 'p1', name, color: '#3366aa',
    track: 'Production', sequence_order: order, created_at: '2026-01-01T00:00:00Z',
  } as Activity;
}

function sheet(id: string, name: string, order: number): Sheet {
  return { id, sheet_name: name, sequence_order: order, project_id: 'p1' } as Sheet;
}

function unit(id: string, sheet_id: string, type: string): Unit {
  return { id, sheet_id, unit_number: id.toUpperCase(), unit_type: type, polygon_coordinates: null } as Unit;
}

function log(unit_id: string, activityName: string, state: string, extra: Partial<StatusLog> = {}): StatusLog {
  return {
    id: `${unit_id}-${activityName}`, unit_id, activityName, status_color: '#3366aa',
    temporal_state: state, track: 'Production',
    planned_start_date: null, planned_end_date: null, logged_date: null,
    client_timestamp: '2026-06-10T08:00:00Z', created_at: '2026-06-10T08:00:00Z',
    ...extra,
  } as StatusLog;
}

const ACTIVITIES = [ms('Framing', 1), ms('Drywall', 2)];
const SHEETS = [sheet('s1', 'Level 1', 1), sheet('s2', 'Level 2', 2)];
const UNITS = [
  unit('u1', 's1', 'Apartment'), unit('u2', 's1', 'Corridor'),
  unit('u3', 's2', 'Apartment'), unit('u4', 's2', 'Apartment'),
];
const STATUSES = [
  log('u1', 'Framing', 'completed'), log('u1', 'Drywall', 'completed'),
  log('u2', 'Framing', 'ongoing', { planned_end_date: '2026-06-01' }), // behind plan
  log('u3', 'Framing', 'completed'),
];
const HISTORY = [
  { unit_id: 'u1', logged_date: '2026-06-08', track: 'Production' },
  { unit_id: 'u3', logged_date: '2026-06-09', track: 'Production' },
];

describe('FloorPulse', () => {
  const baseProps = {
    sheets: SHEETS,
    allUnits: UNITS,
    statuses: STATUSES,
    activities: ACTIVITIES,
    track: 'Production',
    history: HISTORY,
    scope: 'all',
    onScopeChange: vi.fn(),
    onOpenMap: vi.fn(),
  };

  it('renders one row per sheet in reverse building order', () => {
    render(<FloorPulse {...baseProps} />);
    const rows = screen.getAllByText(/Level [12]/);
    expect(rows[0].textContent).toBe('Level 2'); // top floor first
    expect(rows[1].textContent).toBe('Level 1');
  });

  it('scopes the dashboard when a row is clicked', () => {
    const onScopeChange = vi.fn();
    render(<FloorPulse {...baseProps} onScopeChange={onScopeChange} />);
    fireEvent.click(screen.getByText('Level 1'));
    expect(onScopeChange).toHaveBeenCalledWith('s1');
  });

  it('opens the map for a level without changing scope', () => {
    const onOpenMap = vi.fn();
    const onScopeChange = vi.fn();
    render(<FloorPulse {...baseProps} onOpenMap={onOpenMap} onScopeChange={onScopeChange} />);
    fireEvent.click(screen.getByTitle('Open Level 2 on the map'));
    expect(onOpenMap).toHaveBeenCalledWith('s2');
    expect(onScopeChange).not.toHaveBeenCalled();
  });

  it('suppresses forecasts honestly for tiny groups', () => {
    render(<FloorPulse {...baseProps} />);
    // 2 units × 2 activities = 4 slots per level — below the small-sample floor
    expect(screen.getAllByText(/too few tasks/i).length).toBeGreaterThan(0);
  });
});

describe('TypeScorecard', () => {
  const baseProps = {
    allUnits: UNITS,
    statuses: STATUSES,
    activities: ACTIVITIES,
    track: 'Production',
    history: HISTORY,
  };

  it('ranks the most-behind type first', () => {
    render(<TypeScorecard {...baseProps} />);
    const names = screen.getAllByText(/(Apartment|Corridor)/).map(el => el.textContent);
    expect(names[0]).toContain('Corridor'); // u2 is behind plan → ranked RISK 1
  });

  it('expands a row into its burn-up on click', () => {
    render(<TypeScorecard {...baseProps} />);
    fireEvent.click(screen.getByText('Corridor'));
    expect(screen.getByText(/burn-up — actual vs planned/i)).toBeTruthy();
  });

  it('renders nothing when there is only one type to compare', () => {
    const { container } = render(
      <TypeScorecard {...baseProps} allUnits={UNITS.map(u => ({ ...u, unit_type: 'Apartment' }))} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('collapses per-row "no plan dates" into one unlock hint when the project is planless', () => {
    const planless = STATUSES.map(s => ({ ...s, planned_end_date: null }));
    render(<TypeScorecard {...baseProps} statuses={planless} />);
    // ONE hint above the table (not a column of dead cells)...
    expect(screen.getByText(/set them \(Schedule/i)).toBeTruthy();
    // ...and no per-row "no plan dates" chips.
    expect(screen.queryByText(/no plan dates/i)).toBeNull();
  });

  it('keeps per-row variance chips when the project has any planned dates', () => {
    render(<TypeScorecard {...baseProps} />); // STATUSES has a planned_end_date on u2
    expect(screen.queryByText(/set them \(Schedule/i)).toBeNull();
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// Shared fixtures, hoisted so the vi.mock factories (which run before module init)
// can see them alongside the test body.
const { COST_CODES, COMPANIES, DICT } = vi.hoisted(() => ({
  COST_CODES: [
    { id: 'cc1', code: '09-6500', description: 'Resilient Flooring', division: '09', code_type: null, unit_of_measure: 'SF', status: 'active', sort_order: 10, created_by: null, created_at: null, updated_at: null },
    { id: 'cc2', code: '09-9100', description: 'Painting', division: '09', code_type: null, unit_of_measure: 'SF', status: 'active', sort_order: 20, created_by: null, created_at: null, updated_at: null },
  ],
  COMPANIES: [
    { id: 'co1', name: 'Ace Flooring', trade: 'Flooring', status: 'active', sort_order: 10, created_by: null, created_at: null, updated_at: null },
  ],
  DICT: [
    { id: 'd-floor', name: 'Flooring', track: 'Production', type: 'task', status: 'active', aliases: [], default_project_types: [], cost_code_id: 'cc1', proposed_note: null, created_by: null, created_at: null, updated_at: null },
    { id: 'd-paint', name: 'Painting', track: 'Production', type: 'task', status: 'active', aliases: [], default_project_types: [], cost_code_id: 'cc2', proposed_note: null, created_by: null, created_at: null, updated_at: null },
  ],
}));

vi.mock('@/hooks/useCostCodes', () => ({ useCostCodes: () => ({ data: COST_CODES }) }));
vi.mock('@/hooks/useCompanies', () => ({ useCompanies: () => ({ data: COMPANIES }) }));
vi.mock('@/hooks/useActivityDictionary', () => ({ useActivityDictionary: () => ({ data: DICT }) }));

afterEach(cleanup);

import ProductionRates from './ProductionRates';
import { buildApplicabilityIndex } from '@/utils/applicability';
import type { Unit, Activity, StatusLog } from '@/types/domain';
import type { StatusHistoryEvent } from '@/hooks/useProjectQueries';

function act(id: string, name: string, order: number, extra: Partial<Activity>): Activity {
  return {
    id, project_id: 'p1', name, color: '#3366aa', track: 'Production', type: 'task',
    sequence_order: order, dictionary_id: null, subcontractor_id: null,
    applies_to_unit_types: null, created_at: '2026-01-01T00:00:00Z', ...extra,
  } as Activity;
}

function unit(id: string, type: string, area: number | null): Unit {
  return { id, sheet_id: 's1', unit_number: id.toUpperCase(), unit_type: type, computed_area: area, polygon_coordinates: null, opening_edges: [] } as unknown as Unit;
}

function hist(unit_id: string, activity_id: string, logged_date: string): StatusHistoryEvent {
  return { unit_id, activity_id, activityName: activity_id, track: 'Production', logged_date } as StatusHistoryEvent;
}

function status(unit_id: string, activity_id: string, state: string, planned_end_date: string | null): StatusLog {
  return { id: `${unit_id}-${activity_id}`, unit_id, activity_id, activityName: activity_id, temporal_state: state, track: 'Production', status_color: '#3366aa', planned_start_date: null, planned_end_date, logged_date: null, client_timestamp: null, created_at: null } as StatusLog;
}

// A1 = Flooring (cost code cc1, sub co1, Apartment-only); A2 = Painting (cost code cc2, no sub).
const ACTIVITIES = [
  act('A1', 'Flooring', 1, { dictionary_id: 'd-floor', subcontractor_id: 'co1', applies_to_unit_types: ['Apartment'] }),
  act('A2', 'Painting', 2, { dictionary_id: 'd-paint' }),
];
const UNITS = [
  unit('u1', 'Apartment', 100), unit('u2', 'Apartment', 100),
  unit('u3', 'Apartment', 100), unit('u4', 'Apartment', 100),
  unit('c1', 'Corridor', 100), // N/A for A1
];
// Flooring: 3 Apartment completions over a 7-day span → 300 SF / 300 SF-per-week.
// The Corridor completion on A1 is N/A and must be excluded (so it stays "3 done").
const HISTORY: StatusHistoryEvent[] = [
  hist('u1', 'A1', '2026-06-01'), hist('u2', 'A1', '2026-06-04'), hist('u3', 'A1', '2026-06-08'),
  hist('c1', 'A1', '2026-06-02'), // N/A — excluded
  hist('u1', 'A2', '2026-06-01'), // Painting: single completion → tiny-sample, no rate
];
const STATUSES = [status('u4', 'A1', 'none', '2030-01-01')]; // open backlog for cc1

const INDEX = buildApplicabilityIndex(ACTIVITIES, []);

const baseProps = {
  allUnits: UNITS,
  statuses: STATUSES,
  activities: ACTIVITIES,
  track: 'Production',
  history: HISTORY,
  applicabilityIndex: INDEX,
};

describe('ProductionRates', () => {
  it('defaults to a locations/week measure (no drawing scale needed)', () => {
    render(<ProductionRates {...baseProps} />);
    expect(screen.getByText(/09-6500/)).toBeTruthy();
    expect(screen.getByText('Actual loc/wk')).toBeTruthy();      // locations is the default header
    expect(screen.getByText(/3 locations done/)).toBeTruthy();   // Flooring: 3 completed locations
  });

  it('excludes the N/A (Corridor) completion from the count (stays 3 locations)', () => {
    render(<ProductionRates {...baseProps} />);
    expect(screen.getByText(/3 locations done/)).toBeTruthy();
    expect(screen.queryByText(/4 locations done/)).toBeNull();
  });

  it('switches to SF and surfaces the square-foot rate', () => {
    render(<ProductionRates {...baseProps} />);
    fireEvent.click(screen.getByText('SF'));
    expect(screen.getByText('Actual SF/wk')).toBeTruthy();
    // 3 locations × 100 SF over a 7-day span → 300 SF and 300 SF/wk.
    expect(screen.getAllByText(/300/).length).toBeGreaterThan(0);
  });

  it('suppresses a thin-sample cost code with an em dash, not a fake rate', () => {
    render(<ProductionRates {...baseProps} />);
    // Painting has one completion → tiny-sample → no published rate.
    expect(screen.getByText(/09-9100/)).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('switches to the subcontractor axis and shows the company name', () => {
    render(<ProductionRates {...baseProps} />);
    fireEvent.click(screen.getByText('Subcontractor'));
    expect(screen.getByText('Ace Flooring')).toBeTruthy();
  });

  it('renders nothing when no activity carries a cost code or sub', () => {
    const bare = ACTIVITIES.map(a => ({ ...a, dictionary_id: null, subcontractor_id: null }));
    const { container } = render(<ProductionRates {...baseProps} activities={bare} />);
    expect(container.firstChild).toBeNull();
  });
});

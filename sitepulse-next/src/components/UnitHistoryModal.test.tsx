import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

afterEach(cleanup);
import UnitHistoryModal from './UnitHistoryModal';
import type { Activity, StatusLog } from '@/types/domain';

const auditRows = [
  // newest first, as the query returns them
  { id: 'a3', unit_id: 'u1', activityName: 'Drywall', status_color: '#3366aa', temporal_state: 'ongoing', track: 'Production', planned_start_date: '2026-05-01', planned_end_date: '2026-05-20', logged_date: null, client_timestamp: '2026-06-01T08:00:00Z', created_at: '2026-06-01T08:00:00Z', changed_at: '2026-06-01T08:00:00Z' },
  { id: 'a2', unit_id: 'u1', activityName: 'Framing', status_color: '#3366aa', temporal_state: 'completed', track: 'Production', planned_start_date: null, planned_end_date: null, logged_date: '2026-05-10', client_timestamp: '2026-05-10T15:00:00Z', created_at: '2026-05-10T15:00:00Z', changed_at: '2026-05-10T15:00:00Z' },
  { id: 'a1', unit_id: 'u1', activityName: 'Framing', status_color: '#3366aa', temporal_state: 'ongoing', track: 'Production', planned_start_date: null, planned_end_date: null, logged_date: null, client_timestamp: '2026-04-28T07:00:00Z', created_at: '2026-04-28T07:00:00Z', changed_at: '2026-04-28T07:00:00Z' },
];

vi.mock('@/hooks/useProjectQueries', () => ({
  useUnitHistory: () => ({ data: auditRows, isPending: false }),
}));

function ms(name: string, order: number): Activity {
  return {
    id: `ms-${name}`, project_id: 'p1', name, color: '#3366aa',
    track: 'Production', sequence_order: order, created_at: '2026-01-01T00:00:00Z',
  } as Activity;
}

const ACTIVITIES = [ms('Framing', 1), ms('Drywall', 2), ms('Paint', 3)];

const currentStatuses = [
  { id: 'c1', unit_id: 'u1', activityName: 'Framing', status_color: '#3366aa', temporal_state: 'completed', track: 'Production', planned_start_date: null, planned_end_date: null, logged_date: '2026-05-10', client_timestamp: '2026-05-10T15:00:00Z', created_at: '2026-05-10T15:00:00Z' },
  { id: 'c2', unit_id: 'u1', activityName: 'Drywall', status_color: '#3366aa', temporal_state: 'ongoing', track: 'Production', planned_start_date: '2026-05-01', planned_end_date: '2026-05-20', logged_date: null, client_timestamp: '2026-06-01T08:00:00Z', created_at: '2026-06-01T08:00:00Z' },
] as StatusLog[];

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  unitId: 'u1',
  unitNumber: '304',
  activities: ACTIVITIES,
  trackingMode: 'Production',
  currentStatuses,
};

describe('UnitHistoryModal — Journey view', () => {
  it('defaults to the Journey tab with one swimlane per activity', () => {
    render(<UnitHistoryModal {...baseProps} />);
    expect(screen.getByText('Framing')).toBeTruthy();
    expect(screen.getByText('Drywall')).toBeTruthy();
    expect(screen.getByText('Paint')).toBeTruthy();
    expect(screen.getByText('TODAY')).toBeTruthy();
  });

  it('shows the schedule-variance verdict in the header (Drywall is past planned finish)', () => {
    render(<UnitHistoryModal {...baseProps} />);
    expect(screen.getByText(/behind plan/)).toBeTruthy();
    expect(screen.getByText(/bottleneck: Drywall/)).toBeTruthy();
  });

  it('switches to the Log tab and renders the audit table', () => {
    render(<UnitHistoryModal {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Log' }));
    expect(screen.getByText('Planned Start')).toBeTruthy();
    expect(screen.getAllByText(/Framing|Drywall/).length).toBeGreaterThan(1);
  });

  it('renders nothing when closed', () => {
    const { container } = render(<UnitHistoryModal {...baseProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });
});

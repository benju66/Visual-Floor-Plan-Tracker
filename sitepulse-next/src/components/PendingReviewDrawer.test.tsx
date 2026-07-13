import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import PendingReviewDrawer from './PendingReviewDrawer';
import type { PendingChange, Unit } from '@/types/domain';

// Light render assertion for the Phase 2 drill-in: each row is tagged waiting/failed and a
// failed row exposes a per-item Retry that re-sends JUST that change. The drawer pulls
// online status from onlineManager (jsdom defaults navigator.onLine = true → online), so a
// non-failed row is a plain queued item (no tag) and only the failed row shows "Failed".

const unit = (id: string, number: string) => ({ id, unit_number: number } as Unit);
const activityObj = (name: string) => ({ id: name, name, color: '#3b82f6', track: 'Production' });
const change = (id: string, number: string, name: string, state: PendingChange['state']): PendingChange =>
  ({ unit: unit(id, number), log: null, state, capturedAt: 't', extraProps: { activityObj: activityObj(name) } }) as PendingChange;

afterEach(() => cleanup());

function renderDrawer(over: Partial<React.ComponentProps<typeof PendingReviewDrawer>> = {}) {
  const props: React.ComponentProps<typeof PendingReviewDrawer> = {
    pendingChanges: {
      u1: change('u1', '101', 'Framing', 'completed'),
      u2: change('u2', '102', 'Paint', 'ongoing'),
    },
    pendingTimelineChanges: {},
    failedKeys: new Set<string>(['u1_Framing']),
    onClose: vi.fn(),
    handleApplyAll: vi.fn().mockResolvedValue({ succeeded: 0, failed: 0 }),
    handleLocalDiscardAll: vi.fn(),
    handleDrawerItemRemove: vi.fn(),
    handleRetryItem: vi.fn().mockResolvedValue(true),
    handleStageUpdate: vi.fn(),
    isApplying: false,
    currentActivities: [],
    ...over,
  };
  return { props, ...render(<PendingReviewDrawer {...props} />) };
}

describe('PendingReviewDrawer — Phase 2 per-item waiting/failed + retry', () => {
  it('renders one row per staged change and tags ONLY the failed one', () => {
    renderDrawer();
    expect(screen.getByText('Framing')).toBeTruthy();
    expect(screen.getByText('Paint')).toBeTruthy();
    // u1 is in failedKeys → exactly one "Failed" tag; the online, non-failed u2 has none.
    expect(screen.getAllByText('Failed')).toHaveLength(1);
    // Only the failed row gets a Retry affordance.
    expect(screen.getAllByLabelText('Retry saving this change')).toHaveLength(1);
  });

  it('retrying a failed row re-sends exactly that row\'s staged change', async () => {
    const { props } = renderDrawer();
    fireEvent.click(screen.getByLabelText('Retry saving this change'));
    await waitFor(() => expect(props.handleRetryItem).toHaveBeenCalledTimes(1));
    // Called with the underlying PendingChange for the failed slot (u1/Framing), not the batch.
    expect(props.handleRetryItem).toHaveBeenCalledWith(props.pendingChanges.u1);
  });
});

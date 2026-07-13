import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import BulkActionDock from './BulkActionDock';
import { useMapStore } from '@/store/useMapStore';
import type { Activity } from '@/types/domain';

// ─────────────────────────────────────────────────────────────────────────────
// Bulk Date-Clobber Fix — the dock's payload contract for the date inputs.
// The dock used to send empty date inputs as EXPLICIT nulls; the bulk hook treats
// a present null as "clear this stored date", so every bulk action with untouched
// inputs (the normal case) wiped the selected slots' imported/cascaded planned
// windows. Pin the fix: an empty input sends the key as undefined (omitted from
// the write → stored window preserved); a typed date rides the write.
// ─────────────────────────────────────────────────────────────────────────────

const activities = [
  { id: 'act-1', name: 'Drywall', color: '#3366aa', track: 'production' },
] as unknown as Activity[];

function renderDock(onApplyBulkStatus: (payload: unknown) => void) {
  return render(
    <BulkActionDock
      selectedUnitIds={['u1', 'u2']}
      onClearSelection={vi.fn()}
      activities={activities}
      onApplyBulkStatus={onApplyBulkStatus}
      isPending={false}
    />,
  );
}

beforeEach(() => {
  useMapStore.setState({ trackingMode: 'production' } as never);
});

// Vitest globals are OFF in this repo, so RTL's automatic cleanup (registered via
// a global afterEach) never runs — unmount explicitly or renders leak across tests.
afterEach(cleanup);

describe('BulkActionDock — untouched date inputs never clear stored planned windows', () => {
  it('sends empty date inputs as undefined (omitted), not explicit null', () => {
    const onApply = vi.fn();
    renderDock(onApply);

    // Change only the state (activity stays "Keep Existing"); dates stay untouched.
    const [, stateSelect] = screen.getAllByRole('combobox');
    fireEvent.change(stateSelect, { target: { value: 'ongoing' } });
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const payload = onApply.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.temporal_state).toBe('ongoing');
    expect(payload.activityName).toBe('__KEEP_EXISTING__');
    // The load-bearing assertion: undefined = "leave the stored window alone".
    // (null would be treated as an explicit clear by useBulkUpdateStatus.)
    expect(payload.planned_start_date).toBeUndefined();
    expect(payload.planned_end_date).toBeUndefined();
  });

  it('sends a typed date through and leaves the untyped one undefined', () => {
    const onApply = vi.fn();
    const { container } = renderDock(onApply);

    const [, stateSelect] = screen.getAllByRole('combobox');
    fireEvent.change(stateSelect, { target: { value: 'planned' } });
    const [startInput] = Array.from(container.querySelectorAll('input[type="date"]'));
    fireEvent.change(startInput, { target: { value: '2026-07-20' } });
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    const payload = onApply.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.planned_start_date).toBe('2026-07-20');
    expect(payload.planned_end_date).toBeUndefined();
  });
});

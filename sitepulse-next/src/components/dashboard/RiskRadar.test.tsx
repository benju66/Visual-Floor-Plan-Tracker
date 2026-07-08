import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RiskRadar from './RiskRadar';
import type { PaceMove } from '@/utils/monteCarloForecast';
import type { Unit, Activity, StatusLog, Sheet } from '@/types/domain';
import type { StatusHistoryEvent } from '@/hooks/useProjectQueries';

// RiskRadar takes every input as a prop and uses no React Query — so it renders
// standalone. Live data rarely produces a P4 move (needs two levels with clearly
// different recent pace), so this pins the move line's render path + wording.

const ACTIVITIES = [
  { id: 'a-Framing', project_id: 'p1', name: 'Framing', color: '#123456', track: 'Production', sequence_order: 1, created_at: '2026-01-01T00:00:00Z', applies_to_unit_types: null },
] as unknown as Activity[];

// 15 units, no history, no statuses → Framing suppresses as 'no-pace' and lands
// in the muted group, so the card renders (and the move banner can show).
const UNITS = Array.from({ length: 15 }, (_, i) => ({ id: `u${i}`, unit_type: 'Apartment' })) as unknown as Unit[];
const STATUSES: StatusLog[] = [];
const HISTORY: StatusHistoryEvent[] = [];
const SHEETS = [
  { id: 's1', sheet_name: 'Level 1' },
  { id: 's2', sheet_name: 'Level 2' },
] as unknown as Sheet[];

const MOVE: PaceMove = { fromSheetId: 's2', toSheetId: 's1', daysSaved: 6, projectedFinish: '2026-09-01' };

const baseProps = {
  units: UNITS, statuses: STATUSES, activities: ACTIVITIES, track: 'Production',
  history: HISTORY, sheets: SHEETS, scopeLabel: 'all levels', paceMoveEvaluated: false,
};

describe('RiskRadar — P4 highest-impact move line', () => {
  it('renders the move suggestion (with the caption) at all-levels scope', () => {
    const { container } = render(<RiskRadar {...baseProps} scope="all" paceMove={MOVE} paceMoveEvaluated />);
    expect(container.textContent).toContain(
      "If Level 1 matched Level 2's pace, the projected finish moves up ~6 days.",
    );
    expect(container.textContent).toContain('estimate from recent pace — not crew logistics');
  });

  it('hides the move when scoped to a single level (cross-level only)', () => {
    const { container } = render(<RiskRadar {...baseProps} scope="s1" scopeLabel="Level 1" paceMove={MOVE} paceMoveEvaluated />);
    expect(container.textContent).not.toContain('moves up');
  });

  it('shows the honest "no meaningful move" note when levels were compared and none helps', () => {
    const { container } = render(<RiskRadar {...baseProps} scope="all" paceMove={null} paceMoveEvaluated />);
    expect(container.textContent).toContain('No single pace shift between levels would meaningfully improve the finish date.');
    expect(container.textContent).not.toContain('moves up');
  });

  it('stays silent (no note) when there were not enough levels to evaluate', () => {
    const { container } = render(<RiskRadar {...baseProps} scope="all" paceMove={null} paceMoveEvaluated={false} />);
    expect(container.textContent).not.toContain('No single pace shift');
    expect(container.textContent).not.toContain('moves up');
    // the module itself still renders (Framing sits in the muted group).
    expect(container.textContent).toContain('not enough history yet');
  });
});

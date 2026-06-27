import { describe, it, expect } from 'vitest';
import { toReconcileUnits, summarizeFlaggedOpenings, isExportEligible } from './openingReview';
import type { OpeningEdge, OpeningType, PercentPoint, Unit, WorkbenchDrawing } from '@/types/domain';

const pt = (pctX: number, pctY: number): PercentPoint => ({ pctX, pctY });
const oe = (edgeIndex: number, type: OpeningType = 'door'): OpeningEdge => ({ edgeIndex, type });

// The helpers read only id / polygon_coordinates / opening_edges off a Unit, so a
// minimal fixture (cast through unknown) keeps the tests type-clean without naming
// every column of the generated Row.
const unit = (id: string, polygon: PercentPoint[] | null, openingEdges: OpeningEdge[]): Unit =>
  ({ id, polygon_coordinates: polygon, opening_edges: openingEdges } as unknown as Unit);

const drawing = (review_state: string, fully_traced: boolean): WorkbenchDrawing =>
  ({ workbench: { review_state, fully_traced } } as unknown as WorkbenchDrawing);

// Two unit squares sharing the line x = 0.2 (coincident inner faces). A's right edge
// is index 1; B's left edge is the closing edge index 3 — the same physical wall.
const SQUARE_A: PercentPoint[] = [pt(0, 0), pt(0.2, 0), pt(0.2, 0.2), pt(0, 0.2)];
const SQUARE_B: PercentPoint[] = [pt(0.2, 0), pt(0.4, 0), pt(0.4, 0.2), pt(0.2, 0.2)];

describe('toReconcileUnits', () => {
  it('adapts banked units to the reconciliation shape', () => {
    const out = toReconcileUnits([unit('A', SQUARE_A, [oe(1)])]);
    expect(out).toEqual([{ id: 'A', polygon: SQUARE_A, openingEdges: [oe(1)] }]);
  });

  it('skips rooms without a usable polygon (null / fewer than 3 vertices)', () => {
    const out = toReconcileUnits([
      unit('A', SQUARE_A, [oe(1)]),
      unit('B', null, [oe(0)]),
      unit('C', [pt(0, 0), pt(1, 1)], [oe(0)]),
    ]);
    expect(out.map((u) => u.id)).toEqual(['A']);
  });
});

describe('summarizeFlaggedOpenings', () => {
  it('reports nothing flagged when a shared opening reconciles cleanly', () => {
    const summary = summarizeFlaggedOpenings([
      unit('A', SQUARE_A, [oe(1, 'door')]),
      unit('B', SQUARE_B, [oe(3, 'door')]),
    ]);
    expect(summary).toEqual({ count: 0, detail: null });
  });

  it('flags + describes a door/cased-opening type conflict across a shared wall', () => {
    const summary = summarizeFlaggedOpenings([
      unit('A', SQUARE_A, [oe(1, 'door')]),
      unit('B', SQUARE_B, [oe(3, 'cased_opening')]),
    ]);
    expect(summary.count).toBe(1);
    expect(summary.detail).toBe('1 type conflict');
  });

  it('treats an exterior (one-neighbor) opening as clean, not flagged', () => {
    const summary = summarizeFlaggedOpenings([unit('A', SQUARE_A, [oe(1, 'door')])]);
    expect(summary).toEqual({ count: 0, detail: null });
  });

  it('is clean for a sheet with no opening tags at all', () => {
    const summary = summarizeFlaggedOpenings([unit('A', SQUARE_A, []), unit('B', SQUARE_B, [])]);
    expect(summary).toEqual({ count: 0, detail: null });
  });
});

describe('isExportEligible', () => {
  const cleanUnits = [unit('A', SQUARE_A, [oe(1, 'door')]), unit('B', SQUARE_B, [oe(3, 'door')])];
  const conflictUnits = [unit('A', SQUARE_A, [oe(1, 'door')]), unit('B', SQUARE_B, [oe(3, 'cased_opening')])];

  it('is eligible only when reviewed AND fully_traced AND nothing flagged', () => {
    expect(isExportEligible(drawing('reviewed', true), cleanUnits)).toBe(true);
  });

  it('excludes a sheet that is not yet reviewed', () => {
    expect(isExportEligible(drawing('ready_for_review', true), cleanUnits)).toBe(false);
    expect(isExportEligible(drawing('draft', true), cleanUnits)).toBe(false);
  });

  it('excludes a fully_traced=false sheet even when reviewed + clean (training-eligibility gate)', () => {
    expect(isExportEligible(drawing('reviewed', false), cleanUnits)).toBe(false);
  });

  it('excludes a sheet with an unresolved flagged opening', () => {
    expect(isExportEligible(drawing('reviewed', true), conflictUnits)).toBe(false);
  });

  it('excludes a drawing with no workbench sidecar', () => {
    const noSidecar = { workbench: null } as unknown as WorkbenchDrawing;
    expect(isExportEligible(noSidecar, cleanUnits)).toBe(false);
  });
});

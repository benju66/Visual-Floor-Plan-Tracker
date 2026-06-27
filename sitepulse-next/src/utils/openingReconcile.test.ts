import { describe, it, expect } from 'vitest';
import { reconcileOpenings, type ReconcileUnit } from '@/utils/openingReconcile';
import type { OpeningEdge, OpeningType, PercentPoint } from '@/types/domain';

const pt = (pctX: number, pctY: number): PercentPoint => ({ pctX, pctY });
const oe = (edgeIndex: number, type: OpeningType = 'door'): OpeningEdge => ({ edgeIndex, type });
const unit = (id: string, polygon: PercentPoint[], openingEdges: OpeningEdge[]): ReconcileUnit => ({
  id,
  polygon,
  openingEdges,
});

// Two unit squares sharing the line x = 0.2. A's right edge is index 1; B's left
// edge is the closing edge index 3.
const SQUARE_A: PercentPoint[] = [pt(0, 0), pt(0.2, 0), pt(0.2, 0.2), pt(0, 0.2)];
const SQUARE_B_TOUCHING: PercentPoint[] = [pt(0.2, 0), pt(0.4, 0), pt(0.4, 0.2), pt(0.2, 0.2)];
// B offset right by a 0.02 wall thickness (inner faces no longer coincident).
const SQUARE_B_OFFSET: PercentPoint[] = [pt(0.22, 0), pt(0.42, 0), pt(0.42, 0.2), pt(0.22, 0.2)];

describe('reconcileOpenings — cross-wall pairing', () => {
  it('merges a thin-wall pair (coincident inner faces) into one shared opening', () => {
    const { openings, adjacency } = reconcileOpenings([
      unit('A', SQUARE_A, [oe(1, 'door')]),
      unit('B', SQUARE_B_TOUCHING, [oe(3, 'door')]),
    ]);
    expect(openings).toHaveLength(1);
    expect(openings[0].neighborUnitIds).toEqual(['A', 'B']);
    expect(openings[0].type).toBe('door');
    expect(openings[0].flagged).toBe(false);
    expect(openings[0].confidence).toBeGreaterThan(0.9);
    expect(openings[0].sourceEdges).toHaveLength(2);
    expect(adjacency).toEqual([['A', 'B']]);
  });

  it('merges a thick-wall pair (parallel inner faces offset by the wall)', () => {
    const { openings } = reconcileOpenings([
      unit('A', SQUARE_A, [oe(1, 'door')]),
      unit('B', SQUARE_B_OFFSET, [oe(3, 'door')]),
    ]);
    expect(openings).toHaveLength(1);
    expect(openings[0].neighborUnitIds).toEqual(['A', 'B']);
    expect(openings[0].flagged).toBe(false);
  });

  it('no-scale fallback: the conservative default band still pairs without scale info', () => {
    // Called with NO options (no aspect/band from a known scale) — defaults hold.
    const { openings } = reconcileOpenings([
      unit('A', SQUARE_A, [oe(1)]),
      unit('B', SQUARE_B_OFFSET, [oe(3)]),
    ]);
    expect(openings).toHaveLength(1);
    expect(openings[0].neighborUnitIds).toEqual(['A', 'B']);
  });

  it('keeps an exterior tag as a valid one-neighbor opening (nothing invented)', () => {
    const { openings, adjacency } = reconcileOpenings([unit('A', SQUARE_A, [oe(1, 'door')])]);
    expect(openings).toHaveLength(1);
    expect(openings[0].neighborUnitIds).toEqual(['A']);
    expect(openings[0].flagged).toBe(false);
    expect(adjacency).toEqual([]);
  });

  it('does NOT merge parallel edges that fail projection overlap (offset along the wall)', () => {
    // B's left edge is parallel and on the same x-line, but its y-span is disjoint.
    const B_FAR: PercentPoint[] = [pt(0.2, 0.5), pt(0.4, 0.5), pt(0.4, 0.7), pt(0.2, 0.7)];
    const { openings, adjacency } = reconcileOpenings([
      unit('A', SQUARE_A, [oe(1, 'door')]),
      unit('B', B_FAR, [oe(3, 'door')]),
    ]);
    expect(openings).toHaveLength(2);
    expect(openings.every((o) => o.neighborUnitIds.length === 1)).toBe(true);
    expect(adjacency).toEqual([]);
  });

  it('separates two doorways on the same shared wall (projection keeps them distinct)', () => {
    // A right wall with two doorways (edges 2 and 4); B mirrors them (edges 6 and 4).
    const A: PercentPoint[] = [
      pt(0, 0), pt(0.2, 0), pt(0.2, 0.1), pt(0.2, 0.2), pt(0.2, 0.4), pt(0.2, 0.5), pt(0.2, 0.6), pt(0, 0.6),
    ];
    const B: PercentPoint[] = [
      pt(0.2, 0), pt(0.4, 0), pt(0.4, 0.6), pt(0.2, 0.6), pt(0.2, 0.5), pt(0.2, 0.4), pt(0.2, 0.2), pt(0.2, 0.1),
    ];
    const { openings, adjacency } = reconcileOpenings([
      unit('A', A, [oe(2, 'door'), oe(4, 'door')]),
      unit('B', B, [oe(6, 'door'), oe(4, 'door')]),
    ]);
    expect(openings).toHaveLength(2);
    expect(openings.every((o) => o.neighborUnitIds.length === 2 && !o.flagged)).toBe(true);
    expect(adjacency).toEqual([['A', 'B']]); // one connection, deduped
  });

  it('flags a type conflict, merging with a deterministic tiebreak (door < cased_opening)', () => {
    const { openings } = reconcileOpenings([
      unit('A', SQUARE_A, [oe(1, 'door')]),
      unit('B', SQUARE_B_TOUCHING, [oe(3, 'cased_opening')]),
    ]);
    expect(openings).toHaveLength(1);
    const op = openings[0];
    expect(op.neighborUnitIds).toEqual(['A', 'B']);
    expect(op.flagged).toBe(true);
    expect(op.flagReason).toBe('type_conflict');
    expect(op.type).toBe('door'); // earliest in OPENING_TYPES wins
    // Both original types are retained in the sources (the raw truth is never lost).
    expect(op.sourceEdges.map((s) => s.type).sort()).toEqual(['cased_opening', 'door']);
  });

  it('is deterministic and never mutates the raw opening tags', () => {
    const aEdges = [oe(1, 'door')];
    const bEdges = [oe(3, 'door')];
    const units = [unit('A', SQUARE_A, aEdges), unit('B', SQUARE_B_TOUCHING, bEdges)];
    const r1 = reconcileOpenings(units);
    const r2 = reconcileOpenings(units);
    expect(r1).toEqual(r2); // deterministic ids + ordering
    expect(aEdges).toEqual([oe(1, 'door')]); // inputs untouched
    expect(bEdges).toEqual([oe(3, 'door')]);
  });
});

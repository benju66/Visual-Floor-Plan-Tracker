import { describe, it, expect } from 'vitest';
import {
  parseBubbleLabel,
  inferAxis,
  toGridline,
  toSuggestedGridline,
  deriveGridlineSource,
  mapPendingGridlinesToRow,
  type PendingGridline,
} from '@/utils/gridlineParse';
import type { TextWord, PercentRect, Gridline } from '@/types/domain';

// A word at a position (percent space).
const w = (text: string, pctX: number, pctY: number): TextWord => ({ text, pctX, pctY });
// A box around the bubble center (0.5, 0.5).
const BOX: PercentRect = { x0: 0.45, y0: 0.45, x1: 0.55, y1: 0.55 };

// A pending grid factory (geometry irrelevant unless the test cares).
const pending = (
  label: string,
  suggestedLabel: string | null,
  axis: 'h' | 'v' = 'v',
): PendingGridline => ({
  id: `${label}-${axis}`,
  label,
  suggestedLabel,
  p1: { pctX: 0.2, pctY: 0.1 },
  p2: { pctX: 0.2, pctY: 0.9 },
  axis,
});

describe('parseBubbleLabel', () => {
  it('reads a column letter and uppercases it', () => {
    expect(parseBubbleLabel([w('a', 0.5, 0.5)], BOX)).toBe('A');
  });

  it('reads a row number', () => {
    expect(parseBubbleLabel([w('12', 0.5, 0.5)], BOX)).toBe('12');
  });

  it('reads a doubled column letter ("AA")', () => {
    expect(parseBubbleLabel([w('AA', 0.5, 0.5)], BOX)).toBe('AA');
  });

  it('picks the token nearest the box center over an edge distractor', () => {
    const words = [
      w('A', 0.5, 0.5), // dead center
      w('7', 0.46, 0.46), // near a corner — a stray dimension tick
    ];
    expect(parseBubbleLabel(words, BOX)).toBe('A');
  });

  it('ignores tokens outside the box', () => {
    expect(parseBubbleLabel([w('B', 0.9, 0.9)], BOX)).toBeNull();
  });

  it('rejects a hyphenated sheet number (not a bubble token)', () => {
    expect(parseBubbleLabel([w('A-201', 0.5, 0.5)], BOX)).toBeNull();
  });

  it('rejects a multi-character word / room name', () => {
    expect(parseBubbleLabel([w('KITCHEN', 0.5, 0.5)], BOX)).toBeNull();
  });

  it('returns null for empty / blank input (never throws)', () => {
    expect(parseBubbleLabel([], BOX)).toBeNull();
    expect(parseBubbleLabel(null, BOX)).toBeNull();
    expect(parseBubbleLabel(undefined, BOX)).toBeNull();
  });
});

describe('inferAxis', () => {
  it('is "h" for a more-horizontal drag', () => {
    expect(inferAxis({ pctX: 0.1, pctY: 0.5 }, { pctX: 0.9, pctY: 0.52 })).toBe('h');
  });

  it('is "v" for a more-vertical drag', () => {
    expect(inferAxis({ pctX: 0.3, pctY: 0.1 }, { pctX: 0.31, pctY: 0.9 })).toBe('v');
  });

  it('resolves a perfectly diagonal drag to "h" (>=)', () => {
    expect(inferAxis({ pctX: 0, pctY: 0 }, { pctX: 0.5, pctY: 0.5 })).toBe('h');
  });
});

describe('toGridline / toSuggestedGridline', () => {
  const p = pending('  B  ', 'A', 'h');

  it('toGridline keeps the trimmed FINAL label + geometry + axis', () => {
    expect(toGridline(p)).toEqual({ label: 'B', p1: p.p1, p2: p.p2, axis: 'h' });
  });

  it('toSuggestedGridline keeps the FROZEN read label + same geometry', () => {
    expect(toSuggestedGridline(p)).toEqual({ label: 'A', p1: p.p1, p2: p.p2, axis: 'h' });
  });

  it('toSuggestedGridline maps a null read to an empty label', () => {
    expect(toSuggestedGridline(pending('C', null)).label).toBe('');
  });
});

describe('deriveGridlineSource', () => {
  const g = (label: string): Gridline => ({
    label,
    p1: { pctX: 0, pctY: 0 },
    p2: { pctX: 0, pctY: 1 },
    axis: 'v',
  });

  it('is "human" when no grid carried a machine read', () => {
    expect(deriveGridlineSource([g('A'), g('B')], [g(''), g('')])).toBe('human');
  });

  it('is "ai_accepted" when every read was kept exactly', () => {
    expect(deriveGridlineSource([g('A'), g('1')], [g('A'), g('1')])).toBe('ai_accepted');
  });

  it('is "ai_edited" when a read was corrected', () => {
    expect(deriveGridlineSource([g('A'), g('2')], [g('A'), g('1')])).toBe('ai_edited');
  });

  it('is "ai_edited" when a hand-typed label is mixed with reads', () => {
    // Second grid had no read (suggested ''), human typed "B" → a correction.
    expect(deriveGridlineSource([g('A'), g('B')], [g('A'), g('')])).toBe('ai_edited');
  });
});

describe('mapPendingGridlinesToRow (accept-all bulk-confirm)', () => {
  it('maps a batch of all-read grids onto an empty sheet → accepted', () => {
    const out = mapPendingGridlinesToRow([pending('A', 'A'), pending('B', 'B')], null);
    expect(out.gridlines.map((x) => x.label)).toEqual(['A', 'B']);
    expect(out.suggested.map((x) => x.label)).toEqual(['A', 'B']);
    expect(out.source).toBe('ai_accepted');
  });

  it('APPENDS the new batch onto already-saved grids (one upsert replaces the array)', () => {
    const existing = {
      gridlines: [toGridline(pending('A', 'A'))],
      suggested: [toSuggestedGridline(pending('A', 'A'))],
    };
    const out = mapPendingGridlinesToRow([pending('B', 'B', 'h')], existing);
    expect(out.gridlines.map((x) => x.label)).toEqual(['A', 'B']);
    expect(out.gridlines).toHaveLength(2);
    expect(out.suggested).toHaveLength(2);
  });

  it('keeps the final + suggested arrays index-aligned (so source compares correctly)', () => {
    // One read kept, one read corrected → the rolled-up source is edited.
    const out = mapPendingGridlinesToRow([pending('A', 'A'), pending('2', '1')], null);
    expect(out.source).toBe('ai_edited');
    expect(out.gridlines[1].label).toBe('2');
    expect(out.suggested[1].label).toBe('1');
  });

  it('drops blank-labeled pending grids (an axis the human never labeled)', () => {
    const out = mapPendingGridlinesToRow([pending('A', 'A'), pending('   ', null)], null);
    expect(out.gridlines.map((x) => x.label)).toEqual(['A']);
  });

  it('returns the existing arrays unchanged when nothing is pending', () => {
    const existing = {
      gridlines: [toGridline(pending('A', 'A'))],
      suggested: [toSuggestedGridline(pending('A', 'A'))],
    };
    const out = mapPendingGridlinesToRow([], existing);
    expect(out.gridlines).toHaveLength(1);
    expect(out.source).toBe('ai_accepted');
  });
});

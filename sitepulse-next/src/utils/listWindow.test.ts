import { describe, it, expect } from 'vitest';
import { windowPadding, estimateRowHeight } from './listWindow';

describe('windowPadding', () => {
  it('returns zero padding for an empty window', () => {
    expect(windowPadding([], 0)).toEqual({ paddingTop: 0, paddingBottom: 0 });
    expect(windowPadding([], 6400)).toEqual({ paddingTop: 0, paddingBottom: 0 });
  });

  it('pads above the first rendered item and below the last', () => {
    // Blocks 5..7 rendered out of a 6400px total content space.
    const items = [
      { start: 320, end: 384 },
      { start: 384, end: 448 },
      { start: 448, end: 512 },
    ];
    expect(windowPadding(items, 6400)).toEqual({ paddingTop: 320, paddingBottom: 6400 - 512 });
  });

  it('has no top padding when the window starts at 0 (scrolled to top)', () => {
    const items = [{ start: 0, end: 64 }, { start: 64, end: 128 }];
    expect(windowPadding(items, 6400)).toEqual({ paddingTop: 0, paddingBottom: 6400 - 128 });
  });

  it('has no bottom padding when the window ends at the total (scrolled to bottom)', () => {
    const items = [{ start: 6272, end: 6336 }, { start: 6336, end: 6400 }];
    expect(windowPadding(items, 6400)).toEqual({ paddingTop: 6272, paddingBottom: 0 });
  });

  it('handles a single rendered item', () => {
    expect(windowPadding([{ start: 100, end: 160 }], 500)).toEqual({ paddingTop: 100, paddingBottom: 340 });
  });

  it('clamps transient negatives to zero (a block re-measuring taller than totalSize for a frame)', () => {
    expect(windowPadding([{ start: 0, end: 700 }], 650)).toEqual({ paddingTop: 0, paddingBottom: 0 });
    expect(windowPadding([{ start: -5, end: 60 }], 650)).toEqual({ paddingTop: 0, paddingBottom: 590 });
  });
});

describe('estimateRowHeight', () => {
  it('estimates a shorter row for compact density than comfortable', () => {
    expect(estimateRowHeight('compact')).toBeLessThan(estimateRowHeight('comfortable'));
  });

  it('returns positive estimates for both densities', () => {
    expect(estimateRowHeight('comfortable')).toBeGreaterThan(0);
    expect(estimateRowHeight('compact')).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from 'vitest';
import { isPercentPointArray } from './domain';

// isPercentPointArray is the runtime guard that narrows the JSONB
// `polygon_coordinates` column at the query boundary (see AGENTS.md §6).
// A regression here lets raw Json leak into component props.
describe('isPercentPointArray', () => {
  it('accepts an array of valid percent points', () => {
    expect(isPercentPointArray([{ pctX: 0.1, pctY: 0.2 }, { pctX: 0.5, pctY: 0.9 }])).toBe(true);
  });

  it('accepts an empty array', () => {
    expect(isPercentPointArray([])).toBe(true);
  });

  it('rejects a non-array', () => {
    expect(isPercentPointArray({ pctX: 0, pctY: 0 })).toBe(false);
    expect(isPercentPointArray(null)).toBe(false);
    expect(isPercentPointArray(undefined)).toBe(false);
    expect(isPercentPointArray('[]')).toBe(false);
  });

  it('rejects arrays with malformed points', () => {
    expect(isPercentPointArray([{ pctX: 0.1 }])).toBe(false);
    expect(isPercentPointArray([{ pctX: '0.1', pctY: '0.2' }])).toBe(false);
    expect(isPercentPointArray([{ x: 0.1, y: 0.2 }])).toBe(false);
    expect(isPercentPointArray([42])).toBe(false);
  });
});

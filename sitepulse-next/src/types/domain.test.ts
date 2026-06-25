import { describe, it, expect } from 'vitest';
import { isPercentPointArray, isStringArray, isProjectTypeArray, isTextWordArray } from './domain';

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

// isStringArray narrows the `subtypes.aliases` JSONB at the query boundary.
describe('isStringArray', () => {
  it('accepts a string array (and the empty array)', () => {
    expect(isStringArray(['Salon Suite', 'Hair Studio'])).toBe(true);
    expect(isStringArray([])).toBe(true);
  });

  it('rejects non-arrays and arrays with non-string elements', () => {
    expect(isStringArray(null)).toBe(false);
    expect(isStringArray(undefined)).toBe(false);
    expect(isStringArray('Salon Suite')).toBe(false);
    expect(isStringArray(['ok', 42])).toBe(false);
    expect(isStringArray([null])).toBe(false);
  });
});

// isTextWordArray narrows the `sheet_text.text` JSONB at the query boundary
// (AI Tracing Assist — Phase 2). An empty array is the valid scanned-sheet state.
describe('isTextWordArray', () => {
  it('accepts an array of located words (and the empty / scanned-sheet array)', () => {
    expect(isTextWordArray([{ text: 'OFFICE', pctX: 0.5, pctY: 0.5 }])).toBe(true);
    expect(isTextWordArray([])).toBe(true);
  });

  it('rejects non-arrays and arrays with malformed words', () => {
    expect(isTextWordArray(null)).toBe(false);
    expect(isTextWordArray(undefined)).toBe(false);
    expect(isTextWordArray('OFFICE')).toBe(false);
    expect(isTextWordArray([{ text: 'OFFICE', pctX: '0.5', pctY: 0.5 }])).toBe(false);
    expect(isTextWordArray([{ text: 417, pctX: 0.5, pctY: 0.5 }])).toBe(false);
    expect(isTextWordArray([{ pctX: 0.5, pctY: 0.5 }])).toBe(false);
  });
});

// isProjectTypeArray narrows the `subtypes.default_project_types` JSONB.
describe('isProjectTypeArray', () => {
  it('accepts arrays of valid canonical project types (and empty)', () => {
    expect(isProjectTypeArray(['Healthcare', 'Industrial'])).toBe(true);
    expect(isProjectTypeArray([])).toBe(true);
  });

  it('rejects unknown strings, non-strings, and non-arrays', () => {
    expect(isProjectTypeArray(['Healthcare', 'Bogus'])).toBe(false);
    expect(isProjectTypeArray(['healthcare'])).toBe(false); // case-sensitive
    expect(isProjectTypeArray([42])).toBe(false);
    expect(isProjectTypeArray('Healthcare')).toBe(false);
    expect(isProjectTypeArray(null)).toBe(false);
  });
});

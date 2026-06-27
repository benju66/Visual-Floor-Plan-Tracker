import { describe, it, expect } from 'vitest';
import {
  normalizeLocationName,
  isNameUniqueOnSheet,
  suggestNextName,
  definitionOfDoneChecks,
  type LabelForReview,
  type ReviewCompleteness,
} from './workbenchNaming';

describe('normalizeLocationName', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeLocationName('  301 ')).toBe('301');
  });

  it('collapses internal whitespace runs to a single space', () => {
    expect(normalizeLocationName('Court   1')).toBe('Court 1');
    expect(normalizeLocationName('Exam\t\tRoom')).toBe('Exam Room');
  });

  it('returns empty for whitespace-only input', () => {
    expect(normalizeLocationName('   ')).toBe('');
    expect(normalizeLocationName('')).toBe('');
  });
});

describe('isNameUniqueOnSheet', () => {
  it('treats normalized + case-insensitive matches as duplicates', () => {
    const existing = ['Room 1', 'Lobby'];
    expect(isNameUniqueOnSheet('room 1', existing)).toBe(false);
    expect(isNameUniqueOnSheet(' Room  1 ', existing)).toBe(false);
    expect(isNameUniqueOnSheet('Room 2', existing)).toBe(true);
  });

  it('is never unique for a blank name', () => {
    expect(isNameUniqueOnSheet('', ['Lobby'])).toBe(false);
    expect(isNameUniqueOnSheet('   ', [])).toBe(false);
  });

  it('is unique against an empty sheet', () => {
    expect(isNameUniqueOnSheet('301', [])).toBe(true);
  });
});

describe('suggestNextName', () => {
  it('increments a plain numeric series', () => {
    expect(suggestNextName(['301', '302'])).toBe('303');
  });

  it('increments a prefixed series, preserving the prefix and padding', () => {
    expect(suggestNextName(['A-104', 'A-105'])).toBe('A-106');
    expect(suggestNextName(['009', '010'])).toBe('011');
  });

  it('increments a trailing-number series with a word prefix', () => {
    expect(suggestNextName(['Court 1', 'Court 2'])).toBe('Court 3');
  });

  it('returns null when no name ends in a number', () => {
    expect(suggestNextName(['Lobby', 'Kitchen'])).toBeNull();
    expect(suggestNextName([])).toBeNull();
  });

  it('follows the dominant series when prefixes are mixed', () => {
    // The "Room " series has more members than the lone "A-" entry, so it wins.
    expect(suggestNextName(['Room 1', 'Room 2', 'Room 3', 'A-104'])).toBe('Room 4');
  });

  it('breaks an equal-size tie by the higher max number', () => {
    // Both prefixes have one member; "200" is the higher series.
    expect(suggestNextName(['A-100', 'B-200'])).toBe('B-201');
  });

  it('handles a single existing name', () => {
    expect(suggestNextName(['Suite 410'])).toBe('Suite 411');
  });
});

describe('definitionOfDoneChecks', () => {
  const ok: LabelForReview[] = [
    { unit_number: '301', top_level_role: 'program' },
    { unit_number: '302', top_level_role: 'support' },
  ];
  // The §4c review-completeness inputs in their "all clear" state, so the naming
  // tests below isolate the check they target.
  const clear: ReviewCompleteness = { flaggedOpenings: 0, flaggedDetail: null, fullyTraced: true };

  it('passes when every label is named, trimmed, unique, typed, openings-clear, and complete', () => {
    const result = definitionOfDoneChecks(ok, clear);
    expect(result.passed).toBe(true);
    expect(result.totalLabels).toBe(2);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it('fails an empty drawing (no labels)', () => {
    const result = definitionOfDoneChecks([], clear);
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'has-labels')?.passed).toBe(false);
  });

  it('flags an unnamed label', () => {
    const result = definitionOfDoneChecks(
      [
        { unit_number: '301', top_level_role: 'program' },
        { unit_number: '  ', top_level_role: 'program' },
      ],
      clear,
    );
    expect(result.passed).toBe(false);
    const named = result.checks.find((c) => c.id === 'all-named');
    expect(named?.passed).toBe(false);
    expect(named?.detail).toBe('1 unnamed');
  });

  it('flags stray whitespace in a name', () => {
    const result = definitionOfDoneChecks([{ unit_number: 'Room  1', top_level_role: 'program' }], clear);
    expect(result.checks.find((c) => c.id === 'names-trimmed')?.passed).toBe(false);
  });

  it('flags duplicate names (normalized, case-insensitive)', () => {
    const result = definitionOfDoneChecks(
      [
        { unit_number: 'Room 1', top_level_role: 'program' },
        { unit_number: 'room 1', top_level_role: 'support' },
      ],
      clear,
    );
    const unique = result.checks.find((c) => c.id === 'names-unique');
    expect(unique?.passed).toBe(false);
    expect(unique?.detail).toBe('1 duplicated');
  });

  it('flags a label missing a role/type', () => {
    const result = definitionOfDoneChecks(
      [
        { unit_number: '301', top_level_role: 'program' },
        { unit_number: '302', top_level_role: null },
      ],
      clear,
    );
    const typed = result.checks.find((c) => c.id === 'all-typed');
    expect(typed?.passed).toBe(false);
    expect(typed?.detail).toBe('1 without a type');
  });

  // ── AI Tracing Assist §4c — the two new sign-off checks ──

  it('blocks sign-off while an opening is flagged, surfacing the reason', () => {
    const result = definitionOfDoneChecks(ok, { flaggedOpenings: 1, flaggedDetail: '1 type conflict', fullyTraced: true });
    expect(result.passed).toBe(false);
    const openings = result.checks.find((c) => c.id === 'openings-resolved');
    expect(openings?.passed).toBe(false);
    expect(openings?.detail).toBe('1 type conflict');
  });

  it('falls back to a generic flagged count when no reason detail is given', () => {
    const result = definitionOfDoneChecks(ok, { flaggedOpenings: 2, fullyTraced: true });
    expect(result.checks.find((c) => c.id === 'openings-resolved')?.detail).toBe('2 flagged');
  });

  it('blocks sign-off until the sheet is marked fully traced', () => {
    const result = definitionOfDoneChecks(ok, { flaggedOpenings: 0, fullyTraced: false });
    expect(result.passed).toBe(false);
    const complete = result.checks.find((c) => c.id === 'sheet-complete');
    expect(complete?.passed).toBe(false);
    expect(complete?.detail).toBe('Confirm completeness below');
  });

  it('passes the §4c checks once openings are clear and the sheet is complete', () => {
    const result = definitionOfDoneChecks(ok, clear);
    expect(result.checks.find((c) => c.id === 'openings-resolved')?.passed).toBe(true);
    expect(result.checks.find((c) => c.id === 'sheet-complete')?.passed).toBe(true);
  });
});

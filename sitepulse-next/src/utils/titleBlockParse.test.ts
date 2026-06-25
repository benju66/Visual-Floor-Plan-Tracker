import { describe, it, expect } from 'vitest';
import {
  parseTitleBlock,
  wordsToLines,
  normalizeRect,
  deriveTitleBlockSource,
} from '@/utils/titleBlockParse';
import type { TextWord, PercentRect, TitleBlockFields } from '@/types/domain';

// Helper: a word at a position (percent space).
const w = (text: string, pctX: number, pctY: number): TextWord => ({ text, pctX, pctY });

// A box covering the whole sheet, so tests that don't care about position pass all words.
const FULL: PercentRect = { x0: 0, y0: 0, x1: 1, y1: 1 };

describe('normalizeRect', () => {
  it('orders any two opposite corners into top-left-anchored bounds', () => {
    const r = normalizeRect({ pctX: 0.8, pctY: 0.9 }, { pctX: 0.6, pctY: 0.7 });
    expect(r).toEqual({ x0: 0.6, y0: 0.7, x1: 0.8, y1: 0.9 });
  });
});

describe('wordsToLines', () => {
  it('filters to the box and groups words on the same baseline left-to-right', () => {
    const words = [
      w('SECOND', 0.7, 0.5),
      w('FLOOR', 0.75, 0.5),
      w('PLAN', 0.8, 0.5),
      w('A-201', 0.9, 0.95),
      w('OUTSIDE', 0.1, 0.1), // outside a bottom-right box
    ];
    const box: PercentRect = { x0: 0.6, y0: 0.4, x1: 1, y1: 1 };
    const lines = wordsToLines(words, box);
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe('SECOND FLOOR PLAN');
    expect(lines[1].text).toBe('A-201');
  });

  it('returns [] when no word falls inside the box', () => {
    expect(wordsToLines([w('X', 0.1, 0.1)], { x0: 0.5, y0: 0.5, x1: 1, y1: 1 })).toEqual([]);
  });
});

describe('parseTitleBlock — sheet number', () => {
  it('reads a hyphenated sheet number', () => {
    const out = parseTitleBlock([w('A-201', 0.9, 0.95)], FULL);
    expect(out.sheetNumber).toBe('A-201');
  });

  it('prefers the candidate nearest the bottom-right corner', () => {
    // Two number-shaped tokens; the bottom-right one is the sheet number.
    const words = [w('A-100', 0.65, 0.55), w('A-201', 0.92, 0.96)];
    expect(parseTitleBlock(words, FULL).sheetNumber).toBe('A-201');
  });

  it('collapses an internal space ("A 201" → "A201")', () => {
    expect(parseTitleBlock([w('A 201', 0.9, 0.95)], FULL).sheetNumber).toBe('A201');
  });

  it('does not mistake a bare room number for a sheet number', () => {
    expect(parseTitleBlock([w('417', 0.9, 0.95)], FULL).sheetNumber).toBeNull();
  });
});

describe('parseTitleBlock — sheet name', () => {
  it('reads a single-line plan name', () => {
    const words = [w('SECOND', 0.7, 0.5), w('FLOOR', 0.75, 0.5), w('PLAN', 0.8, 0.5)];
    expect(parseTitleBlock(words, FULL).sheetName).toBe('SECOND FLOOR PLAN');
  });

  it('joins a two-line name when "PLAN" sits alone under its title', () => {
    const words = [
      w('SECOND', 0.7, 0.48),
      w('FLOOR', 0.75, 0.48),
      w('PLAN', 0.72, 0.52),
    ];
    expect(parseTitleBlock(words, FULL).sheetName).toBe('SECOND FLOOR PLAN');
  });

  it('recognizes non-plan discipline sheets', () => {
    const words = [w('EXTERIOR', 0.7, 0.5), w('ELEVATIONS', 0.78, 0.5)];
    expect(parseTitleBlock(words, FULL).sheetName).toBe('EXTERIOR ELEVATIONS');
  });

  it('returns null when no sheet-name keyword is present', () => {
    expect(parseTitleBlock([w('GENERAL', 0.7, 0.5), w('CONTRACTOR', 0.8, 0.5)], FULL).sheetName).toBeNull();
  });
});

describe('parseTitleBlock — architect/firm (the copyright-notice case)', () => {
  it('parses the firm from a "written permission of …" notice (LaSalle → RSP Architects)', () => {
    // The proprietary notice spread across several words on one baseline.
    const notice =
      'Reproduction of this drawing without the written permission of RSP Architects is prohibited.'.split(
        ' ',
      );
    const words = notice.map((tok, i) => w(tok, 0.62 + i * 0.01, 0.9));
    expect(parseTitleBlock(words, FULL).architectFirm).toBe('RSP Architects');
  });

  it('parses a "property of" notice', () => {
    const words = 'This drawing is the property of Crew Architects and Associates'
      .split(' ')
      .map((tok, i) => w(tok, 0.6 + i * 0.01, 0.88));
    // "and" is a clause boundary → stops at "Crew Architects".
    expect(parseTitleBlock(words, FULL).architectFirm).toBe('Crew Architects');
  });

  it('parses a "© YEAR FIRM" notice', () => {
    const words = '© 2024 Aldi Design Group'.split(' ').map((tok, i) => w(tok, 0.6 + i * 0.01, 0.9));
    expect(parseTitleBlock(words, FULL).architectFirm).toBe('Aldi Design Group');
  });

  it('falls back to a firm-suffix line when there is no notice', () => {
    const words = [w('RSP', 0.7, 0.2), w('Architects', 0.75, 0.2)];
    expect(parseTitleBlock(words, FULL).architectFirm).toBe('RSP Architects');
  });

  it('does not capture a whole sentence as a firm name', () => {
    const words = 'These documents remain the exclusive intellectual property of the design professional named hereon for all purposes whatsoever'
      .split(' ')
      .map((tok, i) => w(tok, 0.6 + i * 0.005, 0.9));
    // Too long after the boundary cut → rejected rather than a sentence-as-firm.
    const firm = parseTitleBlock(words, FULL).architectFirm;
    expect(firm === null || firm.split(' ').length <= 8).toBe(true);
  });
});

describe('deriveTitleBlockSource (proposal → provenance)', () => {
  const proposal: TitleBlockFields = {
    sheetNumber: 'A-201',
    sheetName: 'SECOND FLOOR PLAN',
    architectFirm: 'RSP Architects',
  };

  it('is "human" when there was no machine proposal', () => {
    expect(deriveTitleBlockSource(null, proposal)).toBe('human');
  });

  it('is "ai_accepted" when all three fields are kept exactly', () => {
    expect(deriveTitleBlockSource(proposal, { ...proposal })).toBe('ai_accepted');
  });

  it('treats whitespace-only differences as accepted', () => {
    expect(
      deriveTitleBlockSource(proposal, { ...proposal, sheetName: '  SECOND FLOOR PLAN  ' }),
    ).toBe('ai_accepted');
  });

  it('is "ai_edited" when any field changes (e.g. firm corrected)', () => {
    expect(
      deriveTitleBlockSource(proposal, { ...proposal, architectFirm: 'RSP Architects Inc.' }),
    ).toBe('ai_edited');
  });

  it('is "ai_edited" when a proposed field is cleared by the human', () => {
    expect(deriveTitleBlockSource(proposal, { ...proposal, sheetNumber: null })).toBe('ai_edited');
  });
});

describe('parseTitleBlock — full title block + edge cases', () => {
  it('reads all three fields from a realistic title block', () => {
    const words = [
      w('SECOND', 0.7, 0.5),
      w('FLOOR', 0.75, 0.5),
      w('PLAN', 0.8, 0.5),
      ...'without the written permission of RSP Architects'
        .split(' ')
        .map((tok, i) => w(tok, 0.62 + i * 0.01, 0.88)),
      w('A-201', 0.92, 0.96),
    ];
    const out = parseTitleBlock(words, FULL);
    expect(out).toEqual({
      sheetNumber: 'A-201',
      sheetName: 'SECOND FLOOR PLAN',
      architectFirm: 'RSP Architects',
    });
  });

  it('returns all-null for empty/blank input (never throws)', () => {
    expect(parseTitleBlock([], FULL)).toEqual({ sheetNumber: null, sheetName: null, architectFirm: null });
    expect(parseTitleBlock(null, FULL)).toEqual({ sheetNumber: null, sheetName: null, architectFirm: null });
  });

  it('only parses words inside the dragged box', () => {
    // The title block is bottom-right; a same-shaped distractor sits top-left.
    const words = [
      w('A-999', 0.05, 0.05),
      w('FIRST', 0.7, 0.5),
      w('FLOOR', 0.76, 0.5),
      w('PLAN', 0.82, 0.5),
      w('A-201', 0.92, 0.96),
    ];
    const box: PercentRect = { x0: 0.6, y0: 0.4, x1: 1, y1: 1 };
    const out = parseTitleBlock(words, box);
    expect(out.sheetNumber).toBe('A-201');
    expect(out.sheetName).toBe('FIRST FLOOR PLAN');
  });
});

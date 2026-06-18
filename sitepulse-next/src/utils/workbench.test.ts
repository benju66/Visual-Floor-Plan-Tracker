import { describe, it, expect } from 'vitest';
import {
  mergeWorkbenchSidecar,
  buildWorkbenchSidecarInsert,
  computeLabelArea,
  normalizeConfirmName,
  matchesPurgeConfirmation,
  type WorkbenchSidecarFields,
} from './workbench';
import type { PercentPoint, Sheet, WorkbenchSheet } from '@/types/domain';

// Minimal fixtures — mergeWorkbenchSidecar only cares about identity/shape, not
// the full column set, so cast partial objects rather than enumerate every field.
const sheet = { id: 'sheet-1', sheet_name: 'L1' } as Sheet;
const sidecar = { sheet_id: 'sheet-1', review_state: 'draft' } as WorkbenchSheet;

describe('mergeWorkbenchSidecar', () => {
  it('attaches an object sidecar under `workbench`', () => {
    const result = mergeWorkbenchSidecar(sheet, sidecar);
    expect(result.id).toBe('sheet-1');
    expect(result.workbench).toBe(sidecar);
  });

  it('unwraps a single-element array (PostgREST to-one as array)', () => {
    const result = mergeWorkbenchSidecar(sheet, [sidecar]);
    expect(result.workbench).toBe(sidecar);
  });

  it('yields null for an empty array (no sidecar row)', () => {
    const result = mergeWorkbenchSidecar(sheet, []);
    expect(result.workbench).toBeNull();
  });

  it('yields null for null', () => {
    expect(mergeWorkbenchSidecar(sheet, null).workbench).toBeNull();
  });

  it('yields null for undefined', () => {
    expect(mergeWorkbenchSidecar(sheet, undefined).workbench).toBeNull();
  });

  it('preserves the sheet fields', () => {
    const result = mergeWorkbenchSidecar(sheet, null);
    expect(result.sheet_name).toBe('L1');
  });
});

describe('buildWorkbenchSidecarInsert', () => {
  const filled: WorkbenchSidecarFields = {
    sheetProjectType: 'Healthcare',
    levelLabel: 'Level 2',
    sourceSheetNumber: 'A-201',
    vectorQuality: 'clean',
    isPartial: true,
  };

  it('carries through a fully-filled form', () => {
    expect(buildWorkbenchSidecarInsert('sheet-1', filled)).toEqual({
      sheet_id: 'sheet-1',
      sheet_project_type: 'Healthcare',
      level_label: 'Level 2',
      source_sheet_number: 'A-201',
      vector_quality: 'clean',
      is_partial: true,
    });
  });

  it('maps the "" project-type / vector-quality sentinels to null', () => {
    const result = buildWorkbenchSidecarInsert('sheet-1', {
      ...filled,
      sheetProjectType: '',
      vectorQuality: '',
    });
    expect(result.sheet_project_type).toBeNull();
    expect(result.vector_quality).toBeNull();
  });

  it('trims free text and collapses blank/whitespace fields to null', () => {
    const result = buildWorkbenchSidecarInsert('sheet-1', {
      ...filled,
      levelLabel: '  Mezzanine  ',
      sourceSheetNumber: '   ',
    });
    expect(result.level_label).toBe('Mezzanine');
    expect(result.source_sheet_number).toBeNull();
  });

  it('omits review_state / reviewed_* (Phase 7 owns that lifecycle)', () => {
    const result = buildWorkbenchSidecarInsert('sheet-1', filled);
    expect('review_state' in result).toBe(false);
    expect('reviewed_by' in result).toBe(false);
    expect('reviewed_at' in result).toBe(false);
  });

  it('keeps is_partial false by default rather than dropping it', () => {
    const result = buildWorkbenchSidecarInsert('sheet-1', { ...filled, isPartial: false });
    expect(result.is_partial).toBe(false);
  });
});

describe('computeLabelArea', () => {
  // A unit square in percent space over a 100×100 image is 100×100 = 10,000 px²;
  // at scale_ratio 1 that is 10,000 real units. Keeps the math easy to verify.
  const square: PercentPoint[] = [
    { pctX: 0, pctY: 0 },
    { pctX: 1, pctY: 0 },
    { pctX: 1, pctY: 1 },
    { pctX: 0, pctY: 1 },
  ];

  it('returns shoelace pixel area × scale for a simple polygon', () => {
    expect(computeLabelArea(square, 100, 100, 1)).toBe(10000);
  });

  it('applies the sheet scale_ratio multiplicatively', () => {
    expect(computeLabelArea(square, 100, 100, 2.5)).toBe(25000);
  });

  it('is orientation-independent (clockwise === counter-clockwise)', () => {
    const cw = [...square].reverse();
    expect(computeLabelArea(cw, 100, 100, 1)).toBe(10000);
  });

  it('returns null for fewer than 3 points', () => {
    expect(computeLabelArea(square.slice(0, 2), 100, 100, 1)).toBeNull();
  });

  it('returns null when scale_ratio is missing (un-scaled drawing still saves)', () => {
    expect(computeLabelArea(square, 100, 100, null)).toBeNull();
    expect(computeLabelArea(square, 100, 100, undefined)).toBeNull();
    expect(computeLabelArea(square, 100, 100, 0)).toBeNull();
  });

  it('returns null when image dimensions are unknown', () => {
    expect(computeLabelArea(square, 0, 100, 1)).toBeNull();
    expect(computeLabelArea(square, 100, 0, 1)).toBeNull();
  });
});

describe('normalizeConfirmName', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeConfirmName('  Oakhaven Tower  ')).toBe('Oakhaven Tower');
  });

  it('collapses internal whitespace runs to a single space', () => {
    expect(normalizeConfirmName('Oakhaven   Tower\t\nL3')).toBe('Oakhaven Tower L3');
  });

  it('preserves case (exact-name match is required)', () => {
    expect(normalizeConfirmName('OakHaven')).toBe('OakHaven');
  });
});

describe('matchesPurgeConfirmation', () => {
  it('matches the exact name', () => {
    expect(matchesPurgeConfirmation('Oakhaven Tower — L3', 'Oakhaven Tower — L3')).toBe(true);
  });

  it('forgives trailing and doubled spaces on the typed input', () => {
    expect(matchesPurgeConfirmation('  Oakhaven   Tower ', 'Oakhaven Tower')).toBe(true);
  });

  it('rejects a case mismatch (must type the exact name)', () => {
    expect(matchesPurgeConfirmation('oakhaven tower', 'Oakhaven Tower')).toBe(false);
  });

  it('rejects a partial / wrong name', () => {
    expect(matchesPurgeConfirmation('Oakhaven', 'Oakhaven Tower')).toBe(false);
  });

  it('never matches a blank typed input', () => {
    expect(matchesPurgeConfirmation('', 'Oakhaven Tower')).toBe(false);
    expect(matchesPurgeConfirmation('   ', 'Oakhaven Tower')).toBe(false);
  });

  it('never matches when the target name is itself blank (nothing to type)', () => {
    expect(matchesPurgeConfirmation('', '')).toBe(false);
    expect(matchesPurgeConfirmation('   ', '   ')).toBe(false);
  });
});

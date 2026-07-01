import { describe, it, expect } from 'vitest';
import {
  mergeWorkbenchSidecar,
  buildWorkbenchSidecarInsert,
  normalizeConfirmName,
  matchesPurgeConfirmation,
  type WorkbenchSidecarFields,
} from './workbench';
import type { Sheet, WorkbenchSheet } from '@/types/domain';

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
    sourceBuilding: 'Oakhaven Tower',
    vectorQuality: 'clean',
    isPartial: true,
  };

  it('carries through a fully-filled form', () => {
    expect(buildWorkbenchSidecarInsert('sheet-1', filled)).toEqual({
      sheet_id: 'sheet-1',
      sheet_project_type: 'Healthcare',
      level_label: 'Level 2',
      source_sheet_number: 'A-201',
      source_building: 'Oakhaven Tower',
      vector_quality: 'clean',
      is_partial: true,
    });
  });

  it('collapses a blank/whitespace source building to null', () => {
    const result = buildWorkbenchSidecarInsert('sheet-1', { ...filled, sourceBuilding: '   ' });
    expect(result.source_building).toBeNull();
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

// NOTE (Phase 3): `computeLabelArea` was RETIRED — it multiplied a pixel area by
// the linear `scale_ratio`, which is dimensionally wrong. Area now flows through
// the single `computeAreaFromUnitsPerPx` (pixelArea × units_per_px²) in scale.ts;
// its coverage (incl. the old-vs-new correctness pin) lives in scale.test.ts.

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

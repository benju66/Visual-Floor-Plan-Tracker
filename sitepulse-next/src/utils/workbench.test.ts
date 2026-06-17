import { describe, it, expect } from 'vitest';
import { mergeWorkbenchSidecar } from './workbench';
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

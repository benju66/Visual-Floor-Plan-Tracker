import { describe, it, expect } from 'vitest';
import {
  deriveEditSource,
  labelSnapshotFromUnit,
  ANNOTATION_SPEC_VERSION,
  TRACE_METHODS,
  TRACE_SOURCES,
} from './traceCapture';
import type { Unit } from '@/types/domain';

// The correction-signal rule: a human editing a label flips it to `ai_edited` only
// when it originated from a machine proposal — that flag is what later distinguishes
// "the model was right" from "the model was wrong and a human fixed it".
describe('deriveEditSource', () => {
  it('keeps a hand-made label `human` when a human edits it', () => {
    expect(deriveEditSource('human')).toBe('human');
  });

  it('flips any AI-origin label to `ai_edited` on human edit (the correction signal)', () => {
    expect(deriveEditSource('ai_suggested')).toBe('ai_edited');
    expect(deriveEditSource('ai_accepted')).toBe('ai_edited');
    expect(deriveEditSource('ai_edited')).toBe('ai_edited');
  });

  it('treats null / undefined / blank / non-ai provenance as `human` (legacy + manual rows)', () => {
    expect(deriveEditSource(null)).toBe('human');
    expect(deriveEditSource(undefined)).toBe('human');
    expect(deriveEditSource('')).toBe('human');
    expect(deriveEditSource('imported')).toBe('human');
  });
});

describe('labelSnapshotFromUnit', () => {
  it('captures exactly the seven label fields (no geometry, no provenance)', () => {
    const unit = {
      id: 'u1',
      sheet_id: 's1',
      unit_number: 'Office 214',
      unit_type: 'Office',
      top_level_role: 'program',
      subtype_id: 'st1',
      spans_levels: false,
      level_note: null,
      has_void: true,
      polygon_coordinates: [{ pctX: 0.1, pctY: 0.1 }],
      source: 'human',
      method: 'manual',
    } as unknown as Unit;

    expect(labelSnapshotFromUnit(unit)).toEqual({
      unit_number: 'Office 214',
      unit_type: 'Office',
      top_level_role: 'program',
      subtype_id: 'st1',
      spans_levels: false,
      level_note: null,
      has_void: true,
    });
  });

  it('normalizes missing optional fields to null', () => {
    const sparse = { unit_number: 'Stair' } as unknown as Unit;
    const snap = labelSnapshotFromUnit(sparse);
    expect(snap).toEqual({
      unit_number: 'Stair',
      unit_type: null,
      top_level_role: null,
      subtype_id: null,
      spans_levels: null,
      level_note: null,
      has_void: null,
    });
  });
});

describe('capture vocabularies', () => {
  it('pins the annotation-spec version stamped on every trace', () => {
    expect(ANNOTATION_SPEC_VERSION).toBe('v1');
  });

  it('exposes the method/source vocabularies (stored as plain TEXT in the DB)', () => {
    expect(TRACE_METHODS).toContain('manual');
    expect(TRACE_METHODS).toContain('geometric');
    expect(TRACE_METHODS).toContain('sam');
    expect(TRACE_SOURCES).toContain('human');
    expect(TRACE_SOURCES).toContain('ai_suggested');
    expect(TRACE_SOURCES).toContain('ai_edited');
  });
});

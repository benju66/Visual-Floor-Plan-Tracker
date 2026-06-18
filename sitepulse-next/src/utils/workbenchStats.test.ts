import { describe, it, expect } from 'vitest';
import { summarizeCorpus, type CorpusDrawing, type CorpusLabel } from './workbenchStats';

// Minimal fixture builders — the math only reads `id` + the three sidecar fields
// and the three label fields, so we build just those (no full Sheet/Unit row).
function drawing(
  id: string,
  workbench: Partial<NonNullable<CorpusDrawing['workbench']>> | null = {},
): CorpusDrawing {
  return {
    id,
    workbench:
      workbench === null
        ? null
        : {
            review_state: 'draft',
            sheet_project_type: null,
            vector_quality: null,
            ...workbench,
          },
  };
}

function label(partial: Partial<CorpusLabel> = {}): CorpusLabel {
  return { unit_number: '101', top_level_role: 'program', subtype_id: null, ...partial };
}

describe('summarizeCorpus', () => {
  it('returns a zeroed summary for an empty corpus (no divide-by-zero)', () => {
    const summary = summarizeCorpus([], {});
    expect(summary).toEqual({
      totalDrawings: 0,
      totalLabels: 0,
      avgLabelsPerDrawing: 0,
      dodReadyCount: 0,
      reviewFunnel: { draft: 0, ready_for_review: 0, reviewed: 0 },
      byRole: { program: 0, common: 0, support: 0, other: 0, unspecified: 0 },
      bySubtype: {},
      distinctSubtypes: 0,
      untypedOrPendingCount: 0,
      vectorQuality: { clean: 0, scanned: 0, unknown: 0 },
      byProjectType: {},
    });
  });

  it('counts the review funnel and averages labels across drawings', () => {
    const drawings = [
      drawing('a', { review_state: 'draft' }),
      drawing('b', { review_state: 'ready_for_review' }),
      drawing('c', { review_state: 'reviewed' }),
      drawing('d', { review_state: 'reviewed' }),
    ];
    const unitsBySheet = {
      a: [label(), label({ unit_number: '102' })],
      b: [label({ unit_number: '103' })],
      // c, d have no labels
    };

    const summary = summarizeCorpus(drawings, unitsBySheet);

    expect(summary.totalDrawings).toBe(4);
    expect(summary.reviewFunnel).toEqual({ draft: 1, ready_for_review: 1, reviewed: 2 });
    expect(summary.totalLabels).toBe(3);
    expect(summary.avgLabelsPerDrawing).toBe(3 / 4);
  });

  it('buckets labels by canonical role, with an Unspecified bucket for null/unknown roles', () => {
    const drawings = [drawing('a')];
    const unitsBySheet = {
      a: [
        label({ top_level_role: 'program' }),
        label({ top_level_role: 'common' }),
        label({ top_level_role: 'support' }),
        label({ top_level_role: 'other' }),
        label({ top_level_role: null }), // null → unspecified
        label({ top_level_role: 'mystery' }), // unknown string → unspecified
      ],
    };

    const summary = summarizeCorpus(drawings, unitsBySheet);

    expect(summary.byRole).toEqual({
      program: 1,
      common: 1,
      support: 1,
      other: 1,
      unspecified: 2,
    });
  });

  it('counts only labels with a role set but no sub-type as untyped/pending (the review queue)', () => {
    const drawings = [drawing('a')];
    const unitsBySheet = {
      a: [
        label({ top_level_role: 'program', subtype_id: null }), // role set, no sub-type → counted
        label({ top_level_role: 'common', subtype_id: 's-1' }), // has sub-type → not counted
        label({ top_level_role: null, subtype_id: null }), // no role → not counted
      ],
    };

    const summary = summarizeCorpus(drawings, unitsBySheet);

    expect(summary.untypedOrPendingCount).toBe(1);
    expect(summary.bySubtype).toEqual({ 's-1': 1 });
    expect(summary.distinctSubtypes).toBe(1);
  });

  it('aggregates sub-type usage across drawings', () => {
    const drawings = [drawing('a'), drawing('b')];
    const unitsBySheet = {
      a: [label({ subtype_id: 's-1' }), label({ subtype_id: 's-1' })],
      b: [label({ subtype_id: 's-2' })],
    };

    const summary = summarizeCorpus(drawings, unitsBySheet);

    expect(summary.bySubtype).toEqual({ 's-1': 2, 's-2': 1 });
    expect(summary.distinctSubtypes).toBe(2);
  });

  it('groups drawings by project type and vector quality, with Unspecified/unknown buckets', () => {
    const drawings = [
      drawing('a', { sheet_project_type: 'Healthcare', vector_quality: 'clean' }),
      drawing('b', { sheet_project_type: 'Healthcare', vector_quality: 'scanned' }),
      drawing('c', { sheet_project_type: null, vector_quality: null }), // → Unspecified / unknown
      drawing('d', { sheet_project_type: '   ', vector_quality: 'mystery' }), // blank → Unspecified, bad quality → unknown
      drawing('e', null), // no sidecar at all → Unspecified / unknown / draft
    ];

    const summary = summarizeCorpus(drawings, {});

    expect(summary.byProjectType).toEqual({ Healthcare: 2, Unspecified: 3 });
    expect(summary.vectorQuality).toEqual({ clean: 1, scanned: 1, unknown: 3 });
    expect(summary.reviewFunnel).toEqual({ draft: 5, ready_for_review: 0, reviewed: 0 });
  });

  it('counts a drawing as DoD-ready only when its labels pass every Definition-of-Done check', () => {
    const drawings = [
      drawing('ready'), // clean, named, typed, unique
      drawing('unnamed'), // has a blank name → fails all-named
      drawing('untyped'), // missing role → fails all-typed
      drawing('dup'), // duplicate names → fails names-unique
      drawing('empty'), // no labels → fails has-labels
    ];
    const unitsBySheet = {
      ready: [
        label({ unit_number: '101', top_level_role: 'program' }),
        label({ unit_number: '102', top_level_role: 'common' }),
      ],
      unnamed: [label({ unit_number: '   ', top_level_role: 'program' })],
      untyped: [label({ unit_number: '201', top_level_role: null })],
      dup: [
        label({ unit_number: '301', top_level_role: 'program' }),
        label({ unit_number: '301', top_level_role: 'program' }),
      ],
      empty: [],
    };

    const summary = summarizeCorpus(drawings, unitsBySheet);

    expect(summary.dodReadyCount).toBe(1);
  });

  it('ignores label groups for sheets not in the drawings list (stays scoped)', () => {
    const drawings = [drawing('a')];
    const unitsBySheet = {
      a: [label()],
      orphan: [label({ unit_number: '999' }), label({ unit_number: '998' })],
    };

    const summary = summarizeCorpus(drawings, unitsBySheet);

    expect(summary.totalLabels).toBe(1);
  });
});

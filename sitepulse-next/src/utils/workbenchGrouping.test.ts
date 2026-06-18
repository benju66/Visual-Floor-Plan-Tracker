import { describe, it, expect } from 'vitest';
import {
  groupDrawings,
  filterDrawings,
  facetValues,
  toggleFilterValue,
  hasActiveFilters,
  EMPTY_FILTERS,
  type GroupableDrawing,
  type WorkbenchFilters,
} from './workbenchGrouping';
import { UNSPECIFIED } from './workbenchStats';

// Minimal fixture builder — the grouping math only reads `id` + the four sidecar
// facets, so we build just those (no full Sheet/WorkbenchSheet row). `review_state`
// is NOT NULL in the DB (defaults to 'draft'), so it always has a value.
function drawing(
  id: string,
  workbench: Partial<NonNullable<GroupableDrawing['workbench']>> | null = {},
): GroupableDrawing {
  return {
    id,
    workbench:
      workbench === null
        ? null
        : {
            review_state: 'draft',
            sheet_project_type: null,
            level_label: null,
            vector_quality: null,
            ...workbench,
          },
  };
}

const keysOf = (groups: { key: string }[]) => groups.map((g) => g.key);
const idsOf = (drawings: GroupableDrawing[]) => drawings.map((d) => d.id);

describe('groupDrawings', () => {
  it('returns no groups for an empty corpus', () => {
    expect(groupDrawings([], 'project_type')).toEqual([]);
  });

  it('groups by project type with PROJECT_TYPES order and an Unspecified bucket last', () => {
    const drawings = [
      drawing('a', { sheet_project_type: 'Healthcare' }),
      drawing('b', { sheet_project_type: null }), // → Unspecified
      drawing('c', { sheet_project_type: 'Commercial' }),
      drawing('d', { sheet_project_type: 'Healthcare' }),
      drawing('e', { sheet_project_type: '   ' }), // blank → Unspecified
      drawing('f', null), // no sidecar → Unspecified
    ];

    const groups = groupDrawings(drawings, 'project_type');

    // Commercial precedes Healthcare (PROJECT_TYPES order); Unspecified pinned last.
    expect(keysOf(groups)).toEqual(['Commercial', 'Healthcare', UNSPECIFIED]);
    expect(groups.map((g) => g.label)).toEqual(['Commercial', 'Healthcare', UNSPECIFIED]);
    expect(idsOf(groups[0].drawings)).toEqual(['c']);
    expect(idsOf(groups[1].drawings)).toEqual(['a', 'd']); // input order preserved
    expect(idsOf(groups[2].drawings)).toEqual(['b', 'e', 'f']);
  });

  it('groups by review state in the canonical funnel order (no Unspecified bucket)', () => {
    const drawings = [
      drawing('a', { review_state: 'reviewed' }),
      drawing('b', { review_state: 'draft' }),
      drawing('c', { review_state: 'ready_for_review' }),
      drawing('d', { review_state: 'bogus' }), // unknown → narrowed to draft
    ];

    const groups = groupDrawings(drawings, 'review_state');

    expect(keysOf(groups)).toEqual(['draft', 'ready_for_review', 'reviewed']);
    expect(groups.map((g) => g.label)).toEqual(['Draft', 'Ready for review', 'Reviewed']);
    expect(idsOf(groups[0].drawings)).toEqual(['b', 'd']); // draft + narrowed bogus
  });

  it('groups by vector quality (clean before scanned) with capitalized labels', () => {
    const drawings = [
      drawing('a', { vector_quality: 'scanned' }),
      drawing('b', { vector_quality: 'clean' }),
      drawing('c', { vector_quality: null }), // → Unspecified
    ];

    const groups = groupDrawings(drawings, 'vector_quality');

    expect(keysOf(groups)).toEqual(['clean', 'scanned', UNSPECIFIED]);
    expect(groups.map((g) => g.label)).toEqual(['Clean', 'Scanned', UNSPECIFIED]);
  });

  it('groups by level alphabetically (free text) with an Unspecified bucket last', () => {
    const drawings = [
      drawing('a', { level_label: 'Level 2' }),
      drawing('b', { level_label: 'Level 1' }),
      drawing('c', { level_label: null }), // → Unspecified
      drawing('d', { level_label: 'Basement' }),
    ];

    const groups = groupDrawings(drawings, 'level');

    expect(keysOf(groups)).toEqual(['Basement', 'Level 1', 'Level 2', UNSPECIFIED]);
  });

  it('preserves the concrete row type (generic) so callers keep their extra fields', () => {
    // A structural supertype: extra fields ride along untouched.
    const rows = [
      { id: 'a', sheet_name: 'Plan A', workbench: { review_state: 'draft', sheet_project_type: 'Hotel', vector_quality: null, level_label: null } },
    ];
    const groups = groupDrawings(rows, 'project_type');
    expect(groups[0].drawings[0].sheet_name).toBe('Plan A');
  });
});

describe('filterDrawings', () => {
  const corpus = [
    drawing('a', { sheet_project_type: 'Healthcare', review_state: 'reviewed', vector_quality: 'clean' }),
    drawing('b', { sheet_project_type: 'Healthcare', review_state: 'draft', vector_quality: 'scanned' }),
    drawing('c', { sheet_project_type: 'Commercial', review_state: 'reviewed', vector_quality: 'clean' }),
    drawing('d', { sheet_project_type: null, review_state: 'draft', vector_quality: null }), // Unspecified type
  ];

  it('returns a shallow copy of the full list when no filters are active', () => {
    const result = filterDrawings(corpus, EMPTY_FILTERS);
    expect(idsOf(result)).toEqual(['a', 'b', 'c', 'd']);
    expect(result).not.toBe(corpus); // new array, not the same reference
  });

  it('filters by a single facet (OR within the facet)', () => {
    const filters: WorkbenchFilters = { ...EMPTY_FILTERS, review_state: ['reviewed'] };
    expect(idsOf(filterDrawings(corpus, filters))).toEqual(['a', 'c']);

    const multi: WorkbenchFilters = { ...EMPTY_FILTERS, project_type: ['Healthcare', 'Commercial'] };
    expect(idsOf(filterDrawings(corpus, multi))).toEqual(['a', 'b', 'c']);
  });

  it('ANDs across facets', () => {
    const filters: WorkbenchFilters = {
      ...EMPTY_FILTERS,
      project_type: ['Healthcare'],
      review_state: ['reviewed'],
    };
    expect(idsOf(filterDrawings(corpus, filters))).toEqual(['a']);
  });

  it('matches drawings with an unset sidecar field when filtering on Unspecified', () => {
    const filters: WorkbenchFilters = { ...EMPTY_FILTERS, project_type: [UNSPECIFIED] };
    expect(idsOf(filterDrawings(corpus, filters))).toEqual(['d']);
  });

  it('returns an empty list when nothing matches', () => {
    const filters: WorkbenchFilters = { ...EMPTY_FILTERS, project_type: ['Hotel'] };
    expect(filterDrawings(corpus, filters)).toEqual([]);
  });
});

describe('facetValues', () => {
  it('returns available values in group order with counts', () => {
    const corpus = [
      drawing('a', { sheet_project_type: 'Healthcare' }),
      drawing('b', { sheet_project_type: 'Healthcare' }),
      drawing('c', { sheet_project_type: 'Commercial' }),
      drawing('d', { sheet_project_type: null }),
    ];

    expect(facetValues(corpus, 'project_type')).toEqual([
      { key: 'Commercial', label: 'Commercial', count: 1 },
      { key: 'Healthcare', label: 'Healthcare', count: 2 },
      { key: UNSPECIFIED, label: UNSPECIFIED, count: 1 },
    ]);
  });

  it('is empty for an empty corpus', () => {
    expect(facetValues([], 'level')).toEqual([]);
  });
});

describe('toggleFilterValue', () => {
  it('adds a value when absent and removes it when present, without mutating', () => {
    const added = toggleFilterValue(EMPTY_FILTERS, 'review_state', 'reviewed');
    expect(added.review_state).toEqual(['reviewed']);
    expect(EMPTY_FILTERS.review_state).toEqual([]); // original untouched

    const removed = toggleFilterValue(added, 'review_state', 'reviewed');
    expect(removed.review_state).toEqual([]);
  });

  it('only touches the targeted facet', () => {
    const start: WorkbenchFilters = { ...EMPTY_FILTERS, project_type: ['Healthcare'] };
    const next = toggleFilterValue(start, 'level', 'Level 1');
    expect(next.project_type).toEqual(['Healthcare']);
    expect(next.level).toEqual(['Level 1']);
  });
});

describe('hasActiveFilters', () => {
  it('is false for the empty filter set and true once any facet is set', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, vector_quality: ['clean'] })).toBe(true);
  });
});

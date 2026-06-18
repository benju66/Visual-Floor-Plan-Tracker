/**
 * Pure, framework-free grouping + filtering for the Drawing Library grid
 * (Workbench Phase 8d). No React, no DB, and no fetch — the page passes its
 * already-loaded, already-container-scoped `WorkbenchDrawing[]` IN and these
 * helpers reorganize it in memory, so the co-located tests pin the behaviour
 * deterministically (AGENTS.md §9).
 *
 * This is display-only over the in-memory corpus. It MUST never trigger a new
 * read, never reach the live Projects Dashboard, and never flow through
 * `progressAnalytics` (the contamination guard). It reuses the canonical facet
 * helpers rather than forking them: `narrowReviewState` + `REVIEW_STATE_LABELS`
 * for the review funnel, `VECTOR_QUALITIES`/`PROJECT_TYPES` for the other facets,
 * and the shared `UNSPECIFIED` bucket convention from `workbenchStats.ts`.
 */

import { UNSPECIFIED } from './workbenchStats';
import {
  narrowReviewState,
  REVIEW_STATES,
  REVIEW_STATE_LABELS,
  VECTOR_QUALITIES,
  type WorkbenchReviewState,
} from './workbench';
import { PROJECT_TYPES } from './locationTaxonomy';
import type { WorkbenchSheet } from '@/types/domain';

/** The facets the library grid can group/filter by. */
export type GroupKey = 'project_type' | 'level' | 'review_state' | 'vector_quality';

/** The group-by selection — a facet, or `'none'` for the plain flat list. */
export type WorkbenchGroupBy = GroupKey | 'none';

/** The grouping facets in their display order (the group-by pick-list). */
export const GROUP_KEYS: readonly GroupKey[] = [
  'project_type',
  'level',
  'review_state',
  'vector_quality',
];

/** Human-facing label for each facet (the group-by control + filter headings). */
export const GROUP_BY_LABELS: Record<GroupKey, string> = {
  project_type: 'Project type',
  level: 'Level',
  review_state: 'Review state',
  vector_quality: 'Vector quality',
};

/**
 * The minimal drawing shape the grouping math inspects — `id` plus the four
 * sidecar fields it categorizes by. Structurally a supertype of
 * `WorkbenchDrawing` (mirrors `CorpusDrawing` in `workbenchStats.ts`, but adds
 * `level_label`, which the corpus math doesn't need), so the page passes its
 * loaded `WorkbenchDrawing[]` straight in with no cast. The helpers below are
 * generic over the concrete type so callers get their own row type back.
 */
export interface GroupableDrawing {
  id: string;
  workbench: Pick<
    WorkbenchSheet,
    'review_state' | 'sheet_project_type' | 'vector_quality' | 'level_label'
  > | null;
}

/**
 * The active grid filters — one string list per facet. An empty list means "no
 * filter on that facet" (everything passes). A list holds the canonical facet
 * values to keep (e.g. `review_state: ['reviewed']`, `project_type: ['Healthcare',
 * UNSPECIFIED]`). Filtering is OR within a facet, AND across facets.
 */
export interface WorkbenchFilters {
  project_type: string[];
  level: string[];
  review_state: string[];
  vector_quality: string[];
}

/** The empty (no-op) filter set — the default, unfiltered view. */
export const EMPTY_FILTERS: WorkbenchFilters = {
  project_type: [],
  level: [],
  review_state: [],
  vector_quality: [],
};

/** One labeled grid section: a facet value, its display label, and its drawings. */
export interface DrawingGroup<D> {
  /** Canonical group key (e.g. `'Healthcare'`, `'draft'`, or `UNSPECIFIED`). */
  key: string;
  /** Display label for the section header. */
  label: string;
  drawings: D[];
}

/** One available filter value for a facet: the canonical key, its label, its count. */
export interface FacetValue {
  key: string;
  label: string;
  count: number;
}

/** Canonical ordering per facet (the group sections + filter chips follow it). */
const CANONICAL_ORDER: Record<GroupKey, readonly string[]> = {
  review_state: REVIEW_STATES,
  vector_quality: VECTOR_QUALITIES,
  project_type: PROJECT_TYPES,
  level: [], // free text — no canonical order, sorts alphabetically
};

/**
 * Resolve a drawing's canonical value for a facet. `review_state` always narrows
 * to a known state (never `UNSPECIFIED` — the column is NOT NULL, defaulting to
 * `draft`); the free-text sidecar facets fall back to the shared `UNSPECIFIED`
 * bucket when blank/unset, so a drawing with no value is groupable + filterable.
 */
function facetValue(drawing: GroupableDrawing, key: GroupKey): string {
  const meta = drawing.workbench;
  switch (key) {
    case 'review_state':
      return narrowReviewState(meta?.review_state);
    case 'project_type':
      return meta?.sheet_project_type?.trim() || UNSPECIFIED;
    case 'level':
      return meta?.level_label?.trim() || UNSPECIFIED;
    case 'vector_quality':
      return meta?.vector_quality?.trim() || UNSPECIFIED;
  }
}

/** Display label for a facet value (canonical value in → presentation string out). */
function facetLabel(key: GroupKey, value: string): string {
  if (value === UNSPECIFIED) return UNSPECIFIED;
  if (key === 'review_state') return REVIEW_STATE_LABELS[value as WorkbenchReviewState];
  if (key === 'vector_quality') return value.charAt(0).toUpperCase() + value.slice(1);
  return value; // project_type / level are already display-ready
}

/**
 * Order two group keys for a facet: the shared `UNSPECIFIED` bucket always last,
 * then canonical values in their defined order, then any non-canonical values
 * alphabetically. Deterministic, so groups + filter chips render stably.
 */
function compareGroupKeys(key: GroupKey, a: string, b: string): number {
  if (a === b) return 0;
  if (a === UNSPECIFIED) return 1;
  if (b === UNSPECIFIED) return -1;
  const order = CANONICAL_ORDER[key];
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1; // canonical sorts before non-canonical
  if (ib !== -1) return 1;
  return a.localeCompare(b);
}

/**
 * Group drawings by a facet into ordered, labeled sections. Drawings keep their
 * input order within each section; the sections follow {@link compareGroupKeys}
 * (canonical order, `UNSPECIFIED` last). Pure + deterministic; generic over the
 * row type so the caller gets `DrawingGroup<WorkbenchDrawing>[]` back.
 */
export function groupDrawings<D extends GroupableDrawing>(
  drawings: readonly D[],
  key: GroupKey,
): DrawingGroup<D>[] {
  const buckets = new Map<string, D[]>();
  for (const drawing of drawings) {
    const value = facetValue(drawing, key);
    const bucket = buckets.get(value);
    if (bucket) bucket.push(drawing);
    else buckets.set(value, [drawing]);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => compareGroupKeys(key, a, b))
    .map(([value, ds]) => ({ key: value, label: facetLabel(key, value), drawings: ds }));
}

/**
 * Return the subset of drawings matching the active filters. OR within a facet
 * (a drawing matches if its value is in that facet's list), AND across facets
 * (it must match every facet that has an active filter). An `UNSPECIFIED` filter
 * value matches drawings with that sidecar field unset. With no active filters,
 * returns a shallow copy of the full list. Pure + deterministic; generic over
 * the row type.
 */
export function filterDrawings<D extends GroupableDrawing>(
  drawings: readonly D[],
  filters: WorkbenchFilters,
): D[] {
  const activeKeys = GROUP_KEYS.filter((key) => filters[key].length > 0);
  if (activeKeys.length === 0) return [...drawings];
  return drawings.filter((drawing) =>
    activeKeys.every((key) => filters[key].includes(facetValue(drawing, key))),
  );
}

/**
 * The available filter values for a facet, in the same order groups render
 * (canonical, `UNSPECIFIED` last), each with the count of drawings that carry it.
 * Drives the filter-chip row; pure, so it's computed from whatever list the page
 * feeds it (the full grid source, before filtering, so chips never disappear).
 */
export function facetValues<D extends GroupableDrawing>(
  drawings: readonly D[],
  key: GroupKey,
): FacetValue[] {
  return groupDrawings(drawings, key).map((group) => ({
    key: group.key,
    label: group.label,
    count: group.drawings.length,
  }));
}

/**
 * Toggle a value in a facet's filter list, returning a NEW filters object (never
 * mutates). Pure, so the store setter stays a generic `Updater` and the page
 * doesn't reimplement add/remove logic.
 */
export function toggleFilterValue(
  filters: WorkbenchFilters,
  key: GroupKey,
  value: string,
): WorkbenchFilters {
  const current = filters[key];
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
  return { ...filters, [key]: next };
}

/** Whether any facet has an active filter (drives the "Clear filters" control). */
export function hasActiveFilters(filters: WorkbenchFilters): boolean {
  return GROUP_KEYS.some((key) => filters[key].length > 0);
}

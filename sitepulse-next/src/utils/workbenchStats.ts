/**
 * Pure, framework-free corpus-health math for the Drawing Library cockpit
 * (Workbench Phase 8a). No React, no DB, and no `Date.now()` — all data is passed
 * IN, so the co-located tests pin these counts deterministically (AGENTS.md §9).
 *
 * This summarizes the hidden `kind='workbench'` container's labeling effort for
 * the `/workbench` health strip ONLY. It is the corpus-building cockpit and MUST
 * never appear on the live Projects Dashboard or flow through `progressAnalytics`
 * (the contamination guard). It reuses the canonical helpers rather than forking
 * them: `definitionOfDoneChecks` for the per-drawing DoD pass (workbenchNaming.ts)
 * and `narrowReviewState` for the review funnel (workbench.ts).
 */

import { definitionOfDoneChecks, type LabelForReview } from './workbenchNaming';
import { narrowReviewState, type WorkbenchReviewState } from './workbench';
import { CANONICAL_ROLES, type TopLevelRole } from './locationTaxonomy';
import type { WorkbenchSheet } from '@/types/domain';

/** Display key for drawings/labels missing the categorized value. */
export const UNSPECIFIED = 'Unspecified';

/**
 * The minimal label shape the corpus math inspects — a subset of `Unit`. Extends
 * the DoD's {@link LabelForReview} (`unit_number` + canonical `top_level_role`)
 * with `subtype_id` for taxonomy coverage + the review-queue signal. Hand-written
 * (like `LabelForReview`) so the math + its tests stay free of the full row shape.
 */
export interface CorpusLabel extends LabelForReview {
  subtype_id: string | null;
}

/**
 * The minimal drawing shape the corpus math inspects — `id` plus the three sidecar
 * fields it categorizes by. Structurally a supertype of `WorkbenchDrawing`, so the
 * page passes its loaded `WorkbenchDrawing[]` straight in with no cast.
 */
export interface CorpusDrawing {
  id: string;
  workbench: Pick<WorkbenchSheet, 'review_state' | 'sheet_project_type' | 'vector_quality'> | null;
}

export interface CorpusSummary {
  totalDrawings: number;
  totalLabels: number;
  /** Mean labels per drawing (0 when the corpus is empty — never divides by zero). */
  avgLabelsPerDrawing: number;
  /** Drawings whose labels pass the full Definition-of-Done checklist (§9). */
  dodReadyCount: number;
  /** # drawings in each review state (the funnel). */
  reviewFunnel: Record<WorkbenchReviewState, number>;
  /** # labels per canonical role (§4 single source of truth) + an Unspecified bucket. */
  byRole: Record<TopLevelRole | 'unspecified', number>;
  /** # labels per `subtype_id` (non-null only) — dictionary coverage. */
  bySubtype: Record<string, number>;
  /** Distinct sub-types used across the corpus (= `Object.keys(bySubtype).length`). */
  distinctSubtypes: number;
  /**
   * Labels with a role set but NO sub-type (`top_level_role IS NOT NULL AND
   * subtype_id IS NULL`) — the review-queue / dictionary-growth signal (§4).
   */
  untypedOrPendingCount: number;
  /** # drawings per source-PDF vector quality. */
  vectorQuality: Record<'clean' | 'scanned' | 'unknown', number>;
  /** # drawings per project type, with an `Unspecified` bucket for none set. */
  byProjectType: Record<string, number>;
}

/**
 * Summarize a workbench corpus from its drawings + their labels grouped by sheet.
 * Pure + deterministic. Only labels belonging to a listed drawing are counted —
 * `unitsBySheet` entries for unlisted sheets are ignored, so the result always
 * reflects exactly the drawings passed in (e.g. once 8b excludes archived ones).
 *
 * @param drawings     the container's drawings (already container-scoped by the caller)
 * @param unitsBySheet labels keyed by their `sheet_id` (a drawing with none may be absent)
 */
export function summarizeCorpus(
  drawings: readonly CorpusDrawing[],
  unitsBySheet: Readonly<Record<string, readonly CorpusLabel[]>>,
): CorpusSummary {
  const reviewFunnel: Record<WorkbenchReviewState, number> = {
    draft: 0,
    ready_for_review: 0,
    reviewed: 0,
  };
  const vectorQuality: Record<'clean' | 'scanned' | 'unknown', number> = {
    clean: 0,
    scanned: 0,
    unknown: 0,
  };
  const byRole: Record<TopLevelRole | 'unspecified', number> = {
    program: 0,
    common: 0,
    support: 0,
    other: 0,
    unspecified: 0,
  };
  const byProjectType: Record<string, number> = {};
  const bySubtype: Record<string, number> = {};

  let totalLabels = 0;
  let dodReadyCount = 0;
  let untypedOrPendingCount = 0;

  for (const drawing of drawings) {
    const meta = drawing.workbench;

    reviewFunnel[narrowReviewState(meta?.review_state)] += 1;

    const projectType = meta?.sheet_project_type?.trim() || UNSPECIFIED;
    byProjectType[projectType] = (byProjectType[projectType] ?? 0) + 1;

    const quality = meta?.vector_quality;
    if (quality === 'clean') vectorQuality.clean += 1;
    else if (quality === 'scanned') vectorQuality.scanned += 1;
    else vectorQuality.unknown += 1;

    const labels = unitsBySheet[drawing.id] ?? [];
    if (definitionOfDoneChecks(labels).passed) dodReadyCount += 1;

    for (const label of labels) {
      totalLabels += 1;

      const role = label.top_level_role;
      if (role && (CANONICAL_ROLES as readonly string[]).includes(role)) {
        byRole[role as TopLevelRole] += 1;
      } else {
        byRole.unspecified += 1;
      }

      if (label.subtype_id) {
        bySubtype[label.subtype_id] = (bySubtype[label.subtype_id] ?? 0) + 1;
      } else if (role) {
        // Role set but no sub-type → the review-queue / dictionary-growth signal (§4).
        untypedOrPendingCount += 1;
      }
    }
  }

  const totalDrawings = drawings.length;

  return {
    totalDrawings,
    totalLabels,
    avgLabelsPerDrawing: totalDrawings > 0 ? totalLabels / totalDrawings : 0,
    dodReadyCount,
    reviewFunnel,
    byRole,
    bySubtype,
    distinctSubtypes: Object.keys(bySubtype).length,
    untypedOrPendingCount,
    vectorQuality,
    byProjectType,
  };
}

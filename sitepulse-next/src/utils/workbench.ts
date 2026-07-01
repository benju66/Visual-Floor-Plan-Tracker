import type { ProjectType, Sheet, WorkbenchSheet, WorkbenchSheetInsert, WorkbenchDrawing } from '@/types/domain';

/**
 * Vector quality of a workbench drawing's source PDF — `'clean'` = a true vector
 * PDF where the snapping engine has line data to work with; `'scanned'` = a
 * raster/scanned PDF with no usable vectors. Mirrors the `workbench_sheets
 * .vector_quality` CHECK (the DB column is plain TEXT, so this literal union
 * can't be derived from `database.types.ts` — this const is the source of truth).
 */
export const VECTOR_QUALITIES = ['clean', 'scanned'] as const;
export type VectorQuality = (typeof VECTOR_QUALITIES)[number];

/**
 * The second-person review lifecycle of a workbench drawing (standard §9), in
 * order: a labeler works in `draft`, hands off as `ready_for_review`, and a second
 * person stamps `reviewed` only once the Definition-of-Done checklist passes.
 * Mirrors the `workbench_sheets.review_state` CHECK (plain TEXT in the DB, so this
 * literal union is the source of truth — it can't be derived from generated types).
 */
export const REVIEW_STATES = ['draft', 'ready_for_review', 'reviewed'] as const;
export type WorkbenchReviewState = (typeof REVIEW_STATES)[number];

/** Human-facing label for each review state (presentation-only). */
export const REVIEW_STATE_LABELS: Record<WorkbenchReviewState, string> = {
  draft: 'Draft',
  ready_for_review: 'Ready for review',
  reviewed: 'Reviewed',
};

/** Tailwind classes for each review-state badge (presentation-only). */
export const REVIEW_STATE_BADGE: Record<WorkbenchReviewState, string> = {
  draft: 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10',
  ready_for_review:
    'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30',
  reviewed:
    'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30',
};

/** Narrow a free-text `review_state` value to a known state, defaulting to `'draft'`. */
export function narrowReviewState(value: string | null | undefined): WorkbenchReviewState {
  return value && (REVIEW_STATES as readonly string[]).includes(value)
    ? (value as WorkbenchReviewState)
    : 'draft';
}

/**
 * Normalize a name for the hard-delete type-to-confirm comparison: trim and
 * collapse internal whitespace runs to a single space. Case is preserved — the
 * user must type the drawing's *exact* name (Phase 8c), so this only forgives
 * trailing/double spaces, never a wrong character or wrong case.
 */
export function normalizeConfirmName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Does the typed text match the drawing's name well enough to permit an
 * IRREVERSIBLE purge (Phase 8c)? The mandatory friction on hard-delete: the
 * destructive button stays disabled until this returns `true`. A blank name can
 * never be confirmed (returns `false`), so an empty input is never a match.
 */
export function matchesPurgeConfirmation(typed: string, name: string): boolean {
  const target = normalizeConfirmName(name);
  if (!target) return false;
  return normalizeConfirmName(typed) === target;
}

/**
 * The per-drawing metadata a labeler captures at ingest (standard §8). Free-text
 * fields hold `''` (not `null`) while the form is open so the inputs stay
 * controlled; {@link buildWorkbenchSidecarInsert} normalizes blanks to `null` at
 * the write boundary. `sheetProjectType`/`vectorQuality` use `''` for "not set".
 */
export interface WorkbenchSidecarFields {
  sheetProjectType: ProjectType | '';
  levelLabel: string;
  sourceSheetNumber: string;
  vectorQuality: VectorQuality | '';
  isPartial: boolean;
  /**
   * Leakage-safe grouping tag (plan M1.3 / ANNOTATION_SPEC §5): the physical
   * building/project this sheet came from. Sheets that share a building share
   * drafting style and MUST stay in the same train/test fold. Free text; `''` =
   * ungrouped (the sheet groups by its own id at export time).
   */
  sourceBuilding: string;
}

/** Trim a free-text value, collapsing an all-whitespace/empty input to `null`. */
function nullIfBlank(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Build the `workbench_sheets` insert payload from the capture-form fields. Pure
 * + deterministic (no I/O): trims free text, maps the "" sentinels to `null`,
 * and leaves `review_state` to its DB default (`'draft'`) — Phase 7 owns that
 * lifecycle, so `reviewed_by`/`reviewed_at` are intentionally omitted here.
 */
export function buildWorkbenchSidecarInsert(
  sheetId: string,
  fields: WorkbenchSidecarFields,
): WorkbenchSheetInsert {
  return {
    sheet_id: sheetId,
    sheet_project_type: fields.sheetProjectType || null,
    level_label: nullIfBlank(fields.levelLabel),
    source_sheet_number: nullIfBlank(fields.sourceSheetNumber),
    vector_quality: fields.vectorQuality || null,
    is_partial: fields.isPartial,
    source_building: nullIfBlank(fields.sourceBuilding),
  };
}

/**
 * Real-world area of a traced label polygon now lives in ONE place —
 * `computeAreaFromUnitsPerPx` in `scale.ts` (`pixelArea × units_per_px²`). The old
 * `computeLabelArea` helper here multiplied a pixel area by the *linear*
 * `scale_ratio`, which is dimensionally wrong (Scale, Measure & Production Rates —
 * Phase 3 retired it). Both create paths (`useWorkbenchActions`,
 * `useMapActions.saveNewUnitFromPopover`) call `computeAreaFromUnitsPerPx`
 * directly against `sheets.scale_units_per_px`.
 */

/**
 * Merge a workbench `sheets` row with its 1:1 `workbench_sheets` sidecar into a
 * single {@link WorkbenchDrawing}.
 *
 * PostgREST embeds a one-to-one relationship as EITHER a single object OR a
 * single-element array, depending on how it detects the relationship (and the
 * detection can change across versions). Either form — plus `null`/`undefined`
 * (no sidecar yet) and an empty array — is normalized here to one sidecar object
 * or `null`, so callers always get a stable shape. Pure + deterministic; no I/O.
 */
export function mergeWorkbenchSidecar(
  sheet: Sheet,
  sidecar: WorkbenchSheet | WorkbenchSheet[] | null | undefined,
): WorkbenchDrawing {
  const workbench = Array.isArray(sidecar) ? sidecar[0] ?? null : sidecar ?? null;
  return { ...sheet, workbench };
}

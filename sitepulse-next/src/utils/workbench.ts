import type { ProjectType, PercentPoint, Sheet, WorkbenchSheet, WorkbenchSheetInsert, WorkbenchDrawing } from '@/types/domain';

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
  };
}

/**
 * Real-world area of a traced label polygon — the value the workbench banks into
 * `units.computed_area`, mirroring the live create flow exactly
 * (`useMapActions.saveNewUnitFromPopover`): the shoelace area of the polygon in
 * source-image pixels, scaled by the sheet's `scale_ratio` (image-area → real
 * area). Pure + deterministic: the caller supplies the converted preview image's
 * natural pixel dimensions and the sheet scale, so there is no I/O here.
 *
 * Returns `null` when there is nothing meaningful to compute — fewer than 3
 * points, missing image dimensions, or no `scale_ratio` on the sheet — so a label
 * on an un-scaled drawing still saves (area-less), exactly like the live flow.
 */
export function computeLabelArea(
  points: readonly PercentPoint[],
  imageWidth: number,
  imageHeight: number,
  scaleRatio: number | null | undefined,
): number | null {
  if (points.length < 3 || !imageWidth || !imageHeight || !scaleRatio) return null;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const xA = points[i].pctX * imageWidth;
    const yA = points[i].pctY * imageHeight;
    const xB = points[j].pctX * imageWidth;
    const yB = points[j].pctY * imageHeight;
    area += xA * yB - xB * yA;
  }
  return (Math.abs(area) / 2) * scaleRatio;
}

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

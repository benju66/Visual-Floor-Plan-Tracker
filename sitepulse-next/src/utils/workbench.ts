import type { Sheet, WorkbenchSheet, WorkbenchDrawing } from '@/types/domain';

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

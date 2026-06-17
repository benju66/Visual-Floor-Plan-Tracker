import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import { uploadFloorplanService } from '@/services/api';
import { invalidatePdfBytes } from '@/utils/pdfByteCache';
import { buildWorkbenchSidecarInsert, computeLabelArea, type WorkbenchSidecarFields } from '@/utils/workbench';
import { useCreateUnit } from '@/hooks/useProjectQueries';
import { useProposePendingSubtype } from '@/hooks/useSubtypes';
import { taxonomyResultToUnitFields, type TaxonomyResult } from '@/utils/subtypes';
import type { PercentPoint, Sheet, Unit } from '@/types/domain';

// Write path for the Location Labeling Workbench. Like the read hooks in
// useWorkbench.ts, this is always scoped to the single hidden `kind='workbench'`
// container, so a new drawing can never reach a live-project surface. It mirrors
// `handleAddLevel`'s upload sequence (insert sheet → upload via the EXISTING,
// unchanged pipeline → write base_image_url) and adds the per-drawing metadata
// sidecar. Online-first via a TanStack mutation — NOT the offline pendingChanges
// queue; no status_logs are touched (AGENTS.md §2, plan § Phase 5).

/** The capture-form values for a new workbench drawing. */
export interface NewWorkbenchDrawingInput extends WorkbenchSidecarFields {
  /** The historical PDF to upload + server-convert. */
  file: File;
  /** Drawing/level name → `sheets.sheet_name`. */
  sheetName: string;
  /** Which PDF page holds this floor plan (the service takes `?page_number=`). */
  pdfPageNumber: number;
}

/**
 * Create a workbench drawing: a `sheets` row under the hidden container, the PDF
 * uploaded through the existing `uploadFloorplanService`, and the §8 metadata in
 * a `workbench_sheets` sidecar.
 *
 * The sheet row is created before the upload (the upload endpoint is sheet-scoped
 * via `project_id` — the load-bearing coupling), so a failed conversion would
 * otherwise leave an orphan empty drawing. We guard that two ways: the metadata
 * sidecar is written ONLY after a successful upload, and any failure after the
 * sheet insert cleans up the orphan (delete the sheet — the sidecar cascades via
 * ON DELETE CASCADE — plus any storage objects), so a retry starts clean.
 *
 * The sheet insert is client-side: existing `sheets` RLS lets a privileged
 * member insert, and the Phase 4 bootstrap made the user `admin` of the
 * container — no service-role, no RLS widening.
 */
export function useCreateWorkbenchDrawing(containerId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: NewWorkbenchDrawingInput): Promise<string> => {
      if (!containerId) {
        throw new Error('The Drawing Library is still loading — try again in a moment.');
      }
      const sheetName = input.sheetName.trim();
      if (!sheetName) throw new Error('Give the drawing a name.');
      if (!input.file) throw new Error('Choose a PDF to upload.');

      // 0. Defend the load-bearing contamination guard AT THE WRITE SITE: never
      //    write a workbench drawing under anything that isn't the hidden
      //    `kind='workbench'` container. The container is resolved by a query with
      //    `staleTime: Infinity` persisted to IndexedDB, so a stale/poisoned cache
      //    entry could otherwise point `containerId` at a LIVE project and a new
      //    drawing would silently contaminate it. One cheap read on the create
      //    action closes that hole (plan § Contamination guard / AGENTS.md §2).
      const { data: containerRow, error: kindErr } = await supabase
        .from('projects')
        .select('kind')
        .eq('id', containerId)
        .single();
      if (kindErr) throw kindErr;
      if (containerRow.kind !== 'workbench') {
        throw new Error(
          'Refusing to upload: the resolved Drawing Library container is not a workbench container. Reload the page and try again.',
        );
      }

      // 1. Create the sheets row under the hidden container.
      const { data: newSheet, error: insertErr } = await supabase
        .from('sheets')
        .insert([{ project_id: containerId, sheet_name: sheetName }])
        .select()
        .single();
      if (insertErr) throw insertErr;
      const sheetId = newSheet.id;

      try {
        // 2. Upload + server-convert the PDF through the EXISTING pipeline.
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error('Missing auth token for file upload');

        const { base_image_url } = await uploadFloorplanService(
          sheetId,
          input.file,
          input.pdfPageNumber,
          token,
        );

        // 3. Persist the converted-preview URL on the sheet (like handleAddLevel).
        const { error: updateErr } = await supabase
          .from('sheets')
          .update({ base_image_url })
          .eq('id', sheetId);
        if (updateErr) throw updateErr;

        // 4. Capture the per-drawing metadata sidecar (only after a successful
        //    upload, so a half-converted drawing never gets a metadata row).
        const { error: sidecarErr } = await supabase
          .from('workbench_sheets')
          .insert([buildWorkbenchSidecarInsert(sheetId, input)]);
        if (sidecarErr) throw sidecarErr;

        return sheetId;
      } catch (err) {
        // Cleanup-on-failure: remove the orphan sheet (sidecar cascades) plus any
        // storage objects the upload may have written, so a retry starts clean.
        try {
          await supabase.storage.from('floorplans').remove([
            `converted/${sheetId}.png`,
            `originals/${sheetId}.pdf`,
          ]);
        } catch {
          // best-effort — storage may have nothing written yet
        }
        invalidatePdfBytes(sheetId);
        try {
          await supabase.from('sheets').delete().eq('id', sheetId);
        } catch {
          // best-effort — leave the throw below as the surfaced error
        }
        throw err;
      }
    },
    onSuccess: (sheetId) => {
      // Invalidate ONLY the workbench keys — never the live `sheets` key, so a
      // workbench row can't leak into a live-project surface (contamination guard).
      if (containerId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workbenchSheets(containerId) });
      }
      // Mirror handleAddLevel: refresh cached vectors so snapping uses fresh data.
      queryClient.invalidateQueries({ queryKey: queryKeys.snappingVectors(sheetId) });
    },
    onError: () => {},
  });
}

/** The values a Phase-6 trace banks into a workbench label. */
export interface CreateWorkbenchLabelInput {
  /** The location name typed in the naming popover (trimmed before insert). */
  name: string;
  /** The traced polygon, in percent-space points (≥ 3 vertices). */
  points: PercentPoint[];
  /** The taxonomy pick (role + sub-type / "Other (pending)"), or null = no type. */
  pick: TaxonomyResult | null;
  /** The workbench drawing's `sheets` row — supplies base_image_url + scale_ratio for area. */
  sheet: Sheet;
}

/**
 * Read a converted-preview image's natural pixel dimensions (browser-only).
 * Resolves `null` if the image is missing or has no intrinsic size, so a label
 * still saves area-less — never throws and never blocks the trace.
 */
function loadImageDimensions(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve(img.naturalWidth && img.naturalHeight ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Bank a traced polygon as a `units` row under the hidden workbench container —
 * the Phase-6 "create label" path. A SLIM wrapper, not a fork: it reuses the
 * EXACT online create the live app uses (`useCreateUnit(sheetId)`) and the same
 * taxonomy resolver (`taxonomyResultToUnitFields` + `useProposePendingSubtype`),
 * deliberately bypassing `useMapActions` (which is wired to `useMapStore`/
 * `useUIStore` + status writes the workbench must never trigger).
 *
 * It sets the same fields the live trace does — `unit_type` = the chosen sub-type
 * name (kept for milestone-applicability back-compat, AGENTS.md §4), the canonical
 * `top_level_role`, `subtype_id`, and `computed_area` — so a workbench label is
 * shaped identically to a live one, just hanging off a `kind='workbench'` sheet.
 *
 * Two guardrails (plan § Contamination guard):
 *   • Write-site kind guard — verify the target sheet hangs off a
 *     `kind='workbench'` container before inserting, mirroring
 *     `useCreateWorkbenchDrawing`. The container read hook is IDB-persisted and
 *     could in theory serve a stale sheet, so we re-check at the write.
 *   • Scope of invalidation — the only cache key this path touches is
 *     `queryKeys.units(sheetId)` (via the reused `useCreateUnit`). `useCreateUnit`
 *     additionally invalidates the `['all_project_units']` prefix, but that is
 *     contamination-safe: every all-project rollup query is keyed by the live
 *     project's explicit sheet ids, and a `kind='workbench'` sheet is never among
 *     them (the dashboard excludes workbench containers), so a workbench label can
 *     never be pulled into a live surface or `progressAnalytics`.
 *
 * Online-first (a normal TanStack mutation), never the offline `pendingChanges`
 * queue; no `status_logs` are written.
 */
export function useCreateWorkbenchLabel(sheetId: string) {
  const createUnit = useCreateUnit(sheetId);
  const proposePending = useProposePendingSubtype();

  return useMutation({
    // Orchestration runs once — never retried — so a transient failure can't
    // re-run the insert and bank a duplicate label. The reused `useCreateUnit`
    // keeps its own (offline-first) resilience for the actual `units` insert.
    retry: false,
    mutationFn: async (input: CreateWorkbenchLabelInput): Promise<Unit> => {
      const name = input.name.trim();
      if (!name) throw new Error('Give the location a name.');
      if (!input.points || input.points.length < 3) throw new Error('Trace a closed shape first.');

      // Write-site kind guard — refuse to bank a label unless this sheet hangs
      // off the hidden `kind='workbench'` container (mirrors Phase 5's guard).
      const { data: sheetRow, error: sheetErr } = await supabase
        .from('sheets')
        .select('project_id')
        .eq('id', sheetId)
        .single();
      if (sheetErr) throw sheetErr;
      if (!sheetRow.project_id) {
        throw new Error('Refusing to save: this drawing has no parent project.');
      }
      const { data: containerRow, error: kindErr } = await supabase
        .from('projects')
        .select('kind')
        .eq('id', sheetRow.project_id)
        .single();
      if (kindErr) throw kindErr;
      if (containerRow.kind !== 'workbench') {
        throw new Error(
          'Refusing to save: this drawing is not in the Drawing Library. Reload the page and try again.',
        );
      }

      // Resolve the taxonomy pick into role/sub-type/unit_type columns, proposing
      // an "Other (pending)" dictionary row when needed (online-first; degrades to
      // role-only if the proposal write is denied — same as the live flow).
      const taxonomy = input.pick
        ? await taxonomyResultToUnitFields(input.pick, (vars) => proposePending.mutateAsync(vars))
        : null;

      // Real-world area, exactly like the live create: measure the converted
      // preview, then shoelace × scale_ratio (null when un-scaled — still saves).
      let computed_area: number | null = null;
      const baseImageUrl = input.sheet.base_image_url;
      if (baseImageUrl) {
        const dims = await loadImageDimensions(baseImageUrl);
        if (dims) {
          computed_area = computeLabelArea(input.points, dims.width, dims.height, input.sheet.scale_ratio);
        }
      }

      // Insert via the SAME online create path the live map uses.
      return createUnit.mutateAsync({
        sheet_id: sheetId,
        unit_number: name,
        polygon_coordinates: input.points,
        unit_type: taxonomy?.unit_type ?? null,
        top_level_role: taxonomy?.top_level_role ?? null,
        subtype_id: taxonomy?.subtype_id ?? null,
        computed_area,
      }) as Promise<Unit>;
    },
  });
}

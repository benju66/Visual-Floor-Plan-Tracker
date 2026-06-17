import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import { uploadFloorplanService } from '@/services/api';
import { invalidatePdfBytes } from '@/utils/pdfByteCache';
import { buildWorkbenchSidecarInsert, type WorkbenchSidecarFields } from '@/utils/workbench';

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

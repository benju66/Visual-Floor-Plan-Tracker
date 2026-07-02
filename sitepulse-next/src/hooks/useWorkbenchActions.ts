import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import { uploadFloorplanService, deleteSheetStorageService } from '@/services/api';
import { invalidatePdfBytes } from '@/utils/pdfByteCache';
import {
  buildWorkbenchSidecarInsert,
  REVIEW_STATES,
  type WorkbenchReviewState,
  type WorkbenchSidecarFields,
} from '@/utils/workbench';
import { computeAreaFromUnitsPerPx } from '@/utils/scale';
import { loadImageDimensions } from '@/utils/imageDimensions';
import { normalizeLocationName } from '@/utils/workbenchNaming';
import { useCreateUnit } from '@/hooks/useProjectQueries';
import { useProposePendingSubtype } from '@/hooks/useSubtypes';
import { taxonomyResultToUnitFields, type TaxonomyResult } from '@/utils/subtypes';
import {
  recordTraceEvent,
  labelSnapshotFromUnit,
  deriveEditSource,
  ANNOTATION_SPEC_VERSION,
  type TraceMethod,
  type TraceSource,
  type LabelSnapshot,
} from '@/utils/traceCapture';
import { normalizeOpeningEdges } from '@/utils/openingEdges';
import type { OpeningEdge, PercentPoint, Sheet, Unit } from '@/types/domain';

/**
 * Re-check that `containerId` is still the hidden `kind='workbench'` container
 * before any workbench write — the load-bearing contamination guard (plan
 * § Contamination guard / AGENTS.md §2). The container is resolved by an
 * IndexedDB-persisted query, so a stale/poisoned cache entry could point it at a
 * LIVE project; one cheap read on each write site closes that hole. Throws a
 * user-facing message if the target is anything but a workbench container.
 */
async function assertWorkbenchContainer(containerId: string): Promise<void> {
  const { data: containerRow, error } = await supabase
    .from('projects')
    .select('kind')
    .eq('id', containerId)
    .single();
  if (error) throw error;
  if (containerRow.kind !== 'workbench') {
    throw new Error(
      'Refusing to write: the resolved Drawing Library container is not a workbench container. Reload the page and try again.',
    );
  }
}

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
  /**
   * Architect/firm manual fallback (AI Tracing Assist — Phase 3a) — when the
   * uploader already knows the firm and won't read the title block. Written to
   * `sheet_metadata` (the firm's home), NOT the workbench sidecar; `source='human'`.
   * Optional; blank = leave it to the title-block reader.
   */
  architectFirm?: string;
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

        // 5. Manual architect/firm fallback → sheet_metadata (Phase 3a). The firm
        //    lives in sheet_metadata (its home), not the sidecar. Best-effort and
        //    non-fatal: the drawing is already created, so a metadata hiccup must
        //    not roll back a successful upload — the title-block reader can still
        //    capture the firm later. source='human' (manual entry).
        const firm = input.architectFirm?.trim();
        if (firm) {
          try {
            await supabase.from('sheet_metadata').upsert(
              {
                sheet_id: sheetId,
                architect_firm: firm,
                source: 'human',
                review_status: 'confirmed',
                spec_version: ANNOTATION_SPEC_VERSION,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'sheet_id' },
            );
          } catch (metaErr) {
            console.warn('[workbench] architect/firm metadata write failed (non-fatal):', metaErr);
          }
        }

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

/** The values a trace banks into a workbench label (Phase 6 geometry + Phase 7 metadata). */
export interface CreateWorkbenchLabelInput {
  /** The location name typed in the naming popover (normalized before insert). */
  name: string;
  /** The traced polygon, in percent-space points (≥ 3 vertices). */
  points: PercentPoint[];
  /**
   * The taxonomy pick (role + sub-type / "Other (pending)"). REQUIRED as of Phase 7
   * — the labeling standard mandates a role + type on every banked label, so the UI
   * blocks the save until one is chosen and this hook refuses a null pick.
   */
  pick: TaxonomyResult;
  /** The workbench drawing's `sheets` row — supplies base_image_url + scale_units_per_px for area. */
  sheet: Sheet;
  /** Standard §7 — the location reads as one space but spans two levels (loft/mezzanine). */
  spansLevels: boolean;
  /** Optional note describing the second level; only meaningful when {@link spansLevels}. */
  levelNote: string;
  /** Standard §5 — the location encloses a tracked void/core (a donut room). */
  hasVoid: boolean;
  // ---- Capture provenance (plan M1). All optional; the manual draw path omits
  // them and defaults to method='manual' / source='human'. The AI-assist spike
  // populates these so the suggested-vs-corrected signal is captured. ----
  /** How the geometry originated (default `'manual'`). */
  method?: TraceMethod;
  /** Provenance of the final value (default `'human'`). */
  source?: TraceSource;
  /** The frozen machine-proposed polygon, when this trace came from a suggestion. */
  suggestedPolygon?: PercentPoint[] | null;
  /** The frozen machine-proposed label, when this trace came from a suggestion. */
  suggestedLabel?: LabelSnapshot | null;
  /** Identifier of the model that produced the suggestion (null for manual). */
  modelVersion?: string | null;
  /** Wall-clock ms the user spent on this trace (the speed metric); null if untimed. */
  durationMs?: number | null;
  /**
   * Opening edges tagged on the room's perimeter during the trace (AI Tracing Assist
   * — Phase 4a): floor-level passages `[{ edgeIndex, type }]`, referenced by the
   * polygon edge's start vertex. Rides the unit write (NOT a separate table);
   * normalized against the polygon before insert. Default `[]` (a plain trace).
   */
  openingEdges?: OpeningEdge[];
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
 * name (kept for activity-applicability back-compat, AGENTS.md §4), the canonical
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
      // Normalize the name to its stored form (trim + collapse spaces, standard §4).
      // Within-sheet uniqueness is enforced at the UI gate, which has the sheet's
      // current names; this hook owns the trim + the required-type rule.
      const name = normalizeLocationName(input.name);
      if (!name) throw new Error('Give the location a name.');
      if (!input.points || input.points.length < 3) throw new Error('Trace a closed shape first.');
      if (!input.pick) throw new Error('Pick a role and type before saving.');

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
      await assertWorkbenchContainer(sheetRow.project_id);

      // Resolve the (required) taxonomy pick into role/sub-type/unit_type columns,
      // proposing an "Other (pending)" dictionary row when needed (online-first;
      // degrades to role-only if the proposal write is denied — same as the live flow).
      const taxonomy = await taxonomyResultToUnitFields(input.pick, (vars) =>
        proposePending.mutateAsync(vars),
      );

      // Real-world area, exactly like the live create: measure the converted
      // preview, then the CORRECT area math — pixelArea × scale_units_per_px²
      // (Phase 3; replaces the dimensionally-wrong × scale_ratio). Null when
      // un-scaled — the label still saves, area-less.
      let computed_area: number | null = null;
      const baseImageUrl = input.sheet.base_image_url;
      if (baseImageUrl) {
        const dims = await loadImageDimensions(baseImageUrl);
        if (dims) {
          computed_area = computeAreaFromUnitsPerPx(
            input.points,
            dims.width,
            dims.height,
            input.sheet.scale_units_per_px,
          );
        }
      }

      // Insert via the SAME online create path the live map uses, carrying the
      // Phase-7 two-level / void label metadata onto the (Phase-3) nullable columns
      // PLUS the capture provenance (plan M1): method/source/spec_version, and — when
      // this came from a machine proposal — the FROZEN original suggestion, so the
      // suggested-vs-final correction signal is durable on the row even if the
      // best-effort event write below is ever missed.
      const levelNote = input.spansLevels ? input.levelNote.trim() || null : null;
      const method: TraceMethod = input.method ?? 'manual';
      const source: TraceSource = input.source ?? 'human';
      // Opening edges (Phase 4a): normalized against the polygon so a stray tag never
      // persists. Rides this same unit insert + M1 provenance — no parallel write path.
      const openingEdges = normalizeOpeningEdges(input.openingEdges ?? [], input.points.length);
      const created = (await createUnit.mutateAsync({
        sheet_id: sheetId,
        unit_number: name,
        polygon_coordinates: input.points,
        opening_edges: openingEdges,
        unit_type: taxonomy.unit_type,
        top_level_role: taxonomy.top_level_role,
        subtype_id: taxonomy.subtype_id,
        computed_area,
        spans_levels: input.spansLevels,
        level_note: levelNote,
        has_void: input.hasVoid,
        method,
        source,
        model_version: input.modelVersion ?? null,
        suggested_polygon: (input.suggestedPolygon ?? null) as Unit['suggested_polygon'],
        suggested_label: (input.suggestedLabel ?? null) as Unit['suggested_label'],
        review_status: source === 'human' ? 'confirmed' : 'unreviewed',
        spec_version: ANNOTATION_SPEC_VERSION,
      })) as Unit;

      // Append the immutable create event (best-effort; never blocks the save).
      await recordTraceEvent({
        sheetId,
        unitId: created.id,
        eventType: 'create',
        method,
        source,
        afterPolygon: input.points,
        afterLabel: labelSnapshotFromUnit(created),
        modelVersion: input.modelVersion ?? null,
        durationMs: input.durationMs ?? null,
        groupKey: sheetId,
      });

      return created;
    },
  });
}

/** Move a workbench drawing through its review lifecycle (standard §9). */
export interface UpdateWorkbenchReviewInput {
  /** The drawing's `sheets` id (= `workbench_sheets.sheet_id`). */
  sheetId: string;
  /** The target review state. */
  reviewState: WorkbenchReviewState;
  /**
   * The reviewing user's id — stamped onto `reviewed_by` only when moving to
   * `reviewed`. Cleared (along with `reviewed_at`) on any other transition, so a
   * drawing bounced back to `draft`/`ready_for_review` no longer claims a reviewer.
   */
  reviewerId: string | null;
}

/**
 * Advance a workbench drawing's `review_state` (`draft → ready_for_review →
 * reviewed`), stamping `reviewed_by`/`reviewed_at` when (and only when) it reaches
 * `reviewed`. The Definition-of-Done gate is enforced at the UI (the "mark
 * reviewed" control is disabled until `definitionOfDoneChecks(...).passed`); this
 * hook owns the write + the contamination guard.
 *
 * Online-first TanStack mutation; carries the same `kind='workbench'` write-site
 * guard as the other workbench writes and invalidates ONLY the workbench drawings
 * key, so a review change can never touch a live-project surface.
 */
export function useUpdateWorkbenchReviewState(containerId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateWorkbenchReviewInput): Promise<void> => {
      if (!containerId) {
        throw new Error('The Drawing Library is still loading — try again in a moment.');
      }
      if (!REVIEW_STATES.includes(input.reviewState)) {
        throw new Error(`Unknown review state: ${input.reviewState}`);
      }
      await assertWorkbenchContainer(containerId);

      const isReviewed = input.reviewState === 'reviewed';
      const { error } = await supabase
        .from('workbench_sheets')
        .update({
          review_state: input.reviewState,
          reviewed_by: isReviewed ? input.reviewerId : null,
          reviewed_at: isReviewed ? new Date().toISOString() : null,
        })
        .eq('sheet_id', input.sheetId);
      if (error) throw error;
    },
    onSuccess: () => {
      if (containerId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workbenchSheets(containerId) });
      }
    },
  });
}

/** Set a workbench drawing's per-sheet completeness flag (AI Tracing Assist — Phase 4c). */
export interface SetWorkbenchFullyTracedInput {
  /** The drawing's `sheets` id (= `workbench_sheets.sheet_id`). */
  sheetId: string;
  /** The new value of `fully_traced` (the reviewer's completeness declaration). */
  fullyTraced: boolean;
}

/**
 * Toggle a workbench drawing's `workbench_sheets.fully_traced` flag — the per-sheet
 * training-eligibility gate (AI Tracing Assist — Phase 4c). The reviewer ticks it to
 * declare "every room AND every floor passage on this sheet is traced," which is one
 * of the Definition-of-Done checks gating "Mark reviewed" AND the broad filter that
 * keeps partial / product-use sheets out of the (future) training-corpus export. A
 * SLIM wrapper writing ONLY that one boolean — it leaves the review state, reviewer
 * stamps, and every label untouched.
 *
 * Online-first TanStack mutation; carries the same `kind='workbench'` write-site
 * guard as the other workbench writes (the container is resolved by an IDB-persisted
 * query, so a poisoned cache could in theory point it at a live project — the cheap
 * re-check closes that hole) and invalidates ONLY the workbench drawings key, so a
 * completeness change can never touch a live-project surface.
 */
export function useSetWorkbenchFullyTraced(containerId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SetWorkbenchFullyTracedInput): Promise<void> => {
      if (!containerId) {
        throw new Error('The Drawing Library is still loading — try again in a moment.');
      }
      await assertWorkbenchContainer(containerId);

      const { error } = await supabase
        .from('workbench_sheets')
        .update({ fully_traced: input.fullyTraced })
        .eq('sheet_id', input.sheetId);
      if (error) throw error;
    },
    onSuccess: () => {
      if (containerId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workbenchSheets(containerId) });
      }
    },
  });
}

/** Identify the workbench drawing to archive, plus who archived it (provenance). */
export interface ArchiveWorkbenchDrawingInput {
  /** The drawing's `sheets` id (= `workbench_sheets.sheet_id`). */
  sheetId: string;
  /**
   * The archiving user's id — stamped onto `deleted_by` (cheap provenance,
   * mirrors `reviewed_by`). `null` when the id is unavailable; the archive still
   * succeeds (the marker is `deleted_at`, not the actor).
   */
  archivedBy: string | null;
}

/**
 * Archive (soft-delete) a workbench drawing — Phase 8b. Stamps
 * `deleted_at = now()` + `deleted_by` on the `workbench_sheets` sidecar, which
 * removes the drawing from the default library grid AND the corpus-health counts
 * (both read the active list) while leaving its labels / storage fully intact, so
 * {@link useRestoreWorkbenchDrawing} can bring it straight back. This is the easy,
 * low-risk, REVERSIBLE action — permanent purge is the separate, gated Phase 8c.
 *
 * Online-first TanStack mutation. Carries the same `kind='workbench'` write-site
 * guard as every other workbench write (the container is resolved by an
 * IDB-persisted query, so a poisoned cache could in theory point it at a live
 * project — the cheap re-check closes that hole). Invalidates `workbenchSheets`
 * (the 2-element prefix → both the active and show-archived variants) AND
 * `workbenchCorpusUnits`, so the grid and the health strip both refresh.
 */
export function useArchiveWorkbenchDrawing(containerId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ArchiveWorkbenchDrawingInput): Promise<void> => {
      if (!containerId) {
        throw new Error('The Drawing Library is still loading — try again in a moment.');
      }
      await assertWorkbenchContainer(containerId);

      const { error } = await supabase
        .from('workbench_sheets')
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: input.archivedBy,
        })
        .eq('sheet_id', input.sheetId);
      if (error) throw error;
    },
    onSuccess: () => {
      if (containerId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workbenchSheets(containerId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.workbenchCorpusUnits(containerId) });
      }
    },
  });
}

/**
 * Restore an archived workbench drawing — Phase 8b. Clears `deleted_at` +
 * `deleted_by` on the sidecar, bringing the drawing (and its untouched labels)
 * straight back into the active library + corpus-health counts. The exact inverse
 * of {@link useArchiveWorkbenchDrawing}: same container guard, same invalidations.
 */
export function useRestoreWorkbenchDrawing(containerId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sheetId: string): Promise<void> => {
      if (!containerId) {
        throw new Error('The Drawing Library is still loading — try again in a moment.');
      }
      await assertWorkbenchContainer(containerId);

      const { error } = await supabase
        .from('workbench_sheets')
        .update({ deleted_at: null, deleted_by: null })
        .eq('sheet_id', sheetId);
      if (error) throw error;
    },
    onSuccess: () => {
      if (containerId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workbenchSheets(containerId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.workbenchCorpusUnits(containerId) });
      }
    },
  });
}

/**
 * PERMANENTLY purge a workbench drawing — Phase 8c, the IRREVERSIBLE counterpart
 * to 8b's recoverable {@link useArchiveWorkbenchDrawing}. There is no undo: this
 * destroys the drawing's storage objects, its cached snapping vectors, and the
 * `sheets` row, and the FK `ON DELETE CASCADE` takes the `workbench_sheets`
 * sidecar AND every `units` label hanging off it (plan § Data model). The UI gate
 * for this hook is the mandatory type-to-confirm modal (ConfirmPurgeModal) — this
 * hook must never be called from anything that skips that typed confirmation.
 *
 * It mirrors the live-app delete (`useProjectActions.handleDeleteSheet`) but is
 * deliberately TRIMMED for the workbench data model:
 *   • no `status_logs` delete — the workbench never writes status, so labels never
 *     have status rows (the manual unit delete is also dropped: the cascade removes
 *     the units when the `sheets` row goes);
 *   • no `tiles/` cleanup — that OpenSeadragon path was removed (AGENTS.md §5;
 *     `tile_manifest_url` is vestigial).
 * Storage cleanup goes through the BACKEND (`deleteSheetStorageService`): storage
 * RLS denies the client's own `.remove()`, so a client delete would orphan the
 * blobs (plan § Reclaiming storage blobs). It's best-effort/non-fatal and ordered
 * FIRST (the backend needs the `sheets` row to resolve access); the `sheets`
 * delete is the real destruction and is ordered LAST, after storage + vectors,
 * exactly like `handleDeleteSheet`.
 *
 * Online-first TanStack mutation. Carries the same `kind='workbench'` write-site
 * guard as every other workbench write (the container is resolved by an
 * IDB-persisted query, so a poisoned cache could in theory point it at a live
 * project — the cheap re-check refuses to destroy anything outside the workbench).
 * On success invalidates `workbenchSheets` (the 2-element prefix → both the active
 * and show-archived variants) AND `workbenchCorpusUnits`, so the grid and the
 * corpus-health counts both refresh.
 */
export function useHardDeleteWorkbenchDrawing(containerId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    // Never retried: a partial failure must surface, not silently re-run the
    // destruction sequence.
    retry: false,
    mutationFn: async (sheetId: string): Promise<void> => {
      if (!containerId) {
        throw new Error('The Drawing Library is still loading — try again in a moment.');
      }
      // Guard FIRST: refuse to purge anything that isn't under the hidden
      // `kind='workbench'` container, before a single object is removed.
      await assertWorkbenchContainer(containerId);

      // 1. Remove the stored converted preview + original PDF via the BACKEND
      //    (service-role): storage RLS denies the client's own `.remove()`
      //    project-wide, so a client delete silently orphans the blobs. This must
      //    run BEFORE the `sheets` row is deleted (the backend resolves access
      //    from the still-present row). Best-effort/non-fatal — a backend hiccup
      //    must never block a purge the user explicitly confirmed; at worst it
      //    re-orphans the blobs (recoverable from the Storage dashboard), which is
      //    no worse than the pre-fix behaviour. Idempotent server-side.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (token) await deleteSheetStorageService(sheetId, token);
      } catch (storageErr) {
        console.warn('[workbench] storage cleanup failed (non-fatal):', storageErr);
      }
      invalidatePdfBytes(sheetId);

      // 2. Drop the cached snapping vectors (NOT cascaded by the sheets FK).
      const { error: vectorErr } = await supabase
        .from('sheet_vectors')
        .delete()
        .eq('sheet_id', sheetId);
      if (vectorErr) throw vectorErr;

      // 3. The real destruction, ordered last: delete the `sheets` row. The FK
      //    `ON DELETE CASCADE` takes the `workbench_sheets` sidecar AND the
      //    `units` labels with it — do NOT hand-delete those.
      const { error: sheetErr } = await supabase.from('sheets').delete().eq('id', sheetId);
      if (sheetErr) throw sheetErr;
    },
    onSuccess: () => {
      if (containerId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workbenchSheets(containerId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.workbenchCorpusUnits(containerId) });
      }
    },
  });
}

/** Fields an existing workbench label can be edited to (any subset; omitted = unchanged). */
export interface UpdateWorkbenchLabelInput {
  /** The `units` row to edit. */
  unitId: string;
  /** New name → `unit_number` (normalized; rejected if blank). */
  name?: string;
  /** New taxonomy pick → re-resolves `unit_type`/`top_level_role`/`subtype_id`. */
  pick?: TaxonomyResult;
  /** Standard §7 two-level flag. */
  spansLevels?: boolean;
  /** Second-level note (trimmed; blank → null). */
  levelNote?: string | null;
  /** Standard §5 void flag. */
  hasVoid?: boolean;
  /** Wall-clock ms the user spent on this edit (the speed metric); null if untimed. */
  durationMs?: number | null;
}

/**
 * Edit an existing workbench label — the rename / re-type / flag-edit path used by
 * the canvas in-place "Rename" action and the review table. A SLIM wrapper over a
 * direct `units` update that applies the SAME standard rules as the create path:
 * the name is normalized (trim + collapse spaces, §4), and a new taxonomy pick is
 * resolved through `taxonomyResultToUnitFields` (proposing an "Other (pending)" row
 * when needed). Only the provided fields are written; the rest are untouched.
 *
 * No container kind-guard read here: unlike create (which CHOOSES a parent and so
 * could be aimed at a live project by a poisoned cache), this targets an existing
 * label by id and never changes its parent sheet, so it cannot contaminate a live
 * surface. Invalidates only `units(sheetId)` (+ the all-project prefix the live
 * create/update paths already touch — contamination-safe, since no rollup query is
 * keyed by a workbench sheet's ids). Online-first; no `status_logs` are written.
 */
export function useUpdateWorkbenchLabel(sheetId: string) {
  const queryClient = useQueryClient();
  const proposePending = useProposePendingSubtype();

  return useMutation({
    retry: false,
    mutationFn: async (input: UpdateWorkbenchLabelInput): Promise<Unit> => {
      const updates: Partial<Unit> = {};

      if (input.name !== undefined) {
        const name = normalizeLocationName(input.name);
        if (!name) throw new Error('Give the location a name.');
        updates.unit_number = name;
      }
      if (input.pick !== undefined) {
        const taxonomy = await taxonomyResultToUnitFields(input.pick, (vars) =>
          proposePending.mutateAsync(vars),
        );
        updates.unit_type = taxonomy.unit_type;
        updates.top_level_role = taxonomy.top_level_role;
        updates.subtype_id = taxonomy.subtype_id;
      }
      if (input.spansLevels !== undefined) updates.spans_levels = input.spansLevels;
      if (input.levelNote !== undefined) {
        const note = (input.levelNote ?? '').trim();
        updates.level_note = note.length > 0 ? note : null;
      }
      if (input.hasVoid !== undefined) updates.has_void = input.hasVoid;

      // Capture the before-state (from cache, no extra round-trip) for the correction
      // signal, and stamp provenance: a human touching the row makes it 'confirmed'
      // and flips an AI-origin label to 'ai_edited' (the correction signal) while a
      // hand-made one stays 'human'.
      const before =
        queryClient.getQueryData<Unit[]>(queryKeys.units(sheetId))?.find((u) => u.id === input.unitId) ?? null;
      const newSource = deriveEditSource(before?.source ?? null);
      updates.source = newSource;
      updates.review_status = 'confirmed';

      const { data, error } = await supabase
        .from('units')
        .update(updates as never)
        .eq('id', input.unitId)
        .select()
        .single();
      if (error) throw error;
      const updated = data as unknown as Unit;

      // Append the immutable edit event (best-effort; never blocks the save).
      await recordTraceEvent({
        sheetId,
        unitId: input.unitId,
        eventType: 'update_label',
        method: (before?.method as TraceMethod | null) ?? 'manual',
        source: newSource,
        beforePolygon: before?.polygon_coordinates ?? null,
        afterPolygon: updated.polygon_coordinates ?? null,
        beforeLabel: before ? labelSnapshotFromUnit(before) : null,
        afterLabel: labelSnapshotFromUnit(updated),
        durationMs: input.durationMs ?? null,
        groupKey: sheetId,
      });

      return updated;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.units(sheetId) });
      queryClient.invalidateQueries({ queryKey: ['all_project_units'] });
    },
  });
}

/** Set a workbench room's opening edges (Phase 4a) — the in-draw bank + edit-after path. */
export interface UpdateWorkbenchOpeningEdgesInput {
  /** The `units` row whose opening tags change. */
  unitId: string;
  /** The full new opening-edge list (toggled by the caller); normalized before write. */
  openingEdges: OpeningEdge[];
  /** The room's polygon vertex count — out-of-range tags are dropped against it. */
  polygonLength: number;
}

/**
 * Write a workbench room's `opening_edges` (AI Tracing Assist — Phase 4a) — the
 * edit-after correction path (select a saved room → click a boundary edge → set /
 * clear its opening type). A SLIM wrapper over a direct `units` update that writes
 * ONLY the opening tags (normalized against the polygon); it deliberately leaves the
 * room's name / type / geometry / provenance untouched, because an opening tag is
 * additive boundary metadata, not a re-trace or a re-name. The human action is
 * captured in the immutable `trace_events` log as an `update_geometry` event (the
 * tags are part of the room's boundary), carrying the room's existing method/source.
 *
 * No container kind-guard read: like {@link useUpdateWorkbenchLabel}, this targets an
 * existing row by id and never changes its parent sheet, so it cannot contaminate a
 * live surface. Online-first; optimistic so the overlay re-colors instantly;
 * invalidates only `units(sheetId)` (+ the all-project prefix the other unit writes
 * already touch — contamination-safe, no rollup is keyed by a workbench sheet's ids).
 */
export function useUpdateWorkbenchOpeningEdges(sheetId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    retry: false,
    mutationFn: async (input: UpdateWorkbenchOpeningEdgesInput): Promise<Unit> => {
      const before =
        queryClient.getQueryData<Unit[]>(queryKeys.units(sheetId))?.find((u) => u.id === input.unitId) ?? null;
      const cleaned = normalizeOpeningEdges(input.openingEdges, input.polygonLength);

      const { data, error } = await supabase
        .from('units')
        .update({ opening_edges: cleaned as never })
        .eq('id', input.unitId)
        .select()
        .single();
      if (error) throw error;
      const updated = data as unknown as Unit;

      // Append the immutable edit event (best-effort; never blocks the save). Opening
      // tags are boundary geometry, so this is an `update_geometry` action; the
      // polygon itself is unchanged (before === after polygon).
      await recordTraceEvent({
        sheetId,
        unitId: input.unitId,
        eventType: 'update_geometry',
        method: (before?.method as TraceMethod | null) ?? 'manual',
        source: (before?.source as TraceSource | null) ?? null,
        beforePolygon: before?.polygon_coordinates ?? null,
        afterPolygon: updated.polygon_coordinates ?? null,
        beforeLabel: before ? labelSnapshotFromUnit(before) : null,
        afterLabel: labelSnapshotFromUnit(updated),
        groupKey: sheetId,
      });

      return updated;
    },
    onMutate: async (input) => {
      // Optimistic: re-color the canvas overlay immediately (the tags are cheap, valid
      // shapes from the caller). The refetch in onSettled reconciles with the server.
      await queryClient.cancelQueries({ queryKey: queryKeys.units(sheetId) });
      queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, (old) =>
        old ? old.map((u) => (u.id === input.unitId ? { ...u, opening_edges: input.openingEdges } : u)) : old,
      );
      return {};
    },
    onError: () => {},
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.units(sheetId) });
      queryClient.invalidateQueries({ queryKey: ['all_project_units'] });
    },
  });
}

/** Set a workbench room's polygon after a node move (the "Select / adjust" tool). */
export interface UpdateWorkbenchGeometryInput {
  /** The `units` row whose polygon changes. */
  unitId: string;
  /** The full new vertex list (one node moved by the caller). */
  points: PercentPoint[];
}

/**
 * Persist a workbench room's polygon after a node move — the missing geometry-edit
 * write that left "Select / adjust" node drags visual-only (they reverted to the saved
 * shape on the next refetch — "snaps back to a square"). A SLIM sibling of
 * {@link useUpdateWorkbenchOpeningEdges}: it writes ONLY `polygon_coordinates` and
 * records an `update_geometry` trace event (before/after polygon — the human's shape
 * correction, the training signal), leaving the room's name / type / provenance
 * untouched (nudging a vertex is not a re-name).
 *
 * No container kind-guard read: like the other unit writes it targets an existing row
 * by id and never changes its parent sheet, so it cannot contaminate a live surface.
 * Online-first; optimistic so the moved shape stays put instantly AND the cache holds
 * the new vertices — so MappedUnit's optimistic preview reconciles to the saved shape,
 * not the pre-move rectangle. Invalidates only `units(sheetId)` (+ the contamination-
 * safe all-project prefix the other unit writes already touch).
 */
export function useUpdateWorkbenchGeometry(sheetId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    retry: false,
    mutationFn: async (input: UpdateWorkbenchGeometryInput): Promise<Unit> => {
      const before =
        queryClient.getQueryData<Unit[]>(queryKeys.units(sheetId))?.find((u) => u.id === input.unitId) ?? null;

      const { data, error } = await supabase
        .from('units')
        .update({ polygon_coordinates: input.points as never })
        .eq('id', input.unitId)
        .select()
        .single();
      if (error) throw error;
      const updated = data as unknown as Unit;

      // Append the immutable edit event (best-effort; never blocks the save). A node
      // move is a boundary correction, so this is an `update_geometry` action carrying
      // the before/after polygon; the label itself is unchanged.
      await recordTraceEvent({
        sheetId,
        unitId: input.unitId,
        eventType: 'update_geometry',
        method: (before?.method as TraceMethod | null) ?? 'manual',
        source: (before?.source as TraceSource | null) ?? null,
        beforePolygon: before?.polygon_coordinates ?? null,
        afterPolygon: updated.polygon_coordinates ?? null,
        beforeLabel: before ? labelSnapshotFromUnit(before) : null,
        afterLabel: labelSnapshotFromUnit(updated),
        groupKey: sheetId,
      });

      return updated;
    },
    onMutate: async (input) => {
      // Optimistic: keep the moved shape on the canvas immediately and seed the cache
      // with the new vertices, so MappedUnit's optimistic preview reconciles to the NEW
      // saved geometry (not the pre-move rectangle) when it clears.
      await queryClient.cancelQueries({ queryKey: queryKeys.units(sheetId) });
      const previous = queryClient.getQueryData<Unit[]>(queryKeys.units(sheetId));
      queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, (old) =>
        old ? old.map((u) => (u.id === input.unitId ? { ...u, polygon_coordinates: input.points } : u)) : old,
      );
      return { previous };
    },
    onError: (_err, _input, context) => {
      // Roll the canvas back to the last saved shape if the write failed.
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.units(sheetId), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.units(sheetId) });
      queryClient.invalidateQueries({ queryKey: ['all_project_units'] });
    },
  });
}

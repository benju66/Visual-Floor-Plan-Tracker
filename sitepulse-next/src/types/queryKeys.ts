export const queryKeys = {
  project:            (id: string)              => ['project', id]          as const,
  sheets:             (projectId: string)       => ['sheets', projectId]    as const,
  units:              (sheetId: string)         => ['units', sheetId]       as const,
  milestones:         (projectId: string)       => ['milestones', projectId]as const,
  projectContacts:    (projectId: string)       => ['project_contacts', projectId] as const,
  milestoneOverrides: (projectId: string)       => ['milestone_overrides', projectId] as const,
  statuses:           (sheetId: string, unitIds: string[]) => ['statuses', sheetId, ...unitIds] as const,
  allProjectUnits:    (sheetIds: string[])      => ['all_project_units', ...sheetIds] as const,
  allProjectStatuses: (unitIds: string[])       => ['all_project_statuses', ...unitIds] as const,
  unitHistory:        (unitId: string)          => ['unit_history', unitId]  as const,
  statusHistory:      (...unitIds: string[])    => ['status_history', ...unitIds] as const,
  snappingVectors:    (sheetId: string)         => ['snapping_vectors_v2', sheetId] as const,
  // 1:1 cache of a sheet's extracted PDF text words (AI Tracing Assist — Phase 2).
  // Mirrors snappingVectors: read sheet_text first, fall back to /extract-text with
  // write-through. Feeds room-name auto-fill on a finished trace.
  sheetText:          (sheetId: string)         => ['sheet_text', sheetId] as const,
  // 1:1 confirmed title-block facts for a sheet (AI Tracing Assist — Phase 3a):
  // sheet number / name / architect firm + the dragged box + M1 provenance.
  // Cache-first read; invalidated by the confirm/save write.
  sheetMetadata:      (sheetId: string)         => ['sheet_metadata', sheetId] as const,
  // 1:1 confirmed gridlines for a sheet (AI Tracing Assist — Phase 3b):
  // [{ label, p1, p2, axis }] + M1 provenance. Cache-first read; invalidated by
  // the "accept all" bulk-confirm upsert.
  sheetGridlines:     (sheetId: string)         => ['sheet_gridlines', sheetId] as const,
  projectMembers:     (projectId: string)       => ['project_members', projectId] as const,
  currentUserRole:    (projectId: string)       => ['current_user_role', projectId] as const,
  subtypes:           ()                         => ['subtypes'] as const,
  // Company-wide learned naming vocabulary (Trace Naming & Type Assist Phase 2):
  // a paginated read of every confirmed room the user can see (RLS-scoped to their
  // project memberships), folded into a plain-JSON frequency model. Keyed globally
  // (not per-project) — learning is cross-project. Warm-cached + best-effort.
  namingVocabulary:   ()                         => ['naming_vocabulary'] as const,
  // Location Labeling Workbench (Phase 4): the single hidden kind='workbench'
  // container and its drawings. Distinct keys keep workbench reads isolated from
  // every live-project surface (contamination guard — AGENTS.md §2).
  workbenchContainer: ()                         => ['workbench_container'] as const,
  // The 2-element form below is the INVALIDATION PREFIX. `useWorkbenchSheets`
  // appends an `includeArchived` boolean (Phase 8b soft-delete) so the active and
  // "Show archived" lists cache separately; invalidating this prefix partial-matches
  // (and refreshes) both variants.
  workbenchSheets:    (containerId: string)      => ['workbench_sheets', containerId] as const,
  // Phase 8a: the container's labels aggregated across its sheets, for the
  // corpus-health strip. Container-scoped (joined to the container's sheets
  // ONLY) — never an all-project units rollup (contamination guard).
  workbenchCorpusUnits: (containerId: string)    => ['workbench_corpus_units', containerId] as const,
} as const;

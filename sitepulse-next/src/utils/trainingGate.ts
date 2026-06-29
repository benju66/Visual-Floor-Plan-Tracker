/**
 * Per-project AI-training gate (Notes/plans/Project-AI-Training-Optout-Plan.md).
 *
 * A project admin can opt an individual project OUT of contributing to AI: when
 * `projects.ai_training_enabled` is false, the client must NOT write the training
 * corpus (trace_events + units provenance) for traces in that project, and the
 * company-wide naming-vocabulary learning must EXCLUDE that project's rooms.
 *
 * Pure + deterministic (no DB, no React, no Date.now) so the load-bearing
 * "default-ON, only explicit-false opts out" rule is unit-tested in isolation
 * (AGENTS.md §9). These are the single source of truth for the gate decision —
 * the write sites and the vocabulary read both route through here.
 */

/** The minimal project shape the gate needs (a narrowed `projects` row). */
export interface TrainingFlagProject {
  ai_training_enabled?: boolean | null;
}

/**
 * Is this project contributing to AI training? DEFAULT-ON: a true flag, a missing
 * flag (legacy row read before the column existed), a null, or a null/undefined
 * project all return `true`. ONLY an explicit `false` opts the project out. This
 * asymmetry is deliberate — a project must keep contributing unless someone
 * intentionally turned it off, and a transient read gap must never silently
 * disable capture for an opted-IN project.
 */
export function isProjectTrainingEnabled(
  project: TrainingFlagProject | null | undefined,
): boolean {
  return project?.ai_training_enabled !== false;
}

/**
 * Drop rooms that belong to an opted-OUT project before they feed the naming
 * vocabulary. Membership is by `sheet_id` (the caller resolves opted-out projects
 * → their sheet ids once). An EMPTY exclusion set returns the input unchanged
 * (the common case — no project opted out — costs nothing). A room with a
 * null/missing `sheet_id` can't be matched to a project, so it is KEPT (the gate
 * never silently drops a room it can't attribute). Pure; never mutates the input.
 */
export function excludeUntrainableRooms<T extends { sheet_id?: string | null }>(
  rooms: ReadonlyArray<T>,
  excludedSheetIds: ReadonlySet<string>,
): T[] {
  if (excludedSheetIds.size === 0) return rooms.slice();
  return rooms.filter((r) => !(r.sheet_id != null && excludedSheetIds.has(r.sheet_id)));
}

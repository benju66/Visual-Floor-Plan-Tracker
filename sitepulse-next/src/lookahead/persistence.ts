"use client";

// SitePulse persistence adapter for the absorbed Look-Ahead module (Phase 0a).
// This REPLACES the standalone app's `store/useSession.ts` cloud layer: instead of
// Lookahead's own Supabase project + auth + project list, the plan rides on
// SitePulse's typed `supabase` client and session, keyed to the active SitePulse
// `project_id`. One SitePulse project ⇄ one `lookahead_plans` row (UNIQUE(project_id)).
//
// Isolation (AGENTS.md guardrails): this touches ONLY the new `lookahead_plans`
// table — never status_logs / units / sheets / project_milestones. The plan blob
// is opaque to Postgres (a `doc jsonb` column); RLS on the table governs access.

import { supabase } from "@/supabaseClient";
import type { Json } from "@/types/database.types";
import { useStore, projectBlob } from "@/lookahead/store/useStore";
import { makeBlankProjectBlob } from "@/lookahead/lib/defaults";
import { isProjectBlob } from "@/lookahead/isProjectBlob";

/**
 * Load a project's saved plan into the document store.
 * - If a row exists and its `doc` narrows to a valid ProjectBlob → hydrate the store with it.
 * - Otherwise (no row yet, or a malformed blob) → hydrate a blank plan WITHOUT writing
 *   a row. Creation is lazy: a row is only written on the first {@link savePlan}.
 * Returns `true` when an existing stored plan was loaded, `false` when blank.
 */
export async function loadPlan(projectId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("lookahead_plans")
    .select("doc")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;

  // Narrow the opaque `doc` (Json) at the query boundary (AGENTS.md §6).
  if (data && isProjectBlob(data.doc)) {
    useStore.getState().loadProject(data.doc);
    return true;
  }

  useStore.getState().loadProject(makeBlankProjectBlob(""));
  return false;
}

/**
 * Upsert the current document-store state into `lookahead_plans` for `projectId`.
 * Conflict target is `project_id` (its UNIQUE constraint), so the first save inserts
 * and every later save updates the same row. `created_by` is filled by the column's
 * `DEFAULT auth.uid()` on insert and left untouched on update; `updated_at` is bumped
 * here on every write.
 */
export async function savePlan(projectId: string): Promise<void> {
  const doc = projectBlob(useStore.getState());
  const { error } = await supabase
    .from("lookahead_plans")
    .upsert(
      {
        project_id: projectId,
        // The blob is validated/owned by the app; Postgres stores it opaquely.
        doc: doc as unknown as Json,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id" }
    );
  if (error) throw error;
}

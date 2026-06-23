import type { Area, ProjectBlob } from "@/lookahead/lib/types";

// Boundary guard (AGENTS.md §6): the `lookahead_plans.doc` column is typed `Json`
// by the Supabase generator. Narrow it to the vendored `ProjectBlob` shape here,
// at the query boundary, before it reaches the document store — never let `Json`
// propagate. Null-safe per element (mirrors the spirit of the domain.ts guards):
// a malformed value yields `false`, it never throws.

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A structurally-valid Area: id/name/currentWeek strings + object `weeks`/`view`. */
function isArea(v: unknown): v is Area {
  if (!isPlainObject(v)) return false;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.currentWeek === "string" &&
    isPlainObject(v.weeks) &&
    isPlainObject(v.view)
  );
}

/**
 * Narrows an opaque `doc` (e.g. a `lookahead_plans.doc` Json value) to a
 * `ProjectBlob`. Requires the four top-level keys, a `project.info` object with
 * the three project-wide arrays, and at least one structurally-valid area.
 */
export function isProjectBlob(doc: unknown): doc is ProjectBlob {
  if (!isPlainObject(doc)) return false;

  // project meta
  if (!isPlainObject(doc.project)) return false;
  const project = doc.project;
  if (!isPlainObject(project.info)) return false;
  if (!Array.isArray(project.subs) || !Array.isArray(project.holidays) || !Array.isArray(project.milestones)) {
    return false;
  }

  // areas map — at least one, every value a valid Area
  if (!isPlainObject(doc.areas)) return false;
  const areaIds = Object.keys(doc.areas);
  if (areaIds.length === 0) return false;
  if (!areaIds.every((id) => isArea((doc.areas as Record<string, unknown>)[id]))) return false;

  // ordering + current pointer
  if (!Array.isArray(doc.areaOrder) || !doc.areaOrder.every((id) => typeof id === "string")) return false;
  if (typeof doc.currentAreaId !== "string") return false;

  return true;
}

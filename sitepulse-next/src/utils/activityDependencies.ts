/**
 * Activity dependencies — pure helpers for the light Finish-to-Start dependency
 * graph (Scheduling Foundation, Slice A, Phase 3b).
 *
 * Framework-free and deterministic (no DB, no React, no `Date.now()`). Dependencies
 * stay COARSE by design: FS-only + a lag in days ("B starts after A finishes, +N days").
 * No critical-path / float / resource-leveling math lives here or anywhere else —
 * that is explicitly out of scope for Slice A.
 *
 * The v1 authoring UI allows ONE predecessor per activity (a chain), though the
 * `activity_dependencies` table itself is pair-unique and could hold a DAG later.
 */
import type { ActivityDependency } from '@/types/domain';

/** The single predecessor edge for an activity (v1 authors at most one), or null. */
export function predecessorEdgeFor(
  deps: ActivityDependency[],
  activityId: string,
): ActivityDependency | null {
  return deps.find((d) => d.successor_activity_id === activityId) ?? null;
}

/**
 * Would linking `predecessorId → successorId` close a loop? Walks the (single-
 * predecessor) chain upward from the candidate predecessor; if it ever reaches the
 * successor, the link is circular. A visited set guards against pre-existing bad
 * data so the walk always terminates.
 */
export function wouldCreateCycle(
  deps: ActivityDependency[],
  predecessorId: string,
  successorId: string,
): boolean {
  if (predecessorId === successorId) return true;
  const visited = new Set<string>();
  let current: string | null = predecessorId;
  while (current) {
    if (current === successorId) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    current = predecessorEdgeFor(deps, current)?.predecessor_activity_id ?? null;
  }
  return false;
}

/**
 * Human label for a dependency edge, e.g. "after Framing" / "after Framing +3d" /
 * "after Framing −2d". `nameById` maps activity id → current name; an unknown
 * predecessor (deleted mid-flight) degrades to "after ?" rather than throwing.
 */
export function dependencyLabel(
  edge: ActivityDependency,
  nameById: Map<string, string>,
): string {
  const name = nameById.get(edge.predecessor_activity_id) ?? '?';
  const lag = edge.lag_days ?? 0;
  if (lag === 0) return `after ${name}`;
  return `after ${name} ${lag > 0 ? '+' : '−'}${Math.abs(lag)}d`;
}
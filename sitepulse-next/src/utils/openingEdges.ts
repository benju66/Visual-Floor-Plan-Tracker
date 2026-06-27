/**
 * Opening edges — pure, framework-free helpers (AI Tracing Assist — Phase 4a).
 *
 * An opening is a floor-level passage (door / cased opening / overhead / pass-
 * through) tagged on a single EDGE of a room's polygon: the two jamb nodes the
 * tracer places are two consecutive polygon vertices, so an opening is exactly one
 * edge, referenced by the index of its START vertex
 * (`polygon[edgeIndex] → polygon[(edgeIndex + 1) % n]`). Referencing by index — not
 * by coordinate — is what lets a tag ride polygon edits (a moved vertex keeps its
 * index; an inserted/removed vertex re-indexes the tags deterministically below).
 *
 * Everything here is deterministic and side-effect-free (no DB, no `Date.now()`,
 * no network) so the add/remove + re-index rules are unit-tested in isolation
 * (AGENTS.md §9) — the same shape as `gridlineParse.ts`. The canonical {@link
 * OpeningType} / {@link OpeningEdge} types + the {@link isOpeningEdgeArray} guard
 * live in the type registry (`src/types/domain.ts`); this module imports them.
 */
import {
  OPENING_TYPES,
  type OpeningEdge,
  type OpeningType,
  type PercentPoint,
} from '@/types/domain';

/** Human-facing label per opening type (presentation; shared by the panel + overlay). */
export const OPENING_TYPE_LABELS: Record<OpeningType, string> = {
  door: 'Door',
  cased_opening: 'Cased opening',
  overhead: 'Overhead',
  pass_through: 'Pass-through',
};

/** One-letter glyph per opening type (drawn on the overlay segment midpoint). */
export const OPENING_TYPE_GLYPHS: Record<OpeningType, string> = {
  door: 'D',
  cased_opening: 'C',
  overhead: 'H',
  pass_through: 'P',
};

/**
 * The keyboard key that selects/marks each opening type. Shown as a chip in the
 * panel and used by the tracer: HOLD the key + click the far jamb while tracing to
 * mark that edge; a TAP sets the active type for click-to-tag. `O` is reserved as
 * the tool toggle, so overhead uses `H` (over-H-ead), not `O`.
 */
export const OPENING_TYPE_KEY: Record<OpeningType, string> = {
  door: 'D',
  cased_opening: 'C',
  overhead: 'H',
  pass_through: 'P',
};

/** Reverse lookup: a pressed key → the opening type it selects, or null. Case-insensitive. */
export function openingTypeForKey(key: string): OpeningType | null {
  switch (key.toLowerCase()) {
    case 'd':
      return 'door';
    case 'c':
      return 'cased_opening';
    case 'h':
      return 'overhead';
    case 'p':
      return 'pass_through';
    default:
      return null;
  }
}

/** Per-type stroke color (`r, g, b` triplet) shared by the overlay + the draft preview. */
export const OPENING_TYPE_RGB: Record<OpeningType, string> = {
  door: '16, 185, 129', // emerald
  cased_opening: '245, 158, 11', // amber
  overhead: '14, 165, 233', // sky
  pass_through: '217, 70, 239', // fuchsia
};

/** The opening type tagged on `edgeIndex`, or null if that edge carries no opening. */
export function getOpeningType(edges: readonly OpeningEdge[], edgeIndex: number): OpeningType | null {
  return edges.find((e) => e.edgeIndex === edgeIndex)?.type ?? null;
}

/**
 * Tag (or RE-tag) one polygon edge as an opening of `type`. One tag per edge: an
 * existing tag on the same edge is replaced. Returns a new array (never mutates),
 * sorted by `edgeIndex` for a stable render order.
 */
export function setOpeningEdge(
  edges: readonly OpeningEdge[],
  edgeIndex: number,
  type: OpeningType,
): OpeningEdge[] {
  const next = edges.filter((e) => e.edgeIndex !== edgeIndex);
  next.push({ edgeIndex, type });
  return next.sort((a, b) => a.edgeIndex - b.edgeIndex);
}

/** Clear any opening tag on `edgeIndex`. Returns a new array (never mutates). */
export function removeOpeningEdge(edges: readonly OpeningEdge[], edgeIndex: number): OpeningEdge[] {
  return edges.filter((e) => e.edgeIndex !== edgeIndex);
}

/**
 * Toggle one edge against `type`: clear it if it already carries that exact type,
 * else set it to `type` (replacing a different type). The single click-to-edit
 * primitive for both in-draw capture and edit-after correction.
 */
export function toggleOpeningEdge(
  edges: readonly OpeningEdge[],
  edgeIndex: number,
  type: OpeningType,
): OpeningEdge[] {
  return getOpeningType(edges, edgeIndex) === type
    ? removeOpeningEdge(edges, edgeIndex)
    : setOpeningEdge(edges, edgeIndex, type);
}

/**
 * Drop tags that can't refer to a real edge of an `n`-vertex polygon (a closed
 * polygon has edges `0 .. n-1`, the last being the closing edge `n-1 → 0`): a
 * negative / non-integer index, an out-of-range index (`>= n`), an unknown type, or
 * a duplicate edge (last write wins). Returns a clean, `edgeIndex`-sorted array.
 * Called before banking a trace and when reconciliation reads the tags.
 */
export function normalizeOpeningEdges(
  edges: readonly OpeningEdge[],
  polygonLength: number,
): OpeningEdge[] {
  const byEdge = new Map<number, OpeningType>();
  for (const e of edges) {
    if (!Number.isInteger(e.edgeIndex) || e.edgeIndex < 0 || e.edgeIndex >= polygonLength) continue;
    if (!(OPENING_TYPES as readonly string[]).includes(e.type)) continue;
    byEdge.set(e.edgeIndex, e.type); // last write wins on a duplicate edge
  }
  return [...byEdge.entries()]
    .map(([edgeIndex, type]) => ({ edgeIndex, type }))
    .sort((a, b) => a.edgeIndex - b.edgeIndex);
}

/**
 * Re-index opening tags after a vertex is INSERTED at vertex-position `insertIndex`
 * (every existing vertex with index `>= insertIndex` shifts up by one). This splits
 * the edge that started at `insertIndex - 1` into two; the tag stays on the FIRST
 * half (same start vertex) and edges at/after `insertIndex` shift up by one. Mirrors
 * the canvas `add_node` splice (`splice(bestIdx + 1, 0, pt)` → `insertIndex =
 * bestIdx + 1`). Pure.
 */
export function reindexOnVertexInsert(
  edges: readonly OpeningEdge[],
  insertIndex: number,
): OpeningEdge[] {
  return edges
    .map((e) => (e.edgeIndex >= insertIndex ? { ...e, edgeIndex: e.edgeIndex + 1 } : { ...e }))
    .sort((a, b) => a.edgeIndex - b.edgeIndex);
}

/**
 * Re-index opening tags after the vertex at `deletedIndex` is REMOVED (every vertex
 * after it shifts down by one). The edge that STARTED at the deleted vertex is gone,
 * so its opening is DROPPED (returned in `removed` so the caller can log a
 * `trace_event` per the lifecycle rules); the edge that ENDED at the deleted vertex
 * keeps its tag (it now spans prev → next). Edges after the deleted vertex shift down
 * by one. Pure — never mutates.
 */
export function reindexOnVertexDelete(
  edges: readonly OpeningEdge[],
  deletedIndex: number,
): { edges: OpeningEdge[]; removed: OpeningEdge[] } {
  const removed = edges.filter((e) => e.edgeIndex === deletedIndex).map((e) => ({ ...e }));
  const kept = edges
    .filter((e) => e.edgeIndex !== deletedIndex)
    .map((e) => (e.edgeIndex > deletedIndex ? { ...e, edgeIndex: e.edgeIndex - 1 } : { ...e }))
    .sort((a, b) => a.edgeIndex - b.edgeIndex);
  return { edges: kept, removed };
}

/**
 * The two endpoints of the polygon edge an opening sits on, for rendering /
 * reconciliation. Honors the wrap-around closing edge (`n-1 → 0`). Returns null when
 * the index can't address an edge of this polygon (so callers skip stale tags after
 * a geometry change they haven't re-indexed). Pure.
 */
export function openingSegment(
  polygon: readonly PercentPoint[],
  edgeIndex: number,
): { p1: PercentPoint; p2: PercentPoint } | null {
  const n = polygon.length;
  if (n < 2 || !Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= n) return null;
  return { p1: polygon[edgeIndex], p2: polygon[(edgeIndex + 1) % n] };
}

/** One opening resolved to drawable geometry. */
export interface ResolvedOpening {
  edgeIndex: number;
  type: OpeningType;
  p1: PercentPoint;
  p2: PercentPoint;
}

/**
 * Resolve every valid opening tag on a polygon to its drawable segment, skipping any
 * tag whose edge index doesn't address a real edge (defensive against stale data).
 * Pure — the single source the overlay + reconciliation read.
 */
export function resolveOpenings(
  polygon: readonly PercentPoint[],
  edges: readonly OpeningEdge[],
): ResolvedOpening[] {
  const out: ResolvedOpening[] = [];
  for (const e of edges) {
    const seg = openingSegment(polygon, e.edgeIndex);
    if (seg) out.push({ edgeIndex: e.edgeIndex, type: e.type, p1: seg.p1, p2: seg.p2 });
  }
  return out;
}

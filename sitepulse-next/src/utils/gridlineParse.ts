/**
 * Gridline annotator — pure, framework-free helpers (AI Tracing Assist —
 * Phase 3b). A structural grid is captured in two human gestures the app assists:
 * (a) the user boxes a grid BUBBLE → {@link parseBubbleLabel} reads its label
 * ("A"/"1") from the sheet's cached PDF text; (b) the user drags the AXIS line
 * across the grid line (endpoints snapped to the long straight vector by the
 * canvas) → {@link inferAxis} reads its orientation from the drag. Captured grids
 * stack up as a pending list; one "accept all" maps them onto whatever's saved via
 * {@link mapPendingGridlinesToRow} and banks them to `sheet_gridlines`.
 *
 * Everything here is deterministic and side-effect-free (no DB, no `Date.now()`,
 * no network) so the heuristics + the accept-all mapping are unit-tested in
 * isolation (AGENTS.md §9) — the same shape as `titleBlockParse.ts`. The geometry
 * (the box, the drag) is 100% human-drawn; only the field VALUES (label, axis) and
 * the bulk-confirm mapping are assisted.
 */
import type { TextWord, PercentRect, PercentPoint, Gridline } from '@/types/domain';
import type { TraceSource } from '@/utils/traceCapture';

/**
 * `model_version` stamped on every gridline proposal — the "model" is this
 * deterministic parser, not an LLM. Bump it when the heuristics change materially
 * so old and new proposals stay distinguishable at training time (mirrors
 * `TITLE_BLOCK_MODEL_VERSION`).
 */
export const GRIDLINE_MODEL_VERSION = 'gridline-parse-v1';

/**
 * A grid-bubble token: a single bubble holds ONE short token — a column letter
 * ("A", "B", or a doubled "AA"/"AB") or a row number ("1", "12", "101"). Anchored
 * so a multi-word phrase, a hyphenated sheet number ("A-201"), or a long room name
 * never qualifies; the human's tight box around the bubble does the rest.
 */
const BUBBLE_TOKEN_RE = /^[A-Za-z]{1,2}$|^\d{1,3}(?:\.\d)?$/;

/**
 * Read a boxed grid bubble's label: among the bubble-shaped tokens whose position
 * falls inside the dragged box, pick the one nearest the box CENTER (a bubble is
 * boxed tightly, so the central token is the label; stray dimension/room text near
 * an edge loses). Letters are uppercased to a canonical "A"/"B". Returns null when
 * the box framed no bubble-shaped token (the human then types the label). Pure;
 * never throws.
 */
export function parseBubbleLabel(
  words: TextWord[] | null | undefined,
  box: PercentRect,
): string | null {
  if (!words || words.length === 0) return null;
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  let best: { token: string; d2: number } | null = null;
  for (const w of words) {
    if (w.pctX < box.x0 || w.pctX > box.x1 || w.pctY < box.y0 || w.pctY > box.y1) continue;
    const token = w.text.trim();
    if (!BUBBLE_TOKEN_RE.test(token)) continue;
    const d2 = (w.pctX - cx) ** 2 + (w.pctY - cy) ** 2;
    if (!best || d2 < best.d2) best = { token: token.toUpperCase(), d2 };
  }
  return best ? best.token : null;
}

/**
 * Infer a grid line's orientation from its two endpoints: a line that runs more
 * horizontally than vertically is `'h'`, otherwise `'v'`. (A perfectly diagonal
 * drag — equal |dx|/|dy| — resolves to `'h'`; in practice the human drags along a
 * near-axis-aligned grid line and the snapped endpoints sharpen it.) Pure.
 */
export function inferAxis(p1: PercentPoint, p2: PercentPoint): 'h' | 'v' {
  return Math.abs(p2.pctX - p1.pctX) >= Math.abs(p2.pctY - p1.pctY) ? 'h' : 'v';
}

/**
 * One captured-but-not-yet-saved grid in the annotator session. Carries the
 * EDITABLE final label (the human may fix a misread before drawing the axis) and
 * the FROZEN machine read (`suggestedLabel`, null when the bubble box found no
 * token), so the accept-all mapping can recover the before-vs-final correction
 * signal. Lives in `useWorkbenchStore.pendingGridlines` (AGENTS.md §2).
 */
export interface PendingGridline {
  /** Client-side id for the pending list (stable for keys + removal). */
  id: string;
  /** The final label the human will save (starts at the read; editable). */
  label: string;
  /** The FROZEN original machine read, or null when nothing was read. */
  suggestedLabel: string | null;
  p1: PercentPoint;
  p2: PercentPoint;
  axis: 'h' | 'v';
}

/** Strip a pending grid to its persisted {@link Gridline} shape (final label, trimmed). */
export function toGridline(p: PendingGridline): Gridline {
  return { label: p.label.trim(), p1: p.p1, p2: p.p2, axis: p.axis };
}

/**
 * The FROZEN machine proposal for a pending grid: the SAME snapped geometry + axis
 * with the original read label (or "" when the bubble box found nothing — a
 * fully-manual label). Stored in `suggested_gridlines` so the suggested-vs-final
 * delta is durable at training time, even after the human edits the live label.
 */
export function toSuggestedGridline(p: PendingGridline): Gridline {
  return { label: (p.suggestedLabel ?? '').trim(), p1: p.p1, p2: p.p2, axis: p.axis };
}

/**
 * Derive the per-sheet `source` (mirrors `deriveTitleBlockSource`): compares the
 * index-aligned final vs frozen-suggested label arrays. `human` when NO grid
 * carried a machine read (every suggested label blank → all labels typed by hand);
 * `ai_accepted` when every read was kept exactly; else `ai_edited` (the high-value
 * correction signal — a fixed misread, or a hand-typed label mixed with reads).
 * Coarse by design: the per-grid before/after lives in `suggested_gridlines`.
 */
export function deriveGridlineSource(final: Gridline[], suggested: Gridline[]): TraceSource {
  const anyRead = suggested.some((g) => g.label.trim() !== '');
  if (!anyRead) return 'human';
  const same =
    final.length === suggested.length &&
    final.every((g, i) => g.label.trim() === (suggested[i]?.label ?? '').trim());
  return same ? 'ai_accepted' : 'ai_edited';
}

/** The payload an "accept all" upsert writes (before provenance stamping). */
export interface GridlineRowPayload {
  gridlines: Gridline[];
  suggested: Gridline[];
  source: TraceSource;
}

/**
 * "Accept all" bulk-confirm mapping (the unit-tested core of the bank step):
 * APPEND the session's pending grids onto whatever's already saved for the sheet,
 * keeping the final + frozen-suggested arrays index-aligned, and derive the rolled
 * up `source`. Pure — pass the existing row's arrays in; never reads the DB. The
 * caller stamps `model_version` / `review_status` / `spec_version` and upserts.
 * Blank-labeled pending grids are dropped (a captured axis the human never
 * labeled), so an accidental empty capture never persists.
 */
export function mapPendingGridlinesToRow(
  pending: PendingGridline[],
  existing: { gridlines: Gridline[]; suggested: Gridline[] } | null,
): GridlineRowPayload {
  const keep = pending.filter((p) => p.label.trim().length > 0);
  const gridlines = [...(existing?.gridlines ?? []), ...keep.map(toGridline)];
  const suggested = [...(existing?.suggested ?? []), ...keep.map(toSuggestedGridline)];
  return { gridlines, suggested, source: deriveGridlineSource(gridlines, suggested) };
}

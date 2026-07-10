/**
 * Pure windowing math for the desktop List's row virtualization (List View
 * Performance — Phase 4). `@tanstack/react-virtual` owns the heavy lifting
 * (measurement + visible-range calc); these are the small deterministic pieces
 * around it, extracted so the load-bearing spacer math is unit-tested and
 * `Date.now()`-free (a wrong `paddingBottom` silently breaks the scroll range).
 */

/** The structural subset of a react-virtual `VirtualItem` this module reads. */
export interface WindowItem {
  /** The item's offset (px) from the start of the virtualized list. */
  start: number;
  /** The item's end offset (px) = start + measured/estimated height. */
  end: number;
}

export interface WindowPadding {
  /** Spacer height (px) standing in for the rows scrolled off the TOP. */
  paddingTop: number;
  /** Spacer height (px) standing in for the rows below the rendered window. */
  paddingBottom: number;
}

/**
 * Given the currently-rendered virtual items (contiguous, ascending by `start`)
 * and the virtualizer's total content size, return the two spacer heights that
 * pad the rendered block so the scrollbar spans the full (mostly-unrendered)
 * list. In the desktop List these become an empty `<tbody>` above and below the
 * rendered location blocks — the "keep the real table" route (a): only the
 * on-screen `<tbody>` blocks mount, the spacers size the scroll range.
 *
 * Clamps to ≥ 0 so a transient over-measurement (a block re-measuring taller
 * than the current `totalSize` for one frame) can't emit a negative height.
 */
export function windowPadding(items: WindowItem[], totalSize: number): WindowPadding {
  if (items.length === 0) return { paddingTop: 0, paddingBottom: 0 };
  const first = items[0];
  const last = items[items.length - 1];
  return {
    paddingTop: Math.max(0, first.start),
    paddingBottom: Math.max(0, totalSize - last.end),
  };
}

/**
 * The estimated collapsed-block height (px) used to seed the virtualizer before
 * real per-block measurement (`measureElement`) corrects it. Comfortable density
 * (py-3, plus the stacked type/assignee cell) measures ~90px in the browser;
 * compact (py-1.5) is shorter. This is only a first-paint estimate — dynamic
 * measurement replaces it as blocks mount — but keeping it near the real height
 * minimizes scrollbar drift as off-screen blocks are measured on the way down.
 */
export function estimateRowHeight(density: 'compact' | 'comfortable'): number {
  return density === 'compact' ? 72 : 90;
}

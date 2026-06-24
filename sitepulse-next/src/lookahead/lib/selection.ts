// Pure marquee-rectangle math for the Look-Ahead grid.
//
// Extracted from LookAhead.tsx (Phase 3 detangle) so it can be unit-tested and,
// later (Phase 6), reused for finger marquee. Deterministic and framework-free:
// everything is passed in — it reads no store and no clock (no `Date.now()`).

/** A grid cell address: a row id + a canonical column (day) index. */
export interface CellRef {
  rowId: string;
  di: number;
}

/**
 * Build the rectangular cell selection spanning two cells (inclusive), using the
 * current visible row order (`rowOrder`) + visible columns (`visCols`). The span
 * is taken over array *positions*, so row/column order is whatever the caller
 * passes — keys are emitted as `"<rowId>:<col>"` using the real column indices.
 *
 * Returns `null` if either endpoint is no longer on screen (its row id isn't in
 * `rowOrder`, or its column index isn't in `visCols`). Direction-agnostic: a→b
 * and b→a yield the same selection. Shared by shift-click (mouse), shift-arrow
 * (keyboard), and drag-to-fill / marquee.
 */
export function rectSelection(
  rowOrder: string[],
  visCols: number[],
  a: CellRef,
  b: CellRef
): Record<string, true> | null {
  const r1 = rowOrder.indexOf(a.rowId), r2 = rowOrder.indexOf(b.rowId);
  const v1 = visCols.indexOf(a.di), v2 = visCols.indexOf(b.di);
  if (r1 < 0 || r2 < 0 || v1 < 0 || v2 < 0) return null;
  const rA = Math.min(r1, r2), rB = Math.max(r1, r2), vA = Math.min(v1, v2), vB = Math.max(v1, v2);
  const sel: Record<string, true> = {};
  for (let ri = rA; ri <= rB; ri++) {
    const rid = rowOrder[ri];
    if (rid == null) continue;
    for (let vi = vA; vi <= vB; vi++) sel[rid + ":" + visCols[vi]] = true;
  }
  return sel;
}

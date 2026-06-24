import { describe, it, expect } from "vitest";
import { rectSelection } from "./selection";

// Vitest globals are OFF (see AGENTS.md §9) — import describe/it/expect explicitly.
describe("rectSelection", () => {
  const rowOrder = ["r1", "r2", "r3"];
  // Deliberately non-contiguous + out of numeric order so the tests prove the
  // span is taken over array *positions*, and keys are emitted with the real
  // column index value (not the array position).
  const visCols = [0, 5, 1, 8];

  it("returns just the one cell when both endpoints are the same", () => {
    const sel = rectSelection(rowOrder, visCols, { rowId: "r2", di: 5 }, { rowId: "r2", di: 5 });
    expect(sel).toEqual({ "r2:5": true });
  });

  it("builds the full inclusive rectangle across rows and columns", () => {
    const sel = rectSelection(rowOrder, visCols, { rowId: "r1", di: 0 }, { rowId: "r3", di: 8 });
    expect(sel).toEqual({
      "r1:0": true, "r1:5": true, "r1:1": true, "r1:8": true,
      "r2:0": true, "r2:5": true, "r2:1": true, "r2:8": true,
      "r3:0": true, "r3:5": true, "r3:1": true, "r3:8": true,
    });
    expect(Object.keys(sel ?? {})).toHaveLength(12);
  });

  it("is direction-agnostic — a→b and b→a give the same selection", () => {
    const forward = rectSelection(rowOrder, visCols, { rowId: "r1", di: 0 }, { rowId: "r3", di: 8 });
    const reverse = rectSelection(rowOrder, visCols, { rowId: "r3", di: 8 }, { rowId: "r1", di: 0 });
    expect(reverse).toEqual(forward);
  });

  it("respects the passed row/column order — spans positions, not numeric values", () => {
    // di=0 is at position 0, di=5 is at position 1; di=1 (position 2) sits between
    // them numerically but NOT positionally, so it must be excluded. Likewise r3.
    const sel = rectSelection(rowOrder, visCols, { rowId: "r1", di: 0 }, { rowId: "r2", di: 5 });
    expect(sel).toEqual({
      "r1:0": true, "r1:5": true,
      "r2:0": true, "r2:5": true,
    });
    // di=1 (numerically between 0 and 5) is NOT in the rectangle.
    expect(sel).not.toHaveProperty("r1:1");
    // r3 is below the selected rows.
    expect(sel).not.toHaveProperty("r3:0");
  });

  it("returns null when the row endpoint is off-screen", () => {
    expect(rectSelection(rowOrder, visCols, { rowId: "ghost", di: 0 }, { rowId: "r1", di: 0 })).toBeNull();
    expect(rectSelection(rowOrder, visCols, { rowId: "r1", di: 0 }, { rowId: "gone", di: 5 })).toBeNull();
  });

  it("returns null when the column endpoint is off-screen", () => {
    // di=99 is not a visible column.
    expect(rectSelection(rowOrder, visCols, { rowId: "r1", di: 99 }, { rowId: "r2", di: 0 })).toBeNull();
    expect(rectSelection(rowOrder, visCols, { rowId: "r1", di: 0 }, { rowId: "r2", di: 99 })).toBeNull();
  });
});

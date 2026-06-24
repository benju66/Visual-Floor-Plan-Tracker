import { describe, it, expect } from "vitest";
import { effectiveWeeks, LA_LANDSCAPE_MIN, LA_PORTRAIT_WEEKS } from "./view";

// Vitest globals are OFF (see AGENTS.md §9) — import describe/it/expect explicitly.
describe("effectiveWeeks", () => {
  it("returns the full saved window at the landscape breakpoint and above", () => {
    expect(effectiveWeeks(3, LA_LANDSCAPE_MIN)).toBe(3); // boundary is inclusive on the landscape side
    expect(effectiveWeeks(3, 1280)).toBe(3);
    expect(effectiveWeeks(8, 1440)).toBe(8);
  });

  it("clamps to the portrait window below the landscape breakpoint", () => {
    expect(effectiveWeeks(3, LA_LANDSCAPE_MIN - 1)).toBe(LA_PORTRAIT_WEEKS);
    expect(effectiveWeeks(8, 768)).toBe(LA_PORTRAIT_WEEKS); // iPad portrait
    expect(effectiveWeeks(3, 768)).toBe(1);
  });

  it("never grows a window — a saved 1-week plan stays 1 week at any width", () => {
    expect(effectiveWeeks(1, 768)).toBe(1);
    expect(effectiveWeeks(1, 1440)).toBe(1);
  });

  it("never returns less than one week, even for degenerate saved values", () => {
    expect(effectiveWeeks(0, 768)).toBe(1);
    expect(effectiveWeeks(0, 1440)).toBe(1);
  });
});

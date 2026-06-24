import { describe, it, expect } from "vitest";
import { classifyPointerGesture } from "./gesture";

// Vitest globals are OFF (see AGENTS.md §9) — import describe/it/expect explicitly.
//
// Phase 6a uses moveThresholdPx ≈ 8 (finger/pen drag slop) and longPressMs = 500
// (the iOS/Android long-press default); the tests pin the boundaries rather than
// those specific tuning numbers so re-tuning the grid doesn't churn the suite.
describe("classifyPointerGesture", () => {
  const base = { downAt: 0, upAt: 0, dx: 0, dy: 0, longPressMs: 500, moveThresholdPx: 8 };

  it("is a tap when the pointer barely moves and is released quickly", () => {
    expect(classifyPointerGesture({ ...base, dx: 1, dy: 1, upAt: 80 })).toBe("tap");
  });

  it("is a drag once travel exceeds the move threshold", () => {
    // dx=9 > 8 → drag, regardless of how little time passed.
    expect(classifyPointerGesture({ ...base, dx: 9, upAt: 10 })).toBe("drag");
  });

  it("uses straight-line (Euclidean) distance, not per-axis travel", () => {
    // 6,6 → hypot ≈ 8.49 > 8 → drag, even though neither axis alone exceeds 8.
    expect(classifyPointerGesture({ ...base, dx: 6, dy: 6, upAt: 10 })).toBe("drag");
    // 5,5 → hypot ≈ 7.07 ≤ 8 → not a drag.
    expect(classifyPointerGesture({ ...base, dx: 5, dy: 5, upAt: 10 })).toBe("tap");
  });

  it("treats travel exactly at the threshold as NOT a drag (strictly greater)", () => {
    // distance === 8, threshold === 8 → tap (short) / longpress (held), never drag.
    expect(classifyPointerGesture({ ...base, dx: 8, dy: 0, upAt: 100 })).toBe("tap");
    expect(classifyPointerGesture({ ...base, dx: 8, dy: 0, upAt: 500 })).toBe("longpress");
  });

  it("is a long-press when held long enough without moving past the threshold", () => {
    expect(classifyPointerGesture({ ...base, dx: 2, dy: 2, upAt: 600 })).toBe("longpress");
  });

  it("treats a hold exactly at longPressMs as a long-press (>=)", () => {
    expect(classifyPointerGesture({ ...base, upAt: 500 })).toBe("longpress");
    // One millisecond short is still a tap.
    expect(classifyPointerGesture({ ...base, upAt: 499 })).toBe("tap");
  });

  it("lets movement win over time — a slow, far gesture is a drag, not a long-press", () => {
    expect(classifyPointerGesture({ ...base, dx: 40, dy: 0, upAt: 5000 })).toBe("drag");
  });

  it("handles negative travel (movement in either direction)", () => {
    expect(classifyPointerGesture({ ...base, dx: -20, dy: 0, upAt: 10 })).toBe("drag");
    expect(classifyPointerGesture({ ...base, dx: 0, dy: -20, upAt: 10 })).toBe("drag");
  });
});

// Pure pointer-gesture classifier for the Look-Ahead grid.
//
// Extracted (Phase 6a — UI convergence / touch parity) so the single Pointer-Event
// interaction model in LookAhead.tsx can decide tap-vs-drag(-vs-longpress) from one
// unit-tested function instead of ad-hoc inline math. Deterministic and
// framework-free: every input is passed IN — it reads no DOM, no store, and no
// clock (it never calls Date.now()/performance.now()). Callers pass timestamps
// (e.g. PointerEvent.timeStamp) so the classifier stays pure + testable.

export type PointerGesture = "tap" | "drag" | "longpress";

export interface PointerGestureInput {
  /** Timestamp (ms) of the pointerdown that began the gesture. */
  downAt: number;
  /** Timestamp (ms) of the moment being classified — a pointermove tick or pointerup. */
  upAt: number;
  /** Horizontal travel since pointerdown: clientX(now) − clientX(down), in CSS px. */
  dx: number;
  /** Vertical travel since pointerdown, in CSS px. */
  dy: number;
  /** Hold duration (ms) at/after which a still pointer becomes a long-press. */
  longPressMs: number;
  /** Travel (px) past which the gesture is a drag — compared with strictly `>`. */
  moveThresholdPx: number;
}

/**
 * Classify a pointer gesture from its travel + duration.
 *
 * Precedence (movement wins over time):
 *  1. If straight-line travel exceeds `moveThresholdPx` (strictly `>`) → `"drag"`.
 *     Movement takes priority over time, so a long *and* far gesture is a drag (a
 *     slow drag is still a drag, never a long-press).
 *  2. Else if held for `longPressMs` or more (`>=`) → `"longpress"`.
 *  3. Else → `"tap"`.
 *
 * Phase 6a consumes `"tap"` (→ cycle a cell's status) and `"drag"` (→ marquee /
 * fill). `"longpress"` is defined + unit-tested now but is not wired until Phase 6b
 * (long-press context menus). The boundaries are exact: travel exactly equal to the
 * threshold is NOT a drag, and a hold exactly equal to `longPressMs` IS a long-press.
 */
export function classifyPointerGesture(input: PointerGestureInput): PointerGesture {
  const { downAt, upAt, dx, dy, longPressMs, moveThresholdPx } = input;
  const distance = Math.hypot(dx, dy);
  if (distance > moveThresholdPx) return "drag";
  if (upAt - downAt >= longPressMs) return "longpress";
  return "tap";
}

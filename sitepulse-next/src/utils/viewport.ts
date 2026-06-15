/**
 * Pure viewport helpers for the Konva floor-plan stage.
 *
 * Extracted from FloorplanCanvas so the load-bearing zoom/pan logic is unit-testable
 * (AGENTS §9) and the canvas component stays lean (AGENTS §3). These functions are
 * stateless: they take primitives and return primitives, never touch Konva or React.
 */

/** Minimal layout shape used for screen<->content math (subset of FloorplanCanvas `layout`). */
export interface ViewportLayout {
  offsetX: number;
  offsetY: number;
  drawW: number;
  drawH: number;
}

export type WheelIntent = 'zoom-pinch' | 'zoom-wheel' | 'pan';

/** Just the wheel-event fields we classify on — keeps the helper trivially testable. */
export type WheelLike = Pick<WheelEvent, 'ctrlKey' | 'metaKey' | 'deltaMode' | 'deltaX' | 'deltaY'>;

/**
 * Hybrid scroll model (user-chosen): mouse wheel zooms, trackpad two-finger scroll pans,
 * Ctrl/⌘+wheel and trackpad pinch zoom.
 *
 * Detection is anchored on the one fully reliable, cross-browser signal: a standard mouse
 * wheel can only scroll vertically (`deltaX === 0`), whereas a trackpad two-finger scroll
 * produces a horizontal pixel-mode component. So we pan ONLY for pixel-mode events that carry
 * a horizontal delta; everything vertical zooms. This guarantees mouse-wheel zoom always works,
 * regardless of the mouse's delta magnitude or pixel/line mode (which varies by OS/driver).
 *
 * - `ctrlKey`/`metaKey` → 'zoom-pinch' (browsers report trackpad pinch as ctrl+wheel).
 * - pixel mode with a horizontal delta → 'pan' (trackpad two-finger scroll).
 * - anything else (any vertical wheel) → 'zoom-wheel'.
 *
 * Tradeoff: a purely-vertical trackpad two-finger scroll zooms rather than pans. This is the
 * deliberate cost of never breaking mouse-wheel zoom; horizontal/diagonal trackpad scrolls pan.
 */
export function classifyWheelIntent(evt: WheelLike): WheelIntent {
  if (evt.ctrlKey || evt.metaKey) return 'zoom-pinch';
  if (evt.deltaMode === 0 && evt.deltaX !== 0) return 'pan';
  return 'zoom-wheel';
}

/**
 * Clamp a proposed stage position so the sheet can never be panned/zoomed fully off-screen.
 *
 * Guarantees at least `marginRatio` of the viewport's smaller dimension stays covered by the
 * sheet on each axis. Works whether the content is larger than the viewport (zoomed in) or
 * smaller (zoomed out) — in both cases the leading content edge is kept within
 * `[margin - contentSize, stageDim - margin]`.
 *
 * @param pos    Proposed stage position in screen pixels (`{ x, y }`).
 * @param scale  Current stage scale.
 * @param layout Sheet layout (offset + drawn size, unscaled stage coords).
 */
export function clampStagePosition(
  pos: { x: number; y: number },
  scale: number,
  layout: ViewportLayout,
  stageW: number,
  stageH: number,
  marginRatio = 0.15,
): { x: number; y: number } {
  const { offsetX, offsetY, drawW, drawH } = layout;
  if (!drawW || !drawH || !stageW || !stageH) return pos;

  const margin = Math.min(stageW, stageH) * marginRatio;

  const clampAxis = (
    posCoord: number,
    offset: number,
    drawSize: number,
    stageDim: number,
  ): number => {
    const contentSize = drawSize * scale;
    const edge = posCoord + offset * scale; // content leading edge in screen px
    const lo = Math.min(margin - contentSize, stageDim - margin);
    const hi = Math.max(margin - contentSize, stageDim - margin);
    const clampedEdge = Math.max(lo, Math.min(edge, hi));
    return clampedEdge - offset * scale;
  };

  return {
    x: clampAxis(pos.x, offsetX, drawW, stageW),
    y: clampAxis(pos.y, offsetY, drawH, stageH),
  };
}

/**
 * Frame-rate-independent exponential damping toward a target.
 *
 * Powers the optional smooth-wheel-zoom glide: each animation frame eases the live
 * scale a fraction of the remaining distance to the target, where the fraction is
 * derived from the elapsed time and a time constant `tau` (seconds). Using
 * `exp(-dt/tau)` (rather than a fixed per-frame lerp factor) keeps the glide speed
 * identical at 60Hz, 120Hz, or after a dropped frame — the curve depends on wall-clock
 * time, not frame count.
 *
 * Smaller `tau` = snappier (reaches target sooner); larger `tau` = floatier. At
 * `tau ≈ 0.07s` the gap closes to ~1% in ~5 frames @60Hz — fast enough to feel
 * responsive, smooth enough to read as a glide rather than a step.
 *
 * @param current Current value (e.g. live stage scale).
 * @param target  Value to approach (e.g. accumulated wheel target scale).
 * @param dt      Elapsed seconds since the last frame.
 * @param tau     Time constant in seconds. `<= 0` snaps straight to target.
 */
export function dampToward(current: number, target: number, dt: number, tau: number): number {
  if (tau <= 0 || dt <= 0) return tau <= 0 ? target : current;
  return target + (current - target) * Math.exp(-dt / tau);
}

/** Snapshot of the live Konva transform to commit into React state. */
export interface ViewportCommitValue {
  scale: number;
  x: number;
  y: number;
}

export interface ViewportSync {
  /** Report the latest live transform. Commits leading, then at most once per interval. */
  push(value: ViewportCommitValue): void;
  /** Commit any pending value immediately (gesture end). */
  flush(): void;
  /** Discard any pending value and timer (unmount). */
  cancel(): void;
}

/**
 * Leading+trailing throttle for syncing the live Konva transform into React state.
 *
 * The stage itself is mutated directly (60fps) and `liveViewportRef` always holds the
 * freshest transform; this only paces the `setStageScale`/`setStagePosition` commits that
 * drive derived math (LOD bitmap selection, visible-unit culling). A leading commit gives
 * instant response at gesture start, intermediate pushes coalesce to one commit per
 * `intervalMs` so culling/LOD stay fresh during a sustained gesture, and the trailing
 * commit guarantees the final React state matches the live transform.
 *
 * (Replaces a pure trailing 100ms debounce, under which React state stayed frozen for the
 * whole gesture and everything landed as one re-render spike after it ended.)
 *
 * @param commit     Receives the value to commit into React state.
 * @param intervalMs Minimum spacing between commits (~8/s at the 120ms default).
 * @param now        Clock, injectable for tests.
 */
export function createViewportSync(
  commit: (value: ViewportCommitValue) => void,
  intervalMs = 120,
  now: () => number = () => performance.now(),
): ViewportSync {
  let lastCommit = -Infinity;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  let pending: ViewportCommitValue | null = null;

  const fire = (value: ViewportCommitValue) => {
    lastCommit = now();
    pending = null;
    commit(value);
  };

  return {
    push(value) {
      pending = value;
      const elapsed = now() - lastCommit;
      if (elapsed >= intervalMs) {
        if (trailing) {
          clearTimeout(trailing);
          trailing = null;
        }
        fire(value);
      } else if (!trailing) {
        trailing = setTimeout(() => {
          trailing = null;
          if (pending) fire(pending);
        }, intervalMs - elapsed);
      }
    },
    flush() {
      if (trailing) {
        clearTimeout(trailing);
        trailing = null;
      }
      if (pending) fire(pending);
    },
    cancel() {
      if (trailing) clearTimeout(trailing);
      trailing = null;
      pending = null;
    },
  };
}

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  classifyWheelIntent,
  clampStagePosition,
  createViewportSync,
  type WheelLike,
  type ViewportLayout,
  type ViewportCommitValue,
} from './viewport';

const wheel = (over: Partial<WheelLike>): WheelLike => ({
  ctrlKey: false,
  metaKey: false,
  deltaMode: 0,
  deltaX: 0,
  deltaY: 0,
  ...over,
});

describe('classifyWheelIntent', () => {
  it('treats ctrl/meta wheel as pinch-zoom (trackpad pinch or ctrl+wheel)', () => {
    expect(classifyWheelIntent(wheel({ ctrlKey: true, deltaY: 4 }))).toBe('zoom-pinch');
    expect(classifyWheelIntent(wheel({ metaKey: true, deltaY: -4 }))).toBe('zoom-pinch');
  });

  it('treats line/page-mode wheels as mouse-wheel zoom', () => {
    expect(classifyWheelIntent(wheel({ deltaMode: 1, deltaY: 3 }))).toBe('zoom-wheel');
    expect(classifyWheelIntent(wheel({ deltaMode: 2, deltaY: 1 }))).toBe('zoom-wheel');
  });

  it('treats every vertical-only wheel as mouse-wheel zoom, regardless of magnitude/mode', () => {
    // Large quantized (classic mouse) and small pixel-mode (smooth-scroll mouse) both zoom —
    // a mouse wheel never produces a horizontal delta.
    expect(classifyWheelIntent(wheel({ deltaX: 0, deltaY: 100 }))).toBe('zoom-wheel');
    expect(classifyWheelIntent(wheel({ deltaX: 0, deltaY: -120 }))).toBe('zoom-wheel');
    expect(classifyWheelIntent(wheel({ deltaX: 0, deltaY: 8 }))).toBe('zoom-wheel');
    expect(classifyWheelIntent(wheel({ deltaX: 0, deltaY: -3 }))).toBe('zoom-wheel');
  });

  it('treats pixel-mode scrolls with a horizontal delta as trackpad pan', () => {
    expect(classifyWheelIntent(wheel({ deltaX: 12, deltaY: 4 }))).toBe('pan');
    expect(classifyWheelIntent(wheel({ deltaX: -8, deltaY: 0 }))).toBe('pan');
    expect(classifyWheelIntent(wheel({ deltaX: 3, deltaY: 30 }))).toBe('pan');
  });
});

describe('clampStagePosition', () => {
  const layout: ViewportLayout = { offsetX: 0, offsetY: 0, drawW: 1000, drawH: 1000 };
  const stageW = 800;
  const stageH = 600;
  const margin = Math.min(stageW, stageH) * 0.15; // 90

  it('returns position unchanged when layout/stage is degenerate', () => {
    const empty: ViewportLayout = { offsetX: 0, offsetY: 0, drawW: 0, drawH: 0 };
    expect(clampStagePosition({ x: 9999, y: -9999 }, 1, empty, stageW, stageH)).toEqual({ x: 9999, y: -9999 });
    expect(clampStagePosition({ x: 5, y: 5 }, 1, layout, 0, 0)).toEqual({ x: 5, y: 5 });
  });

  it('keeps a margin of content on-screen when content is larger than the viewport (zoomed in)', () => {
    const scale = 2; // content 2000x2000, much larger than 800x600
    // Try to fling far up-left so the sheet would leave the screen entirely.
    const clamped = clampStagePosition({ x: -100000, y: -100000 }, scale, layout, stageW, stageH);
    // Leading edge (offset 0) is clamped to its minimum: margin - contentSize.
    expect(clamped.x).toBeCloseTo(margin - layout.drawW * scale, 6); // 90 - 2000
    expect(clamped.y).toBeCloseTo(margin - layout.drawH * scale, 6);
    // Sanity: at least `margin` px of content remains within [0, stageDim].
    const rightEdge = clamped.x + layout.drawW * scale;
    expect(rightEdge).toBeGreaterThanOrEqual(margin - 1e-6);
  });

  it('keeps a small (zoomed-out) sheet from leaving the screen', () => {
    const scale = 0.2; // content 200x200, smaller than viewport
    const flungRight = clampStagePosition({ x: 100000, y: 0 }, scale, layout, stageW, stageH);
    // Leading edge clamped to stageW - margin at most.
    expect(flungRight.x).toBeCloseTo(stageW - margin, 6); // 800 - 90 = 710
  });

  it('leaves an already-centered position untouched', () => {
    const scale = 1;
    const centered = { x: (stageW - layout.drawW) / 2, y: (stageH - layout.drawH) / 2 };
    const clamped = clampStagePosition(centered, scale, layout, stageW, stageH);
    expect(clamped.x).toBeCloseTo(centered.x, 6);
    expect(clamped.y).toBeCloseTo(centered.y, 6);
  });
});

describe('createViewportSync', () => {
  // Fake timers + a clock that follows them, so interval math matches setTimeout firing.
  let clock: number;
  const now = () => clock;
  const advance = (ms: number) => {
    clock += ms;
    vi.advanceTimersByTime(ms);
  };
  const v = (scale: number): ViewportCommitValue => ({ scale, x: scale * 10, y: scale * 20 });

  beforeEach(() => {
    clock = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('commits the first push immediately (leading)', () => {
    const commit = vi.fn();
    const sync = createViewportSync(commit, 120, now);
    sync.push(v(1));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(v(1));
  });

  it('coalesces pushes within the interval into one trailing commit with the last value', () => {
    const commit = vi.fn();
    const sync = createViewportSync(commit, 120, now);

    sync.push(v(1)); // leading
    advance(30);
    sync.push(v(2));
    advance(30);
    sync.push(v(3));
    expect(commit).toHaveBeenCalledTimes(1);

    // Trailing fires at interval boundary (120ms after the leading commit).
    advance(60);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenLastCalledWith(v(3));
  });

  it('keeps committing ~once per interval during a sustained gesture', () => {
    const commit = vi.fn();
    const sync = createViewportSync(commit, 120, now);

    // Push every 30ms for 480ms: leading at t=0, trailing at 120/240/360/480.
    for (let t = 0; t < 480; t += 30) {
      sync.push(v(t));
      advance(30);
    }
    expect(commit.mock.calls.length).toBe(5);
  });

  it('flush commits the pending value immediately', () => {
    const commit = vi.fn();
    const sync = createViewportSync(commit, 120, now);

    sync.push(v(1)); // leading
    advance(10);
    sync.push(v(2)); // pending
    sync.flush();
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenLastCalledWith(v(2));

    // Nothing left pending — the trailing timer was cleared.
    advance(500);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('flush with nothing pending is a no-op', () => {
    const commit = vi.fn();
    const sync = createViewportSync(commit, 120, now);
    sync.flush();
    expect(commit).not.toHaveBeenCalled();
  });

  it('cancel discards the pending value', () => {
    const commit = vi.fn();
    const sync = createViewportSync(commit, 120, now);

    sync.push(v(1)); // leading
    advance(10);
    sync.push(v(2)); // pending
    sync.cancel();
    advance(500);
    expect(commit).toHaveBeenCalledTimes(1); // only the leading commit
  });

  it('a push after an idle interval is leading again', () => {
    const commit = vi.fn();
    const sync = createViewportSync(commit, 120, now);

    sync.push(v(1));
    advance(200); // past the interval, no pending work
    sync.push(v(2));
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenLastCalledWith(v(2));
  });
});

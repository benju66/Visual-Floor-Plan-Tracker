import { describe, it, expect } from 'vitest';
import { classifyWheelIntent, clampStagePosition, type WheelLike, type ViewportLayout } from './viewport';

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

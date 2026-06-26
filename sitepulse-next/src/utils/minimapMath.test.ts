import { describe, it, expect } from 'vitest';
import {
  fitMiniSize,
  viewportRectToMiniBox,
  stageToVisiblePctRect,
  miniClickToStagePosition,
  type MiniMapLayout,
} from './minimapMath';

// A non-square sheet drawn at offset inside a non-square stage — exercises the
// offset/aspect terms rather than letting symmetry hide a bug.
const layout: MiniMapLayout = {
  offsetX: 40,
  offsetY: 10,
  drawW: 600,
  drawH: 800,
  stageW: 1000,
  stageH: 700,
};

describe('fitMiniSize', () => {
  it('fits a landscape sheet to the max width', () => {
    const { miniW, miniH } = fitMiniSize(2, 160, 120); // aspect 2:1
    expect(miniW).toBe(160);
    expect(miniH).toBe(80);
  });

  it('fits a portrait sheet to the max height', () => {
    const { miniW, miniH } = fitMiniSize(0.5, 160, 120); // aspect 1:2
    expect(miniH).toBe(120);
    expect(miniW).toBe(60);
  });

  it('falls back to the full envelope for a degenerate aspect', () => {
    expect(fitMiniSize(0, 160, 120)).toEqual({ miniW: 160, miniH: 120 });
    expect(fitMiniSize(NaN, 160, 120)).toEqual({ miniW: 160, miniH: 120 });
  });
});

describe('viewportRectToMiniBox', () => {
  it('maps a centered half-size region to the middle of the mini-map', () => {
    const box = viewportRectToMiniBox(
      { minPctX: 0.25, minPctY: 0.25, maxPctX: 0.75, maxPctY: 0.75 },
      160,
      120,
    );
    expect(box.left).toBeCloseTo(40, 6);
    expect(box.top).toBeCloseTo(30, 6);
    expect(box.width).toBeCloseTo(80, 6);
    expect(box.height).toBeCloseTo(60, 6);
  });

  it('clamps a region that spills past the sheet edges (zoomed out)', () => {
    const box = viewportRectToMiniBox(
      { minPctX: -0.5, minPctY: -0.2, maxPctX: 1.5, maxPctY: 1.3 },
      160,
      120,
    );
    expect(box.left).toBe(0);
    expect(box.top).toBe(0);
    expect(box.width).toBe(160);
    expect(box.height).toBe(120);
  });
});

describe('miniClickToStagePosition', () => {
  it('a center click centers the sheet center in the viewport', () => {
    const { miniW, miniH } = fitMiniSize(layout.drawW / layout.drawH);
    const scale = 2;
    const pos = miniClickToStagePosition({ x: miniW / 2, y: miniH / 2 }, miniW, miniH, layout, scale);
    // Sheet center in unscaled content coords:
    const contentCx = layout.offsetX + 0.5 * layout.drawW;
    const contentCy = layout.offsetY + 0.5 * layout.drawH;
    expect(pos.x).toBeCloseTo(layout.stageW / 2 - contentCx * scale, 6);
    expect(pos.y).toBeCloseTo(layout.stageH / 2 - contentCy * scale, 6);
  });
});

describe('round-trip: click → stagePosition → visible rect → mini box', () => {
  it('a click recenters there and the resulting box is centered on the click', () => {
    const { miniW, miniH } = fitMiniSize(layout.drawW / layout.drawH);
    const scale = 3;

    for (const click of [
      { x: miniW / 2, y: miniH / 2 },
      { x: miniW * 0.3, y: miniH * 0.8 },
      { x: miniW * 0.7, y: miniH * 0.2 },
    ]) {
      const stagePos = miniClickToStagePosition(click, miniW, miniH, layout, scale);
      const visible = stageToVisiblePctRect(scale, stagePos, layout);

      // The clicked percent point sits at the CENTER of the new visible region.
      const clickedPctX = click.x / miniW;
      const clickedPctY = click.y / miniH;
      expect((visible.minPctX + visible.maxPctX) / 2).toBeCloseTo(clickedPctX, 6);
      expect((visible.minPctY + visible.maxPctY) / 2).toBeCloseTo(clickedPctY, 6);

      // And projecting that visible region back onto the mini-map yields a box
      // whose center is the click point.
      const box = viewportRectToMiniBox(visible, miniW, miniH);
      expect(box.left + box.width / 2).toBeCloseTo(click.x, 4);
      expect(box.top + box.height / 2).toBeCloseTo(click.y, 4);
    }
  });
});

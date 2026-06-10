import { describe, it, expect } from 'vitest';
import {
  clampScaleToPixelBudget,
  computeViewportRenderParams,
  pickLodBitmap,
  MAX_CANVAS_PIXELS,
  OVERLAY_MAX_PIXELS,
  type ViewportRect,
} from './pdfRenderMath';

// Typical 36"×24" architectural sheet at 72dpi
const SHEET_W = 2592;
const SHEET_H = 1728;

const fullPage: ViewportRect = { minPctX: 0, minPctY: 0, maxPctX: 1, maxPctY: 1 };

describe('clampScaleToPixelBudget', () => {
  it('returns the target scale when the canvas fits the budget', () => {
    expect(clampScaleToPixelBudget(SHEET_W, SHEET_H, 2.0)).toBe(2.0);
  });

  it('clamps so width*height stays within the pixel budget', () => {
    const scale = clampScaleToPixelBudget(SHEET_W, SHEET_H, 10.0);
    expect(scale).toBeLessThan(10.0);
    expect(SHEET_W * scale * SHEET_H * scale).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    // ~3.86× for this sheet size — the documented headroom
    expect(scale).toBeCloseTo(Math.sqrt(MAX_CANVAS_PIXELS / (SHEET_W * SHEET_H)), 6);
  });

  it('honors a custom budget', () => {
    const scale = clampScaleToPixelBudget(1000, 1000, 5.0, 4_000_000);
    expect(scale).toBe(2.0);
  });
});

describe('computeViewportRenderParams', () => {
  it('renders the full page 1:1 at stageScale 1, dpr 1', () => {
    const params = computeViewportRenderParams(fullPage, SHEET_W, SHEET_H, 1, 1);
    expect(params).not.toBeNull();
    expect(params!.effectiveScale).toBe(1);
    expect(params!.finalW).toBe(SHEET_W);
    expect(params!.finalH).toBe(SHEET_H);
    expect(params!.clipX).toBe(0);
    expect(params!.clipY).toBe(0);
    expect(params!.position).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('clamps out-of-bounds rects to the page', () => {
    const rect: ViewportRect = { minPctX: -0.5, minPctY: -0.2, maxPctX: 1.5, maxPctY: 1.2 };
    const params = computeViewportRenderParams(rect, SHEET_W, SHEET_H, 1, 1);
    expect(params!.position).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('returns null for degenerate rects', () => {
    const rect: ViewportRect = { minPctX: 0.5, minPctY: 0.5, maxPctX: 0.5, maxPctY: 0.6 };
    expect(computeViewportRenderParams(rect, SHEET_W, SHEET_H, 1, 1)).toBeNull();
    const offPage: ViewportRect = { minPctX: 1.2, minPctY: 0, maxPctX: 1.4, maxPctY: 1 };
    expect(computeViewportRenderParams(offPage, SHEET_W, SHEET_H, 1, 1)).toBeNull();
  });

  it('scales down to stay within the overlay pixel budget at deep zoom', () => {
    const params = computeViewportRenderParams(fullPage, SHEET_W, SHEET_H, 8, 2);
    expect(params).not.toBeNull();
    expect(params!.effectiveScale).toBeLessThan(16);
    // Allow rounding slack from Math.ceil after the sqrt rescale
    expect(params!.finalW * params!.finalH).toBeLessThanOrEqual(OVERLAY_MAX_PIXELS * 1.01);
  });

  it('computes clip offsets in scaled pixel space', () => {
    const rect: ViewportRect = { minPctX: 0.25, minPctY: 0.5, maxPctX: 0.75, maxPctY: 1 };
    const params = computeViewportRenderParams(rect, SHEET_W, SHEET_H, 2, 1);
    expect(params!.effectiveScale).toBe(2);
    expect(params!.clipX).toBe(Math.floor(0.25 * SHEET_W * 2));
    expect(params!.clipY).toBe(Math.floor(0.5 * SHEET_H * 2));
    expect(params!.position).toEqual({ x: 0.25, y: 0.5, width: 0.5, height: 0.5 });
  });
});

describe('pickLodBitmap', () => {
  const lods = { placeholder: 'placeholder', low: 'low', base: 'base', high: 'high' };
  const none = { placeholder: null, low: null, base: null, high: null };

  it('picks high at deep zoom when available', () => {
    expect(pickLodBitmap(2.5, lods)).toBe('high');
  });

  it('falls back to base at deep zoom when high is missing', () => {
    expect(pickLodBitmap(2.5, { ...lods, high: null })).toBe('base');
  });

  it('picks low when zoomed out', () => {
    expect(pickLodBitmap(0.5, lods)).toBe('low');
  });

  it('picks base in the mid range', () => {
    expect(pickLodBitmap(1.2, lods)).toBe('base');
  });

  it('prefers the placeholder PNG over the 1× preview until base lands', () => {
    expect(pickLodBitmap(1.2, { ...lods, base: null, high: null })).toBe('placeholder');
    expect(pickLodBitmap(3, { ...lods, base: null, high: null })).toBe('placeholder');
  });

  it('uses the placeholder alone before any pdf.js output exists', () => {
    expect(pickLodBitmap(1, { ...none, placeholder: 'placeholder' })).toBe('placeholder');
  });

  it('falls back to low when only the preview exists', () => {
    expect(pickLodBitmap(1.2, { ...none, low: 'low' })).toBe('low');
    expect(pickLodBitmap(3, { ...none, low: 'low' })).toBe('low');
  });

  it('returns null when nothing is rendered yet', () => {
    expect(pickLodBitmap(1, none)).toBeNull();
  });
});

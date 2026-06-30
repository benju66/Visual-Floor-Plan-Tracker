import { describe, it, expect } from 'vitest';
import { isSelfIntersecting, polygonIsSimpleAndFinite } from './polygonValidity';
import type { PercentPoint } from '@/types/domain';

const p = (pctX: number, pctY: number): PercentPoint => ({ pctX, pctY });

describe('isSelfIntersecting — bow-tie detection', () => {
  it('a convex quad is not self-intersecting', () => {
    expect(isSelfIntersecting([p(0, 0), p(1, 0), p(1, 1), p(0, 1)])).toBe(false);
  });

  it('a simple concave (dart) quad is not self-intersecting', () => {
    // Re-entrant corner at (1,1) but the ring never crosses itself.
    expect(isSelfIntersecting([p(0, 0), p(4, 0), p(0, 4), p(1, 1)])).toBe(false);
  });

  it('a bow-tie quad (crossed diagonals) IS self-intersecting', () => {
    // Vertex order 0→1→2→3 makes edges 0-1 and 2-3 cross at (0.5, 0.5).
    expect(isSelfIntersecting([p(0, 0), p(1, 1), p(1, 0), p(0, 1)])).toBe(true);
  });

  it('detects a crossing that only involves the CLOSING edge (last → first)', () => {
    // Only non-adjacent pair that crosses is edge1 (p1→p2) × edge3 (p3→p0, the
    // closing edge). A naive check that skipped the closing edge would miss it.
    expect(isSelfIntersecting([p(0, 0), p(2, 0), p(0, 1), p(2, 1)])).toBe(true);
  });

  it('a triangle can never self-intersect (no non-adjacent edge pair)', () => {
    expect(isSelfIntersecting([p(0, 0), p(1, 0), p(0.5, 1)])).toBe(false);
  });

  it('fewer than 4 points → never self-intersecting', () => {
    expect(isSelfIntersecting([])).toBe(false);
    expect(isSelfIntersecting([p(0, 0)])).toBe(false);
    expect(isSelfIntersecting([p(0, 0), p(1, 1)])).toBe(false);
  });

  it('collinear / degenerate vertices are not flagged (no proper crossing)', () => {
    // All points on y = 0; edges only touch/overlap collinearly, never cross.
    expect(isSelfIntersecting([p(0, 0), p(1, 0), p(2, 0), p(3, 0)])).toBe(false);
    // A repeated point (zero-length edge) must not be mistaken for a crossing.
    expect(isSelfIntersecting([p(0, 0), p(1, 0), p(1, 0), p(0, 1)])).toBe(false);
  });

  it('shared corners of adjacent edges do not count as intersections', () => {
    // A clean rectangle: every adjacent edge pair meets at a corner; none cross.
    expect(isSelfIntersecting([p(0, 0), p(2, 0), p(2, 1), p(0, 1)])).toBe(false);
  });
});

describe('polygonIsSimpleAndFinite — composes finiteness + simplicity', () => {
  it('true for a finite, simple polygon', () => {
    expect(polygonIsSimpleAndFinite([p(0.1, 0.1), p(0.3, 0.1), p(0.2, 0.3)])).toBe(true);
  });

  it('false for a self-intersecting (bow-tie) polygon', () => {
    expect(polygonIsSimpleAndFinite([p(0, 0), p(1, 1), p(1, 0), p(0, 1)])).toBe(false);
  });

  it('false for a non-finite / off-canvas polygon (isFinitePolygon gate)', () => {
    expect(polygonIsSimpleAndFinite([p(0.1, 0.1), p(NaN, 0.1), p(0.2, 0.3)])).toBe(false);
    expect(polygonIsSimpleAndFinite([p(0.1, 0.1), p(5, 0.1), p(0.2, 0.3)])).toBe(false);
  });

  it('false for null / too-few points', () => {
    expect(polygonIsSimpleAndFinite(null)).toBe(false);
    expect(polygonIsSimpleAndFinite([p(0, 0), p(1, 0)])).toBe(false);
  });
});

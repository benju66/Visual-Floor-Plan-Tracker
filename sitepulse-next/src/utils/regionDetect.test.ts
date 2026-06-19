import { describe, it, expect } from 'vitest';
import { detectRoomPolygon } from './regionDetect';
import { pointInPolygon, polygonAreaPct } from './geometry';
import type { WallSegment } from './wallIsolation';

const seg = (x0: number, y0: number, x1: number, y1: number): WallSegment => ({
  start: { pctX: x0, pctY: y0 },
  end: { pctX: x1, pctY: y1 },
});

// A closed square room with corners at (0.2,0.2)–(0.8,0.8).
const squareRoom: WallSegment[] = [
  seg(0.2, 0.2, 0.8, 0.2), // top
  seg(0.8, 0.2, 0.8, 0.8), // right
  seg(0.8, 0.8, 0.2, 0.8), // bottom
  seg(0.2, 0.8, 0.2, 0.2), // left
];

const center = { pctX: 0.5, pctY: 0.5 };

describe('detectRoomPolygon', () => {
  it('detects an enclosed square room from a click inside it', () => {
    const poly = detectRoomPolygon(squareRoom, center, { aspect: 1 });
    expect(poly).not.toBeNull();
    const ring = poly as { pctX: number; pctY: number }[];
    expect(ring.length).toBeGreaterThanOrEqual(4);
    // The detected ring contains the click and sits inside the wall envelope.
    expect(pointInPolygon(center, ring)).toBe(true);
    for (const p of ring) {
      expect(p.pctX).toBeGreaterThan(0.15);
      expect(p.pctX).toBeLessThan(0.85);
      expect(p.pctY).toBeGreaterThan(0.15);
      expect(p.pctY).toBeLessThan(0.85);
    }
    // Roughly the 0.6 × 0.6 interior (shrunk a little by wall dilation).
    expect(polygonAreaPct(ring)).toBeGreaterThan(0.2);
    expect(polygonAreaPct(ring)).toBeLessThan(0.4);
  });

  it('bridges a small door gap with the default dilation', () => {
    // Top wall split, leaving a ~0.008-wide opening (a doorway).
    const withDoor: WallSegment[] = [
      seg(0.2, 0.2, 0.46, 0.2),
      seg(0.468, 0.2, 0.8, 0.2),
      seg(0.8, 0.2, 0.8, 0.8),
      seg(0.8, 0.8, 0.2, 0.8),
      seg(0.2, 0.8, 0.2, 0.2),
    ];
    expect(detectRoomPolygon(withDoor, center, { aspect: 1 })).not.toBeNull();
    // With no gap-bridging the fill leaks out through the doorway.
    expect(detectRoomPolygon(withDoor, center, { aspect: 1, gapBridge: 0 })).toBeNull();
  });

  it('returns null for an open (un-enclosed) region', () => {
    const openBox: WallSegment[] = [
      seg(0.2, 0.2, 0.8, 0.2), // top only — three sides missing
    ];
    expect(detectRoomPolygon(openBox, center, { aspect: 1 })).toBeNull();
  });

  it('returns null when the click is outside any enclosure', () => {
    expect(detectRoomPolygon(squareRoom, { pctX: 0.05, pctY: 0.05 }, { aspect: 1 })).toBeNull();
  });

  it('returns null for empty walls', () => {
    expect(detectRoomPolygon([], center, { aspect: 1 })).toBeNull();
  });
});

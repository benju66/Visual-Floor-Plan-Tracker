/**
 * Region detection — pure, framework-free, deterministic.
 *
 * Given a set of (already wall-isolated) line segments and a click point, find
 * the enclosed room around the click and return its outline as a polygon in
 * percent space — or `null` when no clean enclosure exists (open/leaky region,
 * or no walls). This is the deterministic "geometry precursor to AI-assisted
 * tracing" (initiative brief, Phase B1): propose a polygon a human accepts or
 * adjusts; never auto-commit.
 *
 * Approach: raster flood-fill (robust to messy CAD soup, and lets us bridge
 * door gaps by dilating the wall pixels before filling). The alternative —
 * exact planar-arrangement face-finding — is vector-native but brittle on
 * un-isolated soup and can't bridge gaps; flood-fill + human edit is the
 * pragmatic v1.
 *
 * Pipeline: rasterize walls → dilate (gap-bridge) → flood-fill from the click
 * (bail if it escapes to the border) → trace the filled region's boundary
 * (which hugs the INTERIOR wall faces — what the standard wants) → back to
 * percent space. Simplification + vertex snapping happen in the caller.
 *
 * No I/O, no Date.now(), no `any`.
 */
import type { PercentPoint } from '@/types/domain';
import type { WallSegment } from '@/utils/wallIsolation';
import { pointInPolygon, polygonAreaPct } from '@/utils/geometry';

export interface DetectRoomOptions {
  /** drawW / drawH — keeps raster cells square in physical space. */
  aspect: number;
  /** Raster resolution along the longer axis. Default 600. Higher = finer + slower. */
  gridSize?: number;
  /**
   * Fixed wall-dilation radius (in cells) used to bridge gaps before filling.
   * When OMITTED (the recommended mode), detection AUTO-ESCALATES through
   * increasing radii and keeps the SMALLEST that seals the room — this is what
   * closes real doorways without merging neighbouring rooms. Set an explicit
   * value (including 0) to force a single fixed radius (used by tests).
   */
  gapBridge?: number;
  /** Cap for the auto-escalation sequence (cells, at the default grid). Default 24. */
  gapBridgeMax?: number;
}

interface Grid {
  w: number;
  h: number;
  /** 1 = wall, 0 = free. Row-major. */
  cells: Uint8Array;
}

const at = (x: number, y: number, w: number) => y * w + x;

/** Rasterize one segment into the grid with Bresenham's line (1-cell stroke). */
function drawSegment(g: Grid, x0: number, y0: number, x1: number, y1: number): void {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let guard = (dx + dy) * 2 + 8; // hard stop against degenerate input
  for (;;) {
    if (x0 >= 0 && x0 < g.w && y0 >= 0 && y0 < g.h) g.cells[at(x0, y0, g.w)] = 1;
    if (x0 === x1 && y0 === y1) break;
    if (guard-- <= 0) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

/** Separable binary dilation by `r` cells (Chebyshev neighborhood). */
function dilate(g: Grid, r: number): void {
  if (r <= 0) return;
  const { w, h, cells } = g;
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let k = -r; k <= r && !on; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < w && cells[at(xx, y, w)]) on = 1;
      }
      tmp[at(x, y, w)] = on;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let k = -r; k <= r && !on; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < h && tmp[at(x, yy, w)]) on = 1;
      }
      cells[at(x, y, w)] = on;
    }
  }
}

/** Ring-search outward from (cx,cy) for the nearest free cell, up to `maxR`. */
function findNearbyFree(g: Grid, cx: number, cy: number, maxR: number): [number, number] | null {
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < g.w && y >= 0 && y < g.h && !g.cells[at(x, y, g.w)]) return [x, y];
      }
    }
  }
  return null;
}

/**
 * Trace the boundary of the filled region as an ordered lattice loop.
 *
 * For each filled cell, emit its exposed edges as DIRECTED half-edges in a
 * consistent (clockwise, screen y-down) winding; the outer boundary then chains
 * into one loop and any interior holes into oppositely-wound loops. We extract
 * every loop and return the one with the largest area (the outer boundary).
 * Lattice points span 0..w / 0..h.
 */
function traceBoundary(g: Grid, fill: Uint8Array): number[][] | null {
  const { w, h } = g;
  const filled = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && fill[at(x, y, w)] === 1;
  const key = (x: number, y: number) => x * (h + 1) + y;
  const edges = new Map<number, Array<[number, number]>>();
  const addEdge = (ax: number, ay: number, bx: number, by: number) => {
    const k = key(ax, ay);
    const arr = edges.get(k);
    if (arr) arr.push([bx, by]);
    else edges.set(k, [[bx, by]]);
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!filled(x, y)) continue;
      if (!filled(x, y - 1)) addEdge(x, y, x + 1, y);           // top
      if (!filled(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);   // right
      if (!filled(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);   // bottom
      if (!filled(x - 1, y)) addEdge(x, y + 1, x, y);           // left
    }
  }
  if (edges.size === 0) return null;

  let best: number[][] | null = null;
  let bestArea = -1;
  const guardMax = (w + 1) * (h + 1) * 4 + 16;

  for (const startKey of edges.keys()) {
    const startArr = edges.get(startKey);
    if (!startArr || startArr.length === 0) continue;
    const sx = Math.floor(startKey / (h + 1));
    const sy = startKey % (h + 1);
    const loop: number[][] = [];
    let cx = sx;
    let cy = sy;
    let guard = guardMax;
    for (;;) {
      const cur = edges.get(key(cx, cy));
      if (!cur || cur.length === 0) break;
      const next = cur.pop() as [number, number];
      loop.push([cx, cy]);
      cx = next[0];
      cy = next[1];
      if (cx === sx && cy === sy) break;
      if (guard-- <= 0) break;
    }
    if (loop.length >= 4) {
      const poly = loop.map(([px, py]) => ({ pctX: px, pctY: py }));
      const a = polygonAreaPct(poly);
      if (a > bestArea) {
        bestArea = a;
        best = loop;
      }
    }
  }
  return best;
}

/**
 * Detect the enclosed room polygon around `click`. Returns an ordered ring in
 * percent space, or `null` when there is no clean enclosure (open region, click
 * outside any room, or no walls). Callers should simplify + snap the result and
 * always hand it to a human for review before saving.
 */
/**
 * One rasterize-dilate-flood-trace attempt at a single gap radius. Returns the
 * room ring (percent space) or `null` if the fill leaks to the border. The wall
 * raster is copied per attempt so the caller can retry at other radii.
 */
function attemptFill(
  baseCells: Uint8Array,
  w: number,
  h: number,
  gap: number,
  toCol: (p: number) => number,
  toRow: (p: number) => number,
  click: PercentPoint,
): PercentPoint[] | null {
  const g: Grid = { w, h, cells: baseCells.slice() };
  if (gap > 0) dilate(g, gap);

  // Seed cell. If the click landed on a (dilated) wall, nudge to a free neighbor.
  let sx = toCol(click.pctX);
  let sy = toRow(click.pctY);
  if (g.cells[at(sx, sy, w)]) {
    const free = findNearbyFree(g, sx, sy, gap + 3);
    if (!free) return null;
    sx = free[0];
    sy = free[1];
  }

  // Flood fill (4-connectivity). Bail if it reaches the border (open region).
  const fill = new Uint8Array(w * h);
  const stack: number[] = [sx, sy];
  fill[at(sx, sy, w)] = 1;
  while (stack.length) {
    const y = stack.pop() as number;
    const x = stack.pop() as number;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return null; // leaked
    const nb = [x + 1, y, x - 1, y, x, y + 1, x, y - 1];
    for (let i = 0; i < nb.length; i += 2) {
      const nx = nb[i];
      const ny = nb[i + 1];
      const ni = at(nx, ny, w);
      if (!g.cells[ni] && !fill[ni]) {
        fill[ni] = 1;
        stack.push(nx, ny);
      }
    }
  }

  const ring = traceBoundary(g, fill);
  if (!ring || ring.length < 4) return null;

  const poly: PercentPoint[] = ring.map(([px, py]) => ({ pctX: px / w, pctY: py / h }));
  if (!pointInPolygon(click, poly)) return null;
  return poly;
}

export function detectRoomPolygon(
  walls: readonly WallSegment[],
  click: PercentPoint,
  opts: DetectRoomOptions,
): PercentPoint[] | null {
  if (!walls || walls.length === 0) return null;

  const aspect = opts.aspect > 0 ? opts.aspect : 1;
  const base = Math.max(50, Math.round(opts.gridSize ?? 600));
  // Square cells in physical space require W / H === drawW / drawH === aspect.
  const w = aspect >= 1 ? base : Math.max(50, Math.round(base * aspect));
  const h = aspect >= 1 ? Math.max(50, Math.round(base / aspect)) : base;

  // Rasterize the walls ONCE; each gap attempt dilates a fresh copy.
  const baseCells = new Uint8Array(w * h);
  const raster: Grid = { w, h, cells: baseCells };
  const toCol = (p: number) => Math.min(w - 1, Math.max(0, Math.floor(p * w)));
  const toRow = (p: number) => Math.min(h - 1, Math.max(0, Math.floor(p * h)));
  for (const s of walls) {
    drawSegment(raster, toCol(s.start.pctX), toRow(s.start.pctY), toCol(s.end.pctX), toRow(s.end.pctY));
  }

  // Gap radii to try. An explicit gapBridge forces a single fixed radius
  // (incl. 0); otherwise auto-escalate and take the smallest radius that seals.
  let gaps: number[];
  if (opts.gapBridge !== undefined) {
    gaps = [Math.max(0, Math.round(opts.gapBridge))];
  } else {
    const max = Math.max(3, Math.round(opts.gapBridgeMax ?? 24));
    gaps = [3, 7, 12, 18, 24].filter((r) => r < max);
    gaps.push(max);
  }

  for (const gap of gaps) {
    const poly = attemptFill(baseCells, w, h, gap, toCol, toRow, click);
    if (poly) return poly;
  }
  return null;
}

/**
 * Opening reconciliation — pure, framework-free derivation (AI Tracing Assist —
 * Phase 4b). Turns the RAW per-room opening tags (Phase 4a) into CANONICAL openings
 * + a room-connectivity graph, WITHOUT ever mutating the raw tags. The raw tags are
 * ground truth; everything here is a re-runnable, deterministic derivation consumed
 * at export and by the review DoD (Phase 4c).
 *
 * The cross-wall match (load-bearing): because rooms are traced on their INNER wall
 * faces, the two sides of one doorway are two PARALLEL edges offset by the wall
 * thickness — never coincident. A naive coincidence/tolerance test is therefore
 * WRONG. Two opening edges are the same physical opening iff ALL four hold:
 *   1. Parallel       — line orientations within `angleTolDeg`.
 *   2. Facing         — the rooms' inward normals are roughly anti-parallel (a wall
 *                       sits BETWEEN them; they aren't two edges on the same side).
 *   3. Projection overlap — projected onto the wall direction, the spans overlap by
 *                       ≥ `overlapFrac` of the shorter edge (this is what separates
 *                       two distinct doorways on the SAME wall).
 *   4. Separation band — the perpendicular gap is within `[minGap, maxGap]` (a
 *                       bounded wall-thickness band, NOT a snapping tolerance).
 * The AND of these is what prevents false merges. With sheet scale known, the caller
 * expresses the band in real inches; otherwise the conservative percent defaults plus
 * the other three criteria still constrain it (the "no-scale fallback").
 *
 * Backstop (never guess destructively): a confident, unambiguous pair auto-merges; an
 * edge matching nothing stays a valid ONE-neighbor opening (exterior door / untraced
 * neighbor) — nothing dropped or invented; an ambiguous match (a near-tie second
 * candidate) or a type conflict is `flagged` for human confirm (surfaced in 4c), not
 * silently resolved. Deterministic throughout: stable ordering, derived ids, no
 * `Date.now()`/random — so it is unit-tested in isolation (AGENTS.md §9).
 */
import { openingSegment } from '@/utils/openingEdges';
import { OPENING_TYPES, type OpeningEdge, type OpeningType, type PercentPoint } from '@/types/domain';

/** One room as reconciliation sees it: its polygon + its raw opening tags. */
export interface ReconcileUnit {
  id: string;
  polygon: PercentPoint[];
  openingEdges: OpeningEdge[];
}

export interface ReconcileOptions {
  /** drawW/drawH — restores isotropic geometry from the anisotropic percent space. Default 1. */
  aspect?: number;
  /** Max line-orientation difference for "parallel", in degrees. Default 10. */
  angleTolDeg?: number;
  /** Min projection-overlap fraction (of the shorter edge) for a match. Default 0.5. */
  overlapFrac?: number;
  /** Wall-thickness band (perpendicular gap), in the aspect-scaled metric. Defaults conservative. */
  minGap?: number;
  maxGap?: number;
  /** A 2nd candidate whose confidence is within this margin of the best → ambiguous (flagged). Default 0.12. */
  ambiguityMargin?: number;
}

/** One source tag that fed a canonical opening (its original type is retained). */
export interface OpeningSource {
  unitId: string;
  edgeIndex: number;
  type: OpeningType;
}

/** Why a derived opening needs a human look (4c). */
export type OpeningFlagReason = 'ambiguous_match' | 'type_conflict';

/** One derived, canonical opening. */
export interface CanonicalOpening {
  /** Deterministic id from its sorted source edges (stable across re-runs). */
  id: string;
  /** Representative segment (percent space): the source edge for a singleton, the midline for a pair. */
  segment: { p1: PercentPoint; p2: PercentPoint };
  /** Resolved type (deterministic tiebreak on a conflict). */
  type: OpeningType;
  /** The 1 (exterior/untraced) or 2 (shared wall) rooms this opening connects, sorted. */
  neighborUnitIds: string[];
  /** The raw tag(s) that produced it, sorted. */
  sourceEdges: OpeningSource[];
  /** 0..1 — how cleanly the criteria fit (singletons get a moderate, honest baseline). */
  confidence: number;
  /** Set when a human should confirm (ambiguous match or type conflict). */
  flagged?: boolean;
  flagReason?: OpeningFlagReason;
}

export interface ReconcileResult {
  openings: CanonicalOpening[];
  /** Unique connected room pairs `[a, b]` (a < b), sorted — the connectivity graph's edges. */
  adjacency: [string, string][];
}

const DEFAULTS = {
  aspect: 1,
  angleTolDeg: 10,
  overlapFrac: 0.5,
  minGap: 0,
  maxGap: 0.03,
  ambiguityMargin: 0.12,
};
/** Inward normals must oppose by > 120° to count as "facing" across a wall. */
const FACING_DOT = -0.5;
/** Honest baseline confidence for an unmatched (one-neighbor) opening. */
const SINGLETON_CONFIDENCE = 0.5;

type V = { x: number; y: number };
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
const addV = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: V, s: number): V => ({ x: a.x * s, y: a.y * s });
const dot = (a: V, b: V): number => a.x * b.x + a.y * b.y;
const vlen = (a: V): number => Math.hypot(a.x, a.y);
const norm = (a: V): V => {
  const l = vlen(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
const iso = (p: PercentPoint, aspect: number): V => ({ x: p.pctX * aspect, y: p.pctY });

/** Ray-cast point-in-polygon (scaled space). */
function pointInPolygon(pt: V, poly: V[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const intersect =
      a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y || 1e-12) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Unit inward normal of edge `i` (scaled space): the perpendicular pointing into the room. */
function inwardNormal(polyIso: V[], i: number): V {
  const n = polyIso.length;
  const a = polyIso[i];
  const b = polyIso[(i + 1) % n];
  const dir = norm(sub(b, a));
  const left: V = { x: -dir.y, y: dir.x };
  const mid = mul(addV(a, b), 0.5);
  const eps = Math.max(vlen(sub(b, a)) * 0.1, 1e-6);
  const probe = addV(mid, mul(left, eps));
  return pointInPolygon(probe, polyIso) ? left : { x: -left.x, y: -left.y };
}

interface Ref {
  unitId: string;
  edgeIndex: number;
  type: OpeningType;
  pctSeg: { p1: PercentPoint; p2: PercentPoint };
  a: V;
  b: V;
  dir: V;
  mid: V;
  len: number;
  inward: V;
  key: string; // deterministic sort key
}

interface Candidate {
  i: number;
  j: number;
  confidence: number;
  key: string;
}

/** Stable comparison key for a source edge / pair (no randomness). */
const refKey = (unitId: string, edgeIndex: number): string => `${unitId}#${edgeIndex}`;

/** The deterministic-tiebreak type for a (possibly conflicting) pair: the earliest in OPENING_TYPES. */
function resolveType(t1: OpeningType, t2: OpeningType): OpeningType {
  return OPENING_TYPES.indexOf(t1) <= OPENING_TYPES.indexOf(t2) ? t1 : t2;
}

/** Average two percent segments into a centered midline (aligns endpoints by proximity first). */
function midline(
  s1: { p1: PercentPoint; p2: PercentPoint },
  s2: { p1: PercentPoint; p2: PercentPoint },
): { p1: PercentPoint; p2: PercentPoint } {
  const d = (a: PercentPoint, b: PercentPoint) => (a.pctX - b.pctX) ** 2 + (a.pctY - b.pctY) ** 2;
  // Match s2's endpoints to s1's (the two edges can be traced in opposite directions).
  const flip = d(s1.p1, s2.p1) + d(s1.p2, s2.p2) > d(s1.p1, s2.p2) + d(s1.p2, s2.p1);
  const q1 = flip ? s2.p2 : s2.p1;
  const q2 = flip ? s2.p1 : s2.p2;
  const avg = (a: PercentPoint, b: PercentPoint): PercentPoint => ({
    pctX: (a.pctX + b.pctX) / 2,
    pctY: (a.pctY + b.pctY) / 2,
  });
  return { p1: avg(s1.p1, q1), p2: avg(s1.p2, q2) };
}

/**
 * Derive canonical openings + a room-connectivity graph from rooms' raw opening
 * tags. Pure: never mutates inputs; deterministic ids + ordering. See the module
 * header for the four-criterion cross-wall match and the flag-don't-guess backstop.
 */
export function reconcileOpenings(units: ReconcileUnit[], opts: ReconcileOptions = {}): ReconcileResult {
  const o = { ...DEFAULTS, ...opts };
  const angleTolRad = (o.angleTolDeg * Math.PI) / 180;

  // 1. Build a flat, deterministically-ordered list of opening refs (skip stale tags).
  const refs: Ref[] = [];
  for (const u of units) {
    const polyIso = u.polygon.map((p) => iso(p, o.aspect));
    for (const e of u.openingEdges) {
      const pctSeg = openingSegment(u.polygon, e.edgeIndex);
      if (!pctSeg) continue;
      const a = iso(pctSeg.p1, o.aspect);
      const b = iso(pctSeg.p2, o.aspect);
      const len = vlen(sub(b, a));
      if (len <= 0) continue;
      refs.push({
        unitId: u.id,
        edgeIndex: e.edgeIndex,
        type: e.type,
        pctSeg,
        a,
        b,
        dir: norm(sub(b, a)),
        mid: mul(addV(a, b), 0.5),
        len,
        inward: inwardNormal(polyIso, e.edgeIndex),
        key: refKey(u.id, e.edgeIndex),
      });
    }
  }
  refs.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));

  // 2. Test every cross-unit pair against the four criteria; keep the passers + score.
  const candidates: Candidate[] = [];
  for (let i = 0; i < refs.length; i++) {
    for (let j = i + 1; j < refs.length; j++) {
      if (refs[i].unitId === refs[j].unitId) continue; // an opening always spans two rooms
      const c = scorePair(refs[i], refs[j], angleTolRad, o.overlapFrac, o.minGap, o.maxGap);
      if (c !== null) candidates.push({ i, j, confidence: c, key: `${refs[i].key}|${refs[j].key}` });
    }
  }
  // Global greedy: assign the most confident pairs first; deterministic tiebreak by key.
  candidates.sort((p, q) => q.confidence - p.confidence || (p.key < q.key ? -1 : 1));

  const partner = new Array<number>(refs.length).fill(-1);
  const matchConfidence = new Array<number>(refs.length).fill(0);
  for (const c of candidates) {
    if (partner[c.i] !== -1 || partner[c.j] !== -1) continue;
    partner[c.i] = c.j;
    partner[c.j] = c.i;
    matchConfidence[c.i] = c.confidence;
    matchConfidence[c.j] = c.confidence;
  }

  // Ambiguity: a ref had another viable partner within `ambiguityMargin` of its match.
  const ambiguous = new Array<boolean>(refs.length).fill(false);
  for (const c of candidates) {
    for (const idx of [c.i, c.j] as const) {
      const other = idx === c.i ? c.j : c.i;
      if (other === partner[idx]) continue; // this IS the assigned partner
      if (partner[idx] === -1) continue; // unmatched refs are honest singletons, not ambiguous
      if (c.confidence >= matchConfidence[idx] - o.ambiguityMargin) ambiguous[idx] = true;
    }
  }

  // 3. Emit canonical openings (one per matched pair, one per singleton) + adjacency.
  const openings: CanonicalOpening[] = [];
  const adjacencySet = new Set<string>();
  const done = new Array<boolean>(refs.length).fill(false);

  for (let i = 0; i < refs.length; i++) {
    if (done[i]) continue;
    const ri = refs[i];
    const p = partner[i];

    if (p === -1) {
      // Singleton: a valid one-neighbor opening (exterior / untraced neighbor).
      done[i] = true;
      openings.push({
        id: ri.key,
        segment: ri.pctSeg,
        type: ri.type,
        neighborUnitIds: [ri.unitId],
        sourceEdges: [{ unitId: ri.unitId, edgeIndex: ri.edgeIndex, type: ri.type }],
        confidence: SINGLETON_CONFIDENCE,
        flagged: false,
      });
      continue;
    }

    // Matched pair → one shared opening.
    const rj = refs[p];
    done[i] = true;
    done[p] = true;
    const sources: OpeningSource[] = [
      { unitId: ri.unitId, edgeIndex: ri.edgeIndex, type: ri.type },
      { unitId: rj.unitId, edgeIndex: rj.edgeIndex, type: rj.type },
    ].sort((a, b) => (refKey(a.unitId, a.edgeIndex) < refKey(b.unitId, b.edgeIndex) ? -1 : 1));
    const typeConflict = ri.type !== rj.type;
    const isAmbiguous = ambiguous[i] || ambiguous[p];
    const neighbors = [ri.unitId, rj.unitId].sort();
    adjacencySet.add(`${neighbors[0]} ${neighbors[1]}`);

    openings.push({
      id: sources.map((s) => refKey(s.unitId, s.edgeIndex)).join('|'),
      segment: midline(ri.pctSeg, rj.pctSeg),
      type: resolveType(ri.type, rj.type),
      neighborUnitIds: neighbors,
      sourceEdges: sources,
      confidence: matchConfidence[i],
      flagged: typeConflict || isAmbiguous,
      ...(typeConflict
        ? { flagReason: 'type_conflict' as const }
        : isAmbiguous
          ? { flagReason: 'ambiguous_match' as const }
          : {}),
    });
  }

  openings.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const adjacency = [...adjacencySet]
    .map((k) => k.split(' ') as [string, string])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));

  return { openings, adjacency };
}

/**
 * Test two opening refs against the four cross-wall criteria. Returns a confidence in
 * (0,1] when they are the same physical opening, else null. Confidence rewards a tight
 * angle + a large projection overlap (the gap is a gate, not a quality signal).
 */
function scorePair(
  x: Ref,
  y: Ref,
  angleTolRad: number,
  overlapFrac: number,
  minGap: number,
  maxGap: number,
): number | null {
  // 1. Parallel.
  const dotDir = dot(x.dir, y.dir);
  const angle = Math.acos(Math.min(1, Math.abs(dotDir)));
  if (angle > angleTolRad) return null;

  // 2. Facing — inward normals roughly anti-parallel (a wall is between them).
  if (dot(x.inward, y.inward) > FACING_DOT) return null;

  // Common axis (align y's direction to x's), and the perpendicular.
  const yDir = dotDir >= 0 ? y.dir : mul(y.dir, -1);
  const common = norm(addV(x.dir, yDir));
  const perp: V = { x: -common.y, y: common.x };

  // 4. Separation band — perpendicular gap between the two parallel lines.
  const gap = Math.abs(dot(sub(y.mid, x.mid), perp));
  if (gap < minGap || gap > maxGap) return null;

  // 3. Projection overlap along the common axis.
  const px = [dot(x.a, common), dot(x.b, common)];
  const py = [dot(y.a, common), dot(y.b, common)];
  const xMin = Math.min(px[0], px[1]);
  const xMax = Math.max(px[0], px[1]);
  const yMin = Math.min(py[0], py[1]);
  const yMax = Math.max(py[0], py[1]);
  const overlap = Math.max(0, Math.min(xMax, yMax) - Math.max(xMin, yMin));
  const frac = overlap / Math.max(1e-9, Math.min(x.len, y.len));
  if (frac < overlapFrac) return null;

  const angleScore = 1 - angle / angleTolRad;
  const overlapScore = Math.min(1, Math.max(0, (frac - overlapFrac) / (1 - overlapFrac)));
  return 0.5 * angleScore + 0.5 * overlapScore;
}

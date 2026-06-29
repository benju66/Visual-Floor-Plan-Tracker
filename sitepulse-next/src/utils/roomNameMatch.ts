/**
 * Room-name auto-fill — pure, framework-free matching logic (AI Tracing Assist —
 * Trace Naming & Type Assist Phase 1, lever A). Given a freshly-traced room polygon
 * and the sheet's cached text words, isolate the words that ARE the room's name +
 * number so the naming popover pre-fills a CLEAN first draft — dropping the square-
 * footage notes, dimensions, and door/equipment tags that used to get mashed in.
 *
 * Deterministic and side-effect-free (no DB, no `Date.now()`, no network) so the
 * correctness invariants are unit-tested in isolation (AGENTS.md §9). The geometry
 * is still 100% hand-traced; only the NAME is assisted.
 */
import { isPointInPolygon, getCentroid } from '@/utils/geometry';
import type { PercentPoint, TextWord } from '@/types/domain';

/**
 * A door/equipment tag — digits followed by a SINGLE trailing letter (e.g. "105A",
 * "200B"). On commercial sheets these sit inside a space near its door but are NOT
 * the room number (verified on LaSalle/Crew). The pattern is deliberately narrow so
 * it never eats a pure room number ("417"), a name ("WOMEN"), or a number with a
 * leading letter. If a room's only interior text matches this, we still fall back to
 * it rather than suggest nothing.
 */
const DOOR_TAG_RE = /^\d+[A-Za-z]$/;

/**
 * An equipment / MEP tag — a short alpha prefix, a hyphen, then digits (e.g. "EF-1",
 * "AHU-2", "RTU-3", "P-1"). The required hyphen-then-digit shape never matches a real
 * room-name word (which has no internal "-<number>") or a room number, so it is safe
 * to drop outright.
 */
const EQUIPMENT_TAG_RE = /^[A-Za-z]{1,4}-\d+[A-Za-z]?$/;

/**
 * A dimension token — any token carrying BOTH a digit and a foot/inch mark (straight
 * or curly prime), e.g. `12'-6"`, `10'`, `8"`, `12′-6″`. Requiring a digit means a
 * name with an apostrophe ("WOMEN'S", "NURSES'") is never mistaken for a dimension.
 */
const DIM_MARK_RE = /['"′″’”]/;
const isDimension = (t: string) => /\d/.test(t) && DIM_MARK_RE.test(t);

/** A bare number (commas allowed) — a room-number candidate, or an SF value. */
const NUMBER_RE = /^[\d,]+$/;

/**
 * A square-footage UNIT token on its own — "SF", "S.F.", "S F", "SQ FT", "SQFT".
 * (The number it labels is dropped separately by same-line adjacency.)
 */
const SF_UNIT_RE = /^(?:S\.?\s*F\.?|SQ\.?\s*FT\.?)$/i;

/** A combined value+unit square-footage token — "250SF", "1,200 SF". */
const SF_COMBINED_RE = /^[\d,]+\s*(?:S\.?\s*F\.?|SQ\.?\s*FT\.?)$/i;

/** Words within this fraction of sheet height count as the same text line (read L→R). */
const SAME_LINE_EPS = 0.01;

export interface RoomNameMatch {
  /**
   * The proposed `unit_number` — the room's name + space number as it reads on the
   * sheet (e.g. "417 WOMEN", "OFFICE 110"), noise excluded, words joined in reading
   * order (top-to-bottom, then left-to-right).
   */
  unitNumber: string;
  /** The interior words that formed the label, in that same reading order. */
  words: TextWord[];
}

/** Read-order comparator: top line first, then left-to-right within a line. */
function byReadingOrder(a: TextWord, b: TextWord): number {
  if (Math.abs(a.pctY - b.pctY) > SAME_LINE_EPS) return a.pctY - b.pctY;
  return a.pctX - b.pctX;
}

/** True when two words sit on the same text line (vertical centers within EPS). */
function sameLine(a: TextWord, b: TextWord): boolean {
  return Math.abs(a.pctY - b.pctY) <= SAME_LINE_EPS;
}

/**
 * Noise we drop OUTRIGHT regardless of position: door tags, equipment/MEP tags,
 * dimensions, and standalone or combined square-footage tokens. (A bare SF *number*
 * has no shape of its own — it is dropped only when an SF unit follows it on the same
 * line; see {@link matchRoomName}.)
 */
function isStandaloneNoise(t: string): boolean {
  return (
    DOOR_TAG_RE.test(t) ||
    EQUIPMENT_TAG_RE.test(t) ||
    isDimension(t) ||
    SF_UNIT_RE.test(t) ||
    SF_COMBINED_RE.test(t)
  );
}

/** A text line: its words plus the line's mean vertical position. */
interface TextLine {
  y: number;
  words: TextWord[];
}

/** Cluster words into text lines by vertical proximity (read top-to-bottom). */
function groupLines(words: TextWord[]): TextLine[] {
  const sorted = words.slice().sort((a, b) => a.pctY - b.pctY);
  const lines: TextLine[] = [];
  for (const w of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(w.pctY - last.words[0].pctY) <= SAME_LINE_EPS) {
      last.words.push(w);
    } else {
      lines.push({ y: w.pctY, words: [w] });
    }
  }
  for (const line of lines) {
    line.y = line.words.reduce((sum, w) => sum + w.pctY, 0) / line.words.length;
  }
  return lines;
}

/**
 * Match the interior text of a traced room to its name/number, leaning on the fixed
 * "Name + Number" convention (e.g. "OFFICE 110" / "417 WOMEN").
 *
 * Strategy (position/pattern only — no font size):
 *   1. Keep the sheet words whose position falls INSIDE the polygon.
 *   2. Drop noise: door tags ("105A"), equipment tags ("EF-1"), dimensions
 *      ("12'-6\""), and square-footage notes ("250 SF") — including the bare number
 *      that labels an SF unit on the same line. If filtering leaves nothing (e.g. a
 *      door-tag-only room), fall back to the raw interior so the user still gets a
 *      confirmable draft.
 *   3. Keep only the 1–2 text lines NEAREST the polygon centroid (the convention puts
 *      the label on one or two stacked lines) and drop far-away interior text rather
 *      than joining every interior word.
 *   4. Join the survivors in reading order → the candidate `unit_number`.
 *
 * Returns `null` when the polygon has no interior words at all (e.g. a scanned sheet
 * with no text layer, or a blank room) — the caller then leaves the popover empty for
 * a fully-manual name. Never throws.
 */
export function matchRoomName(
  polygon: PercentPoint[],
  words: TextWord[] | null | undefined,
): RoomNameMatch | null {
  if (!polygon || polygon.length < 3 || !words || words.length === 0) return null;

  const interior = words.filter((w) => isPointInPolygon({ pctX: w.pctX, pctY: w.pctY }, polygon));
  if (interior.length === 0) return null;

  // Reading order first, so the SF-adjacency look-ahead ("250" then "SF") is reliable.
  const ordered = interior.slice().sort(byReadingOrder);
  const survivors = ordered.filter((w, i) => {
    const t = w.text.trim();
    if (isStandaloneNoise(t)) return false;
    // A bare number immediately followed (same line) by an SF unit is the SF value.
    if (NUMBER_RE.test(t)) {
      const next = ordered[i + 1];
      if (next && sameLine(w, next) && SF_UNIT_RE.test(next.text.trim())) return false;
    }
    return true;
  });

  // All-noise / door-tag-only room: keep a confirmable draft from the raw interior.
  const kept = survivors.length > 0 ? survivors : ordered;

  // Prefer the 1–2 lines nearest the polygon centroid over mashing every interior word.
  const centroidY = getCentroid(polygon).pctY;
  const lines = groupLines(kept);
  lines.sort((a, b) => Math.abs(a.y - centroidY) - Math.abs(b.y - centroidY));
  const nearest = lines.slice(0, 2).flatMap((l) => l.words);

  const candidates = nearest.slice().sort(byReadingOrder);
  const unitNumber = candidates
    .map((w) => w.text.trim())
    .filter((t) => t.length > 0)
    .join(' ');
  if (!unitNumber) return null;

  return { unitNumber, words: candidates };
}

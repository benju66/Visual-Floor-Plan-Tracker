/**
 * Room-name auto-fill — pure, framework-free matching logic (AI Tracing Assist —
 * Phase 2). Given a freshly-traced room polygon and the sheet's cached text words,
 * pick the words that ARE the room's name/number so the naming popover can pre-fill
 * a first draft the human confirms or edits.
 *
 * Deterministic and side-effect-free (no DB, no `Date.now()`, no network) so the
 * correctness invariants are unit-tested in isolation (AGENTS.md §9). The geometry
 * is still 100% hand-traced; only the NAME is assisted.
 */
import { isPointInPolygon } from '@/utils/geometry';
import type { PercentPoint, TextWord } from '@/types/domain';

/**
 * A door/equipment tag — digits followed by a SINGLE trailing letter (e.g. "105A",
 * "200B"). On commercial sheets these sit inside a space near its door but are NOT
 * the room number (verified on LaSalle/Crew). The pattern is deliberately narrow so
 * it never eats a pure room number ("417"), a name ("WOMEN"), or a number with a
 * leading letter. `sheet_text` stores no font size (Phase 1 cached only position),
 * so this position-agnostic pattern is the door-tag heuristic — see the kickoff's
 * "Open design point". If a room's only interior text matches this, we still fall
 * back to it rather than suggest nothing.
 */
const DOOR_TAG_RE = /^\d+[A-Za-z]$/;

/** Words within this fraction of sheet height count as the same text line (read L→R). */
const SAME_LINE_EPS = 0.01;

export interface RoomNameMatch {
  /**
   * The proposed `unit_number` — the room's name + space number as it reads on the
   * sheet (e.g. "417 WOMEN", "OFFICE 110"), door tags excluded, words joined in
   * reading order (top-to-bottom, then left-to-right).
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

/**
 * Match the interior text of a traced room to its name/number.
 *
 * Strategy (position/pattern only — no font size; see {@link DOOR_TAG_RE}):
 *   1. Keep the sheet words whose position falls INSIDE the polygon.
 *   2. Drop door tags ("105A") so they're not mistaken for the space number — the
 *      commercial wrinkle. If a room's ONLY interior text is door-tag-shaped, keep
 *      it (better a confirmable draft than nothing).
 *   3. Join the survivors in reading order → the candidate `unit_number`.
 *
 * Returns `null` when the polygon has no interior words at all (e.g. a scanned
 * sheet with no text layer, or a blank room) — the caller then leaves the popover
 * empty for a fully-manual name. Never throws.
 */
export function matchRoomName(
  polygon: PercentPoint[],
  words: TextWord[] | null | undefined,
): RoomNameMatch | null {
  if (!polygon || polygon.length < 3 || !words || words.length === 0) return null;

  const interior = words.filter((w) => isPointInPolygon({ pctX: w.pctX, pctY: w.pctY }, polygon));
  if (interior.length === 0) return null;

  // Exclude door tags; but if that leaves nothing, fall back to the raw interior
  // words so a door-tag-only room still gets a (confirmable) suggestion.
  const nonDoor = interior.filter((w) => !DOOR_TAG_RE.test(w.text.trim()));
  const candidates = (nonDoor.length > 0 ? nonDoor : interior).slice().sort(byReadingOrder);

  const unitNumber = candidates
    .map((w) => w.text.trim())
    .filter((t) => t.length > 0)
    .join(' ');
  if (!unitNumber) return null;

  return { unitNumber, words: candidates };
}

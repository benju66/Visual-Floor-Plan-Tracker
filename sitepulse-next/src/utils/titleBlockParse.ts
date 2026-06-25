/**
 * Sheet title-block parse — pure, framework-free heuristics (AI Tracing Assist —
 * Phase 3a). Given the box a user dragged over a sheet's title block and the
 * sheet's cached PDF text words, propose the **sheet number** ("A-201"), the
 * **sheet name** ("SECOND FLOOR PLAN"), and the **architect/firm** so the confirm
 * popover can pre-fill a first draft the human confirms or edits.
 *
 * Deterministic and side-effect-free (no DB, no `Date.now()`, no network) so the
 * field heuristics are unit-tested in isolation (AGENTS.md §9) — the same shape as
 * the Phase-2 `roomNameMatch`/`roomSuggestion` pair. The geometry (the box) is
 * still 100% human-drawn; only the field VALUES are assisted.
 *
 * `sheet_text` carries no font size (Phase 1 cached `get_text("words")` —
 * position only), so every heuristic here is position/pattern-based, never
 * size-based. Title-block LAYOUT varies by firm, which is exactly why this is a
 * human box-drag, not an auto-locate: we only parse the words the human framed.
 */
import type { TextWord, PercentRect, TitleBlockFields } from '@/types/domain';
import type { TraceSource } from '@/utils/traceCapture';

// PercentRect (the dragged box) and TitleBlockFields (the proposed number/name/
// firm) are owned by the central type registry (domain.ts) since they narrow the
// `sheet_metadata` JSONB columns. Re-exported here so existing importers and the
// co-located test keep their single import site.
export type { PercentRect, TitleBlockFields };

/**
 * `model_version` stamped on every title-block proposal — the "model" is this
 * deterministic parser, not an LLM. Bump it when the heuristics change materially
 * so old and new proposals stay distinguishable at training time (mirrors
 * `ROOM_TEXT_MODEL_VERSION`).
 */
export const TITLE_BLOCK_MODEL_VERSION = 'titleblock-parse-v1';

/** Words within this fraction of sheet height count as the same printed line. */
const LINE_EPS = 0.008;

/**
 * A sheet number: 1–3 letters, an optional separator, digits, an optional
 * `.N` minor, and an optional trailing letter — "A-201", "A201", "A-2.01",
 * "S-101", "M5.1", "G-001", "A-101A". Deliberately anchored so it never eats a
 * bare room number ("417") or a word ("PLAN"); the box scope limits the rest.
 */
const SHEET_NUMBER_RE = /^[A-Z]{1,3}[-.\s]?\d{1,3}(?:\.\d{1,2})?[A-Z]?$/;

/**
 * Keywords that mark a sheet-name line. "PLAN" is the common floor-plan case;
 * the rest cover the other discipline sheets a title block names.
 */
const SHEET_NAME_KEYWORDS = [
  'PLAN',
  'ELEVATION',
  'ELEVATIONS',
  'SECTION',
  'SECTIONS',
  'DETAIL',
  'DETAILS',
  'SCHEDULE',
  'SCHEDULES',
  'DIAGRAM',
  'DIAGRAMS',
  'LEGEND',
];

/**
 * Firm-suffix words: a line containing one of these is very likely the firm's
 * name block (the fallback when no copyright notice is present).
 */
const FIRM_SUFFIX_RE =
  /\b(architect|architects|architecture|engineers?|engineering|associates?|consultants?|designs?|design group|group|studio|partners(?:hip)?|llp|llc|inc|pllc|pc)\b/i;

/** A reconstructed printed line: words on one baseline, read left-to-right. */
interface TextLine {
  text: string;
  words: TextWord[];
  /** Mean pctY of the line (its baseline). */
  y: number;
  /** Mean pctX of the line. */
  x: number;
}

/**
 * Keep only the words whose position falls inside the dragged box, then group
 * them into printed lines (same baseline within {@link LINE_EPS}), each read
 * left-to-right. Lines are returned top-to-bottom.
 */
export function wordsToLines(words: TextWord[], box: PercentRect): TextLine[] {
  const inside = words.filter(
    (w) => w.pctX >= box.x0 && w.pctX <= box.x1 && w.pctY >= box.y0 && w.pctY <= box.y1,
  );
  if (inside.length === 0) return [];

  const sorted = inside.slice().sort((a, b) => a.pctY - b.pctY);
  const lines: TextWord[][] = [];
  for (const w of sorted) {
    const last = lines[lines.length - 1];
    const lastY = last ? last.reduce((s, x) => s + x.pctY, 0) / last.length : null;
    if (last && lastY !== null && Math.abs(w.pctY - lastY) <= LINE_EPS) {
      last.push(w);
    } else {
      lines.push([w]);
    }
  }

  return lines.map((lineWords) => {
    const ordered = lineWords.slice().sort((a, b) => a.pctX - b.pctX);
    return {
      words: ordered,
      text: ordered.map((w) => w.text.trim()).filter(Boolean).join(' '),
      y: ordered.reduce((s, w) => s + w.pctY, 0) / ordered.length,
      x: ordered.reduce((s, w) => s + w.pctX, 0) / ordered.length,
    };
  });
}

/**
 * Pick the sheet number: among tokens matching {@link SHEET_NUMBER_RE}, prefer
 * the one nearest the box's bottom-right corner — where title blocks print the
 * sheet number. Returns the token verbatim (uppercased, separators collapsed).
 */
function pickSheetNumber(words: TextWord[], box: PercentRect): string | null {
  const inside = words.filter(
    (w) => w.pctX >= box.x0 && w.pctX <= box.x1 && w.pctY >= box.y0 && w.pctY <= box.y1,
  );
  let best: { token: string; score: number } | null = null;
  for (const w of inside) {
    const token = w.text.trim().toUpperCase();
    if (!SHEET_NUMBER_RE.test(token)) continue;
    // Distance-to-bottom-right (smaller = better); bottom-right corner is (x1,y1).
    const score = (box.x1 - w.pctX) + (box.y1 - w.pctY);
    if (!best || score < best.score) best = { token, score };
  }
  return best ? best.token.replace(/\s+/g, '') : null;
}

/**
 * Pick the sheet name: the line carrying the strongest sheet-name keyword. If
 * that line is just the keyword (e.g. "PLAN" alone), prepend the line directly
 * above when it reads like a continuation (uppercase, not a sheet number) —
 * recovers "SECOND FLOOR" / "PLAN" split across two printed lines.
 */
function pickSheetName(lines: TextLine[]): string | null {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    const upper = lines[i].text.toUpperCase();
    if (SHEET_NAME_KEYWORDS.some((kw) => new RegExp(`\\b${kw}\\b`).test(upper))) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return null;

  let name = lines[idx].text.trim();
  if (lines[idx].words.length <= 1 && idx > 0) {
    const prev = lines[idx - 1].text.trim();
    const prevIsContinuation =
      prev.length > 0 &&
      prev === prev.toUpperCase() &&
      !SHEET_NUMBER_RE.test(prev.toUpperCase());
    if (prevIsContinuation) name = `${prev} ${name}`;
  }
  return name.replace(/\s+/g, ' ').trim() || null;
}

/**
 * Pick the architect/firm. The proprietary/copyright NOTICE reliably names the
 * firm (verified on LaSalle: "…written permission of RSP Architects…"), so parse
 * that first. Falls back to a line that ends in a firm-suffix word (e.g.
 * "RSP Architects") when there's no notice.
 */
function pickArchitectFirm(lines: TextLine[]): string | null {
  // 1) Copyright / proprietary notice → the words naming the firm. Run PER LINE
  //    (notices sit on their own printed line) so the capture never bleeds into
  //    the next line — e.g. the sheet number printed just below the notice.
  const noticeRes = [
    /(?:written\s+)?permission\s+of\s+(.+)/i,
    /property\s+of\s+(.+)/i,
    /(?:©|\(c\)|copyright)\s*\d{0,4}\s*(?:by\s+)?(.+)/i,
  ];
  for (const line of lines) {
    for (const re of noticeRes) {
      const m = line.text.match(re);
      if (m && m[1]) {
        const firm = cleanFirm(m[1]);
        if (firm) return firm;
      }
    }
  }

  // 2) Fallback: a line ending in a firm-suffix word.
  for (const line of lines) {
    if (FIRM_SUFFIX_RE.test(line.text) && line.text.trim().length >= 3) {
      const firm = cleanFirm(line.text);
      if (firm) return firm;
    }
  }
  return null;
}

/**
 * Trim a captured firm span to a sensible name: cut at the first boundary word
 * ("is prohibited", "shall", "and", commas/periods) and keep at most the firm
 * name + its suffix. Returns null if nothing meaningful survives.
 */
function cleanFirm(raw: string): string | null {
  let s = raw.trim();
  // Cut at a sentence/clause boundary or a legal continuation.
  s = s.split(/\s+(?:is|are|shall|may|will|without|for|and)\b/i)[0];
  s = s.split(/[.;,]/)[0];
  s = s.replace(/\s+/g, ' ').trim();
  // Drop a leading "the".
  s = s.replace(/^the\s+/i, '').trim();
  if (s.length < 2) return null;
  // Guard against capturing a whole sentence — keep it firm-name-length.
  const wordCount = s.split(' ').length;
  if (wordCount > 8) return null;
  return s;
}

/**
 * Parse a dragged title-block box into proposed fields. Pure: pass the sheet's
 * words + the box. Returns all-null fields when the box framed no useful text
 * (the caller then opens a blank popover for fully-manual entry). Never throws.
 */
export function parseTitleBlock(
  words: TextWord[] | null | undefined,
  box: PercentRect,
): TitleBlockFields {
  if (!words || words.length === 0) {
    return { sheetNumber: null, sheetName: null, architectFirm: null };
  }
  const lines = wordsToLines(words, box);
  return {
    sheetNumber: pickSheetNumber(words, box),
    sheetName: pickSheetName(lines),
    architectFirm: pickArchitectFirm(lines),
  };
}

/** Trim a field for comparison; null/undefined and "" are equivalent (→ ""). */
function normField(v: string | null | undefined): string {
  return (v ?? '').trim();
}

/**
 * Decide the `source` when title-block fields are SAVED, mirroring
 * `deriveSuggestionSource` for room names: `human` when there was no machine
 * proposal (fully manual entry), else `ai_accepted` when the human kept all three
 * fields exactly, else `ai_edited` (the high-value correction signal — any change
 * to number, name, or firm counts). The frozen `suggested_fields` preserves the
 * original either way, so the before/after delta is always recoverable.
 */
export function deriveTitleBlockSource(
  proposal: TitleBlockFields | null,
  final: TitleBlockFields,
): TraceSource {
  if (!proposal) return 'human';
  const same =
    normField(proposal.sheetNumber) === normField(final.sheetNumber) &&
    normField(proposal.sheetName) === normField(final.sheetName) &&
    normField(proposal.architectFirm) === normField(final.architectFirm);
  return same ? 'ai_accepted' : 'ai_edited';
}

/** Normalize a drag (any two opposite corners) into a top-left-anchored rect. */
export function normalizeRect(a: { pctX: number; pctY: number }, b: { pctX: number; pctY: number }): PercentRect {
  return {
    x0: Math.min(a.pctX, b.pctX),
    y0: Math.min(a.pctY, b.pctY),
    x1: Math.max(a.pctX, b.pctX),
    y1: Math.max(a.pctY, b.pctY),
  };
}

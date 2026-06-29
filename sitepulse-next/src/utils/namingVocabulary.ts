/**
 * Naming vocabulary — the learned frequency model behind Trace Naming & Type
 * Assist Phase 2 (levers C + D2). It turns the rooms you've ALREADY CONFIRMED
 * (their `unit_number` + `subtype_id`, company-wide) into two plain-JSON tables:
 *
 *   - `nameTokenCounts` — how often each alphabetic name word has appeared in a
 *     confirmed room name (lever C: a word seen as a real name is kept; a word
 *     never seen as a name is treated as learned noise and dropped).
 *   - `nameToSubtype` — for each name word, how often it was paired with each
 *     `subtype_id` (lever D2: when the dictionary/keyword guess can't pre-select a
 *     type, propose the sub-type this name most often goes with in your history).
 *
 * Pure + deterministic (no DB, no React, no `Date.now()`), so the load-bearing
 * correctness lives in co-located unit tests (AGENTS.md §9). CRITICAL: the model is
 * PLAIN JSON (`Record<string, …>`, never a `Map`/`Set`/class instance) because it
 * flows through the TanStack Query cache → IndexedDB and must survive
 * `JSON.parse(JSON.stringify(model))` intact (AGENTS.md §6).
 */

/**
 * The learned naming model. Both fields are plain objects keyed by NORMALIZED name
 * tokens (lower-cased, surrounding punctuation stripped — see {@link normalizeNameToken}).
 * Never a `Map`/`Set` — see file header.
 */
export interface NamingVocabulary {
  /** normalized name token → number of confirmed rooms whose name contained it. */
  nameTokenCounts: Record<string, number>;
  /** normalized name token → (`subtype_id` → times that pairing was confirmed). */
  nameToSubtype: Record<string, Record<string, number>>;
}

/** A frozen, shareable empty model — the "no learning" degradation target. */
export const EMPTY_VOCABULARY: NamingVocabulary = Object.freeze({
  nameTokenCounts: Object.freeze({}) as Record<string, number>,
  nameToSubtype: Object.freeze({}) as Record<string, Record<string, number>>,
});

/** The minimal confirmed-room shape the model is built from (a narrowed `units` row). */
export interface ConfirmedRoom {
  unit_number: string | null;
  subtype_id: string | null;
}

/**
 * Normalize one raw token to its vocabulary key: lower-case, then strip leading and
 * trailing non-alphanumerics (so "(OFFICE)", "OFFICE," and "office" all collapse to
 * "office") while preserving INTERNAL marks ("WOMEN'S" → "women's"). Returns `''`
 * for a token with no alphanumeric content. The matcher and the builder MUST share
 * this so their keys agree.
 */
export function normalizeNameToken(raw: string): string {
  return raw.toLowerCase().replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9]+$/, '');
}

/**
 * True when a normalized token is a NAME WORD (eligible for the seen/never-seen
 * learning) rather than a room number or alphanumeric designator: it has at least
 * one letter and NO digit. This deliberately excludes "110" (a room number) and
 * "5B" (a unit designator) — under the "Name + Number" convention those are the
 * number half and must never be scrubbed as noise.
 */
export function isNameToken(normalized: string): boolean {
  return normalized.length > 0 && /[a-z]/.test(normalized) && !/[0-9]/.test(normalized);
}

/**
 * Extract the NORMALIZED name tokens from a room name (split on whitespace, normalize,
 * keep only {@link isNameToken} words). E.g. "OFFICE 110" → ["office"], "417 WOMEN'S"
 * → ["women's"]. Numbers and designators are dropped — they carry no name signal.
 */
export function nameTokensOf(name: string | null | undefined): string[] {
  if (!name) return [];
  const out: string[] = [];
  for (const raw of name.split(/\s+/)) {
    const tok = normalizeNameToken(raw);
    if (isNameToken(tok)) out.push(tok);
  }
  return out;
}

/**
 * Build the {@link NamingVocabulary} from confirmed rooms. Pass the rooms IN (no DB):
 * every named room feeds `nameTokenCounts`; rooms that also carry a `subtype_id`
 * additionally feed `nameToSubtype`. Tolerates empty/garbage input (missing fields,
 * non-strings) → an empty-but-valid model; never throws. The result is always plain
 * JSON (no `Map`/`Set`) so it is safe for the TanStack cache (AGENTS.md §6).
 */
export function buildNamingVocabulary(
  rooms: ReadonlyArray<ConfirmedRoom> | null | undefined,
): NamingVocabulary {
  const nameTokenCounts: Record<string, number> = {};
  const nameToSubtype: Record<string, Record<string, number>> = {};
  if (!Array.isArray(rooms)) return { nameTokenCounts, nameToSubtype };

  for (const room of rooms) {
    if (!room || typeof room !== 'object') continue;
    const name = typeof room.unit_number === 'string' ? room.unit_number : null;
    const tokens = nameTokensOf(name);
    if (tokens.length === 0) continue;

    const subtypeId = typeof room.subtype_id === 'string' && room.subtype_id ? room.subtype_id : null;
    for (const token of tokens) {
      nameTokenCounts[token] = (nameTokenCounts[token] ?? 0) + 1;
      if (subtypeId) {
        const bySubtype = (nameToSubtype[token] ??= {});
        bySubtype[subtypeId] = (bySubtype[subtypeId] ?? 0) + 1;
      }
    }
  }

  return { nameTokenCounts, nameToSubtype };
}

/**
 * Lever D2: from a candidate room name, propose the `subtype_id` most frequently
 * paired with that name in confirmed history. Aggregates the pairing counts across
 * every name token in the candidate, then returns the single highest-count
 * `subtype_id` (ties broken by lexically-smallest id, so the result is deterministic
 * regardless of object key order). Returns `null` when no name token has any learned
 * pairing (or the vocabulary is empty) — the caller then leaves the type unguessed.
 *
 * Pure: it returns a raw `subtype_id`; the caller resolves it to a LIVE active
 * dictionary row (mirroring how the keyword seed is resolved) and never pre-selects
 * a sub-type that no longer exists.
 */
export function subtypeIdFromVocabulary(
  vocabulary: NamingVocabulary | null | undefined,
  name: string | null | undefined,
): string | null {
  if (!vocabulary) return null;
  const totals: Record<string, number> = {};
  for (const token of nameTokensOf(name)) {
    const bySubtype = vocabulary.nameToSubtype[token];
    if (!bySubtype) continue;
    for (const [subtypeId, count] of Object.entries(bySubtype)) {
      totals[subtypeId] = (totals[subtypeId] ?? 0) + count;
    }
  }

  let bestId: string | null = null;
  let bestCount = 0;
  for (const [subtypeId, count] of Object.entries(totals)) {
    if (count > bestCount || (count === bestCount && (bestId === null || subtypeId < bestId))) {
      bestCount = count;
      bestId = subtypeId;
    }
  }
  return bestId;
}

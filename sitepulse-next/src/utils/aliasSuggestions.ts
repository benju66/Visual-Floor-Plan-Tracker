/**
 * Alias suggestions — close the loop between the learned naming vocabulary and the
 * GOVERNED dictionary (Trace Naming & Type Assist — "smarter naming" follow-up, Item 4).
 *
 * Lever D2 already learns, statistically, which name word goes with which sub-type from
 * the rooms you've confirmed. This turns a STRONG, repeated pairing into a concrete
 * proposal — "you've named 7 rooms 'Unit' and typed them all 'Dwelling Unit'; add 'Unit'
 * as an alias?" — so a one-click accept promotes the learned guess into an explicit,
 * shareable, owner-governed alias (`subtypes.aliases`). After that, every future trace
 * resolves it via lever D1 (the dictionary) instead of relying on learning.
 *
 * Pure + deterministic (no DB, no React) — unit-tested in isolation (AGENTS.md §9). It
 * only PROPOSES; accepting writes through the existing `useAddSubtypeAlias` mutation
 * (RLS-gated to owner/admin/pm).
 */
import { isNameToken, type NamingVocabulary } from '@/utils/namingVocabulary';
import { matchSubtypeForName } from '@/utils/subtypes';
import { toTitleCaseName } from '@/utils/workbenchNaming';
import { ACRONYM_KEEP } from '@/utils/roomAbbreviations';
import type { Subtype } from '@/types/domain';

/** A proposed "add this alias to this sub-type" the admin can accept or dismiss. */
export interface AliasCandidate {
  /** The normalized name token the pairing is keyed on (e.g. "unit"). */
  token: string;
  /** The display/alias string we'd store (e.g. "Unit"; "MDF" stays uppercase). */
  alias: string;
  /** The live, ACTIVE sub-type this token reliably means. */
  subtypeId: string;
  subtypeName: string;
  /** Confirmed rooms backing the dominant pairing (the "seen N×" count). */
  support: number;
  /** Confirmed rooms whose name contained the token at all (denominator for the share). */
  total: number;
  /** Stable key for dismiss bookkeeping: `${subtypeId}::${token}`. */
  key: string;
}

export interface AliasSuggestionOptions {
  /** Minimum confirmed rooms backing the pairing before it's proposed (default 3). */
  minSupport?: number;
  /** Minimum share of the token's uses that must go to the dominant type (default 0.6). */
  minShare?: number;
}

/**
 * Derive alias proposals from the learned {@link NamingVocabulary} against the live
 * dictionary. A token is proposed as an alias of sub-type S when:
 *   - it's a real NAME word (not a number/designator — {@link isNameToken});
 *   - S is its DOMINANT learned pairing with enough support + a clear majority share
 *     (so a one-off mistake never becomes a proposal);
 *   - S is a live, ACTIVE dictionary row;
 *   - the dictionary does NOT already reach the token (lever D1 returns nothing for it),
 *     i.e. it's neither the canonical name nor an existing alias of anything — so we only
 *     ever propose genuinely NEW knowledge, never a duplicate or a conflicting re-point.
 *
 * Sorted strongest-support first (ties broken by token, for deterministic output).
 * Returns `[]` for an empty/absent vocabulary. Pure.
 */
export function suggestAliasCandidates(
  vocabulary: NamingVocabulary | null | undefined,
  subtypes: Subtype[],
  options: AliasSuggestionOptions = {},
): AliasCandidate[] {
  const minSupport = options.minSupport ?? 3;
  const minShare = options.minShare ?? 0.6;
  if (!vocabulary) return [];

  const active = subtypes.filter((s) => s.status === 'active');
  const byId = new Map(active.map((s) => [s.id, s]));

  const out: AliasCandidate[] = [];
  for (const [token, bySubtype] of Object.entries(vocabulary.nameToSubtype)) {
    if (!isNameToken(token)) continue;

    // Dominant learned sub-type for this token (ties → lexically-smallest id, so the
    // result is deterministic regardless of object key order — mirrors D2).
    let bestId: string | null = null;
    let bestCount = 0;
    let total = 0;
    for (const [subtypeId, count] of Object.entries(bySubtype)) {
      total += count;
      if (count > bestCount || (count === bestCount && (bestId === null || subtypeId < bestId))) {
        bestCount = count;
        bestId = subtypeId;
      }
    }
    if (!bestId || bestCount < minSupport || bestCount / total < minShare) continue;

    const subtype = byId.get(bestId);
    if (!subtype) continue; // learned pairing points at a removed/retired type — skip

    // Only propose NEW knowledge: skip anything the dictionary already resolves (an
    // existing name/alias, or a different-but-matching term). Avoids duplicates and
    // never re-points a token the dictionary already maps elsewhere.
    if (matchSubtypeForName(active, token)) continue;

    out.push({
      token,
      alias: toTitleCaseName(token, ACRONYM_KEEP),
      subtypeId: subtype.id,
      subtypeName: subtype.name,
      support: bestCount,
      total,
      key: `${subtype.id}::${token}`,
    });
  }

  out.sort((a, b) => b.support - a.support || a.token.localeCompare(b.token));
  return out;
}

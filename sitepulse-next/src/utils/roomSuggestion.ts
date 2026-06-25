/**
 * Room-name auto-fill — the proposal ⇄ provenance mapping (AI Tracing Assist —
 * Phase 2). Bridges the pure name/taxonomy match ({@link matchRoomName} +
 * {@link suggestTaxonomyFromText}) and the Milestone-1 capture path
 * (`useCreateWorkbenchLabel`): it freezes the ORIGINAL machine proposal, decides
 * whether the human accepted it unchanged or edited it, and shapes the frozen
 * `suggestedLabel` snapshot banked on the `units` row.
 *
 * Pure + deterministic (no DB, no React, no `Date.now()`), so the load-bearing
 * "accept → ai_accepted/ai_edited with a frozen suggestion" invariant is unit-tested
 * in isolation (AGENTS.md §9). The GEOMETRY is always hand-traced, so `method` stays
 * `'manual'`; the assist lives entirely in `source` on the NAME (kickoff Decisions).
 */
import { matchRoomName } from '@/utils/roomNameMatch';
import { suggestTaxonomyFromText } from '@/utils/locationTaxonomy';
import { normalizeLocationName } from '@/utils/workbenchNaming';
import type { LabelSnapshot, TraceSource } from '@/utils/traceCapture';
import type { TaxonomyResult } from '@/utils/subtypes';
import type { PercentPoint, Subtype, TextWord, TopLevelRole } from '@/types/domain';

/**
 * `model_version` stamped on every text-prefill suggestion. The "model" here is the
 * deterministic keyword/position matcher, not an LLM — bump it when the matching
 * logic changes materially so old and new suggestions stay distinguishable at
 * training time (mirrors `spec_version` for the annotation rulebook).
 */
export const ROOM_TEXT_MODEL_VERSION = 'text-prefill-v1';

/**
 * The FROZEN original machine proposal for a freshly-traced room. Stored in
 * `useWorkbenchStore` the moment a polygon closes and never mutated as the human
 * edits the live draft — the suggested-vs-final delta is the whole training signal
 * and cannot be reconstructed later (ANNOTATION_SPEC §4).
 */
export interface RoomSuggestion {
  /** Suggested `unit_number` from the sheet text (null = no name found). */
  unitNumber: string | null;
  /** Suggested canonical role (null = no type suggestion). */
  role: TopLevelRole | null;
  /** Resolved dictionary `subtype_id` (null = role-only or no type suggestion). */
  subtypeId: string | null;
  /** Canonical sub-type name behind {@link subtypeId} (kept for the frozen snapshot). */
  subtypeName: string | null;
}

/**
 * Build the room suggestion for a just-closed polygon: point-in-polygon name match
 * + free keyword taxonomy, resolving the suggested seed sub-type name to a LIVE
 * dictionary `subtype_id`. Returns `null` when neither a name nor a type could be
 * suggested (e.g. a scanned sheet, a blank room) — the caller then leaves the
 * popover empty for a fully-manual label (no reject signal, no provenance).
 *
 * Pure: pass the sheet words + the loaded sub-type dictionary in.
 */
export function buildRoomSuggestion(
  polygon: PercentPoint[],
  words: TextWord[] | null | undefined,
  subtypes: Subtype[],
): RoomSuggestion | null {
  const nameMatch = matchRoomName(polygon, words);
  const unitNumber = nameMatch?.unitNumber ?? null;

  const taxo = suggestTaxonomyFromText(unitNumber);
  let role: TopLevelRole | null = null;
  let subtypeId: string | null = null;
  let subtypeName: string | null = null;
  if (taxo) {
    role = taxo.role;
    // Resolve the seed name to a selectable (active) dictionary row. If the seed
    // isn't present, keep role + name for the frozen record but DON'T pre-select a
    // type (see suggestionToPick) — we never auto-propose a new dictionary entry.
    const dict = subtypes.find((s) => s.status === 'active' && s.name === taxo.subtypeName);
    subtypeName = dict ? dict.name : taxo.subtypeName;
    subtypeId = dict ? dict.id : null;
  }

  if (!unitNumber && !role) return null;
  return { unitNumber, role, subtypeId, subtypeName };
}

/**
 * The popover's initial taxonomy selection for a suggestion — only a fully-resolved
 * dictionary sub-type is pre-selected. A role-only (unresolved) suggestion returns
 * `null` so we never auto-propose an "Other (pending)" entry the user didn't ask for.
 */
export function suggestionToPick(s: RoomSuggestion): TaxonomyResult | null {
  if (s.subtypeId && s.role && s.subtypeName) {
    return { kind: 'subtype', subtypeId: s.subtypeId, name: s.subtypeName, role: s.role };
  }
  return null;
}

/**
 * The frozen `suggestedLabel` snapshot banked on the `units` row — the ORIGINAL
 * proposal, never the edited live value (ANNOTATION_SPEC §4). The two-level / void
 * flags are never machine-suggested, so they freeze to their defaults.
 */
export function suggestedLabelFromSuggestion(s: RoomSuggestion): LabelSnapshot {
  return {
    unit_number: s.unitNumber ?? null,
    unit_type: s.subtypeName ?? null,
    top_level_role: s.role ?? null,
    subtype_id: s.subtypeId ?? null,
    spans_levels: false,
    level_note: null,
    has_void: false,
  };
}

/**
 * Decide the final `source` when a suggested label is SAVED: `ai_accepted` when the
 * human kept BOTH the suggested name and type exactly, else `ai_edited` (the
 * highest-value correction signal — any change to the name or the type counts). The
 * frozen `suggestedLabel` preserves the original either way, so the before/after
 * delta is always recoverable.
 *
 * Names are compared in normalized form (trim + collapse spaces, standard §4) so a
 * whitespace-only difference still reads as "accepted unchanged".
 */
export function deriveSuggestionSource(
  original: RoomSuggestion,
  finalName: string,
  finalPick: TaxonomyResult,
): TraceSource {
  const nameSame =
    normalizeLocationName(original.unitNumber ?? '') === normalizeLocationName(finalName);
  const finalSubtypeId = finalPick.kind === 'subtype' ? finalPick.subtypeId : null;
  const typeSame =
    (original.subtypeId ?? null) === finalSubtypeId && (original.role ?? null) === finalPick.role;
  return nameSame && typeSame ? 'ai_accepted' : 'ai_edited';
}

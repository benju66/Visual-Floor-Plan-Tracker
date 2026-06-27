/**
 * Opening review helpers — pure, framework-free (AI Tracing Assist — Phase 4c).
 *
 * The review screen is where a workbench drawing is certified as clean training
 * data. This module bridges the banked `Unit` rows to the Phase-4b reconciliation
 * engine and answers the two product questions the review DoD asks:
 *   1. Are there any UNRESOLVED flagged openings? (a door/cased-opening type
 *      conflict, or an ambiguous cross-wall match) — the human must fix the raw
 *      tags until nothing is flagged. We recompute live from the current tags, so
 *      there is no per-flag "acknowledged" state to persist (recompute-live).
 *   2. Is this sheet EXPORT-eligible? — `reviewed` AND `fully_traced` AND no flagged
 *      openings. There is no training-export pipeline in the repo yet, so
 *      {@link isExportEligible} is the forward-looking single source of truth the
 *      eventual corpus export will call (it is captured + tested now, not wired).
 *
 * Everything here is deterministic and side-effect-free (no DB, no `Date.now()`),
 * so it is unit-tested in isolation (AGENTS.md §9). It owns ONLY the trivial
 * `Unit[] → ReconcileUnit[]` adapter + summarization; the cross-wall matching logic
 * lives in `openingReconcile.ts` and is never duplicated here.
 */
import { reconcileOpenings, type ReconcileUnit } from '@/utils/openingReconcile';
import { narrowReviewState } from '@/utils/workbench';
import type { PercentPoint, Unit, WorkbenchDrawing } from '@/types/domain';

/**
 * Adapt banked workbench labels to the reconciliation input shape (`{ id, polygon,
 * openingEdges }`). Rooms without a usable polygon (null / fewer than 3 vertices)
 * are skipped — they cannot contribute an opening edge — so a half-saved label can
 * never crash reconciliation. Pure; never mutates its input.
 */
export function toReconcileUnits(units: readonly Unit[]): ReconcileUnit[] {
  const out: ReconcileUnit[] = [];
  for (const u of units) {
    const polygon = u.polygon_coordinates;
    if (!polygon || polygon.length < 3) continue;
    out.push({ id: u.id, polygon: polygon as PercentPoint[], openingEdges: u.opening_edges ?? [] });
  }
  return out;
}

/** A live summary of the reconciliation flags blocking a sheet's sign-off. */
export interface FlaggedOpeningSummary {
  /** How many canonical openings are still flagged for a human to resolve. */
  count: number;
  /** Short human reason (e.g. "1 type conflict", "2 ambiguous matches"); null when none. */
  detail: string | null;
}

/** Pluralize "n thing" / "n things" with an explicit plural form (English presentation only). */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Recompute reconciliation from the rooms' CURRENT opening tags and summarize the
 * unresolved flags (type conflicts + ambiguous cross-wall matches). A human resolves
 * a flag by editing the underlying tags (Phase 4a edit-after) until `count` is zero;
 * there is no stored "acknowledged" state. Pure + deterministic.
 */
export function summarizeFlaggedOpenings(units: readonly Unit[]): FlaggedOpeningSummary {
  const { openings } = reconcileOpenings(toReconcileUnits(units));
  const flagged = openings.filter((o) => o.flagged);
  if (flagged.length === 0) return { count: 0, detail: null };

  const conflicts = flagged.filter((o) => o.flagReason === 'type_conflict').length;
  const ambiguous = flagged.filter((o) => o.flagReason === 'ambiguous_match').length;
  const parts: string[] = [];
  if (conflicts > 0) parts.push(plural(conflicts, 'type conflict', 'type conflicts'));
  if (ambiguous > 0) parts.push(plural(ambiguous, 'ambiguous match', 'ambiguous matches'));
  return { count: flagged.length, detail: parts.join(', ') || plural(flagged.length, 'flagged opening', 'flagged openings') };
}

/**
 * Whether a workbench drawing is eligible for the (future) training-corpus export —
 * the single source of truth the eventual export pipeline will call. A sheet exports
 * ONLY when ALL hold:
 *   • it is `reviewed` (passed the full Definition-of-Done sign-off),
 *   • its reviewer declared it `fully_traced` (every room AND every floor passage is
 *     traced — a clean, exhaustively-labeled example), and
 *   • reconciliation flags NOTHING (no unresolved type conflict / ambiguous match).
 * A partial / product-use sheet stays `fully_traced = false` and is excluded, so
 * normal team usage never poisons the corpus. Pure; no I/O. (No export pipeline
 * exists yet — this captures the rule so there is one tested place to enforce it.)
 */
export function isExportEligible(drawing: WorkbenchDrawing, units: readonly Unit[]): boolean {
  const reviewed = narrowReviewState(drawing.workbench?.review_state) === 'reviewed';
  const fullyTraced = drawing.workbench?.fully_traced === true;
  if (!reviewed || !fullyTraced) return false;
  return summarizeFlaggedOpenings(units).count === 0;
}

import type { Activity, TemporalState, Unit } from '@/types/domain';
import {
  hasSequenceGaps,
  nextApplicableIndex,
  type ApplicabilityIndex,
} from '@/utils/applicability';

/**
 * Auto-advance decision core (Status Sequencing & Data-Integrity Fix, Phase 1).
 *
 * When a user completes an activity, the app tees up the NEXT activity in the
 * track as `planned` ("auto-advance"). The pre-fix code did this unconditionally,
 * so completing an earlier activity would overwrite a later activity that was
 * already completed/ongoing — and because the status RPC rewrites every column
 * from its payload, it also wiped that activity's logged_date / actual_start_date.
 *
 * This is the framework-free, deterministic rule both the single-write and (later)
 * bulk paths share, so the never-downgrade guarantee is pinned by unit tests rather
 * than buried in a hook. It NEVER reads the clock or the cache — the caller passes
 * the unit's per-slot state in via `stateOf`.
 *
 * The owner's locked rule (2026-07-10): auto-advance sets the next slot to `planned`
 * ONLY if that slot is currently `none` (Not Started). If it is already
 * `planned` / `ongoing` / `completed`, auto-advance does nothing to it — it does NOT
 * skip ahead to a later Not-Started slot. Simplest, most predictable: it never undoes
 * saved work.
 */

/** The next activity to tee up as `planned`, or null when auto-advance must not fire. */
export interface AutoAdvanceTarget {
  activityId: string;
  activityName: string;
  color: string;
  track: string;
}

/**
 * The minimal Activity shape the decision needs. Keeping it a `Pick` lets the tests
 * (and the future bulk caller) build lightweight fixtures instead of full rows.
 */
export type TrackActivity = Pick<Activity, 'id' | 'name' | 'color' | 'track'>;

export interface PlanAutoAdvanceArgs {
  /** This track's activities, ALREADY sorted by sequence_order ascending. */
  orderedTrackActivities: TrackActivity[];
  unit: Pick<Unit, 'id' | 'unit_type'>;
  /** Index of the just-completed activity within `orderedTrackActivities` (-1 if not found). */
  completedIndex: number;
  applicabilityIndex: ApplicabilityIndex;
  /**
   * The unit's current temporal_state for the activity at `orderedTrackActivities[i]`.
   * State is passed IN (no cache / Date access here) so the rule stays deterministic
   * and testable. Absent / unknown slots MUST resolve to 'none'.
   */
  stateOf: (activityIndex: number) => TemporalState;
}

/**
 * Decide whether — and where — auto-advance should tee up the next activity.
 * Returns the target activity, or null to write nothing.
 */
export function planAutoAdvance({
  orderedTrackActivities,
  unit,
  completedIndex,
  applicabilityIndex,
  stateOf,
}: PlanAutoAdvanceArgs): AutoAdvanceTarget | null {
  // (1) The just-completed activity isn't in this track — nothing to advance from.
  if (completedIndex < 0) return null;

  // (2) Defensive: never auto-advance over an incomplete APPLICABLE prior activity
  //     (a real sequence gap). Skipped when completedIndex === 0 — there are no
  //     priors — which matches the pre-fix behavior. Reuses hasSequenceGaps, bridging
  //     its name-keyed getLog to our index-keyed stateOf.
  const hasGaps =
    completedIndex > 0 &&
    hasSequenceGaps(
      orderedTrackActivities,
      unit,
      completedIndex,
      applicabilityIndex,
      (name) => {
        const i = orderedTrackActivities.findIndex(a => a.name === name);
        return i === -1 ? undefined : { temporal_state: stateOf(i) };
      },
    );
  if (hasGaps) return null;

  // (3) Walk PAST inapplicable (N/A) activities — never land auto-advance on one.
  const nextIndex = nextApplicableIndex(orderedTrackActivities, unit, completedIndex, applicabilityIndex);
  if (nextIndex === -1) return null;

  // (4) NEVER DOWNGRADE (the owner's locked rule): only tee up a slot that hasn't
  //     been started. If the next slot already has any progress, do nothing — and do
  //     NOT skip ahead to a later Not-Started slot.
  if (stateOf(nextIndex) !== 'none') return null;

  // (5) Genuinely-new advance: return the target for the caller to write as `planned`.
  const next = orderedTrackActivities[nextIndex];
  return {
    activityId: next.id,
    activityName: next.name,
    color: next.color,
    track: next.track,
  };
}

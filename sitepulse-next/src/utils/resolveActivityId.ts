import type { Activity } from '@/types/domain';

/** The minimum an activity-like value needs to be resolved to a writable id. */
export interface ActivityIdentity {
  id?: string | null;
  name?: string | null;
  track?: string | null;
}

/**
 * Resolve the `activity_id` for a `status_logs` write.
 *
 * `status_logs.activity_id` is NOT NULL (it is the slot key — Scheduling Slice A,
 * `20260701_activity_model.sql`), but several client paths carry only an activity
 * *name*, not its id:
 *  - the mobile swipe-deck quick paths (swipe-right + the PLN/ONG/✓ buttons) stage a
 *    pending change from the card's current log without attaching a full Activity;
 *  - synthetic "bottleneck" placeholders (`src/utils/bottleneck.ts`) carry a name +
 *    color but **no id**, standing in for a location whose current activity was never
 *    logged.
 *
 * Precedence: an explicit id wins; else match by name **and** track (the project can
 * reuse an activity name across tracks); else fall back to name only. Returns `null`
 * when the activity can't be found, so the caller can fail loudly with a clear message
 * instead of writing NULL and surfacing a raw Postgres NOT-NULL constraint error.
 */
export function resolveActivityId(
  activity: ActivityIdentity,
  activities: ReadonlyArray<Pick<Activity, 'id' | 'name' | 'track'>>,
): string | null {
  if (activity.id) return activity.id;
  const name = activity.name;
  if (!name) return null;
  const byNameAndTrack = activities.find((a) => a.name === name && a.track === activity.track);
  if (byNameAndTrack) return byNameAndTrack.id;
  return activities.find((a) => a.name === name)?.id ?? null;
}

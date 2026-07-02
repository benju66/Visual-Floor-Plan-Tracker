/**
 * activityReadiness — pure "make-ready" logic over the light Finish-to-Start
 * dependency graph (Scheduling Analytics Slice B, Phase 4).
 *
 * Turns the dependency EDGES (authored in Slice A Phase 3b) into BEHAVIOR:
 * for a given location × activity slot, is it ready to work, blocked on an
 * incomplete predecessor, or already done? And per location: what's the
 * make-ready state of its bottleneck (the earliest incomplete activity).
 *
 * Framework-free and deterministic — no DB, no React, no `Date.now()`. COARSE
 * by design: it reads the FS edge graph + completion state only. No
 * critical-path / float / resource-leveling math lives here (out of scope, same
 * as `activityDependencies.ts`).
 *
 * Applicability (N/A) is respected exactly like the rest of the app (AGENTS.md
 * §3): a slot that is not applicable to a location is neither ready nor blocked
 * (`na`), and an N/A predecessor can never block — it will never complete, so
 * treating it as a blocker would deadlock the slot forever.
 */
import type { Activity, ActivityDependency } from '@/types/domain';

/** Slot key shared with the completion / applicability sets: `${unitId}_${activityId}`. */
export const slotKey = (unitId: string, activityId: string): string => `${unitId}_${activityId}`;

export type ReadinessStatus = 'ready' | 'blocked' | 'done' | 'na';

export interface ReadinessResult {
  status: ReadinessStatus;
  /** Predecessor activity ids that are applicable + not yet complete (only when blocked). */
  blockedBy: string[];
}

/**
 * Readiness of a single (location × activity) slot.
 *
 * @param completed   set of completed slot keys (`slotKey(unitId, activityId)`).
 * @param applicable  optional set of APPLICABLE slot keys. When omitted, every
 *                    slot is treated as applicable. When provided, a slot not in
 *                    the set is `na`, and N/A predecessors are ignored (they can
 *                    never complete, so they must not block).
 */
export function readinessFor(
  unitId: string,
  activityId: string,
  deps: ActivityDependency[],
  completed: ReadonlySet<string>,
  applicable?: ReadonlySet<string>,
): ReadinessResult {
  const self = slotKey(unitId, activityId);
  if (applicable && !applicable.has(self)) return { status: 'na', blockedBy: [] };
  if (completed.has(self)) return { status: 'done', blockedBy: [] };

  const blockedBy: string[] = [];
  for (const d of deps) {
    if (d.successor_activity_id !== activityId) continue;
    const predId = d.predecessor_activity_id;
    const predSlot = slotKey(unitId, predId);
    // An N/A predecessor can never complete → it cannot block this slot.
    if (applicable && !applicable.has(predSlot)) continue;
    if (!completed.has(predSlot)) blockedBy.push(predId);
  }
  return blockedBy.length > 0 ? { status: 'blocked', blockedBy } : { status: 'ready', blockedBy: [] };
}

export type MakeReadyKind = 'complete' | 'ready' | 'blocked' | 'none';

export interface MakeReadyInfo {
  kind: MakeReadyKind;
  /** The bottleneck (earliest incomplete applicable) activity, or null when complete/none. */
  bottleneckActivityId: string | null;
  bottleneckName: string | null;
  /** Blocking predecessor activity ids (blocked only). */
  blockedBy: string[];
}

/**
 * Make-ready state of a LOCATION, based on its bottleneck — the earliest
 * incomplete activity in sequence order (the same bottleneck notion
 * `progressAnalytics.computeUnitVariance` uses). Ready when that bottleneck can
 * be worked now; blocked when it waits on an incomplete predecessor.
 *
 * @param orderedActivities the location's APPLICABLE activities for one track,
 *   already sequence-ordered (callers pass `applicableActivities(orderedTrack…)`).
 */
export function unitMakeReady(
  unitId: string,
  orderedActivities: Pick<Activity, 'id' | 'name'>[],
  deps: ActivityDependency[],
  completed: ReadonlySet<string>,
  applicable?: ReadonlySet<string>,
): MakeReadyInfo {
  if (orderedActivities.length === 0) {
    return { kind: 'none', bottleneckActivityId: null, bottleneckName: null, blockedBy: [] };
  }
  let bottleneck: Pick<Activity, 'id' | 'name'> | null = null;
  for (const a of orderedActivities) {
    if (!completed.has(slotKey(unitId, a.id))) { bottleneck = a; break; }
  }
  if (!bottleneck) {
    return { kind: 'complete', bottleneckActivityId: null, bottleneckName: null, blockedBy: [] };
  }
  const r = readinessFor(unitId, bottleneck.id, deps, completed, applicable);
  // The bottleneck is drawn from the applicable, not-completed list, so `r.status`
  // is 'ready' or 'blocked' here (never 'done'/'na').
  const kind: MakeReadyKind = r.status === 'blocked' ? 'blocked' : 'ready';
  return { kind, bottleneckActivityId: bottleneck.id, bottleneckName: bottleneck.name, blockedBy: r.blockedBy };
}

// ---------------------------------------------------------------------------
// Make-ready → color / label (single source of truth for the make-ready encoding)
// ---------------------------------------------------------------------------

export const MAKE_READY_COLORS = {
  ready: '#22c55e',    // green-500  · can start now
  blocked: '#ef4444',  // red-500    · waiting on a predecessor
  complete: '#94a3b8', // slate-400  · done
  none: '#e2e8f0',     // slate-200  · no activities to work
} as const;

export function makeReadyFill(info: MakeReadyInfo): string {
  return MAKE_READY_COLORS[info.kind];
}

export function makeReadyLabel(info: MakeReadyInfo, nameById?: Map<string, string>): string {
  switch (info.kind) {
    case 'complete': return 'Complete';
    case 'none': return 'No activities';
    case 'ready': return info.bottleneckName ? `Ready: ${info.bottleneckName}` : 'Ready to start';
    case 'blocked': {
      const names = info.blockedBy.map((id) => nameById?.get(id)).filter(Boolean) as string[];
      const on = names.length > 0 ? ` on ${names.join(', ')}` : '';
      return info.bottleneckName ? `${info.bottleneckName} blocked${on}` : `Blocked${on}`;
    }
  }
}

/** Fixed legend entries for the map's Make-Ready mode. */
export const MAKE_READY_LEGEND: { label: string; color: string }[] = [
  { label: 'Ready to start', color: MAKE_READY_COLORS.ready },
  { label: 'Blocked (waiting)', color: MAKE_READY_COLORS.blocked },
  { label: 'Complete', color: MAKE_READY_COLORS.complete },
  { label: 'No activities', color: MAKE_READY_COLORS.none },
];

// Pure reconciliation logic for the MS Project import (Scheduling Foundation
// Slice A, Phase 4): match imported MSPDI tasks to the project's activities,
// suggest a target level from the task's summary chain, and subdivide a coarse
// task date window into per-location planned windows.
//
// Framework-free and deterministic — no DB, no React, no `Date.now()`; callers
// pass everything in. The bulk write itself goes through the ESTABLISHED path
// (`useBulkInsertStatusLogs`, an upsert on `unit_id,activity_id` — never plain
// `.insert()`): this module only BUILDS the `StatusLogInsert[]`, mirroring
// `cascadeLevelToLocations` in `ganttMath.ts` (non-destructive by default,
// N/A slots skipped, prior progress fields preserved).

import type { ActivityDictionaryEntry, Milestone, StatusLog, StatusLogInsert, Unit } from '@/types/domain';
import { resolveActivityByName } from '@/utils/activityDictionary';
import { addDays, toDayString } from '@/utils/ganttMath';
import { dayDiff, parseDay } from '@/utils/progressAnalytics';
import {
  isMilestoneApplicable,
  EMPTY_APPLICABILITY_INDEX,
  type ApplicabilityIndex,
} from '@/utils/applicability';
import type { MspTask } from '@/utils/mspImport';

/** The activity fields reconciliation needs (a project `activities` row subset). */
export type ReconcileActivity = Pick<Milestone, 'id' | 'name' | 'track' | 'color' | 'dictionary_id'>;

type StatusLike = Pick<
  StatusLog,
  'unit_id' | 'activity_id' | 'planned_start_date' | 'planned_end_date' | 'temporal_state' | 'logged_date' | 'status_color'
>;

export type TargetUnit = Pick<Unit, 'id' | 'unit_number' | 'unit_type' | 'computed_area' | 'walk_sequence'>;

// ---------------------------------------------------------------------------
// Task → activity matching (exact → alias → fuzzy contains, in that order)
// ---------------------------------------------------------------------------

export type MatchKind = 'exact' | 'alias' | 'fuzzy';

export interface TaskMatch {
  taskUid: string;
  /** Matched project activity id, or null → unmatched (the human resolves it). */
  activityId: string | null;
  matchKind: MatchKind | null;
}

/** Lowercased, trimmed, whitespace-collapsed — the comparison form for names. */
function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Match imported leaf tasks to the project's activities:
 *  1. exact — the task name equals an activity name (case/whitespace-insensitive);
 *  2. alias — the task name resolves through the global activity dictionary
 *     (`resolveActivityByName`, name OR alias) to an entry some project activity
 *     links via `dictionary_id`;
 *  3. fuzzy — one name contains the other (both ≥ 4 chars normalized); the
 *     longest-named candidate wins so "DRYWALL HANG" prefers "Drywall Hang"
 *     over "Drywall". Ties keep input order (pass activities sequence-ordered).
 * Anything else stays unmatched — never guessed. Pure.
 */
export function matchTasksToActivities(
  tasks: Pick<MspTask, 'uid' | 'name'>[],
  activities: ReconcileActivity[],
  dictionary: ActivityDictionaryEntry[],
): TaskMatch[] {
  const byExactName = new Map<string, ReconcileActivity>();
  for (const a of activities) {
    const key = normalizeName(a.name);
    if (!byExactName.has(key)) byExactName.set(key, a);
  }
  const byDictionaryId = new Map<string, ReconcileActivity>();
  for (const a of activities) {
    if (a.dictionary_id && !byDictionaryId.has(a.dictionary_id)) byDictionaryId.set(a.dictionary_id, a);
  }

  return tasks.map((task) => {
    const needle = normalizeName(task.name);
    if (!needle) return { taskUid: task.uid, activityId: null, matchKind: null };

    const exact = byExactName.get(needle);
    if (exact) return { taskUid: task.uid, activityId: exact.id, matchKind: 'exact' as const };

    const entry = resolveActivityByName(dictionary, task.name);
    const viaAlias = entry ? byDictionaryId.get(entry.id) : undefined;
    if (viaAlias) return { taskUid: task.uid, activityId: viaAlias.id, matchKind: 'alias' as const };

    let fuzzy: ReconcileActivity | null = null;
    let fuzzyLen = 0;
    for (const a of activities) {
      const aName = normalizeName(a.name);
      if (aName.length < 4 || needle.length < 4) continue;
      if (!needle.includes(aName) && !aName.includes(needle)) continue;
      if (aName.length > fuzzyLen) {
        fuzzy = a;
        fuzzyLen = aName.length;
      }
    }
    if (fuzzy) return { taskUid: task.uid, activityId: fuzzy.id, matchKind: 'fuzzy' as const };

    return { taskUid: task.uid, activityId: null, matchKind: null };
  });
}

// ---------------------------------------------------------------------------
// Target-level suggestion (from the task's summary chain)
// ---------------------------------------------------------------------------

/** Extract a level number from text like "LEVEL 4 FINISHES", "4th floor", "Floor 2". */
function extractLevelNumber(text: string): number | null {
  const m =
    /\blevel\s*(\d+)\b/i.exec(text) ||
    /\b(\d+)(?:st|nd|rd|th)\s+floor\b/i.exec(text) ||
    /\bfloor\s*(\d+)\b/i.exec(text);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Suggest a target sheet (level) for an imported task by reading a level number
 * out of its own name first, then its summary chain innermost-first ("LEVEL 4
 * FINISHES (19 UNITS)" → 4), and matching it against the sheet names the same
 * way. Returns the sheet id only when exactly ONE sheet matches — an ambiguous
 * number (two buildings with a "Level 4") stays unsuggested for the human.
 */
export function suggestSheetForTask(
  task: Pick<MspTask, 'name' | 'path'>,
  sheets: { id: string; sheet_name: string | null }[],
): string | null {
  let level: number | null = extractLevelNumber(task.name);
  if (level == null) {
    for (let i = task.path.length - 1; i >= 0 && level == null; i--) {
      level = extractLevelNumber(task.path[i]);
    }
  }
  if (level == null) return null;

  const matches = sheets.filter((s) => s.sheet_name != null && extractLevelNumber(s.sheet_name) === level);
  return matches.length === 1 ? matches[0].id : null;
}

// ---------------------------------------------------------------------------
// Envelope subdivision (coarse task window → per-location planned windows)
// ---------------------------------------------------------------------------

/** How a task's window lands on its locations. */
export type DistributionMode =
  /** Divide the window into contiguous per-location sub-windows (crew flow). */
  | 'subdivide'
  /** Every location gets the full task window (like the level cascade). */
  | 'envelope';

export type SubdivisionWeighting = 'area' | 'even' | 'envelope';

export interface LocationWindow {
  unitId: string;
  start: string;
  end: string;
}

export interface SubdivisionResult {
  windows: LocationWindow[];
  /**
   * How the split was computed: 'area' only when EVERY unit has a positive
   * `computed_area` — partial area data degrades honestly to 'even' rather
   * than faking precision with made-up weights.
   */
  weighting: SubdivisionWeighting;
}

/** Deterministic crew-flow order: walk_sequence first (nulls last), then unit number. */
function unitOrder(a: TargetUnit, b: TargetUnit): number {
  if (a.walk_sequence != null && b.walk_sequence != null && a.walk_sequence !== b.walk_sequence) {
    return a.walk_sequence - b.walk_sequence;
  }
  if (a.walk_sequence != null && b.walk_sequence == null) return -1;
  if (a.walk_sequence == null && b.walk_sequence != null) return 1;
  return a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true });
}

/**
 * Subdivide a task's date window across its target locations.
 *
 * 'subdivide': the inclusive day span is split into contiguous sub-windows, one
 * per location in crew-flow order, with lengths proportional to `computed_area`
 * when every unit has one (else even). Day boundaries are rounded, every unit
 * keeps at least its start day, and the last unit always ends on the window's
 * last day — so short windows over many units simply share days (honest, not
 * faked precision). 'envelope': every location gets the whole window.
 */
export function subdivideTaskWindow(
  start: string,
  end: string,
  units: TargetUnit[],
  mode: DistributionMode,
): SubdivisionResult {
  const s = parseDay(start);
  const e = parseDay(end);
  if (!s || !e || units.length === 0) return { windows: [], weighting: 'even' };
  const lo = s <= e ? s : e;
  const hi = s <= e ? e : s;
  const loStr = toDayString(lo);
  const hiStr = toDayString(hi);

  if (mode === 'envelope') {
    return {
      windows: units.map((u) => ({ unitId: u.id, start: loStr, end: hiStr })),
      weighting: 'envelope',
    };
  }

  const ordered = [...units].sort(unitOrder);
  const totalDays = dayDiff(lo, hi) + 1;

  const hasFullAreaData = ordered.every((u) => typeof u.computed_area === 'number' && u.computed_area > 0);
  const weights = ordered.map((u) => (hasFullAreaData ? (u.computed_area as number) : 1));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  const windows: LocationWindow[] = [];
  let cumulative = 0;
  let prevBoundary = 0;
  for (let i = 0; i < ordered.length; i++) {
    cumulative += weights[i];
    // The last boundary is pinned to the full span so rounding never drops the end day.
    const boundary = i === ordered.length - 1 ? totalDays : Math.round((cumulative / totalWeight) * totalDays);
    const startIdx = Math.min(prevBoundary, totalDays - 1);
    const endIdx = Math.max(boundary - 1, startIdx);
    windows.push({
      unitId: ordered[i].id,
      start: toDayString(addDays(lo, startIdx)),
      end: toDayString(addDays(lo, Math.min(endIdx, totalDays - 1))),
    });
    prevBoundary = Math.max(boundary, prevBoundary);
  }

  return { windows, weighting: hasFullAreaData ? 'area' : 'even' };
}

// ---------------------------------------------------------------------------
// Write plan (mirrors cascadeLevelToLocations — the same non-destructive posture)
// ---------------------------------------------------------------------------

/** One confirmed mapping: an imported task, its activity, and its target locations. */
export interface ImportAssignment {
  task: Pick<MspTask, 'uid' | 'start' | 'finish'>;
  activity: ReconcileActivity;
  units: TargetUnit[];
  mode: DistributionMode;
}

export interface ImportWritePlan {
  writes: StatusLogInsert[];
  /** Distinct locations receiving at least one write. */
  affectedUnitCount: number;
  /** Slots skipped because they already carry their own planned dates (non-destructive default). */
  skippedExisting: number;
  /** Slots skipped because the activity does not apply to the unit (N/A). */
  skippedNotApplicable: number;
}

export interface BuildImportWritesOptions {
  /** Existing current-state logs (slot-keyed by unit_id + activity_id). */
  existing: StatusLike[];
  /** When false (default), slots that already have planned dates keep them. */
  overrideExisting?: boolean;
  applicabilityIndex?: ApplicabilityIndex;
}

/**
 * Turn confirmed task→activity→locations assignments into the `status_logs`
 * upsert rows, mirroring `cascadeLevelToLocations` exactly: non-destructive by
 * default (a slot with its own planned dates is skipped unless
 * `overrideExisting`), N/A slots never written, and prior
 * `temporal_state` / `status_color` / `logged_date` are preserved so an import
 * never resets progress — it only sets the planned window. When two
 * assignments hit the same slot, the later one wins (deterministic).
 */
export function buildImportWrites(
  assignments: ImportAssignment[],
  { existing, overrideExisting = false, applicabilityIndex = EMPTY_APPLICABILITY_INDEX }: BuildImportWritesOptions,
): ImportWritePlan {
  const existingByKey = new Map<string, StatusLike>();
  for (const s of existing) {
    if (s.unit_id && s.activity_id) existingByKey.set(`${s.unit_id}_${s.activity_id}`, s);
  }

  const writesByKey = new Map<string, StatusLogInsert>();
  let skippedExisting = 0;
  let skippedNotApplicable = 0;

  for (const { task, activity, units, mode } of assignments) {
    const start = task.start ?? task.finish;
    const end = task.finish ?? task.start;
    if (!start || !end) continue; // dateless task — nothing to write

    const applicable: TargetUnit[] = [];
    for (const u of units) {
      if (isMilestoneApplicable(activity, u, applicabilityIndex)) applicable.push(u);
      else skippedNotApplicable++;
    }

    const { windows } = subdivideTaskWindow(start, end, applicable, mode);
    for (const w of windows) {
      const key = `${w.unitId}_${activity.id}`;
      const prior = existingByKey.get(key);
      const hasOwnDates = !!(prior?.planned_start_date || prior?.planned_end_date);
      if (hasOwnDates && !overrideExisting) {
        skippedExisting++;
        continue;
      }
      writesByKey.set(key, {
        unit_id: w.unitId,
        track: activity.track,
        activity_id: activity.id,
        status_color: prior?.status_color || activity.color,
        temporal_state: prior?.temporal_state || 'planned',
        planned_start_date: w.start,
        planned_end_date: w.end,
        logged_date: prior?.logged_date ?? null,
      });
    }
  }

  const writes = Array.from(writesByKey.values());
  return {
    writes,
    affectedUnitCount: new Set(writes.map((w) => w.unit_id)).size,
    skippedExisting,
    skippedNotApplicable,
  };
}

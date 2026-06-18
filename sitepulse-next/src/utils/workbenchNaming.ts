/**
 * Pure, framework-free naming + Definition-of-Done helpers for the Location
 * Labeling Workbench (Phase 7 — standard-enforcing labeling UX). No React, no DB,
 * and no `Date.now()` — every input (including any timestamps) is passed in, so the
 * co-located tests can pin the load-bearing rules deterministically (AGENTS.md §9).
 *
 * These enforce the labeling standard on the banked corpus: §4 naming (trim +
 * within-sheet uniqueness + auto-increment) and §9 Definition-of-Done (the
 * checklist that gates a drawing's `reviewed` state). Kept separate from the
 * `workbench.ts` write helpers so the rule logic is unit-tested in isolation.
 */

/**
 * Trim surrounding whitespace and collapse internal whitespace runs to a single
 * space — the canonical form a location name is stored in. "  301 " → "301";
 * "Court  1" → "Court 1".
 */
export function normalizeLocationName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Case- and whitespace-insensitive comparison key for two location names. */
function nameKey(name: string): string {
  return normalizeLocationName(name).toLowerCase();
}

/**
 * Whether `name` is unique among the sheet's existing label names (standard §4.5:
 * within-sheet names MUST be unique). Comparison is normalized + case-insensitive,
 * so "Room 1", "room 1", and " Room  1 " all collide. A blank name is never
 * unique (there is nothing to save), so callers can use this as the single gate.
 *
 * For a NEW label, pass every existing name on the sheet. For a rename, the caller
 * must exclude the label's own current name first (a name never collides with itself).
 */
export function isNameUniqueOnSheet(name: string, existingNames: readonly string[]): boolean {
  const key = nameKey(name);
  if (!key) return false;
  return !existingNames.some((n) => nameKey(n) === key);
}

interface ParsedDesignator {
  /** Everything before the trailing number, e.g. "A-" in "A-104" or "Court " in "Court 1". */
  prefix: string;
  /** The trailing integer value, e.g. 104. */
  num: number;
  /** Original digit width, so zero-padding is preserved ("009" → "010"). */
  width: number;
}

/** Split a name into a {prefix, trailing-number, width}, or null if it has no trailing number. */
function parseDesignator(name: string): ParsedDesignator | null {
  const m = normalizeLocationName(name).match(/^(.*?)(\d+)$/);
  if (!m) return null;
  return { prefix: m[1], num: Number.parseInt(m[2], 10), width: m[2].length };
}

function maxNum(group: readonly ParsedDesignator[]): number {
  return group.reduce((m, p) => Math.max(m, p.num), Number.NEGATIVE_INFINITY);
}

/**
 * Suggest the next designator in the sheet's established numbering pattern, for the
 * one-click "fix a duplicate" affordance and general convenience:
 *   301, 302        → "303"
 *   A-104, A-105    → "A-106"
 *   Court 1, Court 2 → "Court 3"
 *
 * It groups existing names by their non-numeric prefix and increments the dominant
 * series (the group with the most members; ties broken by the higher max number,
 * then by first appearance), preserving the prefix and zero-padding width. Returns
 * `null` when no existing name ends in a number — there is no pattern to follow, so
 * the standard's "no suggestion" fallback applies and the labeler types their own.
 */
export function suggestNextName(existingNames: readonly string[]): string | null {
  const parsed = existingNames
    .map(parseDesignator)
    .filter((p): p is ParsedDesignator => p !== null);
  if (parsed.length === 0) return null;

  const groups = new Map<string, ParsedDesignator[]>();
  for (const p of parsed) {
    const g = groups.get(p.prefix);
    if (g) g.push(p);
    else groups.set(p.prefix, [p]);
  }

  // Insertion order is preserved by Map, so only replacing `best` on a STRICT win
  // keeps the first-appearing group on a tie (deterministic).
  let best: ParsedDesignator[] | null = null;
  for (const g of groups.values()) {
    if (best === null || g.length > best.length || (g.length === best.length && maxNum(g) > maxNum(best))) {
      best = g;
    }
  }
  if (!best) return null;

  const top = best.reduce((a, b) => (b.num >= a.num ? b : a));
  const next = String(top.num + 1).padStart(top.width, '0');
  return `${top.prefix}${next}`;
}

/** The minimal label shape the Definition-of-Done checklist inspects (a subset of `Unit`). */
export interface LabelForReview {
  unit_number: string | null;
  top_level_role: string | null;
}

/** A single Definition-of-Done check result (standard §9). */
export interface DoDCheck {
  id: 'has-labels' | 'all-named' | 'names-trimmed' | 'names-unique' | 'all-typed';
  label: string;
  passed: boolean;
  /** Short failure context (e.g. "2 unnamed"), or null when the check passes. */
  detail: string | null;
}

export interface DefinitionOfDoneResult {
  totalLabels: number;
  checks: DoDCheck[];
  /** True only when EVERY check passes — the gate for marking a drawing `reviewed`. */
  passed: boolean;
}

/**
 * Compute the standard §9 Definition-of-Done checklist for a drawing's labels:
 * at least one label; every label named; names trimmed; names unique on the sheet;
 * every label carries a role (the canonical `top_level_role`, the single source of
 * truth for type per AGENTS.md §4). A drawing may only be marked `reviewed` when
 * `passed` is true. Pure — never mutates its input.
 */
export function definitionOfDoneChecks(labels: readonly LabelForReview[]): DefinitionOfDoneResult {
  const total = labels.length;

  const unnamed = labels.filter((l) => normalizeLocationName(l.unit_number ?? '').length === 0).length;

  const untrimmed = labels.filter((l) => {
    const raw = l.unit_number ?? '';
    return raw.length > 0 && raw !== normalizeLocationName(raw);
  }).length;

  const namedKeys = labels.map((l) => nameKey(l.unit_number ?? '')).filter((k) => k.length > 0);
  const duplicatedKeys = new Set(namedKeys.filter((k, i) => namedKeys.indexOf(k) !== i)).size;

  const untyped = labels.filter((l) => !l.top_level_role).length;

  const checks: DoDCheck[] = [
    {
      id: 'has-labels',
      label: 'Has at least one location',
      passed: total > 0,
      detail: total > 0 ? null : 'Trace and name at least one location.',
    },
    {
      id: 'all-named',
      label: 'Every location is named',
      passed: total > 0 && unnamed === 0,
      detail: unnamed > 0 ? `${unnamed} unnamed` : null,
    },
    {
      id: 'names-trimmed',
      label: 'Names are trimmed',
      passed: untrimmed === 0,
      detail: untrimmed > 0 ? `${untrimmed} with stray spaces` : null,
    },
    {
      id: 'names-unique',
      label: 'Names are unique on this sheet',
      passed: duplicatedKeys === 0,
      detail: duplicatedKeys > 0 ? `${duplicatedKeys} duplicated` : null,
    },
    {
      id: 'all-typed',
      label: 'Every location has a role + type',
      passed: total > 0 && untyped === 0,
      detail: untyped > 0 ? `${untyped} without a type` : null,
    },
  ];

  return { totalLabels: total, checks, passed: checks.every((c) => c.passed) };
}

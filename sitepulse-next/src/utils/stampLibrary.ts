import type { PercentPoint } from '@/types/domain';

// Stamp & Fast Markup — Phase 2. The persisted "stamp drawer" model + the pure ops
// over it. A `StampDef` is a reusable shape you can drop on the plan without first
// selecting a room; the store (`useSettingsStore.stampLibrary`) holds the state, these
// functions never touch it. Everything here is framework-free + deterministic — it
// NEVER stamps `id`/`createdAt` itself (callers pass those in) so it stays unit-testable.

/**
 * A saved / recently-used stamp. `points` are stored **normalized to the shape's own
 * centroid** (via `normalizeToCentroid`) so a drop re-anchors cleanly to the cursor.
 * Plain JSON only (localStorage / IDB-safe — no class instances / Map / Set). `subtypeId`
 * / `unitType` ride along so Phase 3's opt-in naming can pre-fill the location's type.
 */
export interface StampDef {
  id: string;
  name: string;
  points: PercentPoint[];
  subtypeId?: string | null;
  unitType?: string | null;
  createdAt: string;
}

/** The persisted drawer: auto-collected `recents` + explicitly pinned `saved`. */
export interface StampLibrary {
  recents: StampDef[];
  saved: StampDef[];
}

/** Empty library — the default state + a stable fallback for `useHydratedStore`. */
export const EMPTY_STAMP_LIBRARY: StampLibrary = { recents: [], saved: [] };

/** How many recent stamps the drawer keeps (newest-first). */
export const RECENTS_CAP = 5;

/**
 * A rounded-point signature used to de-dupe recents. Points are centroid-normalized, so
 * two drops of the SAME shape (placed at different anchors) collapse to one recent —
 * repeatedly stamping the same room never floods the drawer. Rounded to 1/1000 so
 * floating-point noise doesn't split an otherwise-identical shape into two entries.
 */
export function shapeSignature(points: PercentPoint[]): string {
  return points.map((p) => `${Math.round(p.pctX * 1000)},${Math.round(p.pctY * 1000)}`).join(';');
}

/**
 * Prepend `stamp` to `recents`, drop any existing entry with the same shape signature
 * (so it moves to the front instead of duplicating), and cap the list at `cap`.
 */
export function pushRecent(recents: StampDef[], stamp: StampDef, cap: number = RECENTS_CAP): StampDef[] {
  const sig = shapeSignature(stamp.points);
  const deduped = recents.filter((r) => shapeSignature(r.points) !== sig);
  return [stamp, ...deduped].slice(0, Math.max(0, cap));
}

/**
 * Add (or replace, by `id`) a pinned stamp — newest-first. Two saves of the same shape
 * under different names stay as two distinct entries (de-dup is by id, not shape).
 */
export function saveStamp(saved: StampDef[], stamp: StampDef): StampDef[] {
  const without = saved.filter((s) => s.id !== stamp.id);
  return [stamp, ...without];
}

/** Remove a pinned stamp by id. */
export function removeStamp(saved: StampDef[], id: string): StampDef[] {
  return saved.filter((s) => s.id !== id);
}

/** Rename a pinned stamp by id (no-op if the id is absent). */
export function renameStamp(saved: StampDef[], id: string, name: string): StampDef[] {
  return saved.map((s) => (s.id === id ? { ...s, name } : s));
}

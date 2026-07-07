import type { StatusLog } from '@/types/domain';

/**
 * staleness — the display-string layer for "how old is a location's data".
 *
 * Derives from `status_logs.client_timestamp` (the capture-time stamp already
 * loaded by the field views), NOT from the completed-only history hook — a
 * location that only ever went ONGOING still has a real last-touched moment.
 * The max-timestamp idea mirrors `progressAnalytics.lastActivityAt` (which
 * returns a `Date` for pace math); this module is the presentation twin that
 * returns the raw ISO string + a compact age chip label.
 *
 * Every function takes its dates IN as strings — no `Date.now()` — so they stay
 * deterministic and unit-testable (Data Storytelling P3).
 */

const DAY_MS = 86_400_000;

/**
 * The most recent activity timestamp across a unit's current-state rows, as the
 * raw ISO string (so the caller can both format an age AND show the exact date
 * on hover). `client_timestamp` is the capture-time stamp; `created_at` is the
 * fallback for legacy rows written before capture-time stamping. Null when the
 * unit has no timestamped rows.
 */
export function lastActivityIso(
  statusLogs: Pick<StatusLog, 'client_timestamp' | 'created_at'>[],
): string | null {
  let latestMs: number | null = null;
  let latestIso: string | null = null;
  for (const log of statusLogs) {
    const stamp = log.client_timestamp || log.created_at || null;
    if (!stamp) continue;
    const t = Date.parse(stamp);
    if (Number.isNaN(t)) continue;
    if (latestMs === null || t > latestMs) {
      latestMs = t;
      latestIso = stamp;
    }
  }
  return latestIso;
}

/**
 * Compact "age" chip label for a location's last activity: "today", "3d", "2w",
 * or "—" when unknown. Elapsed-days based (floor), with a clean day→week
 * boundary at 7 days. Both args are ISO strings; a future stamp clamps to
 * "today". Returns "—" for null / unparseable input.
 */
export function formatAge(lastIso: string | null, todayIso: string): string {
  if (!lastIso) return '—';
  const last = Date.parse(lastIso);
  const today = Date.parse(todayIso);
  if (Number.isNaN(last) || Number.isNaN(today)) return '—';
  const days = Math.floor((today - last) / DAY_MS);
  if (days <= 0) return 'today';
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

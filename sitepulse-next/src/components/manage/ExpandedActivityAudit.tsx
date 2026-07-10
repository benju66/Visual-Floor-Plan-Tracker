"use client";
import React, { useMemo } from 'react';
import { useUnitHistory } from '@/hooks/useProjectQueries';
import type { AuditEventLike } from '@/utils/progressAnalytics';
import type { StatusLog } from '@/types/domain';

/** Audit rows come back through useUnitHistory typed as StatusLog but carry changed_at. */
type AuditRow = StatusLog & { changed_at?: string | null };

interface ExpandedActivityAuditProps {
  unitId: string;
  track: string;
  /**
   * Gate the per-location history fetch on near-viewport presence (List View
   * Performance — Phase 2). When false the query stays idle (no request), and the
   * events map is empty so expanded child rows fall back to the ENTERED actual-start
   * only — the exact same state as "audit still loading". Defaults to true, so any
   * caller that doesn't gate keeps the eager-fetch behavior.
   */
  enabled?: boolean;
  /** Render-prop: receives an activityName → audit-events map for this location. */
  children: (eventsByActivity: Map<string, AuditEventLike[]>) => React.ReactNode;
}

/**
 * Loads ONE location's `status_audit_log` on demand — it only mounts while that
 * location's list row is expanded, so it is per-location and lazy, never a
 * level-wide prefetch (the 1000-row hot-path trap the guardrails forbid). It rides
 * the exact same `useUnitHistory` hook the Unit History modal uses, so React Query
 * dedupes and caches the fetch. The audit-events map lets the expanded per-activity
 * rows show the audit-backed schedule metrics (Actual Started / Actual Duration /
 * Variance Start / Variance Duration) that `status_logs` alone can't supply.
 *
 * Renders a bare fragment so the caller's <tr> rows stay direct children of the
 * surrounding <tbody>.
 */
export default function ExpandedActivityAudit({ unitId, track, enabled = true, children }: ExpandedActivityAuditProps) {
  const { data: rawLogs } = useUnitHistory(unitId, enabled);

  const eventsByActivity = useMemo(() => {
    const map = new Map<string, AuditEventLike[]>();
    for (const row of (rawLogs as AuditRow[] | undefined) || []) {
      if (row.track !== track) continue;
      const key = row.activityName || '';
      const arr = map.get(key);
      if (arr) arr.push(row);
      else map.set(key, [row]);
    }
    return map;
  }, [rawLogs, track]);

  return <>{children(eventsByActivity)}</>;
}

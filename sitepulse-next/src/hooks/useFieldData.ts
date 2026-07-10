import { useMemo, useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useMapStore } from '@/store/useMapStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useProject, useUnits, useActivities } from '@/hooks/useProjectQueries';
import {
  persistPendingChanges,
  persistPendingTimelineChanges,
  loadPendingChanges,
  loadPendingTimelineChanges,
  clearPersistedPendingChanges,
  persistCurrentQueue,
} from '@/utils/pendingChangesStore';
import { runWithConcurrency } from '@/utils/concurrency';
import type { Unit, StatusLog, PendingChangesMap, PendingChange, TemporalState } from '@/types/domain';

// How many staged status-saves the List's Apply overlaps at once. Each is a full
// upsert_status_log round-trip (auto-advance may fire a second write), so a small
// bound keeps a big batch fast without hammering the DB or the offline queue.
const APPLY_CONCURRENCY = 5;

interface UseFieldDataProps {
  activeStatuses: StatusLog[];
  onApplyPendingChanges?: (changes: PendingChange[]) => Promise<void>;
  /** All-levels scope: supply the cross-sheet unit list instead of the active sheet's. */
  unitsOverride?: Unit[];
}

export function useFieldData({ activeStatuses, onApplyPendingChanges, unitsOverride }: UseFieldDataProps) {
  // --- Store subscriptions (read-only) ---
  const activeSheetId = useMapStore((s) => s.activeSheetId);
  const trackingMode = useMapStore((s) => s.trackingMode);
  const statusFilter = useSettingsStore((s) => s.filterActivity);

  // --- Data queries ---
  const params = useParams();
  const projectId = params?.projectId as string;

  const { data: project } = useProject(projectId);
  const projectUnitTypes = (project?.unit_types as string[]) || [
    'Apartment Unit',
    'Common Area',
    'Back of House',
    'Commercial Space',
    'Other',
  ];
  const { data: allActivities = [] } = useActivities(projectId);
  const { data: fetchedUnits = [] } = useUnits(activeSheetId);
  const units = unitsOverride ?? fetchedUnits;

  const currentActivities = useMemo(
    () =>
      allActivities
        .filter((a) => a.track === trackingMode)
        .sort((a, b) => (a.sequence_order || 0) - (b.sequence_order || 0)),
    [allActivities, trackingMode]
  );

  // --- Local UI state ---
  const [sortColumn, setSortColumn] = useState<string>('unit');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [typeFilter, setTypeFilter] = useState<string>('All');

  const [isMobile, setIsMobile] = useState<boolean>(false);

  const [pendingChanges, setPendingChanges] = useState<PendingChangesMap>({});
  const [pendingTimelineChanges, setPendingTimelineChanges] = useState<PendingChangesMap>({});
  const [isApplying, setIsApplying] = useState<boolean>(false);
  // Ref (not state) to quiesce reactive IDB persist effects during the sync loop.
  // Prevents the useEffect from writing to IDB on every setPendingChanges call during handleApplyAll.
  const isSyncingRef = useRef(false);

  // --- Rehydrate persisted pending changes from IDB on mount / project change ---
  const [hasRehydrated, setHasRehydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHasRehydrated(false); // Reset on projectId change

    (async () => {
      const [savedPending, savedTimeline] = await Promise.all([
        loadPendingChanges(projectId),
        loadPendingTimelineChanges(projectId),
      ]);
      if (cancelled) return;
      if (Object.keys(savedPending).length > 0) setPendingChanges(savedPending);
      if (Object.keys(savedTimeline).length > 0) setPendingTimelineChanges(savedTimeline);
      setHasRehydrated(true);
    })();

    return () => { cancelled = true; };
  }, [projectId]);

  // --- Persist pending changes to IDB on every update ---
  // Guarded by isSyncingRef to prevent redundant writes during handleApplyAll's per-item dequeue loop.
  useEffect(() => {
    if (!hasRehydrated || isSyncingRef.current) return;
    persistPendingChanges(projectId, pendingChanges);
  }, [pendingChanges, hasRehydrated, projectId]);

  useEffect(() => {
    if (!hasRehydrated || isSyncingRef.current) return;
    persistPendingTimelineChanges(projectId, pendingTimelineChanges);
  }, [pendingTimelineChanges, hasRehydrated, projectId]);

  // Track the mobile breakpoint — the swipe deck hides the global header elements.
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Hide global header elements while in the mobile swipe deck
  useEffect(() => {
    if (isMobile) {
      document.documentElement.classList.add('hide-header-elements');
    } else {
      document.documentElement.classList.remove('hide-header-elements');
    }
    return () => {
      document.documentElement.classList.remove('hide-header-elements');
    };
  }, [isMobile]);

  // --- Handlers ---

  const handleLocalUpdate = (unit: Unit, baseLog: StatusLog | null, state: TemporalState, extraProps: Record<string, any> = {}) => {
    const now = new Date().toISOString();
    setPendingChanges((prev) => {
      const existing = prev[unit.id] || {
        log: baseLog || {},
        state: baseLog?.temporal_state || 'none',
        extraProps: {},
      };
      return {
        ...prev,
        [unit.id]: {
          unit,
          log: baseLog,
          state,
          // Preserve original capturedAt if re-editing an already-queued item
          capturedAt: existing.capturedAt ?? now,
          extraProps: { ...existing.extraProps, ...extraProps },
        },
      };
    });
  };

  const handleTimelineUpdate = (unit: Unit, baseLog: StatusLog | null, state: TemporalState, extraProps: Record<string, any> = {}) => {
    const now = new Date().toISOString();
    const activityName = extraProps?.activityObj?.name || baseLog?.activityName;
    const key = `${unit.id}_${activityName}`;
    setPendingTimelineChanges((prev) => {
      const existing = prev[key];
      return {
        ...prev,
        [key]: {
          unit,
          log: baseLog,
          state,
          capturedAt: existing?.capturedAt ?? now,
          extraProps
        }
      };
    });
  };

  const handleRemovePendingItem = (unitId: string, activityName?: string | null): boolean => {
    if (activityName) {
      const hasPrimary = pendingChanges[unitId] !== undefined;
      const remainingTimelineKeys = Object.keys(pendingTimelineChanges).filter(
        (k) => k.startsWith(`${unitId}_`) && k !== `${unitId}_${activityName}`
      );
      const hasRemaining = hasPrimary || remainingTimelineKeys.length > 0;

      setPendingTimelineChanges((prev) => {
        const next = { ...prev };
        delete next[`${unitId}_${activityName}`];
        return next;
      });

      return hasRemaining;
    } else {
      const remainingTimelineKeys = Object.keys(pendingTimelineChanges).filter(
        (k) => k.startsWith(`${unitId}_`)
      );
      const hasRemaining = remainingTimelineKeys.length > 0;

      setPendingChanges((prev) => {
        const next = { ...prev };
        delete next[unitId];
        return next;
      });

      return hasRemaining;
    }
  };

  const handleDiscardAll = () => {
    setPendingChanges({});
    setPendingTimelineChanges({});
    clearPersistedPendingChanges(projectId);
  };

  const pendingCount = useMemo(() => {
    const dedupedChanges = new Set<string>();
    Object.values(pendingChanges).forEach(c => {
      const aName = c.extraProps?.activityObj?.name || c.log?.activityName || 'Primary';
      dedupedChanges.add(`${c.unit.id}_${aName}`);
    });
    Object.values(pendingTimelineChanges).forEach(c => {
      const aName = c.extraProps?.activityObj?.name || c.log?.activityName || 'Primary';
      dedupedChanges.add(`${c.unit.id}_${aName}`);
    });
    return dedupedChanges.size;
  }, [pendingChanges, pendingTimelineChanges]);

  const handleApplyAll = async (): Promise<{ succeeded: number; failed: number }> => {
    const changesArray = [
      ...Object.values(pendingChanges),
      ...Object.values(pendingTimelineChanges)
    ];
    
    const dedupedMap = new Map<string, PendingChange>();
    changesArray.forEach(c => {
       const aName = c.extraProps?.activityObj?.name || c.log?.activityName || 'Primary';
       dedupedMap.set(`${c.unit.id}_${aName}`, c);
    });
    
    const finalChanges = Array.from(dedupedMap.values());
    if (finalChanges.length === 0) return { succeeded: 0, failed: 0 };

    setIsApplying(true);
    isSyncingRef.current = true; // Quiesce reactive IDB writes during sync loop

    // Work against live snapshots so we can write directly to IDB on each checkpoint.
    // const: the bindings are never reassigned — items are removed via `delete` (mutation).
    const livePending = { ...pendingChanges };
    const liveTimeline = { ...pendingTimelineChanges };

    // Per-item checkpoint, serialized. Several changes now save at once (bounded
    // concurrency below), but the dequeue-and-persist for each MUST NOT interleave:
    // the deletes mutate the shared live snapshots, and out-of-order IDB writes could
    // "resurrect" an already-synced item. Chaining off a single tail promise runs each
    // delete+persist atomically and in completion order, so IDB shrinks monotonically —
    // a crash mid-sync still leaves only unsynced items on rehydration (AGENTS.md §2).
    let checkpointTail: Promise<void> = Promise.resolve();
    const checkpoint = (change: PendingChange): Promise<void> => {
      checkpointTail = checkpointTail.then(() => {
        const aName = change.extraProps?.activityObj?.name || change.log?.activityName;
        const key = `${change.unit.id}_${aName}`;
        delete livePending[change.unit.id];
        delete liveTimeline[key];
        return persistCurrentQueue(projectId, livePending, liveTimeline);
      });
      return checkpointTail;
    };

    try {
      // Overlap up to APPLY_CONCURRENCY apply calls instead of strict one-at-a-time.
      // Each call carries its capture-time client_timestamp (change.capturedAt, threaded
      // through onApplyPendingChanges → commitUnitActivity) and writes via upsert_status_log
      // with the LWW guard — unchanged; we only change HOW MANY run at once. A successful
      // call checkpoints immediately; a failure leaves that item queued for retry.
      const results = await runWithConcurrency(
        finalChanges,
        APPLY_CONCURRENCY,
        async (change) => {
          await onApplyPendingChanges?.([change]);
          await checkpoint(change);
        }
      );

      const succeeded = results.filter((r) => r.ok).length;
      const failed = results.length - succeeded;

      // Sync React state to match the drained IDB
      setPendingChanges(livePending);
      setPendingTimelineChanges(liveTimeline);

      // Belt-and-suspenders: if everything succeeded, do a final clean clear
      if (failed === 0) {
        await clearPersistedPendingChanges(projectId);
      }

      return { succeeded, failed };
    } finally {
      isSyncingRef.current = false;
      setIsApplying(false);
    }
  };

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDirection('asc');
    }
  };

  // --- Memos ---

  const ranked = useMemo(() => {
    return [...units]
      .map((unit) => ({
        unit,
        log: activeStatuses.find((s) => s.unit_id === unit.id) || null,
      }))
      .sort((a, b) => {
        let cmp = 0;
        if (sortColumn === 'unit') {
          cmp = a.unit.unit_number.localeCompare(b.unit.unit_number, undefined, {
            numeric: true,
            sensitivity: 'base',
          });
        } else if (sortColumn === 'walk_sequence') {
          const seqA = typeof (a.unit as any).walk_sequence === 'number' ? (a.unit as any).walk_sequence : 99999;
          const seqB = typeof (b.unit as any).walk_sequence === 'number' ? (b.unit as any).walk_sequence : 99999;
          cmp = seqA - seqB;
          if (cmp === 0) {
            cmp = a.unit.unit_number.localeCompare(b.unit.unit_number, undefined, {
              numeric: true,
              sensitivity: 'base',
            });
          }
        } else if (sortColumn === 'status') {
          const ma = a.log?.activityName || '';
          const mb = b.log?.activityName || '';
          cmp = ma.localeCompare(mb);
          if (cmp === 0) {
            const sa = a.log?.temporal_state || '';
            const sb = b.log?.temporal_state || '';
            cmp = sa.localeCompare(sb);
          }
        } else if (sortColumn === 'unit_type') {
          const typeA = a.unit.unit_type || '';
          const typeB = b.unit.unit_type || '';
          cmp = typeA.localeCompare(typeB);
        } else if (sortColumn === 'updated') {
          const ta = a.log?.logged_date
            ? new Date(a.log.logged_date).getTime()
            : a.log?.created_at
            ? new Date(a.log.created_at).getTime()
            : 0;
          const tb = b.log?.logged_date
            ? new Date(b.log.logged_date).getTime()
            : b.log?.created_at
            ? new Date(b.log.created_at).getTime()
            : 0;
          cmp = ta - tb;
        }

        if (cmp === 0 && sortColumn !== 'unit') {
          cmp = a.unit.unit_number.localeCompare(b.unit.unit_number, undefined, {
            numeric: true,
            sensitivity: 'base',
          });
        }

        return sortDirection === 'asc' ? cmp : -cmp;
      });
  }, [units, activeStatuses, sortColumn, sortDirection]);

  const visible = useMemo(() => {
    let filtered = ranked;
    if (statusFilter) {
      filtered = filtered.filter((row) => row.log?.activityName === statusFilter);
    }
    if (typeFilter !== 'All') {
      filtered = filtered.filter((row) => row.unit.unit_type === typeFilter);
    }
    return filtered;
  }, [ranked, statusFilter, typeFilter]);

  return {
    units,
    projectUnitTypes,
    hasRehydrated,
    currentActivities,
    ranked,
    visible,
    sortColumn,
    sortDirection,
    handleSort,
    typeFilter,
    setTypeFilter,
    pendingChanges,
    pendingTimelineChanges,
    pendingCount,
    setPendingChanges,
    setPendingTimelineChanges,
    isApplying,
    handleLocalUpdate,
    handleTimelineUpdate,
    handleRemovePendingItem,
    handleDiscardAll,
    handleApplyAll,
    trackingMode,
  };
}

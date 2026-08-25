import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
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
import { pendingChangeKey } from '@/utils/pendingChangeKey';
import type { Unit, StatusLog, PendingChangesMap, PendingChange, TemporalState } from '@/types/domain';

// How many staged status-saves the List's Apply overlaps at once. Each is a full
// upsert_status_log round-trip (auto-advance may fire a second write), so a small
// bound keeps a big batch fast without hammering the DB or the offline queue.
const APPLY_CONCURRENCY = 5;

// Return `prev` untouched when `key` isn't present (stable identity → no re-render);
// otherwise a new Set without it. Used to clear a failed-save flag the moment its item
// is re-edited/removed (Save Visibility — Phase 1). Pure so it's trivially correct.
function withoutFailedKey(prev: Set<string>, key: string): Set<string> {
  if (!prev.has(key)) return prev;
  const next = new Set(prev);
  next.delete(key);
  return next;
}

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
  // Which staged changes failed their last Apply and stayed queued for retry
  // (Save Visibility — Phase 1). Keyed by pendingChangeKey — the SAME key the queue
  // dedupes/checkpoints on, so a failed apply result maps back to the exact slot.
  // Local useState ONLY (mirrors pendingChanges): NOT Zustand, NOT the RQ cache, NOT
  // IDB — it annotates which queued items failed, never what is queued. Session-only:
  // the queued item itself survives reload; only the red flag is in-memory (AGENTS §2).
  const [failedKeys, setFailedKeys] = useState<Set<string>>(() => new Set());
  // Ref (not state) to quiesce reactive IDB persist effects during the sync loop.
  // Prevents the useEffect from writing to IDB on every setPendingChanges call during handleApplyAll.
  const isSyncingRef = useRef(false);

  // Read-only mirror of `pendingChanges`, for the displaced-slot lookup in
  // handleLocalUpdate. That handler MUST keep a stable identity (empty deps —
  // React.memo(LocationRow) depends on it, List View Performance Phase 3), so it
  // cannot close over `pendingChanges`. It only READS the displaced slot here; every
  // write still goes through the functional setter. Safe against staleness because
  // an activity switch is a discrete click — React flushes between discrete events,
  // so this ref is current by the time the next pick runs.
  const pendingChangesRef = useRef<PendingChangesMap>({});
  useEffect(() => { pendingChangesRef.current = pendingChanges; }, [pendingChanges]);

  // --- Rehydrate persisted pending changes from IDB on mount / project change ---
  const [hasRehydrated, setHasRehydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHasRehydrated(false); // Reset on projectId change
    setFailedKeys(new Set()); // Failed flags are session + project scoped — drop on switch

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

  // useCallback with an empty dep list keeps these two per-row edit handlers at a
  // STABLE identity across renders. Both drive their state through the functional
  // setter form (`setPendingChanges((prev) => …)`) and stamp `capturedAt` at
  // call-time, so they never need to close over the current pending maps — the
  // empty deps are correct, not a stale-closure bug. Stable identity is the
  // prerequisite for React.memo(LocationRow) to skip un-edited rows (List View
  // Performance — Phase 3): without it every edit would hand every row a fresh
  // callback prop and defeat the memo. (AGENTS.md §2: pending state stays local
  // useState → IDB with capture-time timestamps — unchanged here.)
  const handleLocalUpdate = useCallback((unit: Unit, baseLog: StatusLog | null, state: TemporalState, extraProps: Record<string, any> = {}) => {
    const now = new Date().toISOString();

    // ── Activity-switch parking ──────────────────────────────────────────────
    // `pendingChanges` is keyed by unit id alone — one staged slot per location —
    // while the row's picker can choose ANY activity for that location. Switching
    // the picker therefore used to overwrite the staged change in place, silently
    // dropping the previous activity's edit: it never reached the server and
    // nothing surfaced that it had gone. Park the displaced edit in the slot-keyed
    // timeline queue instead, so BOTH activities apply (handleApplyAll unions the
    // two maps and dedupes on pendingChangeKey, so the parked entry is a distinct
    // slot and survives).
    //
    // ONLY an explicit activity pick parks. `extraProps.activityObj` is present
    // only when the user chose an activity from the menu; the date cells and the
    // swipe-deck state changes carry no activityObj and are edits to the CURRENTLY
    // staged slot — those must keep merging exactly as before, which is why the
    // guard is on activityObj rather than on the derived slot key (the date cells
    // pass the row's underlying log, whose activityName can differ from the staged
    // pick, and would otherwise look like a switch).
    const incomingActivity: string | null = extraProps?.activityObj?.name ?? null;
    const displaced = pendingChangesRef.current[unit.id];
    const displacedActivity: string | null =
      displaced?.extraProps?.activityObj?.name ?? displaced?.log?.activityName ?? null;
    const isActivitySwitch = Boolean(
      incomingActivity && displaced && displacedActivity && incomingActivity !== displacedActivity
    );

    if (isActivitySwitch && displaced) {
      const displacedKey = pendingChangeKey(displaced);
      setPendingTimelineChanges((prev) =>
        // An existing timeline entry for that slot is an equally-valid capture of the
        // same (unit, activity) — never clobber it with the displaced copy.
        prev[displacedKey] ? prev : { ...prev, [displacedKey]: displaced }
      );
    }

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
          // Preserve original capturedAt if re-editing an already-queued item — but a
          // switch is a NEW capture of a DIFFERENT slot: inheriting the displaced
          // slot's capture time would mis-order this write under the last-write-wins
          // guard, and inheriting its extraProps would graft the old activity's dates
          // onto this one.
          capturedAt: isActivitySwitch ? now : (existing.capturedAt ?? now),
          extraProps: isActivitySwitch ? { ...extraProps } : { ...existing.extraProps, ...extraProps },
        },
      };
    });
    // Re-editing a failed item clears its red flag — the user is acting on it, and the
    // next Apply re-evaluates from scratch (Save Visibility — Phase 1). setFailedKeys is
    // a stable dispatch, so the empty-deps stable identity this row memo relies on holds.
    const failKey = pendingChangeKey({ unit, log: baseLog, extraProps });
    setFailedKeys((prev) => withoutFailedKey(prev, failKey));
  }, []);

  const handleTimelineUpdate = useCallback((unit: Unit, baseLog: StatusLog | null, state: TemporalState, extraProps: Record<string, any> = {}) => {
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
    // Re-editing a failed item clears its red flag (see handleLocalUpdate). Keyed via
    // pendingChangeKey so it matches the failed-set entry the last Apply recorded.
    setFailedKeys((prev) => withoutFailedKey(prev, pendingChangeKey({ unit, log: baseLog, extraProps })));
  }, []);

  const handleRemovePendingItem = (unitId: string, activityName?: string | null): boolean => {
    if (activityName) {
      const slotKey = `${unitId}_${activityName}`;
      // The named slot can live in EITHER map since activity-switch parking: the
      // primary slot holds the activity the row currently shows, parked ones sit in
      // the timeline map. Removing "Drywall" from the drawer has to clear whichever
      // map is holding it, or the item reappears and still gets written on Apply.
      const primary = pendingChanges[unitId];
      const primaryIsThisSlot = primary !== undefined && pendingChangeKey(primary) === slotKey;
      const hasPrimary = primary !== undefined && !primaryIsThisSlot;
      const removed = pendingTimelineChanges[slotKey] ?? (primaryIsThisSlot ? primary : undefined);
      const remainingTimelineKeys = Object.keys(pendingTimelineChanges).filter(
        (k) => k.startsWith(`${unitId}_`) && k !== slotKey
      );
      const hasRemaining = hasPrimary || remainingTimelineKeys.length > 0;

      setPendingTimelineChanges((prev) => {
        const next = { ...prev };
        delete next[slotKey];
        return next;
      });
      if (primaryIsThisSlot) {
        setPendingChanges((prev) => {
          const next = { ...prev };
          delete next[unitId];
          return next;
        });
      }

      // Dropping a queued item also drops its failed flag (Save Visibility — Phase 1).
      if (removed) setFailedKeys((prev) => withoutFailedKey(prev, pendingChangeKey(removed)));

      return hasRemaining;
    } else {
      const removed = pendingChanges[unitId];
      const remainingTimelineKeys = Object.keys(pendingTimelineChanges).filter(
        (k) => k.startsWith(`${unitId}_`)
      );
      const hasRemaining = remainingTimelineKeys.length > 0;

      setPendingChanges((prev) => {
        const next = { ...prev };
        delete next[unitId];
        return next;
      });

      if (removed) setFailedKeys((prev) => withoutFailedKey(prev, pendingChangeKey(removed)));

      return hasRemaining;
    }
  };

  const handleDiscardAll = () => {
    setPendingChanges({});
    setPendingTimelineChanges({});
    setFailedKeys(new Set()); // No queue → no failed flags
    clearPersistedPendingChanges(projectId);
  };

  const pendingCount = useMemo(() => {
    const dedupedChanges = new Set<string>();
    Object.values(pendingChanges).forEach(c => dedupedChanges.add(pendingChangeKey(c)));
    Object.values(pendingTimelineChanges).forEach(c => dedupedChanges.add(pendingChangeKey(c)));
    return dedupedChanges.size;
  }, [pendingChanges, pendingTimelineChanges]);

  // How many distinct staged changes failed their last Apply (drives the 'error' sync
  // state + the red "N failed to save"). Keyed identically to pendingCount, so a failed
  // count can never exceed the pending count.
  const failedCount = failedKeys.size;

  // The unit ids that have at least one failed change — for per-row marking. LocationRow
  // receives a per-row `isFailed` BOOLEAN derived from this (never this Set itself), so a
  // change to one row's failed state can't re-render the whole memoized table (List View
  // Perf Phase 3). Unit ids are UUIDs (no `_`), so slice at the first `_` recovers them.
  const failedUnitIds = useMemo(() => {
    const ids = new Set<string>();
    for (const key of failedKeys) {
      const sep = key.indexOf('_');
      ids.add(sep >= 0 ? key.slice(0, sep) : key);
    }
    return ids;
  }, [failedKeys]);

  const handleApplyAll = async (): Promise<{ succeeded: number; failed: number }> => {
    const changesArray = [
      ...Object.values(pendingChanges),
      ...Object.values(pendingTimelineChanges)
    ];
    
    const dedupedMap = new Map<string, PendingChange>();
    changesArray.forEach(c => dedupedMap.set(pendingChangeKey(c), c));

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
        // Drop ONLY this slot. `livePending` is keyed by unit id, so an unguarded
        // `delete livePending[unit.id]` would also drain a DIFFERENT activity staged
        // on the same location — and if that one then failed, it would be gone from
        // the queue with nothing to retry. Reachable since activity-switch parking:
        // one location can hold a primary slot plus parked timeline slots. Same guard
        // handleRetryItem already uses.
        const key = pendingChangeKey(change);
        const primary = livePending[change.unit.id];
        if (primary && pendingChangeKey(primary) === key) delete livePending[change.unit.id];
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

      // Record exactly which items failed this Apply (Save Visibility — Phase 1).
      // results[i] ↔ finalChanges[i], so a failed result maps back to its queued item via
      // the SAME key the queue dedupes/checkpoints on. This REPLACES the prior failed set:
      // an item that now succeeds drops out (checkpointed, no longer pending), a re-failure
      // stays, so Retry re-evaluates cleanly. `error` beats `pending`; a fully clean Apply
      // yields an empty set → the sync state falls through to `synced`.
      const nextFailedKeys = new Set<string>();
      for (const r of results) {
        if (!r.ok) nextFailedKeys.add(pendingChangeKey(finalChanges[r.index]));
      }
      setFailedKeys(nextFailedKeys);

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

  // Retry ONE staged change (Save Visibility — Phase 2) — so a single bad change can be
  // re-sent (or dropped) without dragging the whole batch along, and one failure can't hide
  // inside the count. Reuses the EXACT write path as handleApplyAll's worker — the same
  // onApplyPendingChanges([change]) → commitUnitActivity → upsert_status_log with the
  // change's capture-time client_timestamp — only with a one-item array. No new mutation, no
  // queue-mechanic change (AGENTS.md §2).
  //
  // Serialized against an in-flight batch Apply (and any other retry) by isSyncingRef: bail
  // if a sync loop is already running. While it runs we hold isSyncingRef (so the reactive
  // IDB persist effects stay quiesced) and checkpoint the drained queue explicitly, exactly
  // like handleApplyAll. Returns true on success, false if it failed / could not start.
  const handleRetryItem = async (change: PendingChange): Promise<boolean> => {
    if (isSyncingRef.current || !onApplyPendingChanges) return false;
    const key = pendingChangeKey(change);

    setIsApplying(true);
    isSyncingRef.current = true;

    // Snapshot the live queue so a success can write the drained state straight to IDB —
    // the reactive persist effects are quiesced while isSyncingRef is set (mirrors the
    // per-item checkpoint in handleApplyAll).
    const livePending = { ...pendingChanges };
    const liveTimeline = { ...pendingTimelineChanges };

    try {
      await onApplyPendingChanges([change]);

      // Drop ONLY this slot. The timeline entry is keyed by the slot key; the primary is
      // keyed by unit.id — delete that ONLY when it is for this SAME slot (same activity),
      // so retrying one activity can't silently drop a DIFFERENT queued activity on the unit.
      const primary = livePending[change.unit.id];
      if (primary && pendingChangeKey(primary) === key) delete livePending[change.unit.id];
      delete liveTimeline[key];

      await persistCurrentQueue(projectId, livePending, liveTimeline);
      setPendingChanges(livePending);
      setPendingTimelineChanges(liveTimeline);
      setFailedKeys((prev) => withoutFailedKey(prev, key));

      // Fully drained → clean the IDB keys, same belt-and-suspenders as handleApplyAll.
      if (Object.keys(livePending).length === 0 && Object.keys(liveTimeline).length === 0) {
        await clearPersistedPendingChanges(projectId);
      }
      return true;
    } catch {
      // Keep it queued and (re)flag it red so the row + aggregate bar surface the failure.
      setFailedKeys((prev) => {
        if (prev.has(key)) return prev;
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      return false;
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
    failedCount,
    failedUnitIds,
    // The full failed-key set — for the drill-in surfaces (drawer / desktop popover) that
    // look up per-ITEM failed state by key. These are NOT memoized-row props, so passing the
    // Set is safe; LocationRow still receives only a per-row `isFailed` boolean (Phase 3 memo).
    failedKeys,
    setPendingChanges,
    setPendingTimelineChanges,
    isApplying,
    handleLocalUpdate,
    handleTimelineUpdate,
    handleRemovePendingItem,
    handleRetryItem,
    handleDiscardAll,
    handleApplyAll,
    trackingMode,
  };
}

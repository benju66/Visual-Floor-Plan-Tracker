import { useMemo, useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useMapStore } from '@/store/useMapStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useProject, useUnits, useMilestones } from '@/hooks/useProjectQueries';

/**
 * useFieldData — shared business logic hook for the FieldStatusTable container.
 *
 * Owns: sort state, filter state, viewStyle, pendingChanges, isApplying,
 *       ranked/visible memos, handleLocalUpdate, handleApplyAll, handleSort.
 *
 * Does NOT own: mobile swipe state, desktop selection (lastClickedIndex),
 *               selectedUnitIds (Zustand — stays in container/presenters),
 *               renderSortIcon (JSX — lives in StatusTable).
 *
 * IDB / offline constraint: handleApplyAll must remain the sole entry point
 * to onApplyPendingChanges. Do not add retry logic or re-queue mutations here —
 * TanStack Query's offlineFirst networkMode handles that via PersistQueryClientProvider.
 */
export function useFieldData({ activeStatuses, defaultView, onApplyPendingChanges }) {
  // --- Store subscriptions (read-only) ---
  const activeSheetId = useMapStore((s) => s.activeSheetId);
  const trackingMode = useMapStore((s) => s.trackingMode);
  const statusFilter = useSettingsStore((s) => s.filterMilestone);

  // --- Data queries ---
  const params = useParams();
  const projectId = params?.projectId;

  const { data: project } = useProject(projectId);
  const projectUnitTypes = project?.unit_types || [
    'Apartment Unit',
    'Common Area',
    'Back of House',
    'Commercial Space',
    'Other',
  ];
  const { data: allMilestones = [] } = useMilestones(projectId);
  const { data: units = [] } = useUnits(activeSheetId);

  const currentMilestones = useMemo(
    () =>
      allMilestones
        .filter((m) => m.track === trackingMode)
        .sort((a, b) => (a.sequence_order || 0) - (b.sequence_order || 0)),
    [allMilestones, trackingMode]
  );

  // --- Local UI state ---
  const [sortColumn, setSortColumn] = useState('unit');
  const [sortDirection, setSortDirection] = useState('asc');
  const [typeFilter, setTypeFilter] = useState('All');

  const [viewStyle, setViewStyle] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) return 'card';
    return defaultView;
  });

  const [pendingChanges, setPendingChanges] = useState({});
  const [isApplying, setIsApplying] = useState(false);

  // Sync viewStyle when the defaultView prop changes (e.g. settings updated)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setViewStyle('card');
    } else {
      setViewStyle(defaultView);
    }
  }, [defaultView]);

  // Hide global header elements while in card/swipe mode
  useEffect(() => {
    if (viewStyle === 'card') {
      document.documentElement.classList.add('hide-header-elements');
    } else {
      document.documentElement.classList.remove('hide-header-elements');
    }
    return () => {
      document.documentElement.classList.remove('hide-header-elements');
    };
  }, [viewStyle]);

  // --- Handlers ---

  const handleLocalUpdate = (unit, baseLog, state, extraProps = {}) => {
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
          extraProps: { ...existing.extraProps, ...extraProps },
        },
      };
    });
  };

  /**
   * Applies all pending changes through the established mutation chain.
   * try/finally guarantees isApplying resets even when a mutation throws
   * (e.g. offline-paused mutateAsync rejection, RLS violation).
   */
  const handleApplyAll = async () => {
    const changesArray = Object.values(pendingChanges);
    if (changesArray.length === 0) return;
    setIsApplying(true);
    try {
      await onApplyPendingChanges?.(changesArray);
      setPendingChanges({});
    } finally {
      setIsApplying(false);
    }
  };

  const handleSort = (col) => {
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
        log: activeStatuses.find((s) => s.unit_id === unit.id),
      }))
      .sort((a, b) => {
        let cmp = 0;
        if (sortColumn === 'unit') {
          cmp = a.unit.unit_number.localeCompare(b.unit.unit_number, undefined, {
            numeric: true,
            sensitivity: 'base',
          });
        } else if (sortColumn === 'walk_sequence') {
          const seqA = typeof a.unit.walk_sequence === 'number' ? a.unit.walk_sequence : 99999;
          const seqB = typeof b.unit.walk_sequence === 'number' ? b.unit.walk_sequence : 99999;
          cmp = seqA - seqB;
          if (cmp === 0) {
            cmp = a.unit.unit_number.localeCompare(b.unit.unit_number, undefined, {
              numeric: true,
              sensitivity: 'base',
            });
          }
        } else if (sortColumn === 'status') {
          const ma = a.log?.milestone || '';
          const mb = b.log?.milestone || '';
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
      filtered = filtered.filter((row) => row.log?.milestone === statusFilter);
    }
    if (typeFilter !== 'All') {
      filtered = filtered.filter((row) => row.unit.unit_type === typeFilter);
    }
    return filtered;
  }, [ranked, statusFilter, typeFilter]);

  return {
    // Data
    units,
    projectUnitTypes,
    currentMilestones,
    // Derived lists
    ranked,
    visible,
    // Sort state (renderSortIcon is NOT returned — JSX stays in StatusTable)
    sortColumn,
    sortDirection,
    handleSort,
    // Filter state
    typeFilter,
    setTypeFilter,
    // View style
    viewStyle,
    setViewStyle,
    // Pending changes & apply
    pendingChanges,
    setPendingChanges,
    isApplying,
    handleLocalUpdate,
    handleApplyAll,
  };
}

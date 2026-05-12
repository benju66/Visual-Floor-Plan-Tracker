import { useMemo, useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useMapStore } from '@/store/useMapStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useProject, useUnits, useMilestones } from '@/hooks/useProjectQueries';
import type { Unit, StatusLog, PendingChangesMap, PendingChange, TemporalState, Milestone } from '@/types/domain';

interface UseFieldDataProps {
  activeStatuses: StatusLog[];
  defaultView: string;
  onApplyPendingChanges?: (changes: PendingChange[]) => Promise<void>;
}

export function useFieldData({ activeStatuses, defaultView, onApplyPendingChanges }: UseFieldDataProps) {
  // --- Store subscriptions (read-only) ---
  const activeSheetId = useMapStore((s) => s.activeSheetId);
  const trackingMode = useMapStore((s) => s.trackingMode);
  const statusFilter = useSettingsStore((s) => s.filterMilestone);

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
  const [sortColumn, setSortColumn] = useState<string>('unit');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [typeFilter, setTypeFilter] = useState<string>('All');

  const [viewStyle, setViewStyle] = useState<string>(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) return 'card';
    return defaultView;
  });

  const [pendingChanges, setPendingChanges] = useState<PendingChangesMap>({});
  const [pendingTimelineChanges, setPendingTimelineChanges] = useState<PendingChangesMap>({});
  const [isApplying, setIsApplying] = useState<boolean>(false);

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

  const handleLocalUpdate = (unit: Unit, baseLog: StatusLog | null, state: TemporalState, extraProps: Record<string, any> = {}) => {
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

  const handleTimelineUpdate = (unit: Unit, baseLog: StatusLog | null, state: TemporalState, extraProps: Record<string, any> = {}) => {
    const milestoneName = extraProps?.milestoneObj?.name || baseLog?.milestone;
    const key = `${unit.id}_${milestoneName}`;
    setPendingTimelineChanges((prev) => ({
      ...prev,
      [key]: {
        unit,
        log: baseLog,
        state,
        extraProps
      }
    }));
  };

  const handleRemovePendingItem = (unitId: string, milestoneName?: string) => {
    let hasRemaining = false;

    if (milestoneName) {
      setPendingTimelineChanges((prev) => {
        const next = { ...prev };
        delete next[`${unitId}_${milestoneName}`];
        return next;
      });
      const hasPrimary = pendingChanges[unitId] !== undefined;
      const remainingTimelineKeys = Object.keys(pendingTimelineChanges).filter(
        (k) => k.startsWith(`${unitId}_`) && k !== `${unitId}_${milestoneName}`
      );
      hasRemaining = hasPrimary || remainingTimelineKeys.length > 0;
    } else {
      setPendingChanges((prev) => {
        const next = { ...prev };
        delete next[unitId];
        return next;
      });
      const remainingTimelineKeys = Object.keys(pendingTimelineChanges).filter(
        (k) => k.startsWith(`${unitId}_`)
      );
      hasRemaining = remainingTimelineKeys.length > 0;
    }

    return hasRemaining;
  };

  const handleDiscardAll = () => {
    setPendingChanges({});
    setPendingTimelineChanges({});
  };

  const pendingCount = useMemo(() => {
    const dedupedChanges = new Set<string>();
    Object.values(pendingChanges).forEach(c => {
      const mName = c.extraProps?.milestoneObj?.name || c.log?.milestone || 'Primary';
      dedupedChanges.add(`${c.unit.id}_${mName}`);
    });
    Object.values(pendingTimelineChanges).forEach(c => {
      const mName = c.extraProps?.milestoneObj?.name || c.log?.milestone || 'Primary';
      dedupedChanges.add(`${c.unit.id}_${mName}`);
    });
    return dedupedChanges.size;
  }, [pendingChanges, pendingTimelineChanges]);

  const handleApplyAll = async () => {
    const changesArray = [
      ...Object.values(pendingChanges),
      ...Object.values(pendingTimelineChanges)
    ];
    
    const dedupedMap = new Map<string, PendingChange>();
    changesArray.forEach(c => {
       const mName = c.extraProps?.milestoneObj?.name || c.log?.milestone || 'Primary';
       dedupedMap.set(`${c.unit.id}_${mName}`, c);
    });
    
    const finalChanges = Array.from(dedupedMap.values());
    if (finalChanges.length === 0) return;
    
    setIsApplying(true);
    try {
      await onApplyPendingChanges?.(finalChanges);
      setPendingChanges({});
      setPendingTimelineChanges({});
    } finally {
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
    units,
    projectUnitTypes,
    currentMilestones,
    ranked,
    visible,
    sortColumn,
    sortDirection,
    handleSort,
    typeFilter,
    setTypeFilter,
    viewStyle,
    setViewStyle,
    pendingChanges,
    pendingTimelineChanges,
    pendingCount,
    setPendingChanges,
    isApplying,
    handleLocalUpdate,
    handleTimelineUpdate,
    handleRemovePendingItem,
    handleDiscardAll,
    handleApplyAll,
    trackingMode,
  };
}

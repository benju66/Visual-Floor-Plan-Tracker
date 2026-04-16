import fs from 'fs';

let code = fs.readFileSync('c:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next/src/components/FloorplanCanvas.jsx', 'utf8');

// 1. imports
code = code.replace(
  "import { ICON_PATHS } from '@/utils/constants';",
  "import { ICON_PATHS } from '@/utils/constants';\nimport { useAppStore, useHydratedStore } from '@/store/useAppStore';\nimport { useProject, useUnits, useStatuses, useMilestones } from '@/hooks/useProjectQueries';"
);

// 2. Component signature
const oldSignature = `const FloorplanCanvas = forwardRef(({
  imageUrl,
  units,
  activeStatuses,
  toolMode,
  onToolModeChange,
  onUpdateUnitPolygon,
  onUpdateUnitIconOffset,
  onDuplicateUnit,
  onPolygonComplete,
  legendFilter,
  selectedUnitId,
  onSelectUnit,
  onRenameUnit,
  onDeleteUnit,
  onInstantStamp,
  pendingPolygonPoints,
  onPendingPolygonMove,
  onAddNodeToSegment,
  onPendingPolygonComplete,
  showTooltip,
  settings,
  temporalFilters,
  onOpenMilestoneModal,
  onOpenStatusModal,
  legendPosition,
  onLegendDragEnd,
  milestones,
}, ref) => {`;

const newSignature = `const FloorplanCanvas = forwardRef(({
  imageUrl,
  onUpdateUnitPolygon,
  onUpdateUnitIconOffset,
  onDuplicateUnit,
  onPolygonComplete,
  onRenameUnit,
  onDeleteUnit,
  onInstantStamp,
  pendingPolygonPoints,
  onPendingPolygonMove,
  onPendingPolygonComplete,
  onOpenMilestoneModal,
  onOpenStatusModal,
}, ref) => {
  const activeSheetId = useAppStore(s => s.activeSheetId);
  const toolMode = useAppStore(s => s.toolMode);
  const onToolModeChange = useAppStore(s => s.setToolMode);
  const legendFilter = useAppStore(s => s.filterMilestone);
  const selectedUnitId = useAppStore(s => s.selectedUnitId);
  const onSelectUnit = useAppStore(s => s.setSelectedUnitId);
  const temporalFilters = useAppStore(s => s.temporalFilters);
  const trackingMode = useAppStore(s => s.trackingMode);
  
  const settings = useHydratedStore(s => s.settings, { showTooltips: true });
  const legendPosition = useHydratedStore(s => s.legendPosition, { isVisible: false });
  const onLegendDragEnd = useAppStore(s => s.setLegendPosition);

  const { data: project } = useProject();
  const { data: allMilestones = [] } = useMilestones(project?.id);
  const milestones = allMilestones.filter(m => m.track === trackingMode);
  const { data: units = [] } = useUnits(activeSheetId);
  const { data: statuses = [] } = useStatuses(activeSheetId, units.map(u => u.id), allMilestones);
  const activeStatuses = statuses.filter(s => s.track === trackingMode);
`;

code = code.replace(oldSignature, newSignature);
// Replace showTooltip
code = code.replace(/showTooltip/g, 'settings?.showHistoryHover');

fs.writeFileSync('c:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next/src/components/FloorplanCanvas.jsx', code);
console.log('Canvas refactored');

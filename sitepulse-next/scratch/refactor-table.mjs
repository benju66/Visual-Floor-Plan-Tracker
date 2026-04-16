import fs from 'fs';

let code = fs.readFileSync('c:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next/src/components/FieldStatusTable.jsx', 'utf8');

// 1. imports
code = code.replace(
  "import React, { useMemo, useState, useEffect } from 'react';",
  "import React, { useMemo, useState, useEffect } from 'react';\nimport { useAppStore } from '@/store/useAppStore';\nimport { useProject, useUnits, useStatuses, useMilestones } from '@/hooks/useProjectQueries';"
);

// 2. signature
const oldSignature = `export default function FieldStatusTable({
  units,
  activeStatuses,
  statusFilter,
  savingUnitId,
  onChooseStatus,
  defaultView = 'table',
  onSelectUnit,
  onUpdateTemporalState,
}) {`;

const newSignature = `export default function FieldStatusTable({
  savingUnitId,
  onChooseStatus,
  defaultView = 'table',
  onUpdateTemporalState,
}) {
  const activeSheetId = useAppStore(s => s.activeSheetId);
  const statusFilter = useAppStore(s => s.filterMilestone);
  const onSelectUnit = useAppStore(s => s.setSelectedUnitId);
  const trackingMode = useAppStore(s => s.trackingMode);
  
  const { data: project } = useProject();
  const { data: allMilestones = [] } = useMilestones(project?.id);
  const { data: units = [] } = useUnits(activeSheetId);
  const { data: statuses = [] } = useStatuses(activeSheetId, units.map(u => u.id), allMilestones);
  const activeStatuses = statuses.filter(s => s.track === trackingMode);
`;

code = code.replace(oldSignature, newSignature);

fs.writeFileSync('c:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next/src/components/FieldStatusTable.jsx', code);
console.log('Table refactored');

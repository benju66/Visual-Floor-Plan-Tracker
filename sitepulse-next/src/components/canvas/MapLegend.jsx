import React, { useMemo } from 'react';
import { Group, Rect, Text } from 'react-konva';

export default function MapLegend({
  x,
  y,
  units,
  milestones,
  activeStatuses,
  isVisible,
  onDragEnd,
  stageScale
}) {
  const activeMilestones = useMemo(() => {
    if (!isVisible) return [];
    
    // Find units that have active statuses in planned, ongoing, completed
    const matchingStatuses = activeStatuses.filter(s => 
      ['planned', 'ongoing', 'completed'].includes(s.temporal_state) &&
      units.some(u => u.id === s.unit_id)
    );

    // Get unique milestone names
    const uniqueMilestoneNames = [...new Set(matchingStatuses.map(s => s.milestone))];
    
    // Map names to milestone objects from the 'milestones' array to get color
    const legendItems = uniqueMilestoneNames.map(name => {
      const milestone = milestones.find(m => m.name === name);
      const log = matchingStatuses.find(s => s.milestone === name); // fallback for color
      return {
        name,
        color: milestone?.color || milestone?.status_color || log?.status_color || '#cccccc'
      };
    });

    return legendItems;
  }, [isVisible, activeStatuses, units, milestones]);

  if (!isVisible || activeMilestones.length === 0) return null;

  const itemHeight = 24;
  const padding = 16;
  const legendWidth = 200;
  const titleHeight = 30;
  const legendHeight = padding * 2 + titleHeight + (activeMilestones.length * itemHeight);

  // Inverse scale to keep legend size constant regardless of stage zoom
  const scale = 1 / stageScale;

  return (
    <Group 
      x={x} 
      y={y} 
      draggable 
      onDragEnd={onDragEnd}
    >
      <Group scaleX={scale} scaleY={scale}>
        <Rect
          width={legendWidth}
          height={legendHeight}
          fill="rgba(255, 255, 255, 0.95)"
          cornerRadius={8}
          shadowColor="rgba(0,0,0,0.2)"
          shadowBlur={10}
          shadowOffsetX={0}
          shadowOffsetY={4}
        />

        <Text
          x={padding}
          y={padding}
          text="Sheet Legend"
          fontSize={16}
          fontStyle="bold"
          fill="#334155"
        />

        {activeMilestones.map((item, idx) => {
          const itemY = padding + titleHeight + (idx * itemHeight);
          return (
            <Group key={item.name} y={itemY}>
              <Rect
                x={padding}
                y={0}
                width={14}
                height={14}
                fill={item.color}
                cornerRadius={3}
                stroke="#cbd5e1"
                strokeWidth={1}
              />
              <Text
                x={padding + 22}
                y={0}
                text={item.name}
                fontSize={14}
                fill="#475569"
                verticalAlign="middle"
                height={14}
              />
            </Group>
          );
        })}
      </Group>
    </Group>
  );
}

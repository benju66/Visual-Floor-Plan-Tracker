import React, { useMemo, useRef, useEffect } from 'react';
import { Group, Rect, Text, Transformer, Circle, Path } from 'react-konva';
import { ICON_PATHS } from '@/utils/constants';

export default function MapLegend({
  pctX = 0.05,
  pctY = 0.05,
  scaleX = 1,
  scaleY = 1,
  rotation = 0,
  layout,
  units,
  milestones,
  activeStatuses,
  isVisible,
  onUpdate,
  isSelected,
  onSelect
}) {
  const groupRef = useRef(null);
  const trRef = useRef(null);

  useEffect(() => {
    if (isSelected && trRef.current && groupRef.current) {
      trRef.current.nodes([groupRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [isSelected]);

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

  const activeTemporalStates = useMemo(() => {
    if (!isVisible) return [];
    const states = activeStatuses
      .filter(s => ['planned', 'ongoing', 'completed'].includes(s.temporal_state) && units.some(u => u.id === s.unit_id))
      .map(s => s.temporal_state);
    return [...new Set(states)];
  }, [isVisible, activeStatuses, units]);

  if (!isVisible || (activeMilestones.length === 0 && activeTemporalStates.length === 0)) return null;

  const itemHeight = 24;
  const padding = 16;
  const legendWidth = 200;
  const titleHeight = 30;
  
  const milestonesHeight = activeMilestones.length > 0 ? titleHeight + (activeMilestones.length * itemHeight) : 0;
  const statusesHeight = activeTemporalStates.length > 0 ? titleHeight + (activeTemporalStates.length * itemHeight) : 0;
  const totalItemsHeight = milestonesHeight + statusesHeight + (activeMilestones.length > 0 && activeTemporalStates.length > 0 ? padding : 0);
  
  const legendHeight = padding * 2 + totalItemsHeight;

  const x = layout.offsetX + pctX * layout.drawW;
  const y = layout.offsetY + pctY * layout.drawH;

  const TEMPORAL_COLORS = {
    planned: '#94a3b8',
    ongoing: '#f59e0b',
    completed: '#10b981',
  };

  return (
    <>
      <Group 
        ref={groupRef}
        x={x} 
        y={y} 
        scaleX={scaleX}
        scaleY={scaleY}
        rotation={rotation}
        draggable 
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={(e) => {
          const newPctX = (e.target.x() - layout.offsetX) / layout.drawW;
          const newPctY = (e.target.y() - layout.offsetY) / layout.drawH;
          onUpdate?.({ pctX: newPctX, pctY: newPctY });
        }}
        onTransformEnd={(e) => {
          const node = groupRef.current;
          const newScaleX = node.scaleX();
          const newScaleY = node.scaleY();
          const newPctX = (node.x() - layout.offsetX) / layout.drawW;
          const newPctY = (node.y() - layout.offsetY) / layout.drawH;
          
          node.scaleX(1);
          node.scaleY(1);
          
          onUpdate?.({
            pctX: newPctX,
            pctY: newPctY,
            scaleX: scaleX * newScaleX,
            scaleY: scaleY * newScaleY,
            rotation: node.rotation()
          });
        }}
      >
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

        {activeMilestones.length > 0 && (
          <Text
            x={padding}
            y={padding}
            text="Milestones"
            fontSize={16}
            fontStyle="bold"
            fill="#334155"
          />
        )}

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

        {activeTemporalStates.length > 0 && (
          <Group y={padding + milestonesHeight + (activeMilestones.length > 0 ? padding : 0)}>
            <Text
              x={padding}
              y={0}
              text="Map Statuses"
              fontSize={16}
              fontStyle="bold"
              fill="#334155"
            />
            {activeTemporalStates.map((state, idx) => {
              const itemY = titleHeight + (idx * itemHeight);
              const iconColor = TEMPORAL_COLORS[state] || '#cbd5e1';
              return (
                <Group key={state} y={itemY}>
                  <Group x={padding + 7} y={7} scale={{ x: 0.8, y: 0.8 }}>
                    <Circle
                      radius={12}
                      fill="#ffffff"
                      stroke={iconColor}
                      strokeWidth={2.5}
                      shadowColor="rgba(0,0,0,0.4)"
                      shadowBlur={4}
                      shadowOffset={{ x: 0, y: 2 }}
                    />
                    <Path
                      x={-8}
                      y={-8}
                      data={ICON_PATHS[state] || ICON_PATHS.completed}
                      fill="transparent"
                      stroke={iconColor}
                      strokeWidth={2}
                      strokeLineCap="round"
                      strokeLineJoin="round"
                      scale={{ x: 0.65, y: 0.65 }}
                    />
                  </Group>
                  <Text
                    x={padding + 22}
                    y={0}
                    text={state.charAt(0).toUpperCase() + state.slice(1)}
                    fontSize={14}
                    fill="#475569"
                    verticalAlign="middle"
                    height={14}
                  />
                </Group>
              );
            })}
          </Group>
        )}
      </Group>
      {isSelected && (
        <Transformer
          ref={trRef}
          enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
          keepRatio={true}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 50 || newBox.height < 50) return oldBox;
            return newBox;
          }}
        />
      )}
    </>
  );
}

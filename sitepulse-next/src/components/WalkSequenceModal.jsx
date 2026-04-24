import React, { useState, useMemo } from 'react';
import { X, GripVertical, Plus } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useUpdateWalkSequence } from '@/hooks/useProjectQueries';

function SortableItem({ id, unit, onRemove }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center justify-between p-3 mb-2 rounded-xl border bg-white dark:bg-slate-800 ${
        isDragging
          ? 'shadow-xl ring-2 ring-emerald-500 border-emerald-500 opacity-90 scale-[1.02]'
          : 'shadow-sm border-slate-200 dark:border-slate-700'
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          <GripVertical size={18} />
        </div>
        <div className="flex flex-col">
          <span className="font-bold text-slate-900 dark:text-slate-100">{unit.unit_number}</span>
          {unit.unit_type && (
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{unit.unit_type}</span>
          )}
        </div>
      </div>
      <button
        onClick={() => onRemove(unit.id)}
        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  );
}

export default function WalkSequenceModal({ units, sheetId, onClose }) {
  const [routed, setRouted] = useState(() => {
    return [...units]
      .filter(u => typeof u.walk_sequence === 'number')
      .sort((a, b) => a.walk_sequence - b.walk_sequence);
  });

  const unrouted = useMemo(() => {
    const routedIds = new Set(routed.map(u => u.id));
    return units
      .filter(u => !routedIds.has(u.id))
      .sort((a, b) => a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true }));
  }, [units, routed]);

  const updateMutation = useUpdateWalkSequence(sheetId);
  const [isSaving, setIsSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setRouted((items) => {
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const handleRemove = (id) => {
    setRouted(prev => prev.filter(u => u.id !== id));
  };

  const handleAdd = (unit) => {
    setRouted(prev => [...prev, unit]);
  };

  const handleSave = async () => {
    setIsSaving(true);
    const updates = [];
    
    // Map routed units to sequence (1-indexed)
    routed.forEach((u, index) => {
      updates.push({ id: u.id, walk_sequence: index + 1 });
    });

    // Map unrouted units to null
    unrouted.forEach(u => {
      updates.push({ id: u.id, walk_sequence: null });
    });

    try {
      await updateMutation.mutateAsync(updates);
      onClose();
    } catch (e) {
      console.error(e);
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-50 dark:bg-slate-900 w-full max-w-lg max-h-[85vh] rounded-2xl shadow-2xl flex flex-col border border-slate-200 dark:border-slate-800 overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white">Route Sort</h2>
            <p className="text-xs text-slate-500 font-semibold mt-0.5">Drag to order locations, or remove unneeded ones.</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded-full transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-400">Routed Locations ({routed.length})</h3>
            </div>
            
            {routed.length === 0 ? (
              <div className="p-6 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-center">
                <p className="text-sm font-semibold text-slate-500">No locations routed yet.</p>
                <p className="text-xs text-slate-400 mt-1">Add locations from below.</p>
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={routed.map(u => u.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1">
                    {routed.map(unit => (
                      <SortableItem key={unit.id} id={unit.id} unit={unit} onRemove={handleRemove} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>

          {unrouted.length > 0 && (
            <div>
              <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-3 border-t border-slate-200 dark:border-slate-800 pt-6">Unrouted Locations ({unrouted.length})</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {unrouted.map(unit => (
                  <button
                    key={unit.id}
                    onClick={() => handleAdd(unit)}
                    className="flex items-center justify-between p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-emerald-400 dark:hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-left transition-colors group"
                  >
                    <span className="font-bold text-sm text-slate-700 dark:text-slate-300 group-hover:text-emerald-700 dark:group-hover:text-emerald-400">{unit.unit_number}</span>
                    <Plus size={14} className="text-slate-300 group-hover:text-emerald-500" />
                  </button>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="px-5 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2.5 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Route'}
          </button>
        </div>

      </div>
    </div>
  );
}

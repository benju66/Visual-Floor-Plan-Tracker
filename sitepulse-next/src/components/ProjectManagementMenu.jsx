import React, { useState } from 'react';
import { FolderEdit, X, Trash2, Edit2, Check, AlertTriangle, GripVertical } from 'lucide-react';
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
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function SortableSheetItem({
  sheet, editingId, editName, setEditName, handleSaveEdit, setEditingId,
  confirmDeleteId, setConfirmDeleteId, onDeleteSheet, handleStartEdit
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: sheet.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center justify-between p-3 rounded-xl border border-slate-200/60 dark:border-white/10 ${
        isDragging ? 'bg-blue-50/80 dark:bg-blue-900/40 shadow-lg scale-[1.02]' : 'bg-white/40 dark:bg-black/20'
      }`}
    >
      <div 
        {...attributes} 
        {...listeners} 
        className="mr-3 cursor-grab hover:text-blue-500 text-slate-400 focus:outline-none touch-none"
      >
        <GripVertical size={18} />
      </div>

      {editingId === sheet.id ? (
        <div className="flex-1 flex items-center gap-2 mr-2">
          <input
            autoFocus
            className="flex-1 bg-white dark:bg-slate-800 border-2 border-sky-500 rounded-lg px-2 py-1 outline-none text-sm font-medium"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
          />
          <button
            onClick={handleSaveEdit}
            className="p-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg shadow-sm"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            onClick={() => setEditingId(null)}
            className="p-1.5 bg-slate-300 dark:bg-slate-700 hover:bg-slate-400 dark:hover:bg-slate-600 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : confirmDeleteId === sheet.id ? (
        <div className="flex-1 flex items-center justify-between">
          <span className="text-sm font-semibold flex items-center gap-1.5 text-red-600 dark:text-red-400">
            <AlertTriangle className="w-4 h-4" /> Delete this level forever?
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmDeleteId(null)}
              className="px-3 py-1 text-xs font-medium border rounded-lg hover:bg-slate-100 dark:hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              onClick={() => onDeleteSheet(sheet.id)}
              className="px-3 py-1 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-lg shadow-sm"
            >
              Confirm Wipe
            </button>
          </div>
        </div>
      ) : (
        <>
          <span className="font-semibold text-sm mr-auto">{sheet.sheet_name}</span>
          <div className="flex gap-1.5">
            <button
              onClick={() => handleStartEdit(sheet)}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-white/60 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white transition-colors"
              title="Rename Level"
            >
              <Edit2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setConfirmDeleteId(sheet.id)}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-600 dark:hover:text-red-400 transition-colors"
              title="Delete Level"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function ProjectManagementMenu({
  open,
  onClose,
  sheets,
  onRenameSheet,
  onDeleteSheet,
  onReorderSheets
}) {
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  if (!open) return null;

  const handleStartEdit = (sheet) => {
    setEditingId(sheet.id);
    setEditName(sheet.sheet_name);
    setConfirmDeleteId(null);
  };

  const handleSaveEdit = async () => {
    if (editName.trim() && editingId) {
      await onRenameSheet(editingId, editName.trim());
    }
    setEditingId(null);
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    
    // Safety check - do not allow drag if a sheet is in edit/delete mode.
    if (editingId || confirmDeleteId) return;

    if (onReorderSheets && active.id !== over.id) {
      const oldIndex = sheets.findIndex(s => s.id === active.id);
      const newIndex = sheets.findIndex(s => s.id === over.id);
      
      const newSheetsOrder = arrayMove(sheets, oldIndex, newIndex);
      
      const updatedSheets = newSheetsOrder.map((s, index) => ({
        ...s,
        sequence_order: index
      }));
      
      onReorderSheets(updatedSheets);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm transition-opacity"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border p-6 shadow-2xl glass-panel animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <FolderEdit className="w-5 h-5" /> Manage Levels
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-500/20 transition-colors"
          >
            <X className="w-5 h-5 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100" />
          </button>
        </div>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2 relative">
          {sheets.length === 0 && (
            <p className="text-center text-slate-500 dark:text-slate-400 py-4">No levels have been created yet.</p>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={sheets}
              strategy={verticalListSortingStrategy}
            >
              {sheets.map((sheet) => (
                <SortableSheetItem
                  key={sheet.id}
                  sheet={sheet}
                  editingId={editingId}
                  editName={editName}
                  setEditName={setEditName}
                  handleSaveEdit={handleSaveEdit}
                  setEditingId={setEditingId}
                  confirmDeleteId={confirmDeleteId}
                  setConfirmDeleteId={setConfirmDeleteId}
                  onDeleteSheet={onDeleteSheet}
                  handleStartEdit={handleStartEdit}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </div>
    </div>
  );
}

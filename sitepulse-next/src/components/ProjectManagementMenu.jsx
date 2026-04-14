import React, { useState } from 'react';
import { FolderEdit, X, Trash2, Edit2, Check, AlertTriangle } from 'lucide-react';

export default function ProjectManagementMenu({
  open,
  onClose,
  sheets,
  onRenameSheet,
  onDeleteSheet,
}) {
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

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

        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
          {sheets.length === 0 && (
            <p className="text-center text-slate-500 dark:text-slate-400 py-4">No levels have been created yet.</p>
          )}

          {sheets.map((sheet) => (
            <div
              key={sheet.id}
              className="flex items-center justify-between p-3 rounded-xl border border-slate-200/60 dark:border-white/10 bg-white/40 dark:bg-black/20"
            >
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
                  <span className="font-semibold text-sm">{sheet.sheet_name}</span>
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
          ))}
        </div>
      </div>
    </div>
  );
}

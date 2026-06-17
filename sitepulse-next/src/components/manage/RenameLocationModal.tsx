"use client";
import React, { useState } from 'react';
import { X } from 'lucide-react';

interface RenameLocationModalProps {
  unitNumber: string;
  onSave: (newName: string) => void;
  onClose: () => void;
}

export default function RenameLocationModal({ unitNumber, onSave, onClose }: RenameLocationModalProps) {
  const [name, setName] = useState(unitNumber);
  const trimmed = name.trim();
  const save = () => { if (trimmed) onSave(trimmed); };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800 dark:text-slate-100">Rename location</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
            <X size={18} className="text-slate-500" />
          </button>
        </div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          placeholder="Location name"
          className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-sky-500/40"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
            Cancel
          </button>
          <button onClick={save} disabled={!trimmed} className="px-4 py-1.5 text-sm font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors disabled:opacity-50">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

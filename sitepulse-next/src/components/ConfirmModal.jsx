import React from 'react';

export default function ConfirmModal({ confirmModal, setConfirmModal }) {
  if (!confirmModal) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center z-[60] p-4">
      <div className="rounded-2xl shadow-2xl border max-w-md w-full p-6 glass-panel">
        <p className="text-slate-800 dark:text-slate-100 mb-6">{confirmModal.message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirmModal(null)}
            className="px-4 py-2 rounded-lg border border-slate-300/80 dark:border-white/15 font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => confirmModal.onConfirm()}
            className="px-4 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

import React from 'react';

export default function AddLevelModal({
  handleAddLevel,
  newLevelName,
  setNewLevelName,
  pdfPageNumber,
  setPdfPageNumber,
  setSelectedFile,
  setIsModalOpen,
  isUploading
}) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="p-6 rounded-2xl shadow-2xl w-full max-w-md border glass-panel">
        <h2 className="text-xl font-bold mb-4 text-slate-900 dark:text-white">Add New Level</h2>
        <form onSubmit={handleAddLevel}>
          <div className="mb-4">
            <label className="block text-sm font-bold mb-2 text-slate-700 dark:text-slate-300">Level/Sheet Name</label>
            <input
              type="text"
              className="w-full border border-slate-300/80 dark:border-white/15 p-2 rounded-lg bg-white/60 dark:bg-black/25"
              placeholder="e.g., Level 3"
              value={newLevelName}
              onChange={(e) => setNewLevelName(e.target.value)}
              required
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-bold mb-2 text-slate-700 dark:text-slate-300">PDF Page Number</label>
            <input
              type="number"
              min="1"
              className="w-full border border-slate-300/80 dark:border-white/15 p-2 rounded-lg bg-white/60 dark:bg-black/25"
              value={pdfPageNumber}
              onChange={(e) => setPdfPageNumber(e.target.value)}
              required
            />
            <p className="text-xs text-slate-500 mt-1">Which page contains this specific floor plan?</p>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-bold mb-2 text-slate-700 dark:text-slate-300">Floor Plan PDF</label>
            <input
              type="file"
              accept=".pdf"
              className="w-full border border-slate-300/80 dark:border-white/15 p-2 rounded-lg text-sm bg-white/60 dark:bg-black/25"
              onChange={(e) => setSelectedFile(e.target.files[0])}
              required
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-slate-300/80 dark:border-white/15 font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isUploading}
              className="px-4 py-2 rounded-lg bg-slate-800 dark:bg-white text-white dark:text-slate-900 font-bold disabled:opacity-60"
            >
              {isUploading ? 'Processing...' : 'Upload & Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

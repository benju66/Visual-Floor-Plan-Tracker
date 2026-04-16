import React from 'react';
import { Settings, FolderEdit } from 'lucide-react';

function TopHeader({
  project, sheets, activeSheetId, setActiveSheetId,
  setIsModalOpen, setIsProjectMenuOpen,
  setMilestoneMenu, trackingMode, setTrackingMode,
  viewMode, setViewMode, setToolMode,
  activeSheet, exportToPDF, setIsSettingsOpen
}) {
  return (
    <header className="mb-4 flex-shrink-0 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 rounded-2xl border px-4 py-3 glass-panel">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">SitePulse Visual Tracker</h1>
          <div className="flex flex-wrap gap-3 mt-2">
            <select
              className="border border-slate-300/80 dark:border-white/15 p-2 rounded-lg font-semibold shadow-sm bg-white/60 dark:bg-black/25"
              disabled >
              <option>{project ? project.name : 'Loading...'}</option>
            </select>
            <select
              className="border border-slate-300/80 dark:border-white/15 p-2 rounded-lg shadow-sm bg-white/60 dark:bg-black/25"
              value={activeSheetId}
              onChange={(e) => setActiveSheetId(e.target.value)}
            >
              {sheets.length === 0 && <option disabled value="">No levels added</option>}
              {sheets.map((sheet) => (
                <option key={sheet.id} value={sheet.id}>
                  {sheet.sheet_name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="border border-slate-300/80 dark:border-white/15 p-2 rounded-lg hover:bg-white/50 dark:hover:bg-white/10 cursor-pointer text-sm font-medium shadow-sm"
            >
              + Add Level
            </button>
            <button
              type="button"
              onClick={() => setIsProjectMenuOpen(true)}
              className="border border-slate-300/80 dark:border-white/15 p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-white/50 dark:hover:bg-white/10 cursor-pointer shadow-sm"
              title="Manage Levels"
            >
              <FolderEdit size={20} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="button"
            onClick={() => setMilestoneMenu({ mode: 'filter' })}
            className="px-3 py-2 rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/50 dark:bg-black/20 text-xs font-semibold shadow-sm"
          >
            Milestones (Ctrl+K)
          </button>
          <div className="flex rounded-lg border border-slate-300/80 dark:border-white/15 overflow-hidden shadow-sm mr-2">
            <button
              type="button"
              onClick={() => setTrackingMode('Production')}
              className={`px-3 py-2 text-xs font-semibold cursor-pointer ${
                trackingMode === 'Production'
                  ? 'bg-blue-600/90 text-white dark:bg-blue-500/90'
                  : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200'
              }`}
            >
              Production
            </button>
            <button
              type="button"
              onClick={() => setTrackingMode('Inspections')}
              className={`px-3 py-2 text-xs font-semibold cursor-pointer border-l border-slate-300/80 dark:border-white/10 ${
                trackingMode === 'Inspections'
                  ? 'bg-blue-600/90 text-white dark:bg-blue-500/90'
                  : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200'
              }`}
            >
              Inspections
            </button>
          </div>
          <div className="flex rounded-lg border border-slate-300/80 dark:border-white/15 overflow-hidden shadow-sm">
            <button
              type="button"
              onClick={() => {
                setViewMode('list');
                setToolMode('pan');
              }}
              className={`px-4 py-2 text-sm font-semibold cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200'
              }`}
            >
              Field list
            </button>
            <button
              type="button"
              onClick={() => setViewMode('map')}
              className={`px-4 py-2 text-sm font-semibold cursor-pointer border-l border-slate-300/80 dark:border-white/10 ${
                viewMode === 'map'
                  ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200'
              }`}
            >
              Map
            </button>
          </div>
          {viewMode === 'map' && activeSheet?.base_image_url && (
            <button
              type="button"
              onClick={exportToPDF}
              className="px-4 py-2 rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/50 dark:bg-black/20 font-medium shadow-sm text-sm"
            >
              Export PDF
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/50 dark:bg-black/20 font-medium shadow-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
            title="Settings"
          >
            <Settings size={20} />
          </button>
        </div>
      </header>
  );
}

export default TopHeader;

import React from 'react';
import { Settings, FolderEdit, RefreshCw } from 'lucide-react';
import { useIsFetching } from '@tanstack/react-query';

function TopHeader({
  project, sheets, activeSheetId, setActiveSheetId,
  setIsModalOpen, setIsProjectMenuOpen,
  setMilestoneMenu, trackingMode, setTrackingMode,
  viewMode, setViewMode, setToolMode,
  activeSheet, exportToPDF, setIsSettingsOpen,
  triggerUndo, triggerRedo, undoStack, redoStack
}) {
  const isFetching = useIsFetching();
  
  return (
    <header className="mb-4 flex-shrink-0 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 rounded-2xl border px-4 py-3 glass-panel">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            SitePulse Visual Tracker
            {isFetching > 0 && (
              <RefreshCw size={16} className="text-blue-500 animate-spin opacity-80" />
            )}
          </h1>
          <div className="flex flex-wrap gap-3 mt-2">
            <select
              className="border border-slate-300/80 dark:border-white/15 p-2 rounded-lg font-semibold shadow-sm bg-white/60 dark:bg-black/25 cursor-not-allowed hover:bg-slate-100 dark:hover:bg-white/10 transition-colors opacity-90"
              disabled >
              <option>{project ? project.name : 'Loading...'}</option>
            </select>
            <select
              className="border border-slate-300/80 dark:border-white/15 p-2 rounded-lg shadow-sm bg-white/60 dark:bg-black/25 cursor-pointer hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
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
              className="border border-slate-300/80 dark:border-white/15 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer text-sm font-medium shadow-sm transition-colors"
            >
              + Add Level
            </button>
            <button
              type="button"
              onClick={() => setIsProjectMenuOpen(true)}
              className="border border-slate-300/80 dark:border-white/15 p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer shadow-sm transition-colors"
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
            className="px-3 py-2 rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/50 dark:bg-black/20 text-xs font-semibold shadow-sm hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            Milestones (Ctrl+K)
          </button>
          <div className="flex rounded-lg border border-slate-300/80 dark:border-white/15 overflow-hidden shadow-sm mr-2">
            <button
              type="button"
              onClick={() => setTrackingMode('Production')}
              className={`px-3 py-2 text-xs font-semibold cursor-pointer transition-colors ${
                trackingMode === 'Production'
                  ? 'bg-blue-600/90 text-white dark:bg-blue-500/90'
                  : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
              }`}
            >
              Production
            </button>
            <button
              type="button"
              onClick={() => setTrackingMode('Inspections')}
              className={`px-3 py-2 text-xs font-semibold cursor-pointer border-l border-slate-300/80 dark:border-white/10 transition-colors ${
                trackingMode === 'Inspections'
                  ? 'bg-blue-600/90 text-white dark:bg-blue-500/90'
                  : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
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
              className={`px-4 py-2 text-sm font-semibold cursor-pointer transition-colors ${
                viewMode === 'list'
                  ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
              }`}
            >
              Field list
            </button>
            <button
              type="button"
              onClick={() => setViewMode('map')}
              className={`px-4 py-2 text-sm font-semibold cursor-pointer border-l border-slate-300/80 dark:border-white/10 transition-colors ${
                viewMode === 'map'
                  ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
              }`}
            >
              Map
            </button>
          </div>
          {viewMode === 'map' && activeSheet?.base_image_url && (
            <button
              type="button"
              onClick={exportToPDF}
              className="px-4 py-2 rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/50 dark:bg-black/20 font-medium shadow-sm text-sm hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              Export PDF
            </button>
          )}
          {viewMode === 'list' && (
            <div className="flex rounded-lg border border-slate-300/80 dark:border-white/15 overflow-hidden shadow-sm bg-white/50 dark:bg-black/20">
              <button
                type="button"
                onClick={triggerUndo}
                disabled={!undoStack || undoStack.length === 0}
                className="p-2 text-slate-700 dark:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                title="Undo"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>
              </button>
              <div className="w-px bg-slate-300/80 dark:bg-white/10" />
              <button
                type="button"
                onClick={triggerRedo}
                disabled={!redoStack || redoStack.length === 0}
                className="p-2 text-slate-700 dark:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                title="Redo"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/></svg>
              </button>
            </div>
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

import React from 'react';
import { Settings, FolderEdit, RefreshCw, Folders, Plus, Download, LayoutDashboard, Map as MapIcon, List, Home } from 'lucide-react';
import Link from 'next/link';
import { useIsFetching } from '@tanstack/react-query';
import { useCurrentUserRole } from '@/hooks/useProjectQueries';

function TopHeader({
  project, sheets, activeSheetId, setActiveSheetId,
  setIsModalOpen, setIsProjectMenuOpen,
  setMilestoneMenu, trackingMode, setTrackingMode,
  viewMode, setViewMode, setToolMode,
  activeSheet, exportToPDF, setIsSettingsOpen,
  triggerUndo, triggerRedo, undoStack, redoStack
}) {
  const isFetching = useIsFetching();
  const { data: currentUserRole } = useCurrentUserRole(project?.id);

  // Custom scorllbar hiding utility class (if tailwind-scrollbar-hide is missing)
  // Usually added via global css, we just use arbitrary Tailwind for scrollbar hiding
  const hideScrollbar = "[&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']";
  
  return (
    <header className="mb-4 flex-shrink-0 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-3 rounded-xl border px-3 py-2 bg-white/30 dark:bg-black/10 backdrop-blur-md border-slate-200/60 dark:border-white/10 shadow-sm relative z-20">
      
      {/* 1. LEFT SIDE: Title & Project Location Controls */}
      <div className="flex items-center gap-3 w-full xl:w-auto">
        <Link href="/dashboard" className="p-2 mr-1 rounded-xl bg-slate-100/50 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400 hover:text-sky-500 transition-colors shadow-sm" title="Back to Dashboard">
          <Home size={20} />
        </Link>
        <div className="flex items-center gap-2 pr-1 xl:pr-3 xl:border-r border-slate-200 dark:border-white/10">
          <div className="flex items-center justify-center text-sky-500 bg-sky-100 dark:bg-sky-500/20 w-8 h-8 rounded-lg flex-shrink-0">
            <Folders size={18} />
          </div>
          <div className="flex flex-col">
            <h1 className="text-base font-bold text-slate-900 dark:text-white leading-tight flex items-center gap-2 whitespace-nowrap">
              SitePulse Tracker
              {isFetching > 0 && <RefreshCw size={12} className="text-blue-500 animate-spin opacity-80" />}
            </h1>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest truncate max-w-[150px] lg:max-w-[200px]">
              {project ? project.name : 'Loading...'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <select
            className="border border-slate-300/80 dark:border-white/15 py-1.5 px-2 rounded-lg text-sm font-semibold shadow-sm bg-white/60 dark:bg-black/25 cursor-pointer hover:bg-slate-100 dark:hover:bg-white/10 transition-colors w-full xl:w-auto"
            value={activeSheetId}
            onChange={(e) => setActiveSheetId(e.target.value)}
          >
            {sheets.length === 0 && <option disabled value="">No levels added</option>}
            {sheets.map((sheet) => (
              <option key={sheet.id} value={sheet.id}>{sheet.sheet_name}</option>
            ))}
          </select>
          {currentUserRole !== 'superintendent' && (
            <>
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="border border-slate-300/80 dark:border-white/15 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer text-slate-600 dark:text-slate-300 shadow-sm transition-colors flex-shrink-0"
                title="Add New Level"
              >
                <Plus size={18} />
              </button>
              <button
                type="button"
                onClick={() => setIsProjectMenuOpen(true)}
                className="border border-slate-300/80 dark:border-white/15 p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer shadow-sm transition-colors flex-shrink-0"
                title="Manage Levels"
              >
                <FolderEdit size={18} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 2. RIGHT SIDE: Tools, Scopes, and Settings */}
      <div className={`flex items-center gap-2 w-full xl:w-auto overflow-x-auto pb-1 xl:pb-0 ${hideScrollbar}`}>
        
        {/* Milestones Button */}
        <button
          type="button"
          onClick={() => setMilestoneMenu({ mode: 'filter' })}
          className="flex-shrink-0 px-2.5 py-1.5 rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/50 dark:bg-black/20 text-xs font-semibold shadow-sm hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
        >
          Milestones (Ctrl+K)
        </button>
        
        {/* Scope Tabs - Flex None to prevent squishing */}
        <div className="flex flex-shrink-0 flex-nowrap rounded-lg border border-slate-300/80 dark:border-white/15 overflow-hidden shadow-sm bg-white/50 dark:bg-black/20">
          {activeSheet?.active_scopes && activeSheet.active_scopes.length > 0 ? (
            activeSheet.active_scopes.map((scope, index) => (
              <button
                key={scope}
                type="button"
                onClick={() => setTrackingMode(scope)}
                className={`px-3 py-1.5 text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${index > 0 ? 'border-l border-slate-300/80 dark:border-white/10' : ''} ${
                  trackingMode === scope
                    ? 'bg-blue-600/90 text-white dark:bg-blue-500/90'
                    : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
                }`}
              >
                {scope}
              </button>
            ))
          ) : (
            <span className="px-3 py-1.5 text-xs font-semibold text-slate-500 italic whitespace-nowrap">No Scopes Assigned</span>
          )}
        </div>

        {/* View Mode Toggle */}
        <div className="flex flex-shrink-0 rounded-lg border border-slate-300/80 dark:border-white/15 overflow-hidden shadow-sm">
          <button
            type="button"
            title="Dashboard View"
            onClick={() => { setViewMode('dashboard'); setToolMode('pan'); }}
            className={`px-3 py-1.5 cursor-pointer transition-colors ${
              viewMode === 'dashboard' ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900' : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
            }`}
          >
            <LayoutDashboard size={16} />
          </button>
          <button
            type="button"
            title="Field List View"
            onClick={() => { setViewMode('list'); setToolMode('pan'); }}
            className={`px-3 py-1.5 cursor-pointer border-l border-slate-300/80 dark:border-white/10 transition-colors ${
              viewMode === 'list' ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900' : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
            }`}
          >
            <List size={16} />
          </button>
          <button
            type="button"
            title="Interactive Map View"
            onClick={() => setViewMode('map')}
            className={`px-3 py-1.5 cursor-pointer border-l border-slate-300/80 dark:border-white/10 transition-colors ${
              viewMode === 'map' ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900' : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
            }`}
          >
            <MapIcon size={16} />
          </button>
        </div>

        {viewMode === 'map' && activeSheet?.base_image_url && (
          <button
            type="button"
            onClick={exportToPDF}
            className="flex-shrink-0 p-1.5 rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/50 dark:bg-black/20 font-medium shadow-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
            title="Export to PDF"
          >
            <Download size={18} />
          </button>
        )}

        {/* Global Settings */}
        {currentUserRole !== 'superintendent' && (
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="flex-shrink-0 p-1.5 rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/50 dark:bg-black/20 font-medium shadow-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
            title="Settings"
          >
            <Settings size={18} />
          </button>
        )}
      </div>

    </header>
  );
}

export default TopHeader;

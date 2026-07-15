import React from 'react';
import { Settings, FolderEdit, RefreshCw, Folders, Plus, Download, LayoutDashboard, Map as MapIcon, List, GanttChartSquare, CalendarRange, Home, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useIsFetching } from '@tanstack/react-query';
import { useCurrentUserRole } from '@/hooks/useProjectQueries';
import { controlVisibility } from '@/utils/viewRouting';
import { normalizeLegacyRole } from '@/utils/roles';
import type { Project, Sheet } from '@/types/domain';
import type { ActivityMenuState } from '@/store/useUIStore';
import type { UndoAction } from '@/hooks/useUndoRedo';

export interface TopHeaderProps {
  project?: Project | null;
  sheets: Sheet[];
  activeSheetId: string;
  setActiveSheetId: (id: string) => void;
  setIsModalOpen: (o: boolean) => void;
  setIsProjectMenuOpen: (o: boolean) => void;
  setActivityMenu: (m: ActivityMenuState) => void;
  trackingMode: string;
  setTrackingMode: (m: string) => void;
  viewMode: string;
  /** URL-first view switch (pushes `?view=<mode>` + mirrors into the UI store). */
  navigateToView: (m: string) => void;
  /** Project-level tracks (deduped from all activities) — the Dashboard's Scope
   *  tabs list these instead of `activeSheet.active_scopes` (Nav plan Phase 3). */
  projectTracks?: string[];
  activeSheet?: Sheet | null;
  exportToPDF?: () => void;
  setIsSettingsOpen: (o: boolean) => void;
  triggerUndo?: () => void;
  triggerRedo?: () => void;
  undoStack?: UndoAction[];
  redoStack?: UndoAction[];
}

// The 5-view switcher, in canonical order (matches VIEW_MODES in utils/viewRouting).
// Labels render at xl:+ next to the icons; below that the buttons stay icon-only
// (tooltips carry the name). xl, not the plan's example lg: at 1024–1150 the busiest
// header (map view: Level + Activities + scopes + Export) clips Settings off-screen
// with labels on — measured live, ~70px over at 1050px.
const VIEW_BUTTONS = [
  { mode: 'dashboard', label: 'Dashboard', title: 'Dashboard View', Icon: LayoutDashboard },
  { mode: 'list', label: 'List', title: 'Field List View', Icon: List },
  { mode: 'schedule', label: 'Schedule', title: 'Schedule View', Icon: GanttChartSquare },
  { mode: 'map', label: 'Map', title: 'Interactive Map View', Icon: MapIcon },
  { mode: 'lookahead', label: 'Look-Ahead', title: 'Look-Ahead View', Icon: CalendarRange },
] as const;

function TopHeader({
  project, sheets, activeSheetId, setActiveSheetId,
  setIsModalOpen, setIsProjectMenuOpen,
  setActivityMenu, trackingMode, setTrackingMode,
  viewMode, navigateToView, projectTracks,
  activeSheet, exportToPDF, setIsSettingsOpen,
  triggerUndo, triggerRedo, undoStack, redoStack
}: TopHeaderProps) {
  const isFetching = useIsFetching();
  // Normalize the legacy `'super'` value to `'superintendent'` so the gates below
  // treat a not-yet-backfilled row as a superintendent.
  const { data: currentUserRoleRaw } = useCurrentUserRole(project?.id as string);
  const currentUserRole = normalizeLegacyRole(currentUserRoleRaw);

  // Per-view control matrix (Nav plan Phase 3): show only what this view uses.
  const vis = controlVisibility(viewMode);

  // Scope/Track tab options: the Dashboard aggregates the whole project, so its
  // tabs list project-level tracks; every other view keeps the sheet's scopes.
  const scopeOptions: string[] = viewMode === 'dashboard'
    ? (projectTracks ?? [])
    : ((activeSheet?.active_scopes as string[] | null | undefined) ?? []);

  // Custom scorllbar hiding utility class (if tailwind-scrollbar-hide is missing)
  // Usually added via global css, we just use arbitrary Tailwind for scrollbar hiding
  const hideScrollbar = "[&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']";

  return (
    <header className="mb-2 md:mb-4 flex-shrink-0 flex flex-row justify-between items-center gap-2 md:gap-3 rounded-xl border px-2 py-2 md:px-3 bg-white/30 dark:bg-black/10 backdrop-blur-md border-slate-200/60 dark:border-white/10 shadow-sm relative z-20 hide-header-mobile">

      {/* 1. LEFT SIDE: Title & Project Location Controls */}
      <div className="flex items-center gap-3">
        <Link href="/dashboard" className="hide-in-swipe-view p-2 mr-1 rounded-xl bg-slate-100/50 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400 hover:text-sky-500 transition-colors shadow-sm" title="Back to Dashboard">
          <Home size={20} />
        </Link>
        <div className="hide-in-swipe-view flex items-center gap-2 pr-1 xl:pr-3 xl:border-r border-slate-200 dark:border-white/10">
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
          {vis.level && (
            <div className="relative inline-flex items-center flex-1 sm:flex-none min-w-[140px]">
              <select
                className="appearance-none w-full border border-slate-300/80 dark:border-white/15 py-1.5 pl-3 pr-8 rounded-lg text-sm font-semibold shadow-sm bg-white/60 dark:bg-black/25 cursor-pointer hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                value={activeSheetId}
                onChange={(e) => setActiveSheetId(e.target.value)}
              >
                {sheets.length === 0 && <option disabled value="">No levels added</option>}
                {sheets.map((sheet) => (
                  <option key={sheet.id} value={sheet.id}>{sheet.sheet_name}</option>
                ))}
              </select>
              <ChevronDown size={16} className="absolute right-2.5 pointer-events-none text-slate-500" />
            </div>
          )}
          {vis.levelAdmin && currentUserRole !== 'superintendent' && (
            <>
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="hide-in-swipe-view border border-slate-300/80 dark:border-white/15 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer text-slate-600 dark:text-slate-300 shadow-sm transition-colors flex-shrink-0"
                title="Add New Level"
              >
                <Plus size={18} />
              </button>
              <button
                type="button"
                onClick={() => setIsProjectMenuOpen(true)}
                className="hide-in-swipe-view border border-slate-300/80 dark:border-white/15 p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer shadow-sm transition-colors flex-shrink-0"
                title="Manage Levels"
              >
                <FolderEdit size={18} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 2. RIGHT SIDE: three families, divider-separated — Scope/Track ("what am I
          tracking", scrolls internally if cramped) | Views ("where am I", pinned
          outside the scroll region so it can never slide off-screen) | utilities. */}
      <div className="flex items-center gap-2 min-w-0">

        {(vis.activities || vis.scope) && (
          <div className={`flex items-center gap-2 overflow-x-auto pb-1 xl:pb-0 ${hideScrollbar}`}>
            {/* Activities Button */}
            {vis.activities && (
              <button
                type="button"
                onClick={() => setActivityMenu({ mode: 'filter' })}
                className="hide-in-swipe-view flex-shrink-0 px-2.5 py-1.5 rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/50 dark:bg-black/20 text-xs font-semibold shadow-sm hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
              >
                Activities (Ctrl+K)
              </button>
            )}

            {/* Scope Tabs - Flex None to prevent squishing */}
            {vis.scope && (
              <div className="hide-in-swipe-view flex flex-shrink-0 flex-nowrap rounded-lg border border-slate-300/80 dark:border-white/15 overflow-hidden shadow-sm bg-white/50 dark:bg-black/20">
                {scopeOptions.length > 0 ? (
                  scopeOptions.map((scope, index) => (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => setTrackingMode(scope)}
                      className={`px-3 py-1.5 text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${index > 0 ? 'border-l border-slate-300/80 dark:border-white/10' : ''} ${trackingMode === scope
                          ? 'bg-blue-600/90 text-white dark:bg-blue-500/90'
                          : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
                        }`}
                    >
                      {scope}
                    </button>
                  ))
                ) : (
                  <span className="px-3 py-1.5 text-xs font-semibold text-slate-500 italic whitespace-nowrap">
                    {viewMode === 'dashboard' ? 'No tracks yet' : 'No Scopes Assigned'}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {(vis.activities || vis.scope) && (
          <div className="hidden md:block h-6 w-px bg-slate-300/80 dark:bg-white/15 flex-shrink-0" aria-hidden="true" />
        )}

        {/* View Mode Toggle — icon + label at lg:+, icon-only md:–lg: (tooltips kept) */}
        <div className="hidden md:flex flex-shrink-0 rounded-lg border border-slate-300/80 dark:border-white/15 overflow-hidden shadow-sm">
          {VIEW_BUTTONS.map(({ mode, label, title, Icon }, index) => (
            <button
              key={mode}
              type="button"
              title={title}
              onClick={() => navigateToView(mode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 cursor-pointer transition-colors ${index > 0 ? 'border-l border-slate-300/80 dark:border-white/10' : ''} ${viewMode === mode
                  ? 'bg-blue-600/90 text-white dark:bg-blue-500/90'
                  : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
                }`}
            >
              <Icon size={16} />
              <span className="hidden xl:inline text-xs font-semibold whitespace-nowrap">{label}</span>
            </button>
          ))}
        </div>

        {((vis.export && activeSheet?.base_image_url) || currentUserRole !== 'superintendent') && (
          <div className="hidden md:block h-6 w-px bg-slate-300/80 dark:bg-white/15 flex-shrink-0" aria-hidden="true" />
        )}

        {vis.export && activeSheet?.base_image_url && (
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
            className="hide-in-swipe-view flex-shrink-0 p-1.5 rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/50 dark:bg-black/20 font-medium shadow-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
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

"use client";
import React from 'react';
import { List, Map as MapIcon, CalendarRange, LayoutDashboard, type LucideIcon } from 'lucide-react';
import { MOBILE_VIEWS, type ViewMode } from '@/utils/viewRouting';

// Phone bottom tab bar (Navigation plan Phase 4). The four field-focused views
// from MOBILE_VIEWS — Schedule is intentionally absent on phones. Drives
// navigateToView (URL-first, Back walks views); NEVER a bare setViewMode.
// Rendered as the last flex child of the project page's 100dvh column (not
// position:fixed) so it can't overlap the swipe deck's bottom controls or the
// pending-changes UI — the content region shrinks above it instead.
const TAB_META: Record<string, { label: string; Icon: LucideIcon }> = {
  list: { label: 'List', Icon: List },
  map: { label: 'Map', Icon: MapIcon },
  lookahead: { label: 'Look-Ahead', Icon: CalendarRange },
  dashboard: { label: 'Dashboard', Icon: LayoutDashboard },
};

export interface MobileViewTabBarProps {
  viewMode: string;
  navigateToView: (mode: ViewMode) => void;
}

export default function MobileViewTabBar({ viewMode, navigateToView }: MobileViewTabBarProps) {
  return (
    <nav
      aria-label="Views"
      // -mx-2/-mb-2 cancel the page's mobile p-2 so the bar runs edge-to-edge;
      // safe-area padding keeps it above the iOS home indicator.
      className="md:hidden shrink-0 -mx-2 -mb-2 mt-2 border-t border-slate-200/70 dark:border-white/10 bg-white/85 dark:bg-slate-900/85 backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex items-stretch px-1 py-1">
        {MOBILE_VIEWS.map((mode) => {
          const { label, Icon } = TAB_META[mode];
          const isActive = viewMode === mode;
          return (
            <button
              key={mode}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => navigateToView(mode)}
              className={`flex-1 min-h-[52px] mx-0.5 flex flex-col items-center justify-center gap-0.5 rounded-lg transition-colors active:scale-95 ${
                isActive
                  ? 'bg-blue-600/90 text-white dark:bg-blue-500/90'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
              }`}
            >
              <Icon size={20} />
              <span className="text-[10px] font-semibold leading-none">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

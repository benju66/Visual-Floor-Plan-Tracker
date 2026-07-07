// THE canonical temporal-state color language (UI Polish P2, owner-locked 2026-07-06):
//   none = slate · planned = AMBER · ongoing = BLUE · completed = EMERALD
// Every chrome surface that colors a location's temporal state — list chips/segments,
// swipe deck, map sidebar dots, canvas markers + map legend, look-ahead chips — reads
// from this module. Edit the palette here (and its pinned test), never per-surface.
// DB-sourced `status_logs.status_color` polygon fills are NOT part of this palette.
import type { TemporalState } from '@/types/domain';

export type TemporalStateKey = TemporalState | 'none';

/** Canonical state order (matches the segmented control: × / PLN / ONG / ✓). */
export const TEMPORAL_STATE_ORDER: ReadonlyArray<TemporalStateKey> = [
  'none',
  'planned',
  'ongoing',
  'completed',
];

/** Solid hex per state — Konva canvas markers, map legend glyphs, inline dots. */
export const STATUS_HEX: Record<TemporalStateKey, string> = {
  none: '#cbd5e1',      // slate-300
  planned: '#f59e0b',   // amber-500
  ongoing: '#3b82f6',   // blue-500
  completed: '#10b981', // emerald-500
};

/** Tailwind bundle for filled chips / active segments (light + dark variants). */
export const STATUS_CHIP_CLASS: Record<TemporalStateKey, string> = {
  none: 'bg-slate-100 text-slate-600 border-slate-300/80 dark:bg-white/10 dark:text-slate-300 dark:border-white/20',
  planned:
    'bg-amber-100 text-amber-800 border-amber-300/60 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-600/50',
  ongoing:
    'bg-blue-100 text-blue-800 border-blue-300/60 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-600/50',
  completed:
    'bg-emerald-100 text-emerald-800 border-emerald-300/60 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-600/50',
};

/** Tailwind bundle for small round stage dots (sidebar, inspector, legends). */
export const STATUS_DOT_CLASS: Record<TemporalStateKey, string> = {
  none: 'bg-slate-300 dark:bg-slate-600',
  planned: 'bg-amber-500',
  ongoing: 'bg-blue-500',
  completed: 'bg-emerald-500',
};

export interface InvertedBadgeStyle {
  wrapper: string;
  dot: string;
}

/** Tailwind bundle for badges on inverted (dark-on-light / light-on-dark) popups. */
export const STATUS_INVERTED_CLASS: Record<TemporalStateKey, InvertedBadgeStyle> = {
  none: {
    wrapper:
      'bg-white/10 text-slate-300 border border-white/20 dark:bg-slate-200 dark:text-slate-600 dark:border-slate-300/80',
    dot: 'bg-slate-400',
  },
  planned: {
    wrapper:
      'bg-amber-900/40 text-amber-300 border border-amber-600/50 dark:bg-amber-100 dark:text-amber-800 dark:border-amber-300/60',
    dot: 'bg-amber-500',
  },
  ongoing: {
    wrapper:
      'bg-blue-900/40 text-blue-300 border border-blue-600/50 dark:bg-blue-100 dark:text-blue-800 dark:border-blue-300/60',
    dot: 'bg-blue-500',
  },
  completed: {
    wrapper:
      'bg-emerald-900/40 text-emerald-300 border border-emerald-600/50 dark:bg-emerald-100 dark:text-emerald-800 dark:border-emerald-300/60',
    dot: 'bg-emerald-500',
  },
};

/** Chip classes for a state; unknown/junk runtime values degrade to 'none'. */
export const getTemporalStateStyle = (state: TemporalStateKey): string =>
  STATUS_CHIP_CLASS[state] ?? STATUS_CHIP_CLASS.none;

/** Inverted badge classes for a state; unknown values degrade to 'none'. */
export const getInvertedBadgeStyle = (state: TemporalStateKey): InvertedBadgeStyle =>
  STATUS_INVERTED_CLASS[state] ?? STATUS_INVERTED_CLASS.none;

export interface StatusInlinePalette {
  bg: string;
  color: string;
}

/**
 * Inline bg/text pairs for surfaces styled outside Tailwind (the look-ahead grid's
 * theme tokens). Look-ahead's cell statuses map: start → planned · ongoing → ongoing
 * · done → completed. 'none' has no chip there, so only the three active states.
 */
export const STATUS_INLINE: Record<
  'light' | 'dark',
  Record<Exclude<TemporalStateKey, 'none'>, StatusInlinePalette>
> = {
  light: {
    planned: { bg: '#fffbeb', color: '#b45309' },   // amber-50 / amber-700
    ongoing: { bg: '#eff6ff', color: '#1d4ed8' },   // blue-50 / blue-700
    completed: { bg: '#ecfdf5', color: '#047857' }, // emerald-50 / emerald-700
  },
  dark: {
    planned: { bg: 'rgba(245,158,11,.18)', color: '#fcd34d' },   // amber-500 tint / amber-300
    ongoing: { bg: 'rgba(59,130,246,.17)', color: '#93c5fd' },   // blue-500 tint / blue-300
    completed: { bg: 'rgba(16,185,129,.16)', color: '#6ee7b7' }, // emerald-500 tint / emerald-300
  },
};

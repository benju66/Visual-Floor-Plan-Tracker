import { describe, it, expect } from 'vitest';
import {
  TEMPORAL_STATE_ORDER,
  STATUS_HEX,
  STATUS_CHIP_CLASS,
  STATUS_DOT_CLASS,
  STATUS_INVERTED_CLASS,
  STATUS_INLINE,
  getTemporalStateStyle,
  getInvertedBadgeStyle,
  type TemporalStateKey,
} from './statusColors';

// These tests PIN the one status-color language (owner-locked 2026-07-06:
// planned = amber, ongoing = BLUE, completed = emerald, none = slate).
// If an assertion here fails, a surface-level edit tried to fork the palette —
// change the palette deliberately HERE or not at all.

describe('statusColors — canonical palette pins', () => {
  it('pins the canonical state order', () => {
    expect(TEMPORAL_STATE_ORDER).toEqual(['none', 'planned', 'ongoing', 'completed']);
  });

  it('pins the hex palette (canvas markers / legend / inline dots)', () => {
    expect(STATUS_HEX).toEqual({
      none: '#cbd5e1',
      planned: '#f59e0b',
      ongoing: '#3b82f6',
      completed: '#10b981',
    });
  });

  it('pins the chip class bundle', () => {
    expect(STATUS_CHIP_CLASS).toEqual({
      none: 'bg-slate-100 text-slate-600 border-slate-300/80 dark:bg-white/10 dark:text-slate-300 dark:border-white/20',
      planned:
        'bg-amber-100 text-amber-800 border-amber-300/60 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-600/50',
      ongoing:
        'bg-blue-100 text-blue-800 border-blue-300/60 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-600/50',
      completed:
        'bg-emerald-100 text-emerald-800 border-emerald-300/60 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-600/50',
    });
  });

  it('pins the dot class bundle', () => {
    expect(STATUS_DOT_CLASS).toEqual({
      none: 'bg-slate-300 dark:bg-slate-600',
      planned: 'bg-amber-500',
      ongoing: 'bg-blue-500',
      completed: 'bg-emerald-500',
    });
  });

  it('pins the inverted badge bundle', () => {
    expect(STATUS_INVERTED_CLASS).toEqual({
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
    });
  });

  it('pins the look-ahead inline palettes (start=planned amber · ongoing blue · done emerald)', () => {
    expect(STATUS_INLINE).toEqual({
      light: {
        planned: { bg: '#fffbeb', color: '#b45309' },
        ongoing: { bg: '#eff6ff', color: '#1d4ed8' },
        completed: { bg: '#ecfdf5', color: '#047857' },
      },
      dark: {
        planned: { bg: 'rgba(245,158,11,.18)', color: '#fcd34d' },
        ongoing: { bg: 'rgba(59,130,246,.17)', color: '#93c5fd' },
        completed: { bg: 'rgba(16,185,129,.16)', color: '#6ee7b7' },
      },
    });
  });

  it('every bundle covers every canonical state', () => {
    for (const state of TEMPORAL_STATE_ORDER) {
      expect(STATUS_HEX[state]).toBeTruthy();
      expect(STATUS_CHIP_CLASS[state]).toBeTruthy();
      expect(STATUS_DOT_CLASS[state]).toBeTruthy();
      expect(STATUS_INVERTED_CLASS[state].wrapper).toBeTruthy();
      expect(STATUS_INVERTED_CLASS[state].dot).toBeTruthy();
    }
  });

  it('getters return the bundle entry and degrade unknown values to none', () => {
    expect(getTemporalStateStyle('ongoing')).toBe(STATUS_CHIP_CLASS.ongoing);
    expect(getInvertedBadgeStyle('planned')).toBe(STATUS_INVERTED_CLASS.planned);
    const junk = 'bogus' as TemporalStateKey;
    expect(getTemporalStateStyle(junk)).toBe(STATUS_CHIP_CLASS.none);
    expect(getInvertedBadgeStyle(junk)).toBe(STATUS_INVERTED_CLASS.none);
  });
});

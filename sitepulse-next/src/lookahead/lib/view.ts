// Cheap derived labels shared by the toolbar/header.
import type { AreaView, Weeks } from "./types";
import { addDays, mon, parseDate } from "./date";
import { buildVisDows, clampWeeks } from "./schedule";

// Below this viewport width (px) the grid is treated as portrait/narrow and the
// rendered week window is clamped down so the dense day cells stay visible
// without horizontal scrolling. Matches Tailwind's `lg` breakpoint (iPad
// landscape = 1024 → full saved window; iPad portrait = 768 → narrowed).
export const LA_LANDSCAPE_MIN = 1024;

// Weeks rendered on a portrait/narrow viewport, regardless of the saved window.
export const LA_PORTRAIT_WEEKS = 1;

/**
 * Render-only EFFECTIVE week count for the grid. Portrait/narrow viewports show
 * fewer weeks so the dense grid fits an iPad without horizontal scrolling;
 * landscape/desktop show the full saved window. PURE — pass the viewport width
 * in; it never reads `window`. The result is a presentation clamp ONLY and must
 * NEVER be written back to `view.numWeeks` (that stays the user's saved intent,
 * so rotating an iPad never edits — or autosaves — the plan document).
 */
export function effectiveWeeks(savedWeeks: number, viewportWidth: number): number {
  const full = Math.max(1, savedWeeks);
  if (viewportWidth >= LA_LANDSCAPE_MIN) return full;
  return Math.min(full, LA_PORTRAIT_WEEKS);
}

export function windowMeta(currentWeek: string, view: AreaView) {
  const start = parseDate(currentWeek);
  const numWeeks = clampWeeks(view.numWeeks);
  const visDows = buildVisDows(view);
  const lastOffset = (numWeeks - 1) * 7 + visDows[visDows.length - 1];
  const end = addDays(start, lastOffset);
  const weekOfLabel =
    mon(start) + " " + start.getDate() + " – " + mon(end) + " " + end.getDate() + ", " + end.getFullYear();
  return {
    start, numWeeks, visDows, lastOffset, end,
    weekOfLabel,
    windowSubtitle: numWeeks + "-Week Look-Ahead Schedule",
  };
}

export function weekOptionsList(weeks: Weeks, lastOffset: number) {
  return Object.keys(weeks)
    .sort()
    .map((k) => {
      const ws = parseDate(k);
      const we = addDays(ws, lastOffset);
      return {
        value: k,
        label: mon(ws) + " " + ws.getDate() + " – " + mon(we) + " " + we.getDate() + ", " + we.getFullYear(),
      };
    });
}

// Cheap derived labels shared by the toolbar/header.
import type { AreaView, Weeks } from "./types";
import { addDays, mon, parseDate } from "./date";
import { buildVisDows, clampWeeks } from "./schedule";

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

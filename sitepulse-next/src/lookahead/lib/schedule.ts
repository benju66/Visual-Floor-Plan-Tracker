// Framework-agnostic domain logic — lifted directly from the prototype.
import type { Cell, Flag, Group, Row, WeekDoc } from "./types";
import { addDays, mondayOf, parseDate, toKey } from "./date";
import { doneGroupId, uid } from "./uid";

export function clampWeeks(n: number | undefined): number {
  return Math.max(1, Math.min(8, n || 3));
}

const isDoneGroup = (g: Group) => String(g.id).startsWith("done-");

/** Classify the front (current) week of a row: completed / continued / slipped / none. */
export function outcomeOf(cells: Record<number, Cell>): "completed" | "continued" | "slipped" | "none" {
  let done = false, ongoing = false, start = false;
  for (let i = 0; i < 7; i++) {
    const c = cells[i];
    if (!c) continue;
    if (c.s === "done") done = true;
    else if (c.s === "ongoing") ongoing = true;
    else if (c.s === "start") start = true;
  }
  if (done) return "completed";
  if (ongoing) return "continued";
  if (start) return "slipped";
  return "none";
}

/** Cycle order for click-to-cycle: empty → start → ongoing → done → empty. */
export function cycleNext(cur: "start" | "ongoing" | "done" | null): "start" | "ongoing" | "done" | null {
  const order: ("start" | "ongoing" | "done")[] = ["start", "ongoing", "done"];
  if (cur == null) return "start";
  const i = order.indexOf(cur);
  return i === 2 ? null : order[i + 1];
}

export function hasDoneFront(cells: Record<number, Cell>): boolean {
  for (let i = 0; i < 7; i++) {
    const c = cells[i];
    if (c && c.s === "done") return true;
  }
  return false;
}

/** Navigation clone: same task/sub/group structure, cleared marks + fresh weekend defaults. */
export function clonedStructure(w: WeekDoc): WeekDoc {
  return {
    flags: {},
    groups: w.groups.map((g) => ({
      id: g.id, name: g.name, collapsed: false,
      rows: g.rows.map((r) => ({ id: uid(), task: r.task, sub: r.sub, notes: "", cells: {} })),
    })),
  };
}

/** Duplicate week: copy everything including marks, with fresh row ids. */
export function duplicateWeekDoc(src: WeekDoc): WeekDoc {
  return {
    flags: { ...src.flags },
    groups: src.groups.map((g) => ({
      id: g.id, name: g.name, collapsed: g.collapsed,
      rows: g.rows.map((r) => ({
        id: uid(), task: r.task, sub: r.sub, notes: r.notes,
        cells: JSON.parse(JSON.stringify(r.cells)) as Record<number, Cell>,
      })),
    })),
  };
}

export function rollPreviewData(cur: WeekDoc, numWeeks: number) {
  let completed = 0, continued = 0, slipped = 0;
  const slipNames: string[] = [];
  const nw = clampWeeks(numWeeks);
  cur.groups.filter((g) => !isDoneGroup(g)).forEach((g) =>
    g.rows.forEach((r) => {
      const o = outcomeOf(r.cells);
      let remaining = false;
      for (let w = 1; w < nw && !remaining; w++) {
        for (let dow = 0; dow < 7; dow++) {
          if (r.cells[w * 7 + dow]) { remaining = true; break; }
        }
      }
      if (o === "completed" && !remaining) completed++;
      else if (o === "continued") continued++;
      else if (o === "slipped") { slipped++; if (r.task) slipNames.push(r.task); }
      else if (o === "none" && r.carry && r.carry.state !== "completed") {
        if (r.carry.state === "slipped") { slipped++; if (r.task) slipNames.push(r.task); }
        else continued++;
      }
    })
  );
  return { completed, continued, slipped, slipNames };
}

/** Build the next week after a roll-forward: window slide + reconciliation of the passed week. */
export function buildRolledWeek(cur: WeekDoc, curKey: string, numWeeks: number): WeekDoc {
  const nw = clampWeeks(numWeeks);
  const completedRows: Row[] = [];
  const activeGroups = cur.groups.filter((g) => !isDoneGroup(g));
  const newGroups: Group[] = activeGroups.map((g) => ({ id: g.id, name: g.name, collapsed: g.collapsed, rows: [] }));
  activeGroups.forEach((g, gi) => {
    g.rows.forEach((r) => {
      const o = outcomeOf(r.cells);
      // Slide window: new week w <- old week w+1 (the passed week drops off).
      const nc: Record<number, Cell> = {};
      for (let w = 0; w < nw - 1; w++) {
        for (let dow = 0; dow < 7; dow++) {
          const oi = (w + 1) * 7 + dow;
          if (r.cells[oi]) nc[w * 7 + dow] = JSON.parse(JSON.stringify(r.cells[oi])) as Cell;
        }
      }
      const remaining = Object.keys(nc).length > 0;
      if (o === "completed" && !remaining) {
        completedRows.push({ id: uid(), task: r.task, sub: r.sub, notes: "", cells: {}, carry: { state: "completed" } });
        return;
      }
      const prev = r.carry && r.carry.state !== "completed" ? r.carry : null;
      let state: "slipped" | "continued" | null = null;
      if (o === "slipped") state = "slipped";
      else if (o === "continued") state = "continued";
      else if (o === "none" && prev) state = prev.state === "slipped" ? "slipped" : "continued";
      const nr: Row = { id: uid(), task: r.task, sub: r.sub, notes: r.notes, cells: nc };
      if (state) {
        nr.carry = { state, slips: ((prev && prev.slips) || 0) + 1, since: (prev && prev.since) || curKey };
      }
      newGroups[gi].rows.push(nr);
    });
  });
  if (completedRows.length)
    newGroups.push({ id: doneGroupId(), name: "Completed last week", collapsed: true, rows: completedRows });
  return { flags: {}, groups: newGroups };
}

/** Visible day-of-week indices (0=Mon..6=Sun) given weekend toggles. */
export function buildVisDows(view: { showSat: boolean; showSun: boolean }): number[] {
  const v = [0, 1, 2, 3, 4];
  if (view.showSat !== false) v.push(5);
  if (view.showSun === true) v.push(6);
  return v;
}

/** Ordered visible canonical indices across all weeks (marquee + column selection order). */
export function buildVisCols(numWeeks: number, visDows: number[]): number[] {
  const out: number[] = [];
  for (let w = 0; w < numWeeks; w++) for (const dow of visDows) out.push(w * 7 + dow);
  return out;
}

/**
 * Canonical 7-stride flag map: manual > holiday-date match > auto weekend (Sat/Sun).
 */
export function computeFlags(
  manual: Record<number, Flag>,
  start: Date,
  numWeeks: number,
  holidaySet: Set<string>
): Record<number, Flag | null> {
  const flags: Record<number, Flag | null> = {};
  for (let w = 0; w < numWeeks; w++) {
    for (let dow = 0; dow < 7; dow++) {
      const i = w * 7 + dow;
      const dd = addDays(start, w * 7 + dow);
      flags[i] =
        manual[i] || (holidaySet.has(toKey(dd)) ? "holiday" : null) || (dow === 5 || dow === 6 ? "weekend" : null);
    }
  }
  return flags;
}

export function projectMonday(projectStart: string): Date | null {
  if (!projectStart) return null;
  return mondayOf(parseDate(projectStart));
}

export function projWeekNum(wkStart: Date, psMon: Date | null): number | null {
  if (!psMon) return null;
  return Math.round((wkStart.getTime() - psMon.getTime()) / (7 * 86400000)) + 1;
}

// Seed data + settings defaults + 6→7 stride migration — ported from the prototype.
import type {
  Area, AreaView, Cell, Group, Holiday, Milestone, ProjectBlob, ProjectInfo, ProjectMeta, Row, Settings, Sub, WeekDoc, Weeks,
} from "./types";
import { groupId, uid } from "./uid";
import { todayKey } from "./date";

export const SEED_WEEK_START = "2026-06-01";

function r(task: string, sub: string, cells?: Record<number, Cell>, notes?: string): Row {
  return { id: uid(), task, sub, cells: cells || {}, notes: notes || "" };
}

/** Authored in the legacy 6-day stride; migrate to 7 before use. */
export function defaultWeek(): WeekDoc {
  const X: Cell = { s: "ongoing" };
  const allClean: Record<number, Cell> = {};
  [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16].forEach((i) => {
    allClean[i] = { s: "ongoing" };
  });
  const groups: Group[] = [
    {
      id: "g1", name: "Punch & Finishes", collapsed: false, rows: [
        r("4th Floor Punch", "ALL", { 0: X, 1: X, 2: X, 3: X, 4: { s: "done" } }),
        r("3rd Floor Punch", "PHS", { 1: X }),
        r("2nd Floor Mantels", "FIRESIDE", { 0: X }),
        r("2nd Floor Mantel Tile", "PRECISION", { 1: X, 2: X, 3: X, 4: { s: "done" } }),
        r("2nd Floor Incomplete", "ALL", { 0: X, 1: X, 2: X, 3: X, 4: { s: "done" } }),
        r("2nd Floor Corridor Carpet", "PRECISION", { 0: X, 1: X }),
        r("1st Floor Unit LVT", "PRECISION", { 0: X, 1: { s: "ongoing", t: "ATR" }, 2: X }),
        r("1st Floor Mantels", "FIRESIDE", { 1: X }),
        r("1st Floor Lighting", "BERD", { 0: X, 1: X, 2: X, 3: X, 4: { s: "done", t: "DONE?" } }),
        r("1st Floor Mantel Tile", "PRECISION", { 1: X, 2: X, 3: X, 4: { s: "done" } }),
      ],
    },
    {
      id: "g2", name: "Flooring", collapsed: false, rows: [
        r("Load Stack", "", {}),
        r("Fix Gypcrete", "ATR", { 1: X }),
        r("LVT", "PRECISION", { 2: X, 3: X, 4: X }),
        r("Base / Accessories", "JB", { 6: X, 7: X, 8: X }),
        r("Touch Ups", "MCI", { 9: { s: "ongoing", t: "4TH" }, 10: { s: "ongoing", t: "3RD" } }),
      ],
    },
    {
      id: "g3", name: "Commons", collapsed: false, rows: [
        r("Beams", "JB", { 0: X, 1: X, 2: X }),
        r("ACT", "MNA", { 3: X, 4: X }),
        r("Tops", "LEONS", { 3: X }),
        r("Elevator", "SHINDLER", { 12: { s: "start" }, 13: X, 14: X, 15: X, 16: X }),
      ],
    },
    {
      id: "g4", name: "Site / Common", collapsed: false, rows: [
        r("Clean Clean Everywhere", "ALL", allClean),
        r("Clean Basement", "", { 1: { s: "ongoing", t: "SWEEP" }, 2: { s: "ongoing", t: "WASH" } }),
      ],
    },
  ];
  return { flags: {}, groups };
}

function remap6to7(oi: number): number {
  const wk = Math.floor(oi / 6);
  const dow = oi % 6;
  return wk * 7 + dow;
}

export function migrateWeek6to7(w: WeekDoc): WeekDoc {
  const nf: Record<number, WeekDoc["flags"][number]> = {};
  Object.keys(w.flags || {}).forEach((k) => {
    nf[remap6to7(+k)] = w.flags[+k];
  });
  return {
    flags: nf,
    groups: (w.groups || []).map((g) => ({
      ...g,
      rows: g.rows.map((row) => {
        const nc: Record<number, Cell> = {};
        Object.keys(row.cells || {}).forEach((k) => {
          nc[remap6to7(+k)] = row.cells[+k];
        });
        return { ...row, cells: nc };
      }),
    })),
  };
}

export function defaultSettings(): Settings {
  const codes = ["ALL", "PHS", "FIRESIDE", "PRECISION", "BERD", "ATR", "JB", "MCI", "MNA", "LEONS", "SHINDLER"];
  return {
    jobName: "Orchard Path III", jobNumber: "25-117", location: "",
    superintendent: "Aaron Braaten", preparedBy: "Aaron Braaten",
    projectStart: "", projectEnd: "",
    showSat: true, showSun: false, numWeeks: 3, carryForward: true, taskColW: 300,
    subs: codes.map((c) => ({ id: uid(), code: c, company: "", contact: "", phone: "" })),
    holidays: [],
    milestones: [],
  };
}

export function mergeSettings(s: Partial<Settings> | undefined | null): Settings {
  const d = defaultSettings();
  if (!s) return d;
  return {
    jobName: s.jobName ?? d.jobName, jobNumber: s.jobNumber ?? d.jobNumber, location: s.location ?? "",
    superintendent: s.superintendent ?? d.superintendent, preparedBy: s.preparedBy ?? "",
    projectStart: s.projectStart ?? "", projectEnd: s.projectEnd ?? "",
    showSat: s.showSat !== false, showSun: s.showSun === true,
    numWeeks: Math.max(1, Math.min(8, s.numWeeks || 3)), carryForward: s.carryForward !== false,
    taskColW: Math.max(140, Math.min(440, !s.taskColW || s.taskColW === 220 ? 300 : s.taskColW)),
    subs: Array.isArray(s.subs) ? s.subs : d.subs,
    holidays: Array.isArray(s.holidays) ? s.holidays : [],
    milestones: Array.isArray(s.milestones) ? s.milestones : [],
  };
}

// ---- Phase 1: nested Project → Area model ----

export function defaultView(): AreaView {
  return { numWeeks: 3, showSat: true, showSun: false, carryForward: true, taskColW: 300 };
}

export function defaultProject(): ProjectMeta {
  const s = defaultSettings();
  return {
    info: {
      jobName: s.jobName, jobNumber: s.jobNumber, location: s.location,
      superintendent: s.superintendent, preparedBy: s.preparedBy,
      projectStart: s.projectStart, projectEnd: s.projectEnd,
    },
    subs: s.subs,
    holidays: s.holidays,
    milestones: s.milestones,
  };
}

function blankWeekDoc(): WeekDoc {
  return { flags: {}, groups: [{ id: groupId(), name: "New Group", collapsed: false, rows: [blankRow()] }] };
}

export function blankRow(): Row {
  return { id: uid(), task: "", sub: "", notes: "", cells: {} };
}

/** A fresh, empty look-ahead seeded at `startKey`. */
export function makeBlankArea(name: string, startKey: string): Area {
  return { id: uid(), name, weeks: { [startKey]: blankWeekDoc() }, currentWeek: startKey, view: defaultView() };
}

/** A clean starter project document (one empty "Main" area, current week). */
export function makeBlankProjectBlob(name: string): ProjectBlob {
  const area = makeBlankArea("Main", todayKey());
  return {
    project: {
      info: {
        jobName: name || "New Project", jobNumber: "", location: "",
        superintendent: "", preparedBy: "", projectStart: "", projectEnd: "",
      },
      subs: [],
      holidays: [],
      milestones: [],
    },
    areas: { [area.id]: area },
    areaOrder: [area.id],
    currentAreaId: area.id,
  };
}

/** Initial document state for a fresh install. */
export function buildSeed() {
  const start = SEED_WEEK_START;
  const area: Area = {
    id: uid(),
    name: "Main",
    weeks: { [start]: migrateWeek6to7(defaultWeek()) },
    currentWeek: start,
    view: defaultView(),
  };
  return {
    project: defaultProject(),
    areas: { [area.id]: area } as Record<string, Area>,
    areaOrder: [area.id],
    currentAreaId: area.id,
    theme: "light" as const,
    density: "comfortable" as const,
  };
}

// ---- defensive normalizers (used by persist merge) ----

export function normalizeView(v: Partial<AreaView> | undefined | null): AreaView {
  const d = defaultView();
  if (!v) return d;
  return {
    numWeeks: Math.max(1, Math.min(8, v.numWeeks || d.numWeeks)),
    showSat: v.showSat !== false,
    showSun: v.showSun === true,
    carryForward: v.carryForward !== false,
    taskColW: Math.max(140, Math.min(440, v.taskColW || d.taskColW)),
  };
}

export function normalizeProject(p: Partial<ProjectMeta> | undefined | null): ProjectMeta {
  const d = defaultProject();
  const info: Partial<ProjectInfo> = p?.info || {};
  return {
    info: {
      jobName: info.jobName ?? d.info.jobName,
      jobNumber: info.jobNumber ?? d.info.jobNumber,
      location: info.location ?? "",
      superintendent: info.superintendent ?? d.info.superintendent,
      preparedBy: info.preparedBy ?? "",
      projectStart: info.projectStart ?? "",
      projectEnd: info.projectEnd ?? "",
    },
    subs: Array.isArray(p?.subs) ? (p!.subs as Sub[]) : d.subs,
    holidays: Array.isArray(p?.holidays) ? (p!.holidays as Holiday[]) : [],
    milestones: Array.isArray(p?.milestones) ? (p!.milestones as Milestone[]) : [],
  };
}

export function normalizeArea(a: Partial<Area> | undefined | null): Area {
  const weeks = (a?.weeks && typeof a.weeks === "object" ? a.weeks : {}) as Weeks;
  const keys = Object.keys(weeks).sort();
  const currentWeek = a?.currentWeek && weeks[a.currentWeek] ? a.currentWeek : keys[0] || SEED_WEEK_START;
  return {
    id: a?.id || uid(),
    name: a?.name || "Main",
    weeks: keys.length ? weeks : { [currentWeek]: blankWeekDoc() },
    currentWeek,
    view: normalizeView(a?.view),
  };
}

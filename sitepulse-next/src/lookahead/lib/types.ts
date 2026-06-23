// Domain types for the Look-Ahead Schedule.
// Ported 1:1 from the v5 prototype data model.

export type Status = "start" | "ongoing" | "done";
export type Flag = "weekend" | "holiday" | "closed";
export type CarryState = "completed" | "continued" | "slipped";
export type Theme = "light" | "dark";
export type Density = "comfortable" | "compact";
export type Accent = "Orange" | "Blue" | "Slate";

/** A single day-cell. Either field optional; an empty cell has no object at all. */
export interface Cell {
  s?: Status;
  t?: string;
}

/** Carry-forward metadata attached to a row after a roll. */
export interface Carry {
  state: CarryState;
  slips?: number;
  since?: string;
}

export interface Row {
  id: string;
  task: string;
  sub: string;
  notes: string;
  /** Canonical column index (weekIndex*7 + dayOfWeek) → cell. */
  cells: Record<number, Cell>;
  carry?: Carry;
}

export interface Group {
  id: string;
  name: string;
  collapsed: boolean;
  rows: Row[];
}

export interface WeekDoc {
  /** Manual per-day flags, keyed by canonical day index. */
  flags: Record<number, Flag>;
  groups: Group[];
}

/** Map of week-start key (YYYY-MM-DD Monday) → week document. */
export type Weeks = Record<string, WeekDoc>;

export interface Sub {
  id: string;
  code: string;
  company: string;
  contact: string;
  phone: string;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
}

export interface Milestone {
  id: string;
  date: string;
  name: string;
}

export interface Settings {
  jobName: string;
  jobNumber: string;
  location: string;
  superintendent: string;
  preparedBy: string;
  projectStart: string;
  projectEnd: string;
  showSat: boolean;
  showSun: boolean;
  numWeeks: number;
  carryForward: boolean;
  taskColW: number;
  subs: Sub[];
  holidays: Holiday[];
  milestones: Milestone[];
}

export interface RollPreview {
  completed: number;
  continued: number;
  slipped: number;
  slipNames: string[];
  exists: boolean;
}

// ---- Phase 1: Project → Area → Weeks hierarchy ----

/** Project-level identity, shared by every area in the project. */
export interface ProjectInfo {
  jobName: string;
  jobNumber: string;
  location: string;
  superintendent: string;
  preparedBy: string;
  projectStart: string;
  projectEnd: string;
}

/** Project-level settings, shared by every area (subs/holidays/milestones are project-wide). */
export interface ProjectMeta {
  info: ProjectInfo;
  subs: Sub[];
  holidays: Holiday[];
  milestones: Milestone[];
}

/** Area-level display settings (each look-ahead can differ). */
export interface AreaView {
  numWeeks: number;
  showSat: boolean;
  showSun: boolean;
  carryForward: boolean;
  taskColW: number;
}

/** A look-ahead for one area/scope of the project (interior, exterior, …). */
export interface Area {
  id: string;
  name: string;
  weeks: Weeks;
  currentWeek: string;
  view: AreaView;
}

/** The serializable per-project document (what's stored in Supabase `projects.data`). */
export interface ProjectBlob {
  project: ProjectMeta;
  areas: Record<string, Area>;
  areaOrder: string[];
  currentAreaId: string;
}

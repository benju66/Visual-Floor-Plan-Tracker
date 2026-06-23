"use client";

// VENDORED from the standalone Look-Ahead app (C:\Users\BUrness\Dev\Lookahead).
// DELIBERATE EDITS for the SitePulse absorption (Phase 0a):
//   1. The zustand `persist(...)` middleware (single localStorage key
//      "la-sched-orchard-v3") is REMOVED. Inside SitePulse one key would be
//      shared across every project and would hydrate a stale blob before the
//      adapter loads the right one — so persistence is owned entirely by the
//      SitePulse adapter (`@/lookahead/persistence`). The store now starts from
//      the in-memory seed and is hydrated via `loadProject(doc)`.
//   2. Internal `@/lib/*` imports rewritten to `@/lookahead/lib/*`.
// Everything else is byte-for-byte the original (actions, undo, normalizers).

import { create } from "zustand";
import type {
  Area, Cell, Flag, Group, ProjectBlob, ProjectInfo, ProjectMeta, RollPreview, Row, Status, Theme, Density, WeekDoc, Weeks,
} from "@/lookahead/lib/types";
import { addDays, parseDate, toKey, todayKey } from "@/lookahead/lib/date";
import {
  blankRow, buildSeed, makeBlankArea, normalizeArea, normalizeProject,
} from "@/lookahead/lib/defaults";
import { groupId as newGroupId, uid } from "@/lookahead/lib/uid";
import {
  buildRolledWeek, clampWeeks, clonedStructure, cycleNext, duplicateWeekDoc, outcomeOf, rollPreviewData,
} from "@/lookahead/lib/schedule";

const UNDO_CAP = 80;

type Snapshot = { weeks: Weeks; currentWeek: string };
type StringSettingKey = keyof ProjectInfo;
type SectionKey = "display" | "project" | "subs" | "holidays" | "milestones" | "backup";

interface DocState {
  project: ProjectMeta;
  areas: Record<string, Area>;
  areaOrder: string[];
  currentAreaId: string;
  theme: Theme;
  density: Density;
}

interface UIState {
  editing: string | null;
  selCells: Record<string, true>;
  selCols: Record<number, true>;
  focusCell: { rowId: string; di: number } | null;
  // Fixed corner of a multi-cell selection that shift-click / shift-arrow grow from.
  selAnchor: { rowId: string; di: number } | null;
  // Transient: id of a task row whose description input should grab the cursor on
  // next render (set when a new task is created, consumed + cleared by the view).
  focusTaskRowId: string | null;
  menu: { rowId: string; x: number; y: number } | null;
  cellMenu: { rowId: string; di: number; x: number; y: number } | null;
  draggingRowId: string | null;
  dropTarget: { rowId?: string; pos?: "above" | "below"; groupId?: string } | null;
  rollPreview: RollPreview | null;
  settingsOpen: boolean;
  confirmGroup: string | null;
  confirmDeleteWeek: boolean;
  openSections: Record<SectionKey, boolean>;
  scrolledX: boolean;
  scrolledY: boolean;
  taskColW: number;
  colAnchor: number | null;
  past: Snapshot[];
  future: Snapshot[];
}

interface Actions {
  // cells
  setCellStatusAt: (rowId: string, di: number, status: Status | null) => void;
  cycleCell: (rowId: string, di: number) => void;
  commitEdit: (rowId: string, di: number, value: string) => void;
  applyCellStatus: (status: Status | null) => void;
  // fields (in-place; persist on blur)
  setField: (rowId: string, field: "task" | "sub" | "notes", value: string) => void;
  setGroupName: (gid: string, value: string) => void;
  persistData: () => void;
  // columns
  toggleColumn: (di: number, shift: boolean, visCols: number[]) => void;
  applyColFlag: (flag: Flag | null) => void;
  // rows
  insertRow: (rowId: string, after: boolean) => void;
  duplicateRow: (rowId: string) => void;
  deleteRow: (rowId: string) => void;
  addRow: (groupId: string) => void;
  addRowAfter: (rowId: string) => void;
  moveRow: (srcId: string, targetId: string, after: number) => void;
  groupDrop: (gid: string, srcId: string) => void;
  // groups
  addGroup: () => void;
  deleteGroup: (gid: string) => void;
  askDeleteGroup: (gid: string) => void;
  cancelDeleteGroup: () => void;
  toggleGroup: (gid: string) => void;
  // dnd transient
  setDragging: (rowId: string | null) => void;
  setDropTarget: (dt: UIState["dropTarget"]) => void;
  clearDrag: () => void;
  // week nav
  gotoWeek: (delta: number) => void;
  goToWeekKey: (key: string) => void;
  duplicateWeek: () => void;
  askDeleteWeek: () => void;
  cancelDeleteWeek: () => void;
  deleteWeek: () => void;
  // roll
  openRollForward: () => void;
  cancelRoll: () => void;
  confirmRollForward: () => void;
  // selection / focus / edit
  setSelCells: (sel: Record<string, true>) => void;
  setFocusCell: (fc: { rowId: string; di: number } | null) => void;
  setSelAnchor: (a: { rowId: string; di: number } | null) => void;
  setFocusTaskRow: (rowId: string | null) => void;
  moveFocus: (fc: { rowId: string; di: number }) => void;
  startEdit: (rowId: string, di: number) => void;
  cancelEdit: () => void;
  clearSelection: () => void;
  // menus
  openRowMenu: (rowId: string, x: number, y: number) => void;
  closeRowMenu: () => void;
  openCellMenu: (rowId: string, di: number, x: number, y: number) => void;
  closeCellMenu: () => void;
  // settings (project-level)
  scalarChange: (key: StringSettingKey, value: string) => void;
  persistSettings: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  toggleSection: (key: SectionKey) => void;
  addSub: () => void;
  removeSub: (id: string) => void;
  subChange: (id: string, field: "code" | "company" | "contact" | "phone", value: string) => void;
  addHoliday: () => void;
  removeHoliday: (id: string) => void;
  holidayChange: (id: string, field: "date" | "name", value: string) => void;
  addMilestone: () => void;
  removeMilestone: (id: string) => void;
  milestoneChange: (id: string, field: "date" | "name", value: string) => void;
  // settings (area-level view)
  toggleDay: (key: "showSat" | "showSun" | "carryForward") => void;
  setNumWeeks: (n: number) => void;
  // areas
  switchArea: (id: string) => void;
  addArea: (name: string, fromId: string | null) => void;
  renameArea: (id: string, name: string) => void;
  duplicateArea: (id: string) => void;
  deleteArea: (id: string) => void;
  // display
  setTheme: (theme: Theme) => void;
  setDensity: (density: Density) => void;
  // scroll + resize
  setScrolled: (x: boolean, y: boolean) => void;
  setTaskColW: (w: number) => void;
  persistTaskColW: () => void;
  // backup
  importDoc: (data: unknown) => boolean;
  // cloud
  loadProject: (blob: unknown) => void;
  // undo
  undo: () => void;
  redo: () => void;
}

export type Store = DocState & UIState & Actions;

const curArea = (s: DocState): Area => s.areas[s.currentAreaId];
const snap = (s: DocState): Snapshot => {
  const a = curArea(s);
  return { weeks: a.weeks, currentWeek: a.currentWeek };
};

function withUndo(s: Store, patch: Partial<Store>): Partial<Store> {
  const past = [...s.past, snap(s)];
  if (past.length > UNDO_CAP) past.shift();
  return { past, future: [], ...patch };
}

/** Set the current area's weeks (+optionally currentWeek), returning a new areas map. */
function setAreaWeeks(s: DocState, weeks: Weeks, currentWeek?: string): Record<string, Area> {
  const a = curArea(s);
  const na: Area = { ...a, weeks, ...(currentWeek !== undefined ? { currentWeek } : {}) };
  return { ...s.areas, [s.currentAreaId]: na };
}

/** Shallow-immutable copy of the current area's current week so we can mutate `w` then commit. */
function cloneCur(s: DocState): { areas: Record<string, Area>; w: WeekDoc } {
  const a = curArea(s);
  const cur = a.currentWeek;
  const src = a.weeks[cur];
  const w: WeekDoc = {
    flags: { ...src.flags },
    groups: src.groups.map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r, cells: { ...r.cells } })) })),
  };
  return { areas: setAreaWeeks(s, { ...a.weeks, [cur]: w }), w };
}

function findRow(w: WeekDoc, rowId: string): Row | null {
  for (const g of w.groups) {
    const x = g.rows.find((y) => y.id === rowId);
    if (x) return x;
  }
  return null;
}

const clearedSel: Partial<Store> = { selCells: {}, selCols: {}, focusCell: null, selAnchor: null, editing: null, menu: null, cellMenu: null };
const clearedForArea: Partial<Store> = { ...clearedSel, focusTaskRowId: null, rollPreview: null, confirmGroup: null, confirmDeleteWeek: false, past: [], future: [] };

const seed = buildSeed();

export const useStore = create<Store>()((set, get) => ({
  ...seed,
  editing: null,
  selCells: {},
  selCols: {},
  focusCell: null,
  selAnchor: null,
  focusTaskRowId: null,
  menu: null,
  cellMenu: null,
  draggingRowId: null,
  dropTarget: null,
  rollPreview: null,
  settingsOpen: false,
  confirmGroup: null,
  confirmDeleteWeek: false,
  openSections: { display: true, project: true, subs: false, holidays: false, milestones: false, backup: false },
  scrolledX: false,
  scrolledY: false,
  taskColW: seed.areas[seed.currentAreaId].view.taskColW,
  colAnchor: null,
  past: [],
  future: [],

  // ---------- cells ----------
  setCellStatusAt: (rowId, di, status) =>
    set((s) => {
      const { areas, w } = cloneCur(s);
      const r = findRow(w, rowId);
      if (!r) return {};
      if (status == null) delete r.cells[di];
      else {
        const prev = r.cells[di];
        r.cells[di] = { s: status, ...(prev && prev.t ? { t: prev.t } : {}) };
      }
      return withUndo(s, { areas });
    }),
  cycleCell: (rowId, di) =>
    set((s) => {
      const { areas, w } = cloneCur(s);
      const r = findRow(w, rowId);
      if (!r) return {};
      const cur = r.cells[di] ? r.cells[di].s ?? null : null;
      const next = cycleNext(cur);
      if (next == null) delete r.cells[di];
      else r.cells[di] = { s: next };
      return withUndo(s, { areas, selCells: {}, selCols: {} });
    }),
  commitEdit: (rowId, di, value) =>
    set((s) => {
      const { areas, w } = cloneCur(s);
      const r = findRow(w, rowId);
      if (r) {
        const t = (value || "").trim();
        const c = r.cells[di];
        if (t) r.cells[di] = c ? { ...c, t } : { t };
        else if (c) {
          delete c.t;
          if (!c.s) delete r.cells[di];
        }
      }
      return withUndo(s, { areas, editing: null });
    }),
  applyCellStatus: (status) =>
    set((s) => {
      const { areas, w } = cloneCur(s);
      const map: Record<string, Row> = {};
      w.groups.forEach((g) => g.rows.forEach((r) => (map[r.id] = r)));
      Object.keys(s.selCells).forEach((k) => {
        const idx = k.lastIndexOf(":");
        const rid = k.slice(0, idx);
        const di = +k.slice(idx + 1);
        const r = map[rid];
        if (!r) return;
        if (status == null) delete r.cells[di];
        else {
          const prev = r.cells[di];
          r.cells[di] = { s: status, ...(prev && prev.t ? { t: prev.t } : {}) };
        }
      });
      return withUndo(s, { areas });
    }),

  // ---------- fields (in-place, persist on blur) ----------
  setField: (rowId, field, value) => {
    const s = get();
    const a = curArea(s);
    const r = findRow(a.weeks[a.currentWeek], rowId);
    if (r) r[field] = value;
  },
  setGroupName: (gid, value) => {
    const s = get();
    const a = curArea(s);
    const g = a.weeks[a.currentWeek].groups.find((x) => x.id === gid);
    if (g) g.name = value;
  },
  persistData: () => set((s) => withUndo(s, { areas: { ...s.areas } })),

  // ---------- columns ----------
  toggleColumn: (di, shift, visCols) =>
    set((s) => {
      const sel = { ...s.selCols };
      let anchor = s.colAnchor;
      if (shift && anchor != null) {
        const va = visCols.indexOf(anchor);
        const vb = visCols.indexOf(di);
        if (va >= 0 && vb >= 0) {
          const a = Math.min(va, vb);
          const b = Math.max(va, vb);
          for (let i = a; i <= b; i++) sel[visCols[i]] = true;
        }
      } else {
        if (sel[di]) delete sel[di];
        else sel[di] = true;
        anchor = di;
      }
      return { selCols: sel, selCells: {}, editing: null, colAnchor: anchor };
    }),
  applyColFlag: (flag) =>
    set((s) => {
      const { areas, w } = cloneCur(s);
      Object.keys(s.selCols).forEach((di) => {
        if (flag == null) delete w.flags[+di];
        else w.flags[+di] = flag;
      });
      return withUndo(s, { areas });
    }),

  // ---------- rows ----------
  insertRow: (rowId, after) =>
    set((s) => {
      const { areas, w } = cloneCur(s);
      for (const g of w.groups) {
        const i = g.rows.findIndex((r) => r.id === rowId);
        if (i >= 0) {
          g.rows.splice(i + (after ? 1 : 0), 0, blankRow());
          break;
        }
      }
      return withUndo(s, { areas, menu: null });
    }),
  duplicateRow: (rowId) =>
    set((s) => {
      const { areas, w } = cloneCur(s);
      for (const g of w.groups) {
        const i = g.rows.findIndex((r) => r.id === rowId);
        if (i >= 0) {
          const src = g.rows[i];
          g.rows.splice(i + 1, 0, {
            id: uid(), task: src.task, sub: src.sub, notes: src.notes,
            cells: JSON.parse(JSON.stringify(src.cells)) as Record<number, Cell>,
          });
          break;
        }
      }
      return withUndo(s, { areas, menu: null });
    }),
  deleteRow: (rowId) =>
    set((s) => {
      const { areas, w } = cloneCur(s);
      for (const g of w.groups) {
        const i = g.rows.findIndex((r) => r.id === rowId);
        if (i >= 0) {
          g.rows.splice(i, 1);
          break;
        }
      }
      return withUndo(s, { areas, menu: null });
    }),
  addRow: (groupId) =>
    set((s) => {
      const { areas, w } = cloneCur(s);
      const g = w.groups.find((x) => x.id === groupId);
      let newId: string | null = null;
      if (g) {
        const nr = blankRow();
        g.rows.push(nr);
        newId = nr.id;
      }
      return withUndo(s, { areas, focusTaskRowId: newId });
    }),
  // Insert a blank task directly below `rowId` (Enter-to-continue from a task field).
  // Captures the new row's id in `focusTaskRowId` so the view drops the cursor into it.
  addRowAfter: (rowId) =>
    set((s) => {
      const { areas, w } = cloneCur(s);
      let newId: string | null = null;
      for (const g of w.groups) {
        const i = g.rows.findIndex((r) => r.id === rowId);
        if (i >= 0) {
          const nr = blankRow();
          g.rows.splice(i + 1, 0, nr);
          newId = nr.id;
          break;
        }
      }
      return withUndo(s, { areas, focusTaskRowId: newId });
    }),
  moveRow: (srcId, targetId, after) =>
    set((s) => {
      if (srcId === targetId) return {};
      const { areas, w } = cloneCur(s);
      let srcRow: Row | null = null;
      for (const g of w.groups) {
        const i = g.rows.findIndex((r) => r.id === srcId);
        if (i >= 0) {
          srcRow = g.rows.splice(i, 1)[0];
          break;
        }
      }
      if (!srcRow) return {};
      for (const g of w.groups) {
        const i = g.rows.findIndex((r) => r.id === targetId);
        if (i >= 0) {
          g.rows.splice(i + after, 0, srcRow);
          break;
        }
      }
      return withUndo(s, { areas });
    }),
  groupDrop: (gid, srcId) =>
    set((s) => {
      const { areas, w } = cloneCur(s);
      let srcRow: Row | null = null;
      for (const g of w.groups) {
        const i = g.rows.findIndex((r) => r.id === srcId);
        if (i >= 0) {
          srcRow = g.rows.splice(i, 1)[0];
          break;
        }
      }
      if (!srcRow) return {};
      const tg = w.groups.find((g) => g.id === gid);
      if (tg) tg.rows.unshift(srcRow);
      return withUndo(s, { areas });
    }),

  // ---------- groups ----------
  addGroup: () =>
    set((s) => {
      const { areas, w } = cloneCur(s);
      w.groups.push({ id: newGroupId(), name: "New Group", collapsed: false, rows: [blankRow()] });
      return withUndo(s, { areas });
    }),
  deleteGroup: (gid) =>
    set((s) => {
      const { areas, w } = cloneCur(s);
      w.groups = w.groups.filter((g) => g.id !== gid);
      return withUndo(s, { areas, confirmGroup: null });
    }),
  askDeleteGroup: (gid) => set({ confirmGroup: gid }),
  cancelDeleteGroup: () => set({ confirmGroup: null }),
  toggleGroup: (gid) =>
    set((s) => {
      const { areas, w } = cloneCur(s);
      const g = w.groups.find((g) => g.id === gid);
      if (g) g.collapsed = !g.collapsed;
      return withUndo(s, { areas, selCells: {}, selCols: {} });
    }),

  // ---------- dnd transient ----------
  setDragging: (rowId) => set({ draggingRowId: rowId, menu: null }),
  setDropTarget: (dt) => set({ dropTarget: dt }),
  clearDrag: () => set({ draggingRowId: null, dropTarget: null }),

  // ---------- week nav ----------
  gotoWeek: (delta) =>
    set((s) => {
      const a = curArea(s);
      const key = toKey(addDays(parseDate(a.currentWeek), delta * 7));
      const weeks = { ...a.weeks };
      if (!weeks[key]) weeks[key] = clonedStructure(weeks[a.currentWeek]);
      return withUndo(s, { areas: setAreaWeeks(s, weeks, key), selCells: {}, selCols: {}, editing: null, menu: null, confirmDeleteWeek: false });
    }),
  goToWeekKey: (key) =>
    set((s) => {
      const a = curArea(s);
      const weeks = { ...a.weeks };
      if (!weeks[key]) weeks[key] = clonedStructure(weeks[a.currentWeek]);
      return withUndo(s, { areas: setAreaWeeks(s, weeks, key), selCells: {}, selCols: {}, editing: null, menu: null, confirmDeleteWeek: false });
    }),
  duplicateWeek: () =>
    set((s) => {
      const a = curArea(s);
      const key = toKey(addDays(parseDate(a.currentWeek), 7));
      const weeks = { ...a.weeks };
      weeks[key] = duplicateWeekDoc(weeks[a.currentWeek]);
      return withUndo(s, { areas: setAreaWeeks(s, weeks, key), selCells: {}, selCols: {}, editing: null, menu: null });
    }),
  askDeleteWeek: () => set({ confirmDeleteWeek: true }),
  cancelDeleteWeek: () => set({ confirmDeleteWeek: false }),
  deleteWeek: () =>
    set((s) => {
      const a = curArea(s);
      const keys = Object.keys(a.weeks);
      if (keys.length <= 1) return { confirmDeleteWeek: false };
      const weeks = { ...a.weeks };
      delete weeks[a.currentWeek];
      const remaining = Object.keys(weeks).sort();
      const prevKeys = remaining.filter((k) => k < a.currentWeek);
      const next = prevKeys.length ? prevKeys[prevKeys.length - 1] : remaining[0];
      return withUndo(s, { areas: setAreaWeeks(s, weeks, next), confirmDeleteWeek: false, selCells: {}, selCols: {}, editing: null, menu: null });
    }),

  // ---------- roll ----------
  openRollForward: () =>
    set((s) => {
      const a = curArea(s);
      const data = rollPreviewData(a.weeks[a.currentWeek], a.view.numWeeks);
      const exists = !!a.weeks[toKey(addDays(parseDate(a.currentWeek), 7))];
      return { rollPreview: { ...data, exists }, settingsOpen: false, menu: null };
    }),
  cancelRoll: () => set({ rollPreview: null }),
  confirmRollForward: () =>
    set((s) => {
      const a = curArea(s);
      const curKey = a.currentWeek;
      const nw = clampWeeks(a.view.numWeeks);
      const newKey = toKey(addDays(parseDate(curKey), 7));
      const doc = buildRolledWeek(a.weeks[curKey], curKey, nw);
      const weeks = { ...a.weeks, [newKey]: doc };
      return withUndo(s, { areas: setAreaWeeks(s, weeks, newKey), rollPreview: null, selCells: {}, selCols: {}, editing: null, menu: null });
    }),

  // ---------- selection / focus / edit ----------
  setSelCells: (sel) => set({ selCells: sel, selCols: {} }),
  setFocusCell: (fc) => set({ focusCell: fc }),
  setSelAnchor: (a) => set({ selAnchor: a }),
  setFocusTaskRow: (rowId) => set({ focusTaskRowId: rowId }),
  // Plain navigation: move the focused cell and collapse any range back to it
  // (the moved-to cell becomes the new anchor for a later shift-extend).
  moveFocus: (fc) => set({ focusCell: fc, selCells: {}, selCols: {}, selAnchor: fc }),
  startEdit: (rowId, di) => set({ editing: rowId + ":" + di, focusCell: { rowId, di }, selAnchor: { rowId, di }, selCells: {}, selCols: {} }),
  cancelEdit: () => set({ editing: null }),
  clearSelection: () => set({ selCells: {}, selCols: {}, focusCell: null, selAnchor: null }),

  // ---------- menus ----------
  openRowMenu: (rowId, x, y) => set({ menu: { rowId, x, y } }),
  closeRowMenu: () => set({ menu: null }),
  openCellMenu: (rowId, di, x, y) => set({ cellMenu: { rowId, di, x, y }, focusCell: { rowId, di }, menu: null }),
  closeCellMenu: () => set({ cellMenu: null }),

  // ---------- settings (project-level) ----------
  scalarChange: (key, value) => {
    get().project.info[key] = value;
  },
  persistSettings: () => set((s) => ({ project: { ...s.project, info: { ...s.project.info } } })),
  openSettings: () => set({ settingsOpen: true, menu: null }),
  closeSettings: () => set((s) => ({ project: { ...s.project, info: { ...s.project.info } }, settingsOpen: false })),
  toggleSection: (key) => set((s) => ({ openSections: { ...s.openSections, [key]: !s.openSections[key] } })),
  addSub: () =>
    set((s) => ({ project: { ...s.project, subs: [...s.project.subs, { id: uid(), code: "", company: "", contact: "", phone: "" }] } })),
  removeSub: (id) => set((s) => ({ project: { ...s.project, subs: s.project.subs.filter((x) => x.id !== id) } })),
  subChange: (id, field, value) => {
    const x = get().project.subs.find((s) => s.id === id);
    if (x) x[field] = value;
  },
  addHoliday: () =>
    set((s) => ({ project: { ...s.project, holidays: [...s.project.holidays, { id: uid(), date: "", name: "" }] } })),
  removeHoliday: (id) => set((s) => ({ project: { ...s.project, holidays: s.project.holidays.filter((x) => x.id !== id) } })),
  holidayChange: (id, field, value) => {
    const x = get().project.holidays.find((h) => h.id === id);
    if (x) x[field] = value;
  },
  addMilestone: () =>
    set((s) => ({ project: { ...s.project, milestones: [...s.project.milestones, { id: uid(), date: "", name: "" }] } })),
  removeMilestone: (id) => set((s) => ({ project: { ...s.project, milestones: s.project.milestones.filter((x) => x.id !== id) } })),
  milestoneChange: (id, field, value) => {
    const x = get().project.milestones.find((m) => m.id === id);
    if (x) x[field] = value;
  },

  // ---------- settings (area-level view) ----------
  toggleDay: (key) =>
    set((s) => {
      const a = curArea(s);
      const view = { ...a.view, [key]: !a.view[key] };
      return { areas: { ...s.areas, [s.currentAreaId]: { ...a, view } }, selCells: {}, selCols: {} };
    }),
  setNumWeeks: (n) =>
    set((s) => {
      const a = curArea(s);
      const view = { ...a.view, numWeeks: clampWeeks(n) };
      return { areas: { ...s.areas, [s.currentAreaId]: { ...a, view } }, selCells: {}, selCols: {} };
    }),

  // ---------- areas ----------
  switchArea: (id) =>
    set((s) => {
      if (!s.areas[id] || id === s.currentAreaId) return {};
      return { currentAreaId: id, taskColW: s.areas[id].view.taskColW, ...clearedForArea };
    }),
  addArea: (name, fromId) =>
    set((s) => {
      const startKey = curArea(s).currentWeek;
      const from = fromId ? s.areas[fromId] : null;
      let area: Area;
      if (from) {
        area = {
          id: uid(), name: name || "New look-ahead",
          weeks: { [startKey]: clonedStructure(from.weeks[from.currentWeek]) },
          currentWeek: startKey, view: { ...from.view },
        };
      } else {
        area = makeBlankArea(name || "New look-ahead", startKey);
      }
      return {
        areas: { ...s.areas, [area.id]: area }, areaOrder: [...s.areaOrder, area.id],
        currentAreaId: area.id, taskColW: area.view.taskColW, ...clearedForArea,
      };
    }),
  renameArea: (id, name) =>
    set((s) => {
      const a = s.areas[id];
      if (!a) return {};
      return { areas: { ...s.areas, [id]: { ...a, name: name || a.name } } };
    }),
  duplicateArea: (id) =>
    set((s) => {
      const a = s.areas[id];
      if (!a) return {};
      const copy = JSON.parse(JSON.stringify({ weeks: a.weeks, currentWeek: a.currentWeek, view: a.view }));
      const nid = uid();
      const area: Area = { id: nid, name: a.name + " (copy)", ...copy };
      const order = [...s.areaOrder];
      order.splice(order.indexOf(id) + 1, 0, nid);
      return { areas: { ...s.areas, [nid]: area }, areaOrder: order, currentAreaId: nid, taskColW: area.view.taskColW, ...clearedForArea };
    }),
  deleteArea: (id) =>
    set((s) => {
      if (s.areaOrder.length <= 1 || !s.areas[id]) return {};
      const areas = { ...s.areas };
      delete areas[id];
      const i = s.areaOrder.indexOf(id);
      const order = s.areaOrder.filter((x) => x !== id);
      let cur = s.currentAreaId;
      if (cur === id) cur = order[Math.max(0, i - 1)] || order[0];
      return { areas, areaOrder: order, currentAreaId: cur, taskColW: areas[cur].view.taskColW, ...clearedForArea };
    }),

  // ---------- display ----------
  setTheme: (theme) => set({ theme }),
  setDensity: (density) => set({ density }),

  // ---------- scroll + resize ----------
  setScrolled: (x, y) => set({ scrolledX: x, scrolledY: y }),
  setTaskColW: (w) => set({ taskColW: w }),
  persistTaskColW: () =>
    set((s) => {
      const a = curArea(s);
      return { areas: { ...s.areas, [s.currentAreaId]: { ...a, view: { ...a.view, taskColW: s.taskColW } } } };
    }),

  // ---------- backup ----------
  importDoc: (data) => {
    try {
      if (!data || typeof data !== "object") return false;
      const p = data as Record<string, unknown> & { areas?: Record<string, unknown>; areaOrder?: string[]; currentAreaId?: string; theme?: string; density?: string };
      if (!p.areas || typeof p.areas !== "object" || !Object.keys(p.areas).length) return false;
      const project = normalizeProject(p.project as ProjectMeta | undefined);
      let order = Array.isArray(p.areaOrder) && p.areaOrder.length ? p.areaOrder.filter((id) => p.areas![id]) : Object.keys(p.areas);
      const areas: Record<string, Area> = {};
      order.forEach((id) => (areas[id] = normalizeArea(p.areas![id] as Partial<Area>)));
      Object.keys(p.areas).forEach((id) => {
        if (!areas[id]) {
          areas[id] = normalizeArea(p.areas![id] as Partial<Area>);
          order.push(id);
        }
      });
      const currentAreaId = p.currentAreaId && areas[p.currentAreaId] ? p.currentAreaId : order[0];
      set({
        project, areas, areaOrder: order, currentAreaId,
        theme: p.theme === "dark" ? "dark" : "light",
        density: p.density === "compact" ? "compact" : "comfortable",
        taskColW: areas[currentAreaId].view.taskColW,
        ...clearedForArea, settingsOpen: false,
      });
      return true;
    } catch {
      return false;
    }
  },

  // ---------- cloud: hydrate the store from a stored project blob ----------
  loadProject: (blob) => {
    const b = (blob || {}) as Partial<ProjectBlob>;
    const project = normalizeProject(b.project);
    const rawAreas = b.areas && typeof b.areas === "object" ? b.areas : {};
    let order =
      Array.isArray(b.areaOrder) && b.areaOrder.length ? b.areaOrder.filter((id) => rawAreas[id]) : Object.keys(rawAreas);
    const areas: Record<string, Area> = {};
    order.forEach((id) => (areas[id] = normalizeArea(rawAreas[id])));
    Object.keys(rawAreas).forEach((id) => {
      if (!areas[id]) {
        areas[id] = normalizeArea(rawAreas[id]);
        order.push(id);
      }
    });
    if (!order.length) {
      const a = makeBlankArea("Main", todayKey());
      areas[a.id] = a;
      order = [a.id];
    }
    const currentAreaId = b.currentAreaId && areas[b.currentAreaId] ? b.currentAreaId : order[0];
    set({
      project, areas, areaOrder: order, currentAreaId,
      taskColW: areas[currentAreaId].view.taskColW,
      ...clearedForArea, settingsOpen: false,
    });
  },

  // ---------- undo ----------
  undo: () =>
    set((s) => {
      if (!s.past.length) return {};
      const prev = s.past[s.past.length - 1];
      return {
        past: s.past.slice(0, -1),
        future: [...s.future, snap(s)],
        areas: setAreaWeeks(s, prev.weeks, prev.currentWeek),
        selCells: {}, selCols: {}, editing: null, menu: null, confirmGroup: null,
      };
    }),
  redo: () =>
    set((s) => {
      if (!s.future.length) return {};
      const nx = s.future[s.future.length - 1];
      return {
        future: s.future.slice(0, -1),
        past: [...s.past, snap(s)],
        areas: setAreaWeeks(s, nx.weeks, nx.currentWeek),
        selCells: {}, selCols: {}, editing: null, menu: null,
      };
    }),
}));

/** Extract the serializable per-project document from store state (for cloud save). */
export function projectBlob(s: DocState): ProjectBlob {
  return { project: s.project, areas: s.areas, areaOrder: s.areaOrder, currentAreaId: s.currentAreaId };
}

export { outcomeOf };
export type { Group };

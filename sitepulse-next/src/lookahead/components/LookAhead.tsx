"use client";

import "./lookahead.css";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { GripVertical, MoreHorizontal } from "lucide-react";
import { useStore } from "@/lookahead/store/useStore";
import { getAccent, getTokens, blend, FONT_SANS, FONT_MONO } from "@/lookahead/lib/tokens";
import { ACCENT, SHOW_NOTES } from "@/lookahead/lib/config";
import { addDays, fmtMD, mon, parseDate, toKey } from "@/lookahead/lib/date";
import {
  buildVisDows, clampWeeks, computeFlags, hasDoneFront, projWeekNum, projectMonday,
} from "@/lookahead/lib/schedule";
import { windowMeta, effectiveWeeks, LA_LANDSCAPE_MIN } from "@/lookahead/lib/view";
import { rectSelection } from "@/lookahead/lib/selection";
import type { Status } from "@/lookahead/lib/types";
import Header from "./Header";
import Toolbar from "./Toolbar";
import ActionBars from "./ActionBars";
import Menus from "./Menus";
import RollModal from "./RollModal";
import SettingsDrawer from "./SettingsDrawer";

const defLabel: Record<Status, string> = { start: "START", ongoing: "X", done: "DONE" };

// Phase 5 (UI convergence — responsive): on a portrait/narrow viewport the sticky
// task + sub columns are capped so the day cells stay on-screen without the task
// column swallowing an iPad. The user can still resize `taskColW` (the raw stored
// value is untouched); this only caps what's *rendered* while narrow.
const NARROW_TASK_W = 180; // px — effective task-column cap on portrait
const NARROW_SUB_W = 84; // px — effective sub-column width on portrait
const FULL_SUB_W = 110; // px — sub-column width on landscape/desktop (unchanged)

// Phase 5: track the viewport width (for the render-only week-window + column
// clamps) and whether the browser is printing. `printing` forces the full saved
// window/columns so a print from a narrowed iPad still emits the whole plan — it
// uses `flushSync` so the expanded grid is in the DOM *before* the print snapshot.
// This is transient, render-derived component state (no DB data, no global UI
// state), so a local listener hook is the right tool here (AGENTS §2 targets
// server/global state, not viewport measurement).
function useViewport(): { viewportWidth: number | null; printing: boolean } {
  const [viewportWidth, setViewportWidth] = useState<number | null>(
    () => (typeof window === "undefined" ? null : window.innerWidth),
  );
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    onResize();
    const onBeforePrint = () => flushSync(() => setPrinting(true));
    const onAfterPrint = () => setPrinting(false);
    window.addEventListener("resize", onResize);
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, []);
  return { viewportWidth, printing };
}

interface LookAheadProps {
  /** Optional extra autocomplete entries for the sub cell's `la-subs` datalist,
   *  merged (union + de-dupe) with the blob's own `project.subs` codes. The
   *  SitePulse mount (LookaheadWorkspace) injects these from the project's contact
   *  directory; the cell stays a free-text input that stores a plain string, so
   *  free-typing any name is unaffected. Defaults to [] so the vendored module
   *  runs identically standalone. */
  palette?: string[];
}

export default function LookAhead({ palette = [] }: LookAheadProps = {}) {
  const s = useStore();
  const [mounted, setMounted] = useState(false);
  const { viewportWidth, printing } = useViewport();

  const dragRef = useRef<{ startRow: number; startDi: number; moved: boolean; wasFocused: boolean; detail: number } | null>(null);
  const fillRef = useRef<{ rowId: string; di: number; status: Status } | null>(null);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);
  const rowOrderRef = useRef<string[]>([]);
  const visColsRef = useRef<number[]>([]);
  // Holds the task-description input of the row flagged in `focusTaskRowId`, so a
  // freshly created task can grab the cursor (Enter-to-continue / "+ Task").
  const focusTaskInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setMounted(true), []);

  // After a new task row is created, move the cursor into its description field
  // and clear the one-shot flag.
  useEffect(() => {
    if (!s.focusTaskRowId) return;
    const el = focusTaskInputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
    useStore.getState().setFocusTaskRow(null);
  }, [s.focusTaskRowId]);

  // ---- global mouse + keyboard model (attached once) ----
  useEffect(() => {
    const onUp = () => {
      const st = useStore.getState();
      if (fillRef.current) {
        st.applyCellStatus(fillRef.current.status);
        fillRef.current = null;
        dragRef.current = null;
        return;
      }
      if (resizeRef.current) {
        resizeRef.current = null;
        st.persistTaskColW();
        return;
      }
      const d = dragRef.current;
      if (d) {
        if (!d.moved && d.wasFocused && d.detail === 1) {
          const rid = rowOrderRef.current[d.startRow];
          if (rid != null) st.cycleCell(rid, d.startDi);
        }
        dragRef.current = null;
      }
    };
    const onMove = (e: MouseEvent) => {
      if (resizeRef.current) {
        const st = useStore.getState();
        const w = Math.max(140, Math.min(440, resizeRef.current.startW + (e.clientX - resizeRef.current.startX)));
        if (w !== st.taskColW) st.setTaskColW(w);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const ae = document.activeElement;
      const inField = !!(ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT"));
      if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
        if (inField || st.editing) return;
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "y" || e.key === "Y")) {
        if (inField || st.editing) return;
        e.preventDefault();
        st.redo();
        return;
      }
      if (e.key === "Escape") {
        if (st.editing) st.cancelEdit();
        else if (st.cellMenu || st.menu) {
          st.closeCellMenu();
          st.closeRowMenu();
        } else if (st.settingsOpen) st.closeSettings();
        else if (st.rollPreview) st.cancelRoll();
        else {
          st.clearSelection();
          dragRef.current = null;
        }
        return;
      }
      if (inField || st.editing) return;
      const fc = st.focusCell;
      const rowOrder = rowOrderRef.current;
      const visCols = visColsRef.current;
      const fcActive = !!(fc && rowOrder.indexOf(fc.rowId) >= 0);
      // navigation (needs a focused cell)
      if (fc && fcActive) {
        // Move focus to `head`. With Shift held, grow the rectangular selection
        // from the fixed anchor instead of collapsing it.
        const navTo = (head: { rowId: string; di: number }) => {
          if (e.shiftKey) {
            const anchor = st.selAnchor ?? fc;
            const sel = rectSelection(rowOrder, visCols, anchor, head);
            if (sel) {
              st.setSelCells(sel);
              st.setFocusCell(head);
              st.setSelAnchor(anchor);
              return;
            }
          }
          st.moveFocus(head);
        };
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const vi = visCols.indexOf(fc.di);
          if (vi >= 0) {
            const ni = Math.max(0, Math.min(visCols.length - 1, vi + (e.key === "ArrowRight" ? 1 : -1)));
            navTo({ rowId: fc.rowId, di: visCols[ni] });
          }
          return;
        }
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const ri = rowOrder.indexOf(fc.rowId);
          const nr = Math.max(0, Math.min(rowOrder.length - 1, ri + (e.key === "ArrowDown" ? 1 : -1)));
          navTo({ rowId: rowOrder[nr], di: fc.di });
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          const vi = visCols.indexOf(fc.di);
          if (vi >= 0) {
            const ni = Math.max(0, Math.min(visCols.length - 1, vi + (e.shiftKey ? -1 : 1)));
            st.moveFocus({ rowId: fc.rowId, di: visCols[ni] });
          }
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const ri = rowOrder.indexOf(fc.rowId);
          const nr = Math.max(0, Math.min(rowOrder.length - 1, ri + (e.shiftKey ? -1 : 1)));
          st.moveFocus({ rowId: rowOrder[nr], di: fc.di });
          return;
        }
        if (e.key === "F2") {
          e.preventDefault();
          st.startEdit(fc.rowId, fc.di);
          return;
        }
      }
      // status / clear keys — apply to the whole marquee selection if one exists, else the focused cell
      const hasSel = Object.keys(st.selCells).length > 0;
      if (hasSel || fcActive) {
        const k = (e.key || "").toLowerCase();
        const apply = (status: Status | null) => {
          if (hasSel) st.applyCellStatus(status);
          else if (fc) st.setCellStatusAt(fc.rowId, fc.di, status);
        };
        if (k === "s") { e.preventDefault(); apply("start"); return; }
        if (k === "x" || k === "i") { e.preventDefault(); apply("ongoing"); return; }
        if (k === "d") { e.preventDefault(); apply("done"); return; }
        if (e.key === "Backspace" || e.key === "Delete" || k === "0" || k === "c") { e.preventDefault(); apply(null); return; }
      }
    };
    document.addEventListener("mouseup", onUp);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!mounted) return <div style={{ minHeight: "100vh", background: "#fafafa" }} />;

  // ---------- derived render data (port of renderVals) ----------
  const t = getTokens(s.theme);
  const ac = getAccent(ACCENT, s.theme);
  const focusRing = s.theme === "dark" ? "#60a5fa" : "#2563eb";
  const area = s.areas[s.currentAreaId];
  // Phase 5: portrait/narrow viewports cap the rendered sticky columns so day
  // cells stay visible. `taskColW` (raw, user-resizable) is unchanged — only the
  // EFFECTIVE width fed to the layout is capped while narrow. Print expands back.
  const narrow = !printing && viewportWidth != null && viewportWidth < LA_LANDSCAPE_MIN;
  const taskW = s.taskColW || area.view.taskColW || 220;
  const effTaskW = narrow ? Math.min(taskW, NARROW_TASK_W) : taskW;
  const subW = narrow ? NARROW_SUB_W : FULL_SUB_W;
  const sx = s.scrolledX;
  const sy = s.scrolledY;
  const SHX = "6px 0 9px -7px rgba(0,0,0," + (s.theme === "dark" ? ".6" : ".22") + ")";
  const SHY = "0 6px 9px -7px rgba(0,0,0," + (s.theme === "dark" ? ".6" : ".22") + ")";
  const shf = (r: boolean, b: boolean): string | undefined => {
    const a: string[] = [];
    if (r && sx) a.push(SHX);
    if (b && sy) a.push(SHY);
    return a.length ? a.join(", ") : undefined;
  };
  const dense = s.density === "compact";
  const rowH = dense ? 27 : 33;
  const cellFont = dense ? 9.5 : 10.5;
  const showNotes = SHOW_NOTES;

  const project = s.project;
  const cur = area.weeks[area.currentWeek];
  const groups = cur.groups;
  const holidaySet = new Set(project.holidays.filter((h) => h.date).map((h) => h.date));
  const msMap: Record<string, string> = {};
  (project.milestones || []).forEach((m) => {
    if (m.date) msMap[m.date] = m.name || "Milestone";
  });
  const msColor = s.theme === "dark" ? "#c4b5fd" : "#7c3aed";

  const start = parseDate(area.currentWeek);
  // Phase 5: the grid renders an EFFECTIVE (render-only) week count — portrait
  // narrows to a 1-week window so the dense grid fits an iPad; landscape/desktop
  // (and any print) show the full saved window. This NEVER writes back to
  // `view.numWeeks`, so the saved plan + the Settings "Weeks shown" value are
  // unchanged and rotating the device does not autosave.
  const savedWeeks = clampWeeks(area.view.numWeeks);
  const numWeeks =
    printing || viewportWidth == null ? savedWeeks : effectiveWeeks(savedWeeks, viewportWidth);
  const dows7 = ["MON", "TUES", "WED", "THUR", "FRI", "SAT", "SUN"];
  const visDows = buildVisDows(area.view);
  const nDays = visDows.length;
  const totalCols = 2 + nDays * numWeeks + (showNotes ? 1 : 0);

  const psMon = projectMonday(project.info.projectStart);
  const flags = computeFlags(cur.flags, start, numWeeks, holidaySet);

  const visCols: number[] = [];
  for (let w = 0; w < numWeeks; w++) for (const dow of visDows) visCols.push(w * 7 + dow);
  visColsRef.current = visCols;

  const lastOffset = (numWeeks - 1) * 7 + visDows[visDows.length - 1];
  const { weekOfLabel, windowSubtitle } = windowMeta(area.currentWeek, area.view);

  // week-group headers
  const weeksHdr = Array.from({ length: numWeeks }, (_, w) => {
    const ws = addDays(start, w * 7);
    const we = addDays(start, w * 7 + visDows[visDows.length - 1]);
    const range =
      mon(ws) === mon(we)
        ? mon(ws) + " " + ws.getDate() + "–" + we.getDate()
        : mon(ws) + " " + ws.getDate() + "–" + mon(we) + " " + we.getDate();
    const pn = projWeekNum(ws, psMon);
    const headStyle: CSSProperties = {
      background: t.headBg, color: t.fg, position: "sticky", top: 0, zIndex: 30, height: "24px", fontSize: "11px",
      fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", borderBottom: "1px solid " + t.border,
      borderLeft: "2px solid " + t.borderStrong, padding: "0 8px", textAlign: "left", whiteSpace: "nowrap",
    };
    return { label: pn != null ? "Week " + pn : "Week " + (w + 1), range, span: nDays, headStyle };
  });

  // day headers
  const flagTagMap: Record<string, string> = { weekend: "WKND", holiday: "HOL", closed: "CLOSED" };
  const days: {
    idx: number; dow: string; date: string; flag: string | null; selected: boolean;
    flagTag: string; flagTagStyle: CSSProperties; msName: string; msStyle: CSSProperties; title: string; thStyle: CSSProperties;
  }[] = [];
  for (let w = 0; w < numWeeks; w++) {
    for (let di = 0; di < visDows.length; di++) {
      const dow = visDows[di];
      const i = w * 7 + dow;
      const d = addDays(start, w * 7 + dow);
      const flag = flags[i] || null;
      const selected = !!s.selCols[i];
      const wk = di === 0;
      const msName = msMap[toKey(d)];
      const th: CSSProperties = {
        background: selected ? ac.main : flag ? blend(t.headBg, t.flag[flag]) : t.headBg,
        color: selected ? ac.fg : t.fg, position: "sticky", top: "24px", zIndex: 30, width: "46px", minWidth: "46px",
        height: "40px", padding: "2px 0", textAlign: "center", cursor: "pointer", userSelect: "none",
        borderBottom: "1px solid " + t.borderStrong, borderLeft: wk ? "2px solid " + t.borderStrong : "1px solid " + t.border,
      };
      if (sy) th.boxShadow = SHY;
      if (msName) th.borderTop = "3px solid " + msColor;
      days.push({
        idx: i, dow: dows7[dow], date: fmtMD(d), flag, selected,
        flagTag: flag ? flagTagMap[flag] : "",
        flagTagStyle: { fontSize: "7px", fontWeight: 700, letterSpacing: ".04em", marginTop: "1px", color: selected ? ac.fg : flag === "holiday" ? "#e11d48" : t.mutedFg },
        msName: msName || "",
        msStyle: { fontSize: "7px", fontWeight: 700, marginTop: "1px", color: selected ? ac.fg : msColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "44px" },
        title: msName ? "◆ Milestone: " + msName : "Click to select column · shift-click for range",
        thStyle: th,
      });
    }
  }

  // ---------- handlers using refs + store ----------
  const cellDown = (rowId: string, di: number, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const st = useStore.getState();
    if (st.editing) {
      // Clicking another cell while editing commits the text (via the input's blur)
      // and exits edit mode. Don't preventDefault (so blur fires); don't start a drag/cycle.
      if (st.editing !== rowId + ":" + di) st.setFocusCell({ rowId, di });
      return;
    }
    e.preventDefault();
    // Shift-click extends a rectangular selection from the anchor (the last
    // focused/clicked cell) to the clicked cell — no cell-status cycle.
    if (e.shiftKey) {
      const anchor = st.selAnchor ?? st.focusCell ?? { rowId, di };
      const sel = rectSelection(rowOrderRef.current, visColsRef.current, anchor, { rowId, di });
      if (sel) {
        st.setSelCells(sel);
        st.setFocusCell({ rowId, di });
        st.setSelAnchor(anchor);
      }
      return;
    }
    const fc = st.focusCell;
    const wasFocused = !!(fc && fc.rowId === rowId && fc.di === di);
    dragRef.current = { startRow: rowOrderRef.current.indexOf(rowId), startDi: di, moved: false, wasFocused, detail: e.detail || 1 };
    st.setFocusCell({ rowId, di });
    st.setSelAnchor({ rowId, di });
  };
  const cellEnter = (rowId: string, di: number) => {
    const st = useStore.getState();
    const rowOrder = rowOrderRef.current;
    const vc = visColsRef.current;
    if (fillRef.current) {
      const f = fillRef.current;
      // Fill-drag paints the inclusive rectangle from the fill origin to the
      // hovered cell — identical math to shift-select, so reuse rectSelection.
      const sel = rectSelection(rowOrder, vc, { rowId: f.rowId, di: f.di }, { rowId, di });
      if (sel) st.setSelCells(sel);
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    d.moved = true;
    const r2 = rowOrder.indexOf(rowId);
    const v1 = vc.indexOf(d.startDi), v2 = vc.indexOf(di);
    if (v1 < 0 || v2 < 0) return;
    const rA = Math.min(d.startRow, r2), rB = Math.max(d.startRow, r2), vA = Math.min(v1, v2), vB = Math.max(v1, v2);
    const sel: Record<string, true> = {};
    for (let ri = rA; ri <= rB; ri++) {
      const rid = rowOrder[ri];
      if (rid == null) continue;
      for (let vi = vA; vi <= vB; vi++) sel[rid + ":" + vc[vi]] = true;
    }
    st.setSelCells(sel);
  };
  const fillDown = (rowId: string, di: number, status: Status, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = null;
    fillRef.current = { rowId, di, status };
    const st = useStore.getState();
    st.setSelCells({ [rowId + ":" + di]: true });
    st.setFocusCell({ rowId, di });
  };
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startW: useStore.getState().taskColW };
  };
  const cellContext = (rowId: string, di: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = null;
    useStore.getState().openCellMenu(rowId, di, e.clientX, e.clientY);
  };
  // native HTML5 drag-and-drop (matches the prototype)
  const onDragStart = (rowId: string, e: React.DragEvent) => {
    s.setDragging(rowId);
    try {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", rowId);
    } catch {
      /* noop */
    }
  };
  const onRowDragOver = (rowId: string, e: React.DragEvent) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = e.clientY - rect.top < rect.height / 2 ? "above" : "below";
    const dt = useStore.getState().dropTarget;
    if (!dt || dt.rowId !== rowId || dt.pos !== pos) s.setDropTarget({ rowId, pos });
  };
  const onRowDrop = (rowId: string, e: React.DragEvent) => {
    e.preventDefault();
    const st = useStore.getState();
    const src = st.draggingRowId;
    const dt = st.dropTarget;
    st.clearDrag();
    if (!src || !dt) return;
    st.moveRow(src, rowId, dt.pos === "below" ? 1 : 0);
  };
  const onGroupDragOver = (gid: string, e: React.DragEvent) => {
    e.preventDefault();
    const dt = useStore.getState().dropTarget;
    if (!dt || dt.groupId !== gid) s.setDropTarget({ groupId: gid });
  };
  const onGroupDrop = (gid: string, e: React.DragEvent) => {
    e.preventDefault();
    const st = useStore.getState();
    const src = st.draggingRowId;
    st.clearDrag();
    if (src) st.groupDrop(gid, src);
  };

  // ---------- body ----------
  const dt = s.dropTarget;
  const subCodes = project.subs.map((x) => x.code).filter(Boolean);
  // Phase 3 (Project Contacts): merge the blob's own sub codes with the optional
  // injected palette — union + de-dupe, blob codes first. Empty palette (the
  // standalone default) leaves the datalist identical to before.
  const subOptions = Array.from(new Set([...subCodes, ...palette]));
  const wkKey = area.id + "-" + area.currentWeek;
  const rowOrder: string[] = [];
  const bodyNodes: ReactNode[] = [];

  const taskFlexStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "5px", height: "100%" };
  const fieldInput = (weight: number, size: number, color: string): CSSProperties => ({
    width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "inherit",
    fontSize: size + "px", fontWeight: weight, color, padding: 0,
  });

  groups.forEach((g) => {
    const groupDrop = !!(dt && dt.groupId === g.id);
    const confirmDelete = s.confirmGroup === g.id;
    bodyNodes.push(
      <tr key={"g-" + wkKey + "-" + g.id} onDragOver={(e) => onGroupDragOver(g.id, e)} onDrop={(e) => onGroupDrop(g.id, e)}>
        <td
          colSpan={totalCols}
          style={{
            background: t.groupBg, borderTop: "1px solid " + t.border,
            borderBottom: groupDrop ? "2px solid " + ac.main : "1px solid " + t.border, padding: 0,
          }}
        >
          <div style={{ position: "sticky", left: 0, display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px", maxWidth: "460px" }}>
            <button onClick={() => s.toggleGroup(g.id)} style={{ border: "none", background: "transparent", color: t.mutedFg, cursor: "pointer", fontSize: "11px", padding: "2px 4px", lineHeight: 1 }}>
              {g.collapsed ? "▸" : "▾"}
            </button>
            <input
              defaultValue={g.name}
              onChange={(e) => s.setGroupName(g.id, e.target.value)}
              onBlur={() => s.persistData()}
              style={{ border: "none", outline: "none", background: "transparent", color: t.fg, fontFamily: "inherit", fontSize: "11px", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", width: "200px", padding: "2px 0" }}
            />
            <span style={{ fontSize: "10.5px", color: t.faintFg, fontWeight: 500 }}>
              {g.rows.length + (g.rows.length === 1 ? " task" : " tasks")}
            </span>
            <button className="no-print" onClick={() => s.addRow(g.id)} style={{ border: "1px solid " + t.border, background: t.panel, color: t.mutedFg, cursor: "pointer", fontSize: "10.5px", fontWeight: 500, padding: "2px 8px", borderRadius: "5px" }}>
              + Task
            </button>
            {!confirmDelete && (
              <button className="no-print" onClick={() => s.askDeleteGroup(g.id)} style={{ border: "none", background: "transparent", color: t.faintFg, cursor: "pointer", fontSize: "10px", fontWeight: 600, padding: "2px 6px", borderRadius: "5px" }} title="Delete group">
                ✕
              </button>
            )}
            {confirmDelete && (
              <>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "#e11d48", marginLeft: "2px", whiteSpace: "nowrap" }}>Delete group?</span>
                <button className="no-print" onClick={() => s.deleteGroup(g.id)} style={{ border: "none", background: "#e11d48", color: "#fff", cursor: "pointer", fontSize: "10.5px", fontWeight: 600, padding: "3px 9px", borderRadius: "5px" }}>Delete</button>
                <button className="no-print" onClick={() => s.cancelDeleteGroup()} style={{ border: "1px solid " + t.border, background: t.panel, color: t.mutedFg, cursor: "pointer", fontSize: "10.5px", fontWeight: 600, padding: "3px 9px", borderRadius: "5px" }}>Cancel</button>
              </>
            )}
          </div>
        </td>
      </tr>
    );

    if (!g.collapsed) {
      g.rows.forEach((r) => {
        rowOrder.push(r.id);
        const dropAbove = !!(dt && dt.rowId === r.id && dt.pos === "above");
        const dropBelow = !!(dt && dt.rowId === r.id && dt.pos === "below");
        const edgeTop = dropAbove ? "2px solid " + ac.main : null;
        const edgeBot = dropBelow ? "2px solid " + ac.main : null;

        const cellNodes: ReactNode[] = [];
        for (let w = 0; w < numWeeks; w++) {
          for (let di = 0; di < visDows.length; di++) {
            const dow = visDows[di];
            const ci = w * 7 + dow;
            const cd = r.cells[ci];
            const status = (cd ? cd.s : null) ?? null;
            const flag = flags[ci] || null;
            const selected = !!s.selCells[r.id + ":" + ci];
            const editing = s.editing === r.id + ":" + ci;
            const wk = di === 0;
            const focused = !!(s.focusCell && s.focusCell.rowId === r.id && s.focusCell.di === ci);
            const pal = status ? t.st[status] : null;
            const showFill = focused && !!status;
            const base: CSSProperties = {
              width: "46px", minWidth: "46px", height: rowH + "px", padding: 0, textAlign: "center", verticalAlign: "middle",
              fontFamily: FONT_MONO, fontSize: cellFont + "px", fontWeight: 600, cursor: "pointer",
              userSelect: "none", position: "relative", overflow: "hidden",
              color: pal ? pal.color : cd && cd.t ? t.fg : t.faintFg,
              background: pal ? pal.bg : flag ? blend(t.panel, t.flag[flag]) : t.panel,
              borderBottom: edgeBot || "1px solid " + t.border,
              borderLeft: wk ? "2px solid " + t.borderStrong : "1px solid " + t.border,
            };
            if (edgeTop) base.borderTop = edgeTop;
            if (selected) base.boxShadow = "inset 0 0 0 2px " + ac.main;
            if (focused) base.boxShadow = "inset 0 0 0 2px " + focusRing;
            const text = cd ? cd.t || (status ? defLabel[status] : "") : "";
            cellNodes.push(
              <td
                key={r.id + ":" + ci}
                className="la-cell"
                style={base}
                onMouseDown={(e) => cellDown(r.id, ci, e)}
                onMouseEnter={() => cellEnter(r.id, ci)}
                onDoubleClick={() => s.startEdit(r.id, ci)}
                onContextMenu={(e) => cellContext(r.id, ci, e)}
                title={status ? (status === "ongoing" ? "In progress" : status) : ""}
              >
                {editing ? (
                  <input
                    defaultValue={cd ? cd.t || "" : ""}
                    autoFocus
                    onBlur={(e) => s.commitEdit(r.id, ci, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        (e.target as HTMLInputElement).blur();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.nativeEvent.stopImmediatePropagation();
                        s.cancelEdit();
                      }
                    }}
                    style={{ width: "100%", height: "100%", border: "none", outline: "none", background: "transparent", textAlign: "center", fontFamily: FONT_MONO, fontSize: cellFont + "px", fontWeight: 600, color: pal ? pal.color : t.fg, padding: 0 }}
                  />
                ) : (
                  text
                )}
                {showFill && status && (
                  <span
                    onMouseDown={(e) => fillDown(r.id, ci, status, e)}
                    style={{ position: "absolute", right: "1px", bottom: "1px", width: "7px", height: "7px", background: focusRing, cursor: "crosshair", borderRadius: "1px" }}
                    title="Drag to fill"
                  />
                )}
              </td>
            );
          }
        }

        // sticky task / sub cells
        const stickyTd = (leftPx: number, wd: number): CSSProperties => {
          const stl: CSSProperties = {
            position: "sticky", left: leftPx + "px", zIndex: 20, background: t.panel, width: wd + "px", minWidth: wd + "px",
            maxWidth: wd + "px", height: rowH + "px", padding: "0 8px", borderBottom: edgeBot || "1px solid " + t.border,
            borderRight: leftPx > 0 ? "2px solid " + t.borderStrong : "1px solid " + t.border,
          };
          if (edgeTop) stl.borderTop = edgeTop;
          if (leftPx > 0 && sx) stl.boxShadow = SHX;
          return stl;
        };

        const cf = r.carry;
        const doneNow = hasDoneFront(r.cells);
        let carryBadge: { text: string; color: string; bg: string } | null = null;
        let leftAccent: string | null = null;
        if (cf) {
          if (cf.state === "completed") {
            carryBadge = { text: "✓ Done", color: s.theme === "dark" ? "#6ee7b7" : "#047857", bg: s.theme === "dark" ? "rgba(16,185,129,.16)" : "#ecfdf5" };
          } else if (!doneNow && cf.state === "slipped") {
            carryBadge = { text: "Slipped" + ((cf.slips || 0) > 1 ? " ×" + cf.slips : ""), color: s.theme === "dark" ? "#fda4af" : "#e11d48", bg: s.theme === "dark" ? "rgba(244,63,94,.16)" : "#fef2f2" };
            leftAccent = "#e11d48";
          } else if (!doneNow && cf.state === "continued") {
            carryBadge = { text: "Continued" + ((cf.slips || 0) > 1 ? " ×" + cf.slips : ""), color: s.theme === "dark" ? "#fcd34d" : "#b45309", bg: s.theme === "dark" ? "rgba(245,158,11,.16)" : "#fffbeb" };
            leftAccent = "#d97706";
          }
        }
        const taskTd = stickyTd(0, effTaskW);
        if (leftAccent) taskTd.boxShadow = "inset 3px 0 0 " + leftAccent;
        const carryTitle = cf
          ? cf.state === "completed"
            ? "Completed last week"
            : (cf.state === "slipped" ? "Planned but not completed" : "In progress, carried forward") +
              ((cf.slips || 0) > 1 ? " — " + cf.slips + " weeks" : "") +
              (cf.since ? " (since " + cf.since + ")" : "")
          : "";

        const notesTd: CSSProperties = {
          width: "200px", minWidth: "200px", height: rowH + "px", padding: "0 8px",
          borderBottom: edgeBot || "1px solid " + t.border, borderLeft: "1px solid " + t.border, background: t.panel,
        };
        if (edgeTop) notesTd.borderTop = edgeTop;

        bodyNodes.push(
          <tr
            key={"r-" + wkKey + "-" + r.id}
            style={{ opacity: s.draggingRowId === r.id ? 0.4 : 1 }}
            onDragOver={(e) => onRowDragOver(r.id, e)}
            onDrop={(e) => onRowDrop(r.id, e)}
            onDragEnd={() => s.clearDrag()}
          >
            <td style={taskTd}>
              <div style={taskFlexStyle}>
                <span draggable onDragStart={(e) => onDragStart(r.id, e)} style={{ cursor: "grab", color: t.faintFg, display: "inline-flex", lineHeight: 1, padding: "0 1px", userSelect: "none", flex: "none" }} title="Drag to reorder">
                  <GripVertical size={13} />
                </span>
                <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); s.openRowMenu(r.id, e.clientX, e.clientY); }} style={{ cursor: "pointer", color: t.faintFg, background: "transparent", border: "none", display: "inline-flex", lineHeight: 1, padding: "0 2px", flex: "none" }} title="Insert, duplicate or delete this task">
                  <MoreHorizontal size={15} />
                </button>
                <input
                  ref={r.id === s.focusTaskRowId ? focusTaskInputRef : undefined}
                  defaultValue={r.task}
                  placeholder="Task description"
                  onChange={(e) => s.setField(r.id, "task", e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      // Current text is already in the store (onChange); this commits
                      // it and drops a fresh blank task right below, cursor and all.
                      s.addRowAfter(r.id);
                    }
                  }}
                  onBlur={() => s.persistData()}
                  style={{ ...fieldInput(500, 12.5, t.fg), flex: 1, minWidth: 0, width: "auto" }}
                />
                {carryBadge && (
                  <span title={carryTitle} style={{ flex: "none", fontSize: "9px", fontWeight: 700, lineHeight: 1, padding: "2px 5px", borderRadius: "4px", whiteSpace: "nowrap", color: carryBadge.color, background: carryBadge.bg }}>
                    {carryBadge.text}
                  </span>
                )}
              </div>
            </td>
            <td style={stickyTd(effTaskW, subW)}>
              <input
                defaultValue={r.sub}
                placeholder="Sub"
                list="la-subs"
                onChange={(e) => s.setField(r.id, "sub", e.target.value)}
                onBlur={() => s.persistData()}
                style={{ ...fieldInput(600, 10.5, t.mutedFg), textTransform: "uppercase", letterSpacing: ".03em" }}
              />
            </td>
            {cellNodes}
            {showNotes && (
              <td style={notesTd}>
                <input
                  defaultValue={r.notes}
                  placeholder="…"
                  onChange={(e) => s.setField(r.id, "notes", e.target.value)}
                  onBlur={() => s.persistData()}
                  style={fieldInput(400, 11.5, t.mutedFg)}
                />
              </td>
            )}
          </tr>
        );
      });

      bodyNodes.push(
        <tr key={"add-" + wkKey + "-" + g.id} className="no-print">
          <td colSpan={totalCols} style={{ background: t.addBg, borderBottom: "1px solid " + t.border, padding: 0 }}>
            <button onClick={() => s.addRow(g.id)} style={{ position: "sticky", left: 0, border: "none", background: "transparent", color: t.faintFg, cursor: "pointer", fontSize: "11px", fontWeight: 500, padding: "5px 10px" }}>
              + Add task to {g.name}
            </button>
          </td>
        </tr>
      );
    }
  });

  bodyNodes.push(
    <tr key={"addgroup-" + wkKey} className="no-print">
      <td colSpan={totalCols} style={{ background: t.appBg, padding: 0, borderTop: "1px solid " + t.border }}>
        <button onClick={() => s.addGroup()} style={{ position: "sticky", left: 0, border: "1px dashed " + t.borderStrong, background: t.panel, color: t.mutedFg, cursor: "pointer", fontSize: "11.5px", fontWeight: 600, padding: "7px 14px", borderRadius: "7px", margin: "8px 10px" }}>
          + Add group
        </button>
      </td>
    </tr>
  );
  rowOrderRef.current = rowOrder;

  // ---------- styles for shell / table head ----------
  const shellStyle: CSSProperties = {
    minHeight: "100vh", background: t.appBg, color: t.fg,
    fontFamily: FONT_SANS, display: "flex", flexDirection: "column",
  };
  const shellVars = {
    "--la-hover": t.hover,
    "--la-cell-hover-outline": s.theme === "dark" ? "rgba(96,165,250,.5)" : "rgba(37,99,235,.45)",
  } as CSSProperties;

  const scrollStyle: CSSProperties = {
    flex: 1, overflow: "auto", margin: narrow ? "10px 10px 12px" : "14px 18px 18px",
    border: "1px solid " + t.border, borderRadius: "10px",
    background: t.panel, position: "relative", boxShadow: s.theme === "dark" ? "none" : "0 1px 2px rgba(0,0,0,.04)",
    // Phase 5: keep a finger-drag inside the grid — don't scroll-chain/bounce the
    // whole page — and ride native momentum on iOS. No interaction change: the
    // mouse/keyboard model is untouched.
    overscrollBehavior: "contain", WebkitOverflowScrolling: "touch",
  };
  const tableStyle: CSSProperties = { borderCollapse: "separate", borderSpacing: 0, width: "auto", tableLayout: "fixed" };
  const cornerTaskStyle: CSSProperties = {
    position: "sticky", left: 0, top: 0, zIndex: 40, background: t.headBg, color: t.mutedFg, width: effTaskW + "px",
    minWidth: effTaskW + "px", maxWidth: effTaskW + "px", fontSize: "10.5px", fontWeight: 600, textAlign: "left", padding: "0 8px",
    borderBottom: "1px solid " + t.borderStrong, borderRight: "1px solid " + t.border, lineHeight: 1.2, boxShadow: shf(false, true),
  };
  const cornerSubStyle: CSSProperties = {
    position: "sticky", left: effTaskW + "px", top: 0, zIndex: 40, background: t.headBg, color: t.mutedFg, width: subW + "px",
    minWidth: subW + "px", fontSize: "10.5px", fontWeight: 600, textAlign: "left", padding: "0 8px",
    borderBottom: "1px solid " + t.borderStrong, borderRight: "2px solid " + t.borderStrong, boxShadow: shf(true, true),
  };
  const notesHeadStyle: CSSProperties = {
    position: "sticky", top: 0, zIndex: 30, background: t.headBg, color: t.mutedFg, width: "200px", minWidth: "200px",
    fontSize: "10.5px", fontWeight: 600, textAlign: "left", padding: "0 8px", borderBottom: "1px solid " + t.borderStrong,
    borderLeft: "1px solid " + t.border, boxShadow: shf(false, true),
  };

  const onGridScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const nsx = e.currentTarget.scrollLeft > 0;
    const nsy = e.currentTarget.scrollTop > 0;
    if (nsx !== s.scrolledX || nsy !== s.scrolledY) s.setScrolled(nsx, nsy);
  };

  return (
    <div id="la-root" style={{ ...shellStyle, ...shellVars }}>
      <datalist id="la-subs">
        {subOptions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <Header />
      <Toolbar />

      {/* print-only header */}
      <div className="print-only" style={{ padding: "0 18px 10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "2px solid #18181b", paddingBottom: "8px" }}>
          <div>
            <div style={{ fontSize: "20px", fontWeight: 700, color: "#18181b" }}>{project.info.jobName || ""}</div>
            <div style={{ fontSize: "12px", color: "#52525b", marginTop: "2px" }}>Short Interval Plan — {area.name} — {windowSubtitle}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: "11.5px", color: "#3f3f46", lineHeight: 1.55 }}>
            <div>
              Job #: <b>{project.info.jobNumber || ""}</b> &nbsp;·&nbsp; Supt: <b>{project.info.superintendent || ""}</b> &nbsp;·&nbsp; Prepared by: <b>{project.info.preparedBy || ""}</b>
            </div>
            <div>{weekOfLabel}</div>
          </div>
        </div>
      </div>

      <div id="la-scroll" style={scrollStyle} onScroll={onGridScroll}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th rowSpan={2} style={cornerTaskStyle}>
                What work do you have planned for next week?
                <span style={{ position: "absolute", top: 0, right: 0, width: "7px", height: "100%", cursor: "col-resize", zIndex: 50 }} onMouseDown={onResizeStart} title="Drag to resize column" />
              </th>
              <th rowSpan={2} style={cornerSubStyle}>Sub</th>
              {weeksHdr.map((wk, i) => (
                <th key={i} colSpan={wk.span} style={wk.headStyle}>
                  {wk.label}
                  <span style={{ display: "block", fontSize: "9.5px", fontWeight: 500, color: t.faintFg, textTransform: "none", letterSpacing: 0, marginTop: "1px" }}>{wk.range}</span>
                </th>
              ))}
              {showNotes && <th rowSpan={2} style={notesHeadStyle}>Notes</th>}
            </tr>
            <tr>
              {days.map((day) => (
                <th key={day.idx} style={day.thStyle} onClick={(e) => s.toggleColumn(day.idx, e.shiftKey, visColsRef.current)} title={day.title}>
                  <div style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".02em" }}>{day.dow}</div>
                  <div style={{ fontSize: "9px", fontWeight: 500, fontFamily: FONT_MONO, opacity: 0.7, marginTop: "1px" }}>{day.date}</div>
                  {day.flag && <div style={day.flagTagStyle}>{day.flagTag}</div>}
                  {day.msName && <div style={day.msStyle}>◆ {day.msName}</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{bodyNodes}</tbody>
        </table>
      </div>

      <ActionBars />
      <Menus />
      <SettingsDrawer />
      <RollModal />
    </div>
  );
}

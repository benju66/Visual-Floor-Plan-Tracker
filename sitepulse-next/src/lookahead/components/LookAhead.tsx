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
import { rectSelection, type CellRef } from "@/lookahead/lib/selection";
import { classifyPointerGesture, pointerDropEdge } from "@/lookahead/lib/gesture";
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

// Phase 6a (UI convergence — touch parity): tap-vs-drag travel + long-press timing
// for `classifyPointerGesture`. The px threshold applies to FINGER / PEN only — a
// mouse uses Infinity (see `cellDown`) so desktop click-vs-drag stays governed by
// "did the cursor enter another cell", byte-identical to the pre-pointer
// (`mouseenter`) model. 8px ≈ Android touchSlop; 500ms ≈ the iOS/Android long-press
// default. Long-press is defined here but not wired until Phase 6b (cell/row menus).
const LA_MOVE_THRESHOLD_PX = 8;
const LA_LONGPRESS_MS = 500;

// Resolve the grid cell under a screen point for touch drag-fill / marquee. With a
// captured pointer (touch has implicit capture), `pointermove` is delivered to the
// ORIGIN cell and `pointerenter` never fires on the cells under the moving finger —
// so the drag loop must hit-test the finger position itself. Each grid `<td>`
// carries `data-rowid` / `data-di`; only day cells do, so a hit over the sticky
// task / sub / notes columns (or off-grid) returns null and starts no marquee.
function cellFromPoint(x: number, y: number): CellRef | null {
  const el = document.elementFromPoint(x, y);
  const td = el && (el as Element).closest("[data-rowid][data-di]");
  if (!td) return null;
  const rowId = td.getAttribute("data-rowid");
  const diStr = td.getAttribute("data-di");
  if (rowId == null || diStr == null) return null;
  const di = Number(diStr);
  return Number.isFinite(di) ? { rowId, di } : null;
}

// Phase 6b (touch parity — pointer row reorder): the drop target under the grip
// drag — a task row (with above/below edge) or a group header. Mirrors the old
// HTML5 onRowDrop / onGroupDrop split.
type ReorderHit =
  | { kind: "row"; rowId: string; pos: "above" | "below" }
  | { kind: "group"; groupId: string };

// Resolve the row / group under a screen point for the pointer-based row reorder.
// Mirrors `cellFromPoint`: hit-test the live DOM so a captured finger (which keeps
// delivering pointermove to the grip, not the row beneath it) still knows what it
// is hovering. Each task `<tr>` carries `data-row-reorder`, each group header `<tr>`
// `data-group-reorder`; a child anywhere in the row's task / sub / day / notes cells
// resolves up to the row via `closest`. The dragged row's own cells resolve back to
// itself (→ `moveRow` no-ops on src===target); the +Task / +Group strips carry
// neither attribute, so a hit there (or off-grid) returns null → no drop.
function rowFromPoint(x: number, y: number): ReorderHit | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const rowEl = (el as Element).closest("[data-row-reorder]");
  if (rowEl) {
    const rowId = rowEl.getAttribute("data-row-reorder");
    if (rowId) {
      const rect = rowEl.getBoundingClientRect();
      return { kind: "row", rowId, pos: pointerDropEdge(y, rect.top, rect.height) };
    }
  }
  const groupEl = (el as Element).closest("[data-group-reorder]");
  if (groupEl) {
    const groupId = groupEl.getAttribute("data-group-reorder");
    if (groupId) return { kind: "group", groupId };
  }
  return null;
}

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

  // Pointer-gesture refs (Phase 6a). `pointerId` lets the document-level handlers
  // ignore a second finger's events mid-gesture; `pointerType` + `moveThreshold`
  // + `downX/Y/At` feed the tap-vs-drag decision (mouse uses an Infinity threshold
  // → parity with the old mouseenter model; touch/pen use LA_MOVE_THRESHOLD_PX).
  const dragRef = useRef<{
    startRow: number; startDi: number; moved: boolean; wasFocused: boolean; detail: number;
    pointerId: number; pointerType: string; downX: number; downY: number; downAt: number; moveThreshold: number;
  } | null>(null);
  const fillRef = useRef<{ rowId: string; di: number; status: Status; pointerId: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startW: number; pointerId: number } | null>(null);
  // Phase 6b refs. `reorderRef` drives the pointer-based row reorder (replaces HTML5
  // `draggable`, which never fires on touch). `longPressRef` holds the touch/pen
  // long-press timer that opens the cell / row menu (a finger has no right-click).
  // `lastPointerTypeRef` records the last pointer that pressed a cell so the cell's
  // onContextMenu fires for a real mouse only — a touch long-press already opened
  // the menu, so the browser's synthetic contextmenu must not double-open it.
  const reorderRef = useRef<{ srcId: string; pointerId: number; downX: number; downY: number; moved: boolean } | null>(null);
  const longPressRef = useRef<{ pointerId: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const lastPointerTypeRef = useRef<string>("mouse");
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

  // ---- global pointer + keyboard model (attached once) ----
  // Pointer Events unify mouse + touch + pen, so desktop drives the SAME code path
  // (a mouse is `pointerType: "mouse"`) while a finger now works too. `onUp`/`onMove`
  // mirror the old `mouseup`/`mousemove` handlers; `onMove` also absorbs the marquee/
  // fill growth that used to live in per-cell `onMouseEnter` (which can't fire under
  // a captured touch pointer). `onKey` is unchanged. Each handler ignores events from
  // a different `pointerId` so a stray second finger can't hijack an active gesture.
  useEffect(() => {
    // Cancel a pending touch long-press timer (movement / release / cancel resolves
    // the gesture before the hold completes, so the menu must not still open).
    const clearLP = () => {
      if (longPressRef.current) {
        clearTimeout(longPressRef.current.timer);
        longPressRef.current = null;
      }
    };
    const onUp = (e: PointerEvent) => {
      // The release resolves any armed long-press (it was a tap / quick drag, not a
      // hold), so the timer must not fire after the finger is up.
      if (longPressRef.current && longPressRef.current.pointerId === e.pointerId) clearLP();
      const st = useStore.getState();
      // Pointer-based row reorder (Phase 6b): commit the move to whatever row / group
      // is under the finger AT RELEASE (re-hit-tested, so a release over empty space
      // drops nothing) — mirroring the old HTML5 onRowDrop / onGroupDrop.
      if (reorderRef.current) {
        if (e.pointerId !== reorderRef.current.pointerId) return;
        const rr = reorderRef.current;
        reorderRef.current = null;
        st.clearDrag();
        if (rr.moved) {
          const hit = rowFromPoint(e.clientX, e.clientY);
          if (hit) {
            if (hit.kind === "group") st.groupDrop(hit.groupId, rr.srcId);
            else st.moveRow(rr.srcId, hit.rowId, hit.pos === "below" ? 1 : 0);
          }
        }
        return;
      }
      if (fillRef.current) {
        if (e.pointerId !== fillRef.current.pointerId) return;
        st.applyCellStatus(fillRef.current.status);
        fillRef.current = null;
        dragRef.current = null;
        return;
      }
      if (resizeRef.current) {
        if (e.pointerId !== resizeRef.current.pointerId) return;
        resizeRef.current = null;
        st.persistTaskColW();
        return;
      }
      const d = dragRef.current;
      if (d) {
        if (e.pointerId !== d.pointerId) return;
        if (!d.moved && d.wasFocused && d.detail === 1) {
          const rid = rowOrderRef.current[d.startRow];
          if (rid != null) st.cycleCell(rid, d.startDi);
        }
        dragRef.current = null;
      }
    };
    const onMove = (e: PointerEvent) => {
      // Pointer-based row reorder (Phase 6b): once the grip press travels past the
      // slop it becomes a drag (cancelling the long-press), then we highlight the
      // drop edge of the row / group under the finger via the existing dropTarget
      // store state — so the edge/group feedback the grid already renders is reused.
      if (reorderRef.current) {
        const rr = reorderRef.current;
        if (e.pointerId !== rr.pointerId) return;
        if (!rr.moved) {
          if (Math.hypot(e.clientX - rr.downX, e.clientY - rr.downY) <= LA_MOVE_THRESHOLD_PX) return;
          rr.moved = true;
          clearLP();
          useStore.getState().setDragging(rr.srcId);
        }
        const st = useStore.getState();
        const hit = rowFromPoint(e.clientX, e.clientY);
        if (!hit) return;
        if (hit.kind === "row") {
          const cur = st.dropTarget;
          if (!cur || cur.rowId !== hit.rowId || cur.pos !== hit.pos) st.setDropTarget({ rowId: hit.rowId, pos: hit.pos });
        } else {
          const cur = st.dropTarget;
          if (!cur || cur.groupId !== hit.groupId) st.setDropTarget({ groupId: hit.groupId });
        }
        return;
      }
      // Column resize (mouse or finger): same clamp + live-width update as before.
      if (resizeRef.current) {
        if (e.pointerId !== resizeRef.current.pointerId) return;
        const st = useStore.getState();
        const w = Math.max(140, Math.min(440, resizeRef.current.startW + (e.clientX - resizeRef.current.startX)));
        if (w !== st.taskColW) st.setTaskColW(w);
        return;
      }
      // Fill-drag: paint the inclusive rectangle from the fill origin to whatever
      // cell the pointer is over (hit-tested, so it works under a captured finger).
      if (fillRef.current) {
        if (e.pointerId !== fillRef.current.pointerId) return;
        const cell = cellFromPoint(e.clientX, e.clientY);
        if (!cell) return;
        const f = fillRef.current;
        const sel = rectSelection(rowOrderRef.current, visColsRef.current, { rowId: f.rowId, di: f.di }, cell);
        if (sel) useStore.getState().setSelCells(sel);
        return;
      }
      // Marquee-drag: grow the rectangle from the press origin to the pointer.
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const originRowId = rowOrderRef.current[d.startRow];
      if (originRowId == null) return;
      const cell = cellFromPoint(e.clientX, e.clientY);
      if (!d.moved) {
        // Escalate press → drag. Mouse: byte-identical to the old `mouseenter` model
        // — a drag begins the instant the cursor is over a DIFFERENT cell (the px
        // threshold is Infinity, so the distance test never fires). Touch / pen:
        // begin once the finger travels past LA_MOVE_THRESHOLD_PX, so small jitter
        // near a cell boundary still reads as a tap (→ cycle), not a 1-cell drag.
        const enteredOther = !!cell && !(cell.rowId === originRowId && cell.di === d.startDi);
        const starts =
          d.pointerType === "mouse"
            ? enteredOther
            : classifyPointerGesture({
                downAt: d.downAt, upAt: e.timeStamp,
                dx: e.clientX - d.downX, dy: e.clientY - d.downY,
                longPressMs: LA_LONGPRESS_MS, moveThresholdPx: d.moveThreshold,
              }) === "drag";
        if (!starts) return;
        d.moved = true;
        clearLP(); // a finger drag won the gesture → cancel the pending long-press menu
      }
      if (!cell) return;
      const sel = rectSelection(rowOrderRef.current, visColsRef.current, { rowId: originRowId, di: d.startDi }, cell);
      if (sel) useStore.getState().setSelCells(sel);
    };
    // A canceled pointer (e.g. the browser claims a touch for scroll, or the OS
    // interrupts) aborts the in-flight gesture without committing fill / resize.
    const onCancel = (e: PointerEvent) => {
      if (longPressRef.current && e.pointerId === longPressRef.current.pointerId) clearLP();
      if (reorderRef.current && e.pointerId === reorderRef.current.pointerId) {
        reorderRef.current = null;
        useStore.getState().clearDrag();
      }
      if (fillRef.current && e.pointerId === fillRef.current.pointerId) fillRef.current = null;
      if (resizeRef.current && e.pointerId === resizeRef.current.pointerId) resizeRef.current = null;
      if (dragRef.current && e.pointerId === dragRef.current.pointerId) dragRef.current = null;
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
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("keydown", onKey);
    return () => {
      clearLP();
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointercancel", onCancel);
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
  // Capture finger / pen pointers so the marquee / fill keeps tracking once it
  // leaves the origin element (touch has implicit capture; this makes pen explicit
  // and robust, and guarantees pointerup is delivered here to resolve the gesture).
  // The MOUSE is deliberately NOT captured: global pointermove already tracks it,
  // and not capturing keeps desktop focus / double-click-to-edit / text-selection
  // behaviour byte-identical to the pre-pointer model.
  const capturePointer = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* noop — capture is best-effort */
    }
  };
  // Phase 6b: arm a touch/pen long-press (the finger's stand-in for right-click). The
  // timer fires only if the pointer stays within slop for LA_LONGPRESS_MS — movement
  // past slop (a drag) and release (a tap) both clear it in the global handlers. Any
  // previously-armed timer is dropped first so a fresh press always wins.
  const armLongPress = (pointerId: number, fire: () => void) => {
    if (longPressRef.current) clearTimeout(longPressRef.current.timer);
    longPressRef.current = {
      pointerId,
      timer: setTimeout(() => {
        longPressRef.current = null;
        fire();
      }, LA_LONGPRESS_MS),
    };
  };
  // Swallow the single compatibility "ghost click" some touch browsers synthesize
  // when the finger lifts after a long-press, so it can't land on a menu item or
  // immediately re-close the just-opened menu. Installed the instant the menu opens
  // (finger still down) and one-shot in the capture phase, so the only click it can
  // intercept is that release's ghost — never a later, deliberate menu tap. A short
  // safety timer drops the listener on browsers that emit no ghost click at all.
  const swallowGhostClick = () => {
    const onClick = (ev: MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      document.removeEventListener("click", onClick, true);
    };
    document.addEventListener("click", onClick, true);
    window.setTimeout(() => document.removeEventListener("click", onClick, true), 600);
  };
  const cellDown = (rowId: string, di: number, e: React.PointerEvent) => {
    lastPointerTypeRef.current = e.pointerType;
    if (e.button !== 0) return;
    const st = useStore.getState();
    if (st.editing) {
      // Tapping another cell while editing commits the text (via the input's blur)
      // and exits edit mode. Don't preventDefault (so blur fires); don't start a drag/cycle.
      if (st.editing !== rowId + ":" + di) st.setFocusCell({ rowId, di });
      return;
    }
    e.preventDefault();
    // Shift-click extends a rectangular selection from the anchor (the last
    // focused/clicked cell) to the clicked cell — no cell-status cycle. (Desktop
    // only: there is no Shift modifier on touch, so this branch is mouse/keyboard.)
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
    dragRef.current = {
      startRow: rowOrderRef.current.indexOf(rowId), startDi: di, moved: false, wasFocused, detail: e.detail || 1,
      pointerId: e.pointerId, pointerType: e.pointerType, downX: e.clientX, downY: e.clientY, downAt: e.timeStamp,
      moveThreshold: e.pointerType === "mouse" ? Infinity : LA_MOVE_THRESHOLD_PX,
    };
    capturePointer(e);
    st.setFocusCell({ rowId, di });
    st.setSelAnchor({ rowId, di });
    // Touch / pen: a still hold opens the cell menu (the finger's right-click). The
    // long-press wins over the pending tap/drag — firing nulls dragRef so the
    // finger-up doesn't also cycle the cell; movement past slop cancels it (onMove).
    if (e.pointerType !== "mouse") {
      const lx = e.clientX;
      const ly = e.clientY;
      armLongPress(e.pointerId, () => {
        dragRef.current = null;
        useStore.getState().openCellMenu(rowId, di, lx, ly);
        swallowGhostClick();
      });
    }
  };
  const fillDown = (rowId: string, di: number, status: Status, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = null;
    fillRef.current = { rowId, di, status, pointerId: e.pointerId };
    capturePointer(e);
    const st = useStore.getState();
    st.setSelCells({ [rowId + ":" + di]: true });
    st.setFocusCell({ rowId, di });
  };
  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startW: useStore.getState().taskColW, pointerId: e.pointerId };
    capturePointer(e);
  };
  const cellContext = (rowId: string, di: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Desktop right-click only. On touch/pen the cell menu opens via the long-press
    // timer, so the browser's synthetic contextmenu (which fires after a long-press
    // on some platforms) is suppressed here rather than double-opening the menu.
    if (lastPointerTypeRef.current !== "mouse") return;
    dragRef.current = null;
    useStore.getState().openCellMenu(rowId, di, e.clientX, e.clientY);
  };
  // Phase 6b: pointer-based row reorder, started from the grip handle. Replaces the
  // HTML5 `draggable` path (which never fires on touch) with one pointer pipeline for
  // mouse + finger: arm a potential reorder; the global pointermove escalates it to a
  // real drag past the slop (setDragging + dropTarget highlight) and pointerup commits
  // it (moveRow / groupDrop). On touch/pen a still hold instead opens the row menu.
  const gripDown = (rowId: string, e: React.PointerEvent) => {
    lastPointerTypeRef.current = e.pointerType;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = null;
    reorderRef.current = { srcId: rowId, pointerId: e.pointerId, downX: e.clientX, downY: e.clientY, moved: false };
    // Capture for ALL pointer types here (unlike cells, which skip mouse): the grip
    // is a dedicated drag handle with no click / double-click / text-select role, so
    // capturing the mouse mirrors the old native HTML5 drag and avoids stray text
    // selection mid-reorder. The global pointermove/up still fire (events bubble).
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* noop — capture is best-effort */
    }
    if (e.pointerType !== "mouse") {
      const lx = e.clientX;
      const ly = e.clientY;
      armLongPress(e.pointerId, () => {
        reorderRef.current = null; // long-press wins over the pending reorder drag
        useStore.getState().openRowMenu(rowId, lx, ly);
        swallowGhostClick();
      });
    }
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
      <tr key={"g-" + wkKey + "-" + g.id} data-group-reorder={g.id}>
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
              // Phase 6a: a finger drag that STARTS on a day cell does fill / marquee,
              // never a page/grid scroll. (The sticky task / sub columns + day header
              // keep their default touch-action, so finger-scroll still works there.)
              touchAction: "none",
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
                data-rowid={r.id}
                data-di={ci}
                style={base}
                onPointerDown={(e) => cellDown(r.id, ci, e)}
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
                    className="la-fill"
                    onPointerDown={(e) => fillDown(r.id, ci, status, e)}
                    style={{ position: "absolute", right: "1px", bottom: "1px", width: "7px", height: "7px", background: focusRing, cursor: "crosshair", borderRadius: "1px", touchAction: "none" }}
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
        // A seed / untouched row (blank task + sub + no cells) is styled as a faded
        // placeholder so it can't read as real look-ahead data (Data Storytelling P2).
        const isSeedRow = !r.task?.trim() && !r.sub?.trim() && Object.keys(r.cells || {}).length === 0;
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
            data-row-reorder={r.id}
            style={{ opacity: s.draggingRowId === r.id ? 0.4 : isSeedRow ? 0.6 : 1 }}
          >
            <td style={taskTd}>
              <div style={taskFlexStyle}>
                <span
                  onPointerDown={(e) => gripDown(r.id, e)}
                  style={{ cursor: "grab", color: t.faintFg, display: "inline-flex", lineHeight: 1, padding: "0 1px", userSelect: "none", flex: "none", touchAction: "none" }}
                  title="Drag to reorder"
                >
                  <GripVertical size={13} />
                </span>
                <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); s.openRowMenu(r.id, e.clientX, e.clientY); }} style={{ cursor: "pointer", color: t.faintFg, background: "transparent", border: "none", display: "inline-flex", lineHeight: 1, padding: "0 2px", flex: "none" }} title="Insert, duplicate or delete this task">
                  <MoreHorizontal size={15} />
                </button>
                <input
                  ref={r.id === s.focusTaskRowId ? focusTaskInputRef : undefined}
                  defaultValue={r.task}
                  placeholder={isSeedRow ? "Describe the task…" : "Task description"}
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
                  style={{ ...fieldInput(500, 12.5, isSeedRow ? t.faintFg : t.fg), flex: 1, minWidth: 0, width: "auto", fontStyle: isSeedRow ? "italic" : undefined }}
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
                style={{ ...fieldInput(600, 10.5, isSeedRow ? t.faintFg : t.mutedFg), textTransform: "uppercase", letterSpacing: ".03em", fontStyle: isSeedRow ? "italic" : undefined }}
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
                <span className="la-resize" style={{ position: "absolute", top: 0, right: 0, width: "7px", height: "100%", cursor: "col-resize", zIndex: 50, touchAction: "none" }} onPointerDown={onResizeStart} title="Drag to resize column" />
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

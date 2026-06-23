"use client";

import type { CSSProperties } from "react";
import { useStore } from "@/lookahead/store/useStore";
import { getTokens } from "@/lookahead/lib/tokens";

function barBtn(bg: string, color: string, bd?: string): CSSProperties {
  return {
    border: "1px solid " + (bd || "transparent"), background: bg, color, cursor: "pointer",
    fontSize: "12px", fontWeight: 600, padding: "6px 12px", borderRadius: "7px", whiteSpace: "nowrap",
  };
}

export default function ActionBars() {
  const theme = useStore((s) => s.theme);
  const selCells = useStore((s) => s.selCells);
  const selCols = useStore((s) => s.selCols);
  const applyCellStatus = useStore((s) => s.applyCellStatus);
  const applyColFlag = useStore((s) => s.applyColFlag);
  const setSelCells = useStore((s) => s.setSelCells);

  const t = getTokens(theme);
  const cellCount = Object.keys(selCells).length;
  const colCount = Object.keys(selCols).length;
  const showCellBar = cellCount > 0;
  const showColBar = colCount > 0 && cellCount === 0;
  if (!showCellBar && !showColBar) return null;

  const barStyle: CSSProperties = {
    position: "fixed", left: "50%", bottom: "22px", transform: "translateX(-50%)", zIndex: 60,
    display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", background: t.barBg,
    borderRadius: "12px", boxShadow: "0 10px 30px rgba(0,0,0,.28)", border: "1px solid rgba(255,255,255,.08)",
  };
  const barCountStyle: CSSProperties = { fontSize: "12px", fontWeight: 600, color: "#fff", padding: "0 6px", whiteSpace: "nowrap" };
  const barSepStyle: CSSProperties = { width: "1px", height: "20px", background: "rgba(255,255,255,.18)" };

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    fn();
  };

  if (showCellBar) {
    return (
      <div className="no-print" style={barStyle}>
        <span style={barCountStyle}>
          {cellCount + (cellCount === 1 ? " cell" : " cells") + " selected"}
        </span>
        <div style={barSepStyle} />
        <button onMouseDown={stop(() => applyCellStatus("start"))} style={barBtn(t.st.start.bg, t.st.start.color)}>Start</button>
        <button onMouseDown={stop(() => applyCellStatus("ongoing"))} style={barBtn(t.st.ongoing.bg, t.st.ongoing.color)}>In progress</button>
        <button onMouseDown={stop(() => applyCellStatus("done"))} style={barBtn(t.st.done.bg, t.st.done.color)}>Done</button>
        <button onMouseDown={stop(() => applyCellStatus(null))} style={barBtn("transparent", "rgba(255,255,255,.7)", "rgba(255,255,255,.2)")}>Clear</button>
        <div style={barSepStyle} />
        <button onMouseDown={stop(() => setSelCells({}))} style={barBtn("#fff", "#18181b")}>Done selecting</button>
      </div>
    );
  }

  return (
    <div className="no-print" style={barStyle}>
      <span style={barCountStyle}>
        {colCount + (colCount === 1 ? " column" : " columns") + " selected"}
      </span>
      <div style={barSepStyle} />
      <button onMouseDown={stop(() => applyColFlag("weekend"))} style={barBtn("rgba(255,255,255,.10)", "#fff")}>Weekend</button>
      <button onMouseDown={stop(() => applyColFlag("holiday"))} style={barBtn("rgba(244,63,94,.22)", "#fda4af")}>Holiday</button>
      <button onMouseDown={stop(() => applyColFlag("closed"))} style={barBtn("rgba(255,255,255,.16)", "#fff")}>Site closed</button>
      <button onMouseDown={stop(() => applyColFlag(null))} style={barBtn("transparent", "rgba(255,255,255,.7)", "rgba(255,255,255,.2)")}>Clear flag</button>
      <div style={barSepStyle} />
      <button onMouseDown={stop(() => setSelCells({}))} style={barBtn("#fff", "#18181b")}>Done</button>
    </div>
  );
}

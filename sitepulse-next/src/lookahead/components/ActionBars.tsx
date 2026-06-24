"use client";

import type { CSSProperties } from "react";
import { useStore } from "@/lookahead/store/useStore";
import { getTokens } from "@/lookahead/lib/tokens";

// Phase 3 (UI convergence): the floating selection bar is reskinned to Tailwind
// for layout/spacing/typography. The bar is a fixed dark surface (t.barBg) with
// white-on-dark controls, so the per-button palette (status fills, accent text,
// the rgba dividers/borders) and the fixed centering stay inline; the structural
// classes move to className. `fontSize`/odd radii stay inline to avoid the
// line-height + rounding drift that Tailwind's steps would introduce.
const BAR_CLASS = "no-print fixed flex items-center gap-2 rounded-xl border px-2.5 py-2";
const BAR_BTN = "cursor-pointer whitespace-nowrap border px-3 py-1.5 font-semibold";
const BAR_COUNT = "whitespace-nowrap px-1.5 font-semibold text-white";

function barBtn(bg: string, color: string, bd?: string): CSSProperties {
  // 7px radius has no clean Tailwind step → stays inline.
  return { borderColor: bd || "transparent", background: bg, color, fontSize: "12px", borderRadius: "7px" };
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

  // Fixed centering + the dark surface / shadow / hairline border stay inline.
  const barStyle: CSSProperties = {
    left: "50%", bottom: "22px", transform: "translateX(-50%)", zIndex: 60,
    background: t.barBg, boxShadow: "0 10px 30px rgba(0,0,0,.28)", borderColor: "rgba(255,255,255,.08)",
  };
  const barCountStyle: CSSProperties = { fontSize: "12px" };
  const sepStyle: CSSProperties = { background: "rgba(255,255,255,.18)" };

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    fn();
  };

  if (showCellBar) {
    return (
      <div className={BAR_CLASS} style={barStyle}>
        <span className={BAR_COUNT} style={barCountStyle}>
          {cellCount + (cellCount === 1 ? " cell" : " cells") + " selected"}
        </span>
        <div className="h-5 w-px" style={sepStyle} />
        <button onMouseDown={stop(() => applyCellStatus("start"))} className={BAR_BTN} style={barBtn(t.st.start.bg, t.st.start.color)}>Start</button>
        <button onMouseDown={stop(() => applyCellStatus("ongoing"))} className={BAR_BTN} style={barBtn(t.st.ongoing.bg, t.st.ongoing.color)}>In progress</button>
        <button onMouseDown={stop(() => applyCellStatus("done"))} className={BAR_BTN} style={barBtn(t.st.done.bg, t.st.done.color)}>Done</button>
        <button onMouseDown={stop(() => applyCellStatus(null))} className={BAR_BTN} style={barBtn("transparent", "rgba(255,255,255,.7)", "rgba(255,255,255,.2)")}>Clear</button>
        <div className="h-5 w-px" style={sepStyle} />
        <button onMouseDown={stop(() => setSelCells({}))} className={BAR_BTN} style={barBtn("#fff", "#18181b")}>Done selecting</button>
      </div>
    );
  }

  return (
    <div className={BAR_CLASS} style={barStyle}>
      <span className={BAR_COUNT} style={barCountStyle}>
        {colCount + (colCount === 1 ? " column" : " columns") + " selected"}
      </span>
      <div className="h-5 w-px" style={sepStyle} />
      <button onMouseDown={stop(() => applyColFlag("weekend"))} className={BAR_BTN} style={barBtn("rgba(255,255,255,.10)", "#fff")}>Weekend</button>
      <button onMouseDown={stop(() => applyColFlag("holiday"))} className={BAR_BTN} style={barBtn("rgba(244,63,94,.22)", "#fda4af")}>Holiday</button>
      <button onMouseDown={stop(() => applyColFlag("closed"))} className={BAR_BTN} style={barBtn("rgba(255,255,255,.16)", "#fff")}>Site closed</button>
      <button onMouseDown={stop(() => applyColFlag(null))} className={BAR_BTN} style={barBtn("transparent", "rgba(255,255,255,.7)", "rgba(255,255,255,.2)")}>Clear flag</button>
      <div className="h-5 w-px" style={sepStyle} />
      <button onMouseDown={stop(() => setSelCells({}))} className={BAR_BTN} style={barBtn("#fff", "#18181b")}>Done</button>
    </div>
  );
}

"use client";

import type { CSSProperties } from "react";
import { ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { useStore } from "@/lookahead/store/useStore";
import { getAccent, getTokens, swatch } from "@/lookahead/lib/tokens";
import { ACCENT } from "@/lookahead/lib/config";
import { todayKey } from "@/lookahead/lib/date";
import { windowMeta, weekOptionsList } from "@/lookahead/lib/view";

export default function Toolbar() {
  const theme = useStore((s) => s.theme);
  const area = useStore((s) => s.areas[s.currentAreaId]);
  const confirmDeleteWeek = useStore((s) => s.confirmDeleteWeek);

  const gotoWeek = useStore((s) => s.gotoWeek);
  const openRollForward = useStore((s) => s.openRollForward);
  const duplicateWeek = useStore((s) => s.duplicateWeek);
  const goToWeekKey = useStore((s) => s.goToWeekKey);
  const askDeleteWeek = useStore((s) => s.askDeleteWeek);
  const deleteWeek = useStore((s) => s.deleteWeek);
  const cancelDeleteWeek = useStore((s) => s.cancelDeleteWeek);

  const currentWeek = area.currentWeek;
  const t = getTokens(theme);
  const ac = getAccent(ACCENT, theme);
  const { weekOfLabel, lastOffset } = windowMeta(currentWeek, area.view);
  const weekOptions = weekOptionsList(area.weeks, lastOffset);
  const savedCount = Object.keys(area.weeks).length;
  const thisKey = todayKey();
  const onThisWeekDisabled = currentWeek === thisKey;
  const showRoll = area.view.carryForward !== false;
  const canDeleteWeek = savedCount > 1 && !confirmDeleteWeek;
  const showConfirmDelete = confirmDeleteWeek && savedCount > 1;

  const toolbarStyle: CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px",
    padding: "8px 18px", borderBottom: "1px solid " + t.border, background: t.appBg, flexWrap: "wrap",
  };
  const navWrapStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", rowGap: "6px" };
  const navArrowStyle: CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: "30px", height: "30px", border: "1px solid " + t.border, background: t.panel, color: t.fg,
    cursor: "pointer", borderRadius: "8px",
  };
  const weekBoxStyle: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "center", padding: "0 8px", minWidth: "210px" };
  const weekKickerStyle: CSSProperties = { fontSize: "8.5px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: t.faintFg };
  const weekLabelStyle: CSSProperties = { fontSize: "13px", fontWeight: 600, color: t.fg, whiteSpace: "nowrap" };
  const rollBtnStyle: CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: "5px",
    border: "1px solid " + ac.main, background: "transparent", color: ac.main, cursor: "pointer",
    fontSize: "12px", fontWeight: 600, padding: "6px 11px", borderRadius: "8px", whiteSpace: "nowrap", marginLeft: "4px",
  };
  const dupBtnStyle: CSSProperties = {
    border: "1px solid " + t.border, background: t.panel, color: t.mutedFg, cursor: "pointer",
    fontSize: "12px", fontWeight: 500, padding: "6px 11px", borderRadius: "8px", marginLeft: "4px",
  };
  const jumpSelectStyle: CSSProperties = {
    height: "30px", border: "1px solid " + t.border, background: t.panel, color: t.fg, cursor: "pointer",
    fontSize: "12px", fontWeight: 500, padding: "0 8px", borderRadius: "8px", fontFamily: "inherit", maxWidth: "190px",
  };
  const thisWeekBtnStyle: CSSProperties = {
    height: "30px", border: "1px solid " + (onThisWeekDisabled ? t.border : ac.main),
    background: onThisWeekDisabled ? t.panel : "transparent", color: onThisWeekDisabled ? t.faintFg : ac.main,
    cursor: "pointer", fontSize: "12px", fontWeight: 600, padding: "0 11px", borderRadius: "8px", whiteSpace: "nowrap",
  };
  const savedPillStyle: CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "11.5px", fontWeight: 500, color: t.mutedFg,
    padding: "4px 10px", borderRadius: "999px", background: t.headBg, border: "1px solid " + t.border, marginLeft: "2px",
  };
  const savedDotStyle: CSSProperties = { width: "7px", height: "7px", borderRadius: "50%", background: "#10b981" };
  const delWeekBtnStyle: CSSProperties = {
    height: "30px", border: "1px solid " + t.border, background: t.panel, color: t.faintFg, cursor: "pointer",
    fontSize: "12px", fontWeight: 500, padding: "0 10px", borderRadius: "8px", whiteSpace: "nowrap",
  };
  const delWeekTextStyle: CSSProperties = { fontSize: "12px", fontWeight: 600, color: "#e11d48", whiteSpace: "nowrap" };
  const delWeekYesStyle: CSSProperties = { height: "30px", border: "none", background: "#e11d48", color: "#fff", cursor: "pointer", fontSize: "12px", fontWeight: 600, padding: "0 11px", borderRadius: "8px" };
  const delWeekNoStyle: CSSProperties = { height: "30px", border: "1px solid " + t.border, background: t.panel, color: t.mutedFg, cursor: "pointer", fontSize: "12px", fontWeight: 500, padding: "0 11px", borderRadius: "8px" };

  const legendGroupStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" };
  const hintStyle: CSSProperties = { fontSize: "11px", color: t.faintFg };

  const savedLabel = savedCount + (savedCount === 1 ? " week saved" : " weeks saved");

  return (
    <div className="no-print" style={toolbarStyle}>
      <div style={navWrapStyle}>
        <button onClick={() => gotoWeek(-1)} style={navArrowStyle} title="Previous week">
          <ChevronLeft size={18} />
        </button>
        <div style={weekBoxStyle}>
          <span style={weekKickerStyle}>Look-ahead window</span>
          <span style={weekLabelStyle}>{weekOfLabel}</span>
        </div>
        <button onClick={() => gotoWeek(1)} style={navArrowStyle} title="Next week">
          <ChevronRight size={18} />
        </button>
        {showRoll && (
          <button onClick={() => openRollForward()} style={rollBtnStyle} title="Advance one week, carrying unfinished work forward">
            <RotateCw size={13} /> Roll forward
          </button>
        )}
        <button onClick={() => duplicateWeek()} style={dupBtnStyle}>
          Duplicate week →
        </button>
        <select value={currentWeek} onChange={(e) => goToWeekKey(e.target.value)} style={jumpSelectStyle} title="Jump to a saved week">
          {weekOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button onClick={() => goToWeekKey(thisKey)} style={thisWeekBtnStyle} title="Go to the week containing today">
          This week
        </button>
        <div style={savedPillStyle}>
          <span style={savedDotStyle} />
          {savedLabel}
        </div>
        {canDeleteWeek && (
          <button onClick={() => askDeleteWeek()} style={delWeekBtnStyle} title="Delete this saved week">
            Delete week
          </button>
        )}
        {showConfirmDelete && (
          <>
            <span style={delWeekTextStyle}>Delete this week?</span>
            <button onClick={() => deleteWeek()} style={delWeekYesStyle}>
              Delete
            </button>
            <button onClick={() => cancelDeleteWeek()} style={delWeekNoStyle}>
              Cancel
            </button>
          </>
        )}
      </div>
      <div style={legendGroupStyle}>
        <span style={swatch(t.st.start)}>Start</span>
        <span style={swatch(t.st.ongoing)}>X · In&nbsp;progress</span>
        <span style={swatch(t.st.done)}>Done</span>
        <span style={hintStyle}>click selects · click again to cycle · dbl-click types · ←↑↓→ move · s/x/d to mark · ⌘Z undo</span>
      </div>
    </div>
  );
}

"use client";

import type { CSSProperties } from "react";
import { useStore } from "@/lookahead/store/useStore";
import { getAccent, getTokens } from "@/lookahead/lib/tokens";
import { ACCENT } from "@/lookahead/lib/config";
import { addDays, mon, parseDate } from "@/lookahead/lib/date";

export default function RollModal() {
  const theme = useStore((s) => s.theme);
  const rollPreview = useStore((s) => s.rollPreview);
  const currentWeek = useStore((s) => s.areas[s.currentAreaId].currentWeek);
  const cancelRoll = useStore((s) => s.cancelRoll);
  const confirmRollForward = useStore((s) => s.confirmRollForward);

  if (!rollPreview) return null;

  const t = getTokens(theme);
  const ac = getAccent(ACCENT, theme);
  const start = parseDate(currentWeek);
  const next = addDays(start, 7);
  const rollNextLabel = mon(next) + " " + next.getDate();
  const slipNames =
    rollPreview.slipNames.length > 0
      ? rollPreview.slipNames.slice(0, 4).join(", ") +
        (rollPreview.slipNames.length > 4 ? " +" + (rollPreview.slipNames.length - 4) + " more" : "")
      : "";

  const backdrop: CSSProperties = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 95,
    display: "flex", alignItems: "center", justifyContent: "center", padding: "20px",
  };
  const modal: CSSProperties = {
    width: "420px", maxWidth: "100%", background: t.panel, borderRadius: "14px", border: "1px solid " + t.border,
    boxShadow: "0 24px 60px rgba(0,0,0,.35)", overflow: "hidden",
  };
  const headStyle: CSSProperties = { padding: "16px 18px 4px", fontSize: "15px", fontWeight: 700, color: t.fg };
  const subStyle: CSSProperties = { padding: "0 18px 14px", fontSize: "12.5px", color: t.mutedFg };
  const bodyStyle: CSSProperties = { padding: "4px 18px" };
  const doneRow: CSSProperties = { display: "flex", alignItems: "center", gap: "10px", padding: "9px 11px", borderRadius: "9px", background: theme === "dark" ? "rgba(16,185,129,.12)" : "#ecfdf5", marginBottom: "7px" };
  const contRow: CSSProperties = { display: "flex", alignItems: "center", gap: "10px", padding: "9px 11px", borderRadius: "9px", background: theme === "dark" ? "rgba(245,158,11,.12)" : "#fffbeb", marginBottom: "7px" };
  const slipRow: CSSProperties = { display: "flex", flexDirection: "column", gap: "2px", padding: "9px 11px", borderRadius: "9px", background: theme === "dark" ? "rgba(244,63,94,.12)" : "#fef2f2", marginBottom: "7px" };
  const doneNum: CSSProperties = { fontSize: "15px", fontWeight: 700, color: theme === "dark" ? "#6ee7b7" : "#047857", minWidth: "22px" };
  const contNum: CSSProperties = { fontSize: "15px", fontWeight: 700, color: theme === "dark" ? "#fcd34d" : "#b45309", minWidth: "22px" };
  const slipNum: CSSProperties = { fontSize: "15px", fontWeight: 700, color: theme === "dark" ? "#fda4af" : "#e11d48" };
  const statLabel: CSSProperties = { fontSize: "12.5px", fontWeight: 500, color: t.fg };
  const slipNamesStyle: CSSProperties = { fontSize: "11px", color: t.mutedFg, marginTop: "1px" };
  const warnStyle: CSSProperties = { fontSize: "11.5px", color: theme === "dark" ? "#fda4af" : "#b91c1c", padding: "2px 2px 8px" };
  const footStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: "8px", padding: "14px 18px 16px" };
  const cancelStyle: CSSProperties = { border: "1px solid " + t.border, background: t.panel, color: t.fg, cursor: "pointer", fontSize: "12.5px", fontWeight: 500, padding: "8px 14px", borderRadius: "8px" };
  const confirmStyle: CSSProperties = { border: "none", background: ac.main, color: ac.fg, cursor: "pointer", fontSize: "12.5px", fontWeight: 600, padding: "8px 16px", borderRadius: "8px" };
  const taskFlex: CSSProperties = { display: "flex", alignItems: "center", gap: "5px" };

  return (
    <div className="no-print" style={backdrop} onMouseDown={() => cancelRoll()}>
      <div style={modal} onMouseDown={(e) => e.stopPropagation()}>
        <div style={headStyle}>Roll forward to {rollNextLabel}</div>
        <div style={subStyle}>
          The window slides forward one week — plans you already made for later weeks move into view. Here&apos;s how the
          week that passed reconciles:
        </div>
        <div style={bodyStyle}>
          <div style={doneRow}>
            <span style={doneNum}>{rollPreview.completed}</span>
            <span style={statLabel}>completed — moved to “Completed last week”</span>
          </div>
          <div style={contRow}>
            <span style={contNum}>{rollPreview.continued}</span>
            <span style={statLabel}>in progress — carried &amp; continued</span>
          </div>
          <div style={slipRow}>
            <div style={taskFlex}>
              <span style={slipNum}>{rollPreview.slipped}</span>
              <span style={statLabel}>&nbsp;slipped — carried &amp; flagged</span>
            </div>
            {rollPreview.slipped > 0 && <div style={slipNamesStyle}>{slipNames}</div>}
          </div>
          {rollPreview.exists && <div style={warnStyle}>⚠ A week already exists here — it will be replaced.</div>}
        </div>
        <div style={footStyle}>
          <button onClick={() => cancelRoll()} style={cancelStyle}>Cancel</button>
          <button onClick={() => confirmRollForward()} style={confirmStyle}>Roll forward →</button>
        </div>
      </div>
    </div>
  );
}

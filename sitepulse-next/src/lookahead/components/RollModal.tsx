"use client";

import type { CSSProperties } from "react";
import { useStore } from "@/lookahead/store/useStore";
import { getAccent, getTokens } from "@/lookahead/lib/tokens";
import { ACCENT } from "@/lookahead/lib/config";
import { addDays, mon, parseDate } from "@/lookahead/lib/date";

// Phase 4 (UI convergence): the roll-forward preview modal moves to Tailwind for
// structure/spacing/typography — the shell mirrors the Phase-3 AreaSwitcher dialog
// (centered overlay + max-w-full bordered card). Theme tokens (panel/border/fg/
// accent), every fontSize, the overlay rgba, odd values with no clean step (420px
// width, 14/9px radii, odd pads, 22px minWidth), and the data-driven status tints
// (done/continued/slipped row backgrounds + count colors) stay inline.
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

  const backdrop: CSSProperties = { background: "rgba(0,0,0,.4)", zIndex: 95 };
  const modal: CSSProperties = {
    width: "420px", background: t.panel, borderRadius: "14px", borderColor: t.border,
    boxShadow: "0 24px 60px rgba(0,0,0,.35)",
  };
  const headStyle: CSSProperties = { padding: "16px 18px 4px", fontSize: "15px", color: t.fg };
  const subStyle: CSSProperties = { padding: "0 18px 14px", fontSize: "12.5px", color: t.mutedFg };
  const bodyStyle: CSSProperties = { padding: "4px 18px" };
  const doneRow: CSSProperties = { padding: "9px 11px", borderRadius: "9px", background: theme === "dark" ? "rgba(16,185,129,.12)" : "#ecfdf5", marginBottom: "7px" };
  const contRow: CSSProperties = { padding: "9px 11px", borderRadius: "9px", background: theme === "dark" ? "rgba(245,158,11,.12)" : "#fffbeb", marginBottom: "7px" };
  const slipRow: CSSProperties = { padding: "9px 11px", borderRadius: "9px", background: theme === "dark" ? "rgba(244,63,94,.12)" : "#fef2f2", marginBottom: "7px" };
  const doneNum: CSSProperties = { fontSize: "15px", color: theme === "dark" ? "#6ee7b7" : "#047857", minWidth: "22px" };
  const contNum: CSSProperties = { fontSize: "15px", color: theme === "dark" ? "#fcd34d" : "#b45309", minWidth: "22px" };
  const slipNum: CSSProperties = { fontSize: "15px", color: theme === "dark" ? "#fda4af" : "#e11d48" };
  const statLabel: CSSProperties = { fontSize: "12.5px", color: t.fg };
  const slipNamesStyle: CSSProperties = { fontSize: "11px", color: t.mutedFg };
  const warnStyle: CSSProperties = { fontSize: "11.5px", color: theme === "dark" ? "#fda4af" : "#b91c1c", padding: "2px 2px 8px" };
  const footStyle: CSSProperties = { padding: "14px 18px 16px" };
  const cancelStyle: CSSProperties = { borderColor: t.border, background: t.panel, color: t.fg, fontSize: "12.5px" };
  const confirmStyle: CSSProperties = { background: ac.main, color: ac.fg, fontSize: "12.5px" };
  const taskFlex: CSSProperties = { gap: "5px" };

  return (
    <div className="no-print fixed inset-0 flex items-center justify-center p-5" style={backdrop} onMouseDown={() => cancelRoll()}>
      <div className="max-w-full overflow-hidden border" style={modal} onMouseDown={(e) => e.stopPropagation()}>
        <div className="font-bold" style={headStyle}>Roll forward to {rollNextLabel}</div>
        <div style={subStyle}>
          The window slides forward one week — plans you already made for later weeks move into view. Here&apos;s how the
          week that passed reconciles:
        </div>
        <div style={bodyStyle}>
          <div className="flex items-center gap-2.5" style={doneRow}>
            <span className="font-bold" style={doneNum}>{rollPreview.completed}</span>
            <span className="font-medium" style={statLabel}>completed — moved to “Completed last week”</span>
          </div>
          <div className="flex items-center gap-2.5" style={contRow}>
            <span className="font-bold" style={contNum}>{rollPreview.continued}</span>
            <span className="font-medium" style={statLabel}>in progress — carried &amp; continued</span>
          </div>
          <div className="flex flex-col gap-0.5" style={slipRow}>
            <div className="flex items-center" style={taskFlex}>
              <span className="font-bold" style={slipNum}>{rollPreview.slipped}</span>
              <span className="font-medium" style={statLabel}>&nbsp;slipped — carried &amp; flagged</span>
            </div>
            {rollPreview.slipped > 0 && <div className="mt-px" style={slipNamesStyle}>{slipNames}</div>}
          </div>
          {rollPreview.exists && <div style={warnStyle}>⚠ A week already exists here — it will be replaced.</div>}
        </div>
        <div className="flex justify-end gap-2" style={footStyle}>
          <button onClick={() => cancelRoll()} className="cursor-pointer rounded-lg border px-3.5 py-2 font-medium" style={cancelStyle}>Cancel</button>
          <button onClick={() => confirmRollForward()} className="cursor-pointer rounded-lg border-0 px-4 py-2 font-semibold" style={confirmStyle}>Roll forward →</button>
        </div>
      </div>
    </div>
  );
}

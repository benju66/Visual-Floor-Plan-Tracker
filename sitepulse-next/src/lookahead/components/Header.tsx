"use client";

import type { CSSProperties } from "react";
import { Undo2, Redo2, Settings as SettingsIcon, Printer, ArrowLeft } from "lucide-react";
import { useStore } from "@/lookahead/store/useStore";
import { useSession } from "@/lookahead/store/useSession";
import { getAccent, getTokens } from "@/lookahead/lib/tokens";
import { ACCENT } from "@/lookahead/lib/config";
import { windowMeta } from "@/lookahead/lib/view";
import AreaSwitcher from "./AreaSwitcher";

// Phase 2 (UI convergence): this is NO LONGER a second app masthead — SitePulse's
// real TopHeader already brands the app + names the view. This collapses to a thin
// frosted-glass context strip (window subtitle + project meta + AreaSwitcher on the
// left; saving indicator + undo/redo + Settings + Print on the right) that reads as
// a sub-toolbar UNDER the TopHeader. The brand dot + duplicate "Short Interval Plan"
// title were intentionally removed. The outer container chrome is Tailwind (.glass-
// panel); the inner controls stay inline-styled until the Phase 3 Tailwind reskin.
export default function Header() {
  const theme = useStore((s) => s.theme);
  const info = useStore((s) => s.project.info);
  const area = useStore((s) => s.areas[s.currentAreaId]);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const openSettings = useStore((s) => s.openSettings);

  const cloud = useSession((s) => s.cloud);
  const inProject = useSession((s) => !!s.currentProjectId);
  const saving = useSession((s) => s.saving);
  const backToDashboard = useSession((s) => s.backToDashboard);
  const embedded = useSession((s) => s.embedded);
  // DELIBERATE SitePulse edit (Phase 0b): the saving indicator shows whenever a
  // cloud project is open, but the "← Projects" back button is suppressed while
  // embedded — SitePulse's TopHeader owns navigation, so this strip's own back
  // nav would be a dead end.
  const showCloudNav = cloud && inProject;
  const showBack = showCloudNav && !embedded;

  const t = getTokens(theme);
  const ac = getAccent(ACCENT, theme);
  const { windowSubtitle } = windowMeta(area.currentWeek, area.view);

  const subStyle: CSSProperties = { fontSize: "11.5px", color: t.mutedFg, lineHeight: 1.2 };
  const metaDividerStyle: CSSProperties = { width: "1px", height: "28px", background: t.border, margin: "0 4px" };
  const metaStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "7px", fontSize: "12.5px", color: t.mutedFg, flexWrap: "wrap" };
  const metaStrongStyle: CSSProperties = { color: t.fg, fontWeight: 600 };
  const metaDotStyle: CSSProperties = { color: t.faintFg };
  const ghostBtnStyle: CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: "6px",
    border: "1px solid " + t.border, background: t.panel, color: t.fg, cursor: "pointer",
    fontSize: "12.5px", fontWeight: 500, padding: "7px 12px", borderRadius: "8px",
  };
  const primaryBtnStyle: CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: "6px",
    border: "none", background: ac.main, color: ac.fg, cursor: "pointer",
    fontSize: "12.5px", fontWeight: 600, padding: "8px 14px", borderRadius: "8px",
  };
  const undoBtnStyle: CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: "32px", height: "34px", border: "1px solid " + t.border, background: t.panel,
    color: canUndo ? t.fg : t.faintFg, cursor: canUndo ? "pointer" : "default", borderRadius: "8px",
    opacity: canUndo ? 1 : 0.5,
  };
  const redoBtnStyle: CSSProperties = { ...undoBtnStyle, color: canRedo ? t.fg : t.faintFg, cursor: canRedo ? "pointer" : "default", opacity: canRedo ? 1 : 0.5 };

  const backBtnStyle: CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: "5px", border: "1px solid " + t.border, background: t.panel,
    color: t.mutedFg, cursor: "pointer", fontSize: "12px", fontWeight: 500, padding: "6px 10px", borderRadius: "8px", flex: "none",
  };
  const savingStyle: CSSProperties = {
    fontSize: "11.5px", fontWeight: 500, color: saving === "error" ? "#e11d48" : t.faintFg, whiteSpace: "nowrap",
  };
  const savingLabel = saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : saving === "error" ? "Save failed" : "";

  return (
    <div className="no-print glass-panel rounded-xl mx-[18px] mt-[14px] flex flex-wrap items-center justify-between gap-4 px-4 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        {showBack && (
          <button onClick={() => backToDashboard()} style={backBtnStyle} title="Back to projects">
            <ArrowLeft size={14} /> Projects
          </button>
        )}
        <div style={subStyle}>{windowSubtitle}</div>
        <div style={metaDividerStyle} />
        <div style={metaStyle}>
          <span style={metaStrongStyle}>{info.jobName || "—"}</span>
          <span style={metaDotStyle}>·</span>
          <span>{info.jobNumber}</span>
          <span style={metaDotStyle}>·</span>
          <span>Supt. {info.superintendent || "—"}</span>
        </div>
        <div style={metaDividerStyle} />
        <AreaSwitcher />
      </div>
      <div className="flex flex-none items-center gap-2">
        {showCloudNav && savingLabel && <span style={savingStyle}>{savingLabel}</span>}
        <button onClick={() => undo()} style={undoBtnStyle} title="Undo (⌘Z)">
          <Undo2 size={16} />
        </button>
        <button onClick={() => redo()} style={redoBtnStyle} title="Redo (⌘⇧Z)">
          <Redo2 size={16} />
        </button>
        <button onClick={() => openSettings()} style={ghostBtnStyle} title="Settings & display options">
          <SettingsIcon size={15} /> Settings
        </button>
        <button onClick={() => window.print()} style={primaryBtnStyle}>
          <Printer size={15} /> Print / Export PDF
        </button>
      </div>
    </div>
  );
}

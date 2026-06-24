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

  // Phase 3 (UI convergence): the strip's inner controls move to Tailwind for
  // layout/spacing/typography; theme tokens (border/panel/fg/accent), dynamic
  // enabled/error colors, and the odd 11.5/12.5px fonts + 5px/7px gaps + 34px
  // icon-button height (no clean Tailwind step) stay inline. The Phase-2 outer
  // container chrome (glass-panel / no-print / inset) is left exactly as is.
  const ICON_BTN = "inline-flex w-8 items-center justify-center rounded-lg border";
  const navBtnStyle = (enabled: boolean): CSSProperties => ({
    height: "34px", borderColor: t.border, background: t.panel,
    color: enabled ? t.fg : t.faintFg, cursor: enabled ? "pointer" : "default", opacity: enabled ? 1 : 0.5,
  });

  const subStyle: CSSProperties = { fontSize: "11.5px", color: t.mutedFg, lineHeight: 1.2 };
  const metaDividerStyle: CSSProperties = { background: t.border };
  const metaStyle: CSSProperties = { gap: "7px", fontSize: "12.5px", color: t.mutedFg };
  const ghostBtnStyle: CSSProperties = { borderColor: t.border, background: t.panel, color: t.fg, fontSize: "12.5px", padding: "7px 12px" };
  const primaryBtnStyle: CSSProperties = { background: ac.main, color: ac.fg, fontSize: "12.5px" };
  const backBtnStyle: CSSProperties = { gap: "5px", borderColor: t.border, background: t.panel, color: t.mutedFg, fontSize: "12px" };
  const savingStyle: CSSProperties = { fontSize: "11.5px", color: saving === "error" ? "#e11d48" : t.faintFg };
  const savingLabel = saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : saving === "error" ? "Save failed" : "";

  return (
    <div className="no-print glass-panel rounded-xl mx-[18px] mt-[14px] flex flex-wrap items-center justify-between gap-4 px-4 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        {showBack && (
          <button onClick={() => backToDashboard()} className="inline-flex flex-none cursor-pointer items-center rounded-lg border px-2.5 py-1.5 font-medium" style={backBtnStyle} title="Back to projects">
            <ArrowLeft size={14} /> Projects
          </button>
        )}
        <div style={subStyle}>{windowSubtitle}</div>
        <div className="mx-1 h-7 w-px" style={metaDividerStyle} />
        <div className="flex flex-wrap items-center" style={metaStyle}>
          <span className="font-semibold" style={{ color: t.fg }}>{info.jobName || "—"}</span>
          <span style={{ color: t.faintFg }}>·</span>
          <span>{info.jobNumber}</span>
          <span style={{ color: t.faintFg }}>·</span>
          <span>Supt. {info.superintendent || "—"}</span>
        </div>
        <div className="mx-1 h-7 w-px" style={metaDividerStyle} />
        <AreaSwitcher />
      </div>
      <div className="flex flex-none items-center gap-2">
        {showCloudNav && savingLabel && <span className="whitespace-nowrap font-medium" style={savingStyle}>{savingLabel}</span>}
        <button onClick={() => undo()} className={ICON_BTN} style={navBtnStyle(canUndo)} title="Undo (⌘Z)">
          <Undo2 size={16} />
        </button>
        <button onClick={() => redo()} className={ICON_BTN} style={navBtnStyle(canRedo)} title="Redo (⌘⇧Z)">
          <Redo2 size={16} />
        </button>
        <button onClick={() => openSettings()} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border font-medium" style={ghostBtnStyle} title="Settings & display options">
          <SettingsIcon size={15} /> Settings
        </button>
        <button onClick={() => window.print()} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border-0 px-3.5 py-2 font-semibold" style={primaryBtnStyle}>
          <Printer size={15} /> Print / Export PDF
        </button>
      </div>
    </div>
  );
}

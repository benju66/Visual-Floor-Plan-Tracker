"use client";

import type { CSSProperties } from "react";
import { ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { useStore } from "@/lookahead/store/useStore";
import { getAccent, getTokens, swatch } from "@/lookahead/lib/tokens";
import { ACCENT } from "@/lookahead/lib/config";
import { todayKey } from "@/lookahead/lib/date";
import { windowMeta, weekOptionsList } from "@/lookahead/lib/view";

// Phase 3 (UI convergence): the week toolbar's inner controls move to Tailwind for
// layout/spacing/typography. Theme tokens (border/panel/fg/headBg/accent), the
// dynamic "this week" enabled state, fixed status/flag colors, and odd values with
// no clean Tailwind step (30px control height, 8.5/11/11.5/12/13px fonts, 5px gap,
// 11px pads, 190/210px widths) stay inline. The Phase-2 glass container is left
// exactly as is; `swatch` keeps the palette fill, the SWATCH_CLASS its structure.
const SWATCH_CLASS = "inline-flex items-center rounded-full font-semibold";

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

  const navArrowStyle: CSSProperties = { width: "30px", height: "30px", borderColor: t.border, background: t.panel, color: t.fg };
  const weekBoxStyle: CSSProperties = { minWidth: "210px" };
  const weekKickerStyle: CSSProperties = { fontSize: "8.5px", letterSpacing: ".1em", color: t.faintFg };
  const weekLabelStyle: CSSProperties = { fontSize: "13px", color: t.fg };
  const rollBtnStyle: CSSProperties = { gap: "5px", borderColor: ac.main, color: ac.main, fontSize: "12px", padding: "6px 11px" };
  const dupBtnStyle: CSSProperties = { borderColor: t.border, background: t.panel, color: t.mutedFg, fontSize: "12px", padding: "6px 11px" };
  const jumpSelectStyle: CSSProperties = { height: "30px", borderColor: t.border, background: t.panel, color: t.fg, fontSize: "12px", fontFamily: "inherit", maxWidth: "190px" };
  const thisWeekBtnStyle: CSSProperties = {
    height: "30px", borderColor: onThisWeekDisabled ? t.border : ac.main,
    background: onThisWeekDisabled ? t.panel : "transparent", color: onThisWeekDisabled ? t.faintFg : ac.main,
    fontSize: "12px", padding: "0 11px",
  };
  const savedPillStyle: CSSProperties = { fontSize: "11.5px", color: t.mutedFg, background: t.headBg, borderColor: t.border };
  const delWeekBtnStyle: CSSProperties = { height: "30px", borderColor: t.border, background: t.panel, color: t.faintFg, fontSize: "12px" };
  const delWeekTextStyle: CSSProperties = { fontSize: "12px", color: "#e11d48" };
  const delWeekYesStyle: CSSProperties = { height: "30px", background: "#e11d48", fontSize: "12px", padding: "0 11px" };
  const delWeekNoStyle: CSSProperties = { height: "30px", borderColor: t.border, background: t.panel, color: t.mutedFg, fontSize: "12px", padding: "0 11px" };
  const hintStyle: CSSProperties = { fontSize: "11px", color: t.faintFg };

  const savedLabel = savedCount + (savedCount === 1 ? " week saved" : " weeks saved");

  return (
    // Phase 2 (UI convergence): frosted-glass, rounded sub-toolbar that floats
    // under the TopHeader + the context strip (matching their inset). Inner
    // controls were reskinned to Tailwind in Phase 3 (structure → classes,
    // tokens/odd values → inline).
    // Phase 5 (responsive): inset + gaps tighten below `lg` for iPad portrait;
    // `lg:` restores desktop spacing. Nav arrows + action buttons grow to a 40px
    // finger target below `xl` (both iPad orientations), resetting at desktop.
    <div className="no-print glass-panel rounded-xl mx-2.5 lg:mx-[18px] mt-2 flex flex-wrap items-center justify-between gap-2 lg:gap-4 px-3 lg:px-4 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <button onClick={() => gotoWeek(-1)} className="inline-flex cursor-pointer items-center justify-center rounded-lg border min-h-[40px] min-w-[40px] xl:min-h-0 xl:min-w-0" style={navArrowStyle} title="Previous week">
          <ChevronLeft size={18} />
        </button>
        <div className="flex flex-col items-center px-2" style={weekBoxStyle}>
          <span className="font-bold uppercase" style={weekKickerStyle}>Look-ahead window</span>
          <span className="whitespace-nowrap font-semibold" style={weekLabelStyle}>{weekOfLabel}</span>
        </div>
        <button onClick={() => gotoWeek(1)} className="inline-flex cursor-pointer items-center justify-center rounded-lg border min-h-[40px] min-w-[40px] xl:min-h-0 xl:min-w-0" style={navArrowStyle} title="Next week">
          <ChevronRight size={18} />
        </button>
        {showRoll && (
          <button onClick={() => openRollForward()} className="ml-1 inline-flex cursor-pointer items-center whitespace-nowrap rounded-lg border bg-transparent font-semibold min-h-[40px] xl:min-h-0" style={rollBtnStyle} title="Advance one week, carrying unfinished work forward">
            <RotateCw size={13} /> Roll forward
          </button>
        )}
        <button onClick={() => duplicateWeek()} className="ml-1 cursor-pointer rounded-lg border font-medium min-h-[40px] xl:min-h-0" style={dupBtnStyle}>
          Duplicate week →
        </button>
        <select value={currentWeek} onChange={(e) => goToWeekKey(e.target.value)} className="cursor-pointer rounded-lg border px-2 font-medium min-h-[40px] xl:min-h-0" style={jumpSelectStyle} title="Jump to a saved week">
          {weekOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button onClick={() => goToWeekKey(thisKey)} className="cursor-pointer whitespace-nowrap rounded-lg border font-semibold min-h-[40px] xl:min-h-0" style={thisWeekBtnStyle} title="Go to the week containing today">
          This week
        </button>
        <div className="ml-0.5 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium" style={savedPillStyle}>
          <span className="rounded-full" style={{ width: "7px", height: "7px", background: "#10b981" }} />
          {savedLabel}
        </div>
        {canDeleteWeek && (
          <button onClick={() => askDeleteWeek()} className="cursor-pointer whitespace-nowrap rounded-lg border px-2.5 font-medium min-h-[40px] xl:min-h-0" style={delWeekBtnStyle} title="Delete this saved week">
            Delete week
          </button>
        )}
        {showConfirmDelete && (
          <>
            <span className="whitespace-nowrap font-semibold" style={delWeekTextStyle}>Delete this week?</span>
            <button onClick={() => deleteWeek()} className="cursor-pointer rounded-lg border-0 font-semibold text-white min-h-[40px] xl:min-h-0" style={delWeekYesStyle}>
              Delete
            </button>
            <button onClick={() => cancelDeleteWeek()} className="cursor-pointer rounded-lg border font-medium min-h-[40px] xl:min-h-0" style={delWeekNoStyle}>
              Cancel
            </button>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={SWATCH_CLASS} style={swatch(t.st.start)}>Start</span>
        <span className={SWATCH_CLASS} style={swatch(t.st.ongoing)}>X · In&nbsp;progress</span>
        <span className={SWATCH_CLASS} style={swatch(t.st.done)}>Done</span>
        {/* Phase 5: keyboard/mouse guidance — hidden below `lg` (it's desktop hint
            text and would force awkward wraps on a narrow iPad portrait legend row). */}
        <span className="hidden lg:inline" style={hintStyle}>click selects · click again to cycle · dbl-click types · ←↑↓→ move · s/x/d to mark · ⌘Z undo</span>
      </div>
    </div>
  );
}

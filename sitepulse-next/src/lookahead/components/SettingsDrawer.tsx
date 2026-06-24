"use client";

import { useRef, type CSSProperties } from "react";
import { useStore } from "@/lookahead/store/useStore";
import { getAccent, getTokens, seg, switchKnob, switchTrack } from "@/lookahead/lib/tokens";
import { ACCENT } from "@/lookahead/lib/config";

// Phase 4 (UI convergence): the project-settings drawer moves to Tailwind for
// structure/spacing/typography. Theme tokens (border/panel/fg/appBg/headBg/accent),
// every fontSize, the modal-overlay rgba, and odd values with no clean Tailwind
// step (34/32/30/28px controls, 7/9/14px radii, 7px/9px/odd pads, 440px width,
// the grid track widths, letterSpacing, lineHeight) stay inline.
const SECTION_HEAD_CLASS = "mb-3 flex w-full cursor-pointer items-center border-0 bg-transparent p-0 text-left";
const SECTION_CARET_CLASS = "w-2.5 flex-none";
const SECTION_LABEL_CLASS = "font-bold uppercase";
const LABEL_CLASS = "mb-1 block font-semibold";
const TOGGLE_ROW_CLASS = "flex items-center justify-between border-b";
const TWO_COL_CLASS = "grid grid-cols-2 gap-2.5";
const INP_CLASS = "box-border w-full border outline-none";
const SEG_CLASS = "cursor-pointer rounded-md border-0 font-semibold";
const SWITCH_TRACK_CLASS = "relative flex-none cursor-pointer rounded-full border-0 p-0";
const SWITCH_KNOB_CLASS = "absolute top-0.5 h-5 w-5 rounded-full";
const ADD_BTN_CLASS = "mt-1 w-full cursor-pointer rounded-lg border border-dashed p-2 font-semibold";
const BACKUP_BTN_CLASS = "flex-1 cursor-pointer rounded-lg border font-semibold";
const REMOVE_BTN_CLASS = "cursor-pointer border";

export default function SettingsDrawer() {
  const open = useStore((s) => s.settingsOpen);
  const theme = useStore((s) => s.theme);
  const density = useStore((s) => s.density);
  const info = useStore((s) => s.project.info);
  const project = useStore((s) => s.project);
  const area = useStore((s) => s.areas[s.currentAreaId]);
  const sections = useStore((s) => s.openSections);

  const closeSettings = useStore((s) => s.closeSettings);
  const setDensity = useStore((s) => s.setDensity);
  const setNumWeeks = useStore((s) => s.setNumWeeks);
  const toggleDay = useStore((s) => s.toggleDay);
  const toggleSection = useStore((s) => s.toggleSection);
  const scalarChange = useStore((s) => s.scalarChange);
  const persistSettings = useStore((s) => s.persistSettings);
  const addSub = useStore((s) => s.addSub);
  const removeSub = useStore((s) => s.removeSub);
  const subChange = useStore((s) => s.subChange);
  const addHoliday = useStore((s) => s.addHoliday);
  const removeHoliday = useStore((s) => s.removeHoliday);
  const holidayChange = useStore((s) => s.holidayChange);
  const addMilestone = useStore((s) => s.addMilestone);
  const removeMilestone = useStore((s) => s.removeMilestone);
  const milestoneChange = useStore((s) => s.milestoneChange);
  const importDoc = useStore((s) => s.importDoc);

  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const t = getTokens(theme);
  const ac = getAccent(ACCENT, theme);
  const dense = density === "compact";
  const view = area.view;

  const inp: CSSProperties = {
    height: "34px", borderColor: t.border, background: t.panel, color: t.fg,
    borderRadius: "7px", padding: "0 9px", fontSize: "12.5px", fontFamily: "inherit",
  };
  const labelStyle: CSSProperties = { fontSize: "11px", color: t.mutedFg };
  const sectionStyle: CSSProperties = { marginBottom: "26px" };
  const sectionHeadStyle: CSSProperties = { gap: "7px" };
  const sectionCaretStyle: CSSProperties = { color: t.faintFg, fontSize: "10px" };
  const sectionLabelStyle: CSSProperties = { fontSize: "11px", letterSpacing: ".06em", color: t.mutedFg };
  const toggleRowStyle: CSSProperties = { padding: "9px 0", borderColor: t.border };
  const toggleLabelStyle: CSSProperties = { fontSize: "12.5px", color: t.fg };
  const toggleSubLabelStyle: CSSProperties = { fontSize: "11px", color: t.faintFg };
  const segWrapStyle: CSSProperties = { background: t.headBg, borderColor: t.border };
  const weeksSelectStyle: CSSProperties = { height: "32px", borderColor: t.border, background: t.panel, color: t.fg, fontSize: "12.5px", padding: "0 10px", borderRadius: "7px", fontFamily: "inherit" };
  const holHeadStyle: CSSProperties = { fontSize: "11.5px", color: t.faintFg, marginBottom: "10px", lineHeight: 1.4 };
  const subHeadStyle: CSSProperties = { gridTemplateColumns: "64px 1fr 28px", fontSize: "10px", letterSpacing: ".04em", color: t.faintFg, padding: "0 2px 6px" };
  const subRowStyle: CSSProperties = { gridTemplateColumns: "64px 1fr 28px", marginBottom: "7px" };
  const subCodeInputStyle: CSSProperties = { ...inp, height: "32px", padding: "0 4px" };
  const subSubStyle: CSSProperties = { gap: "5px" };
  const subFieldStyle: CSSProperties = { ...inp, height: "32px" };
  const removeBtnStyle: CSSProperties = { width: "28px", height: "32px", borderColor: t.border, background: t.panel, color: t.faintFg, borderRadius: "7px", fontSize: "12px" };
  const holRowStyle: CSSProperties = { gridTemplateColumns: "150px 1fr 28px", marginBottom: "7px" };
  const addBtnFullStyle: CSSProperties = { borderColor: t.borderStrong, background: t.panel, color: t.mutedFg, fontSize: "12px" };
  const backupBtnStyle: CSSProperties = { borderColor: t.border, background: t.panel, color: t.fg, fontSize: "12px", padding: "9px" };

  const persist = () => persistSettings();
  const caret = (k: keyof typeof sections) => (sections[k] ? "▾" : "▸");

  const doExport = () => {
    const s = useStore.getState();
    const doc = {
      _schema: 3, _exportedAt: new Date().toISOString(),
      project: s.project, areas: s.areas, areaOrder: s.areaOrder, currentAreaId: s.currentAreaId,
      theme: s.theme, density: s.density,
    };
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const base = (s.project.info.jobNumber || s.project.info.jobName || "lookahead").replace(/[^\w.-]+/g, "_");
    a.href = url;
    a.download = `lookahead-${base}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!importDoc(data)) window.alert("Import failed: that file is not a valid Look-Ahead backup.");
      } catch {
        window.alert("Import failed: could not read that file as JSON.");
      }
    };
    reader.readAsText(f);
  };

  return (
    <>
      <div
        className="no-print fixed inset-0"
        style={{ background: "rgba(0,0,0,.35)", zIndex: 89 }}
        onMouseDown={() => closeSettings()}
      />
      <div
        className="no-print fixed inset-y-0 right-0 flex flex-col border-l"
        style={{
          width: "440px", maxWidth: "92vw", background: t.appBg, borderColor: t.border,
          boxShadow: "-12px 0 40px rgba(0,0,0,.22)", zIndex: 90,
        }}
      >
        <div className="flex items-center justify-between border-b" style={{ padding: "15px 18px", borderColor: t.border, background: t.panel }}>
          <div>
            <div className="font-bold" style={{ fontSize: "15px", color: t.fg }}>Project settings</div>
            <div className="mt-px" style={{ fontSize: "11px", color: t.faintFg }}>Saved automatically to this device</div>
          </div>
          <button onClick={() => closeSettings()} className="cursor-pointer rounded-lg border" style={{ width: "30px", height: "30px", borderColor: t.border, background: t.panel, color: t.fg, fontSize: "13px" }}>
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto" style={{ padding: "18px" }}>
          {/* Display (device + this area) */}
          <div style={sectionStyle}>
            <button onClick={() => toggleSection("display")} className={SECTION_HEAD_CLASS} style={sectionHeadStyle}>
              <span className={SECTION_CARET_CLASS} style={sectionCaretStyle}>{caret("display")}</span>
              <span className={SECTION_LABEL_CLASS} style={sectionLabelStyle}>Display</span>
            </button>
            {sections.display && (
              <>
                <div className={TOGGLE_ROW_CLASS} style={toggleRowStyle}>
                  <div><div className="font-medium" style={toggleLabelStyle}>Row density</div></div>
                  <div className="flex rounded-lg border p-0.5" style={segWrapStyle}>
                    <button onClick={() => setDensity("comfortable")} className={SEG_CLASS} style={seg(!dense, t)}>Comfortable</button>
                    <button onClick={() => setDensity("compact")} className={SEG_CLASS} style={seg(dense, t)}>Compact</button>
                  </div>
                </div>
                <div style={{ ...holHeadStyle, marginTop: "12px", marginBottom: "4px" }}>
                  These apply to the current look-ahead (<b style={{ color: t.mutedFg }}>{area.name}</b>):
                </div>
                <div className={TOGGLE_ROW_CLASS} style={toggleRowStyle}>
                  <div>
                    <div className="font-medium" style={toggleLabelStyle}>Weeks shown</div>
                    <div className="mt-px" style={toggleSubLabelStyle}>Length of the look-ahead window</div>
                  </div>
                  <select value={view.numWeeks || 3} onChange={(e) => setNumWeeks(+e.target.value)} className="cursor-pointer border font-semibold" style={weeksSelectStyle}>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <div className={TOGGLE_ROW_CLASS} style={toggleRowStyle}>
                  <div>
                    <div className="font-medium" style={toggleLabelStyle}>Show Saturday</div>
                    <div className="mt-px" style={toggleSubLabelStyle}>Shaded as a weekend</div>
                  </div>
                  <button onClick={() => toggleDay("showSat")} className={SWITCH_TRACK_CLASS} style={switchTrack(view.showSat !== false, ac, t)}>
                    <span className={SWITCH_KNOB_CLASS} style={switchKnob(view.showSat !== false)} />
                  </button>
                </div>
                <div className={TOGGLE_ROW_CLASS} style={toggleRowStyle}>
                  <div>
                    <div className="font-medium" style={toggleLabelStyle}>Show Sunday</div>
                    <div className="mt-px" style={toggleSubLabelStyle}>Shaded as a weekend</div>
                  </div>
                  <button onClick={() => toggleDay("showSun")} className={SWITCH_TRACK_CLASS} style={switchTrack(view.showSun === true, ac, t)}>
                    <span className={SWITCH_KNOB_CLASS} style={switchKnob(view.showSun === true)} />
                  </button>
                </div>
                <div className={TOGGLE_ROW_CLASS} style={toggleRowStyle}>
                  <div>
                    <div className="font-medium" style={toggleLabelStyle}>Carry-forward intelligence</div>
                    <div className="mt-px" style={toggleSubLabelStyle}>&quot;Roll forward&quot; advances work, flags slipped tasks</div>
                  </div>
                  <button onClick={() => toggleDay("carryForward")} className={SWITCH_TRACK_CLASS} style={switchTrack(view.carryForward !== false, ac, t)}>
                    <span className={SWITCH_KNOB_CLASS} style={switchKnob(view.carryForward !== false)} />
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Project information */}
          <div style={sectionStyle}>
            <button onClick={() => toggleSection("project")} className={SECTION_HEAD_CLASS} style={sectionHeadStyle}>
              <span className={SECTION_CARET_CLASS} style={sectionCaretStyle}>{caret("project")}</span>
              <span className={SECTION_LABEL_CLASS} style={sectionLabelStyle}>Project information</span>
            </button>
            {sections.project && (
              <>
                <div className="mb-3">
                  <label className={LABEL_CLASS} style={labelStyle}>Job name</label>
                  <input defaultValue={info.jobName} onChange={(e) => scalarChange("jobName", e.target.value)} onBlur={persist} className={INP_CLASS} style={inp} />
                </div>
                <div className={TWO_COL_CLASS}>
                  <div className="mb-3">
                    <label className={LABEL_CLASS} style={labelStyle}>Job number</label>
                    <input defaultValue={info.jobNumber} onChange={(e) => scalarChange("jobNumber", e.target.value)} onBlur={persist} className={INP_CLASS} style={inp} />
                  </div>
                  <div className="mb-3">
                    <label className={LABEL_CLASS} style={labelStyle}>Location</label>
                    <input defaultValue={info.location} onChange={(e) => scalarChange("location", e.target.value)} onBlur={persist} placeholder="City, State" className={INP_CLASS} style={inp} />
                  </div>
                </div>
                <div className={TWO_COL_CLASS}>
                  <div className="mb-3">
                    <label className={LABEL_CLASS} style={labelStyle}>Superintendent</label>
                    <input defaultValue={info.superintendent} onChange={(e) => scalarChange("superintendent", e.target.value)} onBlur={persist} className={INP_CLASS} style={inp} />
                  </div>
                  <div className="mb-3">
                    <label className={LABEL_CLASS} style={labelStyle}>Prepared by</label>
                    <input defaultValue={info.preparedBy} onChange={(e) => scalarChange("preparedBy", e.target.value)} onBlur={persist} className={INP_CLASS} style={inp} />
                  </div>
                </div>
                <div className={TWO_COL_CLASS}>
                  <div className="mb-3">
                    <label className={LABEL_CLASS} style={labelStyle}>Project start</label>
                    <input type="date" defaultValue={info.projectStart} onChange={(e) => { scalarChange("projectStart", e.target.value); persist(); }} className={INP_CLASS} style={inp} />
                  </div>
                  <div className="mb-3">
                    <label className={LABEL_CLASS} style={labelStyle}>Substantial completion</label>
                    <input type="date" defaultValue={info.projectEnd} onChange={(e) => { scalarChange("projectEnd", e.target.value); persist(); }} className={INP_CLASS} style={inp} />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Subcontractor directory */}
          <div style={sectionStyle}>
            <button onClick={() => toggleSection("subs")} className={SECTION_HEAD_CLASS} style={sectionHeadStyle}>
              <span className={SECTION_CARET_CLASS} style={sectionCaretStyle}>{caret("subs")}</span>
              <span className={SECTION_LABEL_CLASS} style={sectionLabelStyle}>Subcontractor directory</span>
            </button>
            {sections.subs && (
              <>
                <div className="grid gap-2 font-semibold uppercase" style={subHeadStyle}>
                  <span>Code</span>
                  <span>Company · contact · phone</span>
                  <span></span>
                </div>
                {project.subs.map((sub) => (
                  <div key={sub.id} className="grid items-start gap-2" style={subRowStyle}>
                    <input defaultValue={sub.code} onChange={(e) => subChange(sub.id, "code", e.target.value)} onBlur={persist} placeholder="—" className={`${INP_CLASS} text-center font-semibold uppercase`} style={subCodeInputStyle} />
                    <div className="flex flex-col" style={subSubStyle}>
                      <input defaultValue={sub.company} onChange={(e) => subChange(sub.id, "company", e.target.value)} onBlur={persist} placeholder="Company name" className={INP_CLASS} style={subFieldStyle} />
                      <input defaultValue={sub.contact} onChange={(e) => subChange(sub.id, "contact", e.target.value)} onBlur={persist} placeholder="Contact name" className={INP_CLASS} style={subFieldStyle} />
                      <input defaultValue={sub.phone} onChange={(e) => subChange(sub.id, "phone", e.target.value)} onBlur={persist} placeholder="Phone / email" className={INP_CLASS} style={subFieldStyle} />
                    </div>
                    <button onClick={() => removeSub(sub.id)} className={REMOVE_BTN_CLASS} style={removeBtnStyle} title="Remove subcontractor">✕</button>
                  </div>
                ))}
                <button onClick={() => addSub()} className={ADD_BTN_CLASS} style={addBtnFullStyle}>+ Add subcontractor</button>
              </>
            )}
          </div>

          {/* Holidays */}
          <div style={sectionStyle}>
            <button onClick={() => toggleSection("holidays")} className={SECTION_HEAD_CLASS} style={sectionHeadStyle}>
              <span className={SECTION_CARET_CLASS} style={sectionCaretStyle}>{caret("holidays")}</span>
              <span className={SECTION_LABEL_CLASS} style={sectionLabelStyle}>Holidays &amp; non-work days</span>
            </button>
            {sections.holidays && (
              <>
                <div style={holHeadStyle}>
                  Dates listed here are shaded “HOL” on every week automatically. Per-week weekend/closed flags still take precedence.
                </div>
                {project.holidays.map((hol) => (
                  <div key={hol.id} className="grid items-center gap-2" style={holRowStyle}>
                    <input type="date" defaultValue={hol.date} onChange={(e) => { holidayChange(hol.id, "date", e.target.value); persist(); }} className={INP_CLASS} style={subFieldStyle} />
                    <input defaultValue={hol.name} onChange={(e) => holidayChange(hol.id, "name", e.target.value)} onBlur={persist} placeholder="Description (optional)" className={INP_CLASS} style={subFieldStyle} />
                    <button onClick={() => removeHoliday(hol.id)} className={REMOVE_BTN_CLASS} style={removeBtnStyle} title="Remove">✕</button>
                  </div>
                ))}
                <button onClick={() => addHoliday()} className={ADD_BTN_CLASS} style={addBtnFullStyle}>+ Add holiday</button>
              </>
            )}
          </div>

          {/* Milestones */}
          <div style={sectionStyle}>
            <button onClick={() => toggleSection("milestones")} className={SECTION_HEAD_CLASS} style={sectionHeadStyle}>
              <span className={SECTION_CARET_CLASS} style={sectionCaretStyle}>{caret("milestones")}</span>
              <span className={SECTION_LABEL_CLASS} style={sectionLabelStyle}>Milestones</span>
            </button>
            {sections.milestones && (
              <>
                <div style={holHeadStyle}>
                  Key dates (pours, crane erection, completions). The matching column is marked with a ◆ on every week it appears.
                </div>
                {project.milestones.map((ms) => (
                  <div key={ms.id} className="grid items-center gap-2" style={holRowStyle}>
                    <input type="date" defaultValue={ms.date} onChange={(e) => { milestoneChange(ms.id, "date", e.target.value); persist(); }} className={INP_CLASS} style={subFieldStyle} />
                    <input defaultValue={ms.name} onChange={(e) => milestoneChange(ms.id, "name", e.target.value)} onBlur={persist} placeholder="Milestone description" className={INP_CLASS} style={subFieldStyle} />
                    <button onClick={() => removeMilestone(ms.id)} className={REMOVE_BTN_CLASS} style={removeBtnStyle} title="Remove">✕</button>
                  </div>
                ))}
                <button onClick={() => addMilestone()} className={ADD_BTN_CLASS} style={addBtnFullStyle}>+ Add milestone</button>
              </>
            )}
          </div>

          {/* Data & backup */}
          <div style={sectionStyle}>
            <button onClick={() => toggleSection("backup")} className={SECTION_HEAD_CLASS} style={sectionHeadStyle}>
              <span className={SECTION_CARET_CLASS} style={sectionCaretStyle}>{caret("backup")}</span>
              <span className={SECTION_LABEL_CLASS} style={sectionLabelStyle}>Data &amp; backup</span>
            </button>
            {sections.backup && (
              <>
                <div style={holHeadStyle}>
                  Your schedule is saved on this device only. Export a JSON backup you can re-import here or on another machine.
                </div>
                <div className="flex gap-2">
                  <button onClick={doExport} className={BACKUP_BTN_CLASS} style={backupBtnStyle}>Export backup (.json)</button>
                  <button onClick={() => fileRef.current?.click()} className={BACKUP_BTN_CLASS} style={backupBtnStyle}>Import…</button>
                </div>
                <input ref={fileRef} type="file" accept="application/json,.json" onChange={onFile} className="hidden" />
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

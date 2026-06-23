"use client";

import { useRef, type CSSProperties } from "react";
import { useStore } from "@/lookahead/store/useStore";
import { getAccent, getTokens, seg, switchKnob, switchTrack } from "@/lookahead/lib/tokens";
import { ACCENT } from "@/lookahead/lib/config";

export default function SettingsDrawer() {
  const open = useStore((s) => s.settingsOpen);
  const theme = useStore((s) => s.theme);
  const density = useStore((s) => s.density);
  const info = useStore((s) => s.project.info);
  const project = useStore((s) => s.project);
  const area = useStore((s) => s.areas[s.currentAreaId]);
  const sections = useStore((s) => s.openSections);

  const closeSettings = useStore((s) => s.closeSettings);
  const setTheme = useStore((s) => s.setTheme);
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
    width: "100%", height: "34px", border: "1px solid " + t.border, background: t.panel, color: t.fg,
    borderRadius: "7px", padding: "0 9px", fontSize: "12.5px", fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  };
  const labelStyle: CSSProperties = { fontSize: "11px", fontWeight: 600, color: t.mutedFg, marginBottom: "4px", display: "block" };
  const sectionStyle: CSSProperties = { marginBottom: "26px" };
  const sectionHeadStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "7px", width: "100%", textAlign: "left", border: "none", background: "transparent", cursor: "pointer", padding: 0, marginBottom: "12px" };
  const sectionCaretStyle: CSSProperties = { color: t.faintFg, fontSize: "10px", width: "10px", flex: "none" };
  const sectionLabelStyle: CSSProperties = { fontSize: "11px", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: t.mutedFg };
  const fieldStyle: CSSProperties = { marginBottom: "12px" };
  const twoColStyle: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" };
  const toggleRowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid " + t.border };
  const toggleLabelStyle: CSSProperties = { fontSize: "12.5px", fontWeight: 500, color: t.fg };
  const toggleSubLabelStyle: CSSProperties = { fontSize: "11px", color: t.faintFg, marginTop: "1px" };
  const segWrapStyle: CSSProperties = { display: "flex", background: t.headBg, borderRadius: "8px", padding: "2px", border: "1px solid " + t.border };
  const weeksSelectStyle: CSSProperties = { height: "32px", border: "1px solid " + t.border, background: t.panel, color: t.fg, cursor: "pointer", fontSize: "12.5px", fontWeight: 600, padding: "0 10px", borderRadius: "7px", fontFamily: "inherit" };
  const holHeadStyle: CSSProperties = { fontSize: "11.5px", color: t.faintFg, marginBottom: "10px", lineHeight: 1.4 };
  const subHeadStyle: CSSProperties = { display: "grid", gridTemplateColumns: "64px 1fr 28px", gap: "8px", fontSize: "10px", fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: t.faintFg, padding: "0 2px 6px" };
  const subRowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "64px 1fr 28px", gap: "8px", marginBottom: "7px", alignItems: "start" };
  const subCodeInputStyle: CSSProperties = { ...inp, height: "32px", fontWeight: 600, textTransform: "uppercase", textAlign: "center", padding: "0 4px" };
  const subSubStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: "5px" };
  const subFieldStyle: CSSProperties = { ...inp, height: "32px" };
  const removeBtnStyle: CSSProperties = { width: "28px", height: "32px", border: "1px solid " + t.border, background: t.panel, color: t.faintFg, borderRadius: "7px", cursor: "pointer", fontSize: "12px" };
  const holRowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "150px 1fr 28px", gap: "8px", marginBottom: "7px", alignItems: "center" };
  const addBtnFullStyle: CSSProperties = { width: "100%", border: "1px dashed " + t.borderStrong, background: t.panel, color: t.mutedFg, cursor: "pointer", fontSize: "12px", fontWeight: 600, padding: "8px", borderRadius: "8px", marginTop: "4px" };
  const backupBtnStyle: CSSProperties = { flex: 1, border: "1px solid " + t.border, background: t.panel, color: t.fg, cursor: "pointer", fontSize: "12px", fontWeight: 600, padding: "9px", borderRadius: "8px" };

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
        className="no-print"
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 89 }}
        onMouseDown={() => closeSettings()}
      />
      <div
        className="no-print"
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: "440px", maxWidth: "92vw", background: t.appBg,
          borderLeft: "1px solid " + t.border, boxShadow: "-12px 0 40px rgba(0,0,0,.22)", zIndex: 90,
          display: "flex", flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 18px", borderBottom: "1px solid " + t.border, background: t.panel }}>
          <div>
            <div style={{ fontSize: "15px", fontWeight: 700, color: t.fg }}>Project settings</div>
            <div style={{ fontSize: "11px", color: t.faintFg, marginTop: "1px" }}>Saved automatically to this device</div>
          </div>
          <button onClick={() => closeSettings()} style={{ width: "30px", height: "30px", border: "1px solid " + t.border, background: t.panel, color: t.fg, borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>
            ✕
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "18px" }}>
          {/* Display (device + this area) */}
          <div style={sectionStyle}>
            <button onClick={() => toggleSection("display")} style={sectionHeadStyle}>
              <span style={sectionCaretStyle}>{caret("display")}</span>
              <span style={sectionLabelStyle}>Display</span>
            </button>
            {sections.display && (
              <>
                <div style={toggleRowStyle}>
                  <div><div style={toggleLabelStyle}>Appearance</div></div>
                  <div style={segWrapStyle}>
                    <button onClick={() => setTheme("light")} style={seg(theme === "light", t)}>Light</button>
                    <button onClick={() => setTheme("dark")} style={seg(theme === "dark", t)}>Dark</button>
                  </div>
                </div>
                <div style={toggleRowStyle}>
                  <div><div style={toggleLabelStyle}>Row density</div></div>
                  <div style={segWrapStyle}>
                    <button onClick={() => setDensity("comfortable")} style={seg(!dense, t)}>Comfortable</button>
                    <button onClick={() => setDensity("compact")} style={seg(dense, t)}>Compact</button>
                  </div>
                </div>
                <div style={{ ...holHeadStyle, marginTop: "12px", marginBottom: "4px" }}>
                  These apply to the current look-ahead (<b style={{ color: t.mutedFg }}>{area.name}</b>):
                </div>
                <div style={toggleRowStyle}>
                  <div>
                    <div style={toggleLabelStyle}>Weeks shown</div>
                    <div style={toggleSubLabelStyle}>Length of the look-ahead window</div>
                  </div>
                  <select value={view.numWeeks || 3} onChange={(e) => setNumWeeks(+e.target.value)} style={weeksSelectStyle}>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <div style={toggleRowStyle}>
                  <div>
                    <div style={toggleLabelStyle}>Show Saturday</div>
                    <div style={toggleSubLabelStyle}>Shaded as a weekend</div>
                  </div>
                  <button onClick={() => toggleDay("showSat")} style={switchTrack(view.showSat !== false, ac, t)}>
                    <span style={switchKnob(view.showSat !== false)} />
                  </button>
                </div>
                <div style={toggleRowStyle}>
                  <div>
                    <div style={toggleLabelStyle}>Show Sunday</div>
                    <div style={toggleSubLabelStyle}>Shaded as a weekend</div>
                  </div>
                  <button onClick={() => toggleDay("showSun")} style={switchTrack(view.showSun === true, ac, t)}>
                    <span style={switchKnob(view.showSun === true)} />
                  </button>
                </div>
                <div style={toggleRowStyle}>
                  <div>
                    <div style={toggleLabelStyle}>Carry-forward intelligence</div>
                    <div style={toggleSubLabelStyle}>&quot;Roll forward&quot; advances work, flags slipped tasks</div>
                  </div>
                  <button onClick={() => toggleDay("carryForward")} style={switchTrack(view.carryForward !== false, ac, t)}>
                    <span style={switchKnob(view.carryForward !== false)} />
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Project information */}
          <div style={sectionStyle}>
            <button onClick={() => toggleSection("project")} style={sectionHeadStyle}>
              <span style={sectionCaretStyle}>{caret("project")}</span>
              <span style={sectionLabelStyle}>Project information</span>
            </button>
            {sections.project && (
              <>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Job name</label>
                  <input defaultValue={info.jobName} onChange={(e) => scalarChange("jobName", e.target.value)} onBlur={persist} style={inp} />
                </div>
                <div style={twoColStyle}>
                  <div style={fieldStyle}>
                    <label style={labelStyle}>Job number</label>
                    <input defaultValue={info.jobNumber} onChange={(e) => scalarChange("jobNumber", e.target.value)} onBlur={persist} style={inp} />
                  </div>
                  <div style={fieldStyle}>
                    <label style={labelStyle}>Location</label>
                    <input defaultValue={info.location} onChange={(e) => scalarChange("location", e.target.value)} onBlur={persist} placeholder="City, State" style={inp} />
                  </div>
                </div>
                <div style={twoColStyle}>
                  <div style={fieldStyle}>
                    <label style={labelStyle}>Superintendent</label>
                    <input defaultValue={info.superintendent} onChange={(e) => scalarChange("superintendent", e.target.value)} onBlur={persist} style={inp} />
                  </div>
                  <div style={fieldStyle}>
                    <label style={labelStyle}>Prepared by</label>
                    <input defaultValue={info.preparedBy} onChange={(e) => scalarChange("preparedBy", e.target.value)} onBlur={persist} style={inp} />
                  </div>
                </div>
                <div style={twoColStyle}>
                  <div style={fieldStyle}>
                    <label style={labelStyle}>Project start</label>
                    <input type="date" defaultValue={info.projectStart} onChange={(e) => { scalarChange("projectStart", e.target.value); persist(); }} style={inp} />
                  </div>
                  <div style={fieldStyle}>
                    <label style={labelStyle}>Substantial completion</label>
                    <input type="date" defaultValue={info.projectEnd} onChange={(e) => { scalarChange("projectEnd", e.target.value); persist(); }} style={inp} />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Subcontractor directory */}
          <div style={sectionStyle}>
            <button onClick={() => toggleSection("subs")} style={sectionHeadStyle}>
              <span style={sectionCaretStyle}>{caret("subs")}</span>
              <span style={sectionLabelStyle}>Subcontractor directory</span>
            </button>
            {sections.subs && (
              <>
                <div style={subHeadStyle}>
                  <span>Code</span>
                  <span>Company · contact · phone</span>
                  <span></span>
                </div>
                {project.subs.map((sub) => (
                  <div key={sub.id} style={subRowStyle}>
                    <input defaultValue={sub.code} onChange={(e) => subChange(sub.id, "code", e.target.value)} onBlur={persist} placeholder="—" style={subCodeInputStyle} />
                    <div style={subSubStyle}>
                      <input defaultValue={sub.company} onChange={(e) => subChange(sub.id, "company", e.target.value)} onBlur={persist} placeholder="Company name" style={subFieldStyle} />
                      <input defaultValue={sub.contact} onChange={(e) => subChange(sub.id, "contact", e.target.value)} onBlur={persist} placeholder="Contact name" style={subFieldStyle} />
                      <input defaultValue={sub.phone} onChange={(e) => subChange(sub.id, "phone", e.target.value)} onBlur={persist} placeholder="Phone / email" style={subFieldStyle} />
                    </div>
                    <button onClick={() => removeSub(sub.id)} style={removeBtnStyle} title="Remove subcontractor">✕</button>
                  </div>
                ))}
                <button onClick={() => addSub()} style={addBtnFullStyle}>+ Add subcontractor</button>
              </>
            )}
          </div>

          {/* Holidays */}
          <div style={sectionStyle}>
            <button onClick={() => toggleSection("holidays")} style={sectionHeadStyle}>
              <span style={sectionCaretStyle}>{caret("holidays")}</span>
              <span style={sectionLabelStyle}>Holidays &amp; non-work days</span>
            </button>
            {sections.holidays && (
              <>
                <div style={holHeadStyle}>
                  Dates listed here are shaded “HOL” on every week automatically. Per-week weekend/closed flags still take precedence.
                </div>
                {project.holidays.map((hol) => (
                  <div key={hol.id} style={holRowStyle}>
                    <input type="date" defaultValue={hol.date} onChange={(e) => { holidayChange(hol.id, "date", e.target.value); persist(); }} style={subFieldStyle} />
                    <input defaultValue={hol.name} onChange={(e) => holidayChange(hol.id, "name", e.target.value)} onBlur={persist} placeholder="Description (optional)" style={subFieldStyle} />
                    <button onClick={() => removeHoliday(hol.id)} style={removeBtnStyle} title="Remove">✕</button>
                  </div>
                ))}
                <button onClick={() => addHoliday()} style={addBtnFullStyle}>+ Add holiday</button>
              </>
            )}
          </div>

          {/* Milestones */}
          <div style={sectionStyle}>
            <button onClick={() => toggleSection("milestones")} style={sectionHeadStyle}>
              <span style={sectionCaretStyle}>{caret("milestones")}</span>
              <span style={sectionLabelStyle}>Milestones</span>
            </button>
            {sections.milestones && (
              <>
                <div style={holHeadStyle}>
                  Key dates (pours, crane erection, completions). The matching column is marked with a ◆ on every week it appears.
                </div>
                {project.milestones.map((ms) => (
                  <div key={ms.id} style={holRowStyle}>
                    <input type="date" defaultValue={ms.date} onChange={(e) => { milestoneChange(ms.id, "date", e.target.value); persist(); }} style={subFieldStyle} />
                    <input defaultValue={ms.name} onChange={(e) => milestoneChange(ms.id, "name", e.target.value)} onBlur={persist} placeholder="Milestone description" style={subFieldStyle} />
                    <button onClick={() => removeMilestone(ms.id)} style={removeBtnStyle} title="Remove">✕</button>
                  </div>
                ))}
                <button onClick={() => addMilestone()} style={addBtnFullStyle}>+ Add milestone</button>
              </>
            )}
          </div>

          {/* Data & backup */}
          <div style={sectionStyle}>
            <button onClick={() => toggleSection("backup")} style={sectionHeadStyle}>
              <span style={sectionCaretStyle}>{caret("backup")}</span>
              <span style={sectionLabelStyle}>Data &amp; backup</span>
            </button>
            {sections.backup && (
              <>
                <div style={holHeadStyle}>
                  Your schedule is saved on this device only. Export a JSON backup you can re-import here or on another machine.
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={doExport} style={backupBtnStyle}>Export backup (.json)</button>
                  <button onClick={() => fileRef.current?.click()} style={backupBtnStyle}>Import…</button>
                </div>
                <input ref={fileRef} type="file" accept="application/json,.json" onChange={onFile} style={{ display: "none" }} />
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

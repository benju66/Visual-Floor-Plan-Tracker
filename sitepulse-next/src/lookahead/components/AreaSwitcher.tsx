"use client";

import { useState, type CSSProperties } from "react";
import { Check, ChevronDown, Copy, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { useStore } from "@/lookahead/store/useStore";
import { getAccent, getTokens } from "@/lookahead/lib/tokens";
import { ACCENT } from "@/lookahead/lib/config";

type Dialog = { mode: "create" | "rename" } | null;

// Phase 3 (UI convergence): the area dropdown + create/rename dialog move to
// Tailwind for structure/spacing/typography. Theme tokens (border/panel/fg/accent/
// hover), dynamic active/disabled colors, the modal overlay rgba, and odd values
// with no clean Tailwind step (5/7/9px pads, 9/10/14px radii, 380px card, 220px
// trigger, 11/12/12.5/13/15px fonts) stay inline.
const ITEM_CLASS = "flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent text-left font-medium";

export default function AreaSwitcher() {
  const theme = useStore((s) => s.theme);
  const areas = useStore((s) => s.areas);
  const areaOrder = useStore((s) => s.areaOrder);
  const currentAreaId = useStore((s) => s.currentAreaId);
  const switchArea = useStore((s) => s.switchArea);
  const addArea = useStore((s) => s.addArea);
  const renameArea = useStore((s) => s.renameArea);
  const duplicateArea = useStore((s) => s.duplicateArea);
  const deleteArea = useStore((s) => s.deleteArea);

  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [name, setName] = useState("");
  const [copyCurrent, setCopyCurrent] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const t = getTokens(theme);
  const ac = getAccent(ACCENT, theme);
  const current = areas[currentAreaId];
  if (!current) return null;
  const canDelete = areaOrder.length > 1;

  const close = () => {
    setOpen(false);
    setConfirmDelete(false);
  };
  const openCreate = () => {
    setName("");
    setCopyCurrent(true);
    setDialog({ mode: "create" });
    close();
  };
  const openRename = () => {
    setName(current.name);
    setDialog({ mode: "rename" });
    close();
  };
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    if (dialog?.mode === "create") addArea(n, copyCurrent ? currentAreaId : null);
    else renameArea(currentAreaId, n);
    setDialog(null);
  };

  const triggerStyle: CSSProperties = { borderColor: t.border, background: t.panel, color: t.fg, fontSize: "12px", padding: "5px 9px", maxWidth: "220px" };
  const dropStyle: CSSProperties = { top: "calc(100% + 6px)", zIndex: 80, background: t.panel, borderColor: t.border, borderRadius: "10px", boxShadow: "0 12px 32px rgba(0,0,0,.22)" };
  const kickerStyle: CSSProperties = { fontSize: "9px", letterSpacing: ".1em", color: t.faintFg, padding: "5px 8px 4px" };
  const itemStyle: CSSProperties = { color: t.fg, fontSize: "12.5px", padding: "7px 8px" };
  const sepStyle: CSSProperties = { background: t.border, margin: "5px 2px" };
  const nameCellStyle = (active: boolean): CSSProperties => ({ ...itemStyle, fontWeight: active ? 600 : 500, background: active ? t.hover : "transparent" });

  return (
    <div className="relative">
      <button className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border font-semibold" style={triggerStyle} onClick={() => setOpen((o) => !o)} title="Switch look-ahead area">
        <Layers size={13} className="flex-none" style={{ color: t.mutedFg }} />
        <span className="truncate">{current.name}</span>
        <ChevronDown size={13} className="flex-none" style={{ color: t.mutedFg }} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0" style={{ zIndex: 79 }} onMouseDown={close} />
          <div className="absolute left-0 min-w-60 border p-1.5" style={dropStyle}>
            <div className="font-bold uppercase" style={kickerStyle}>Area / Scope</div>
            {areaOrder.map((id) => {
              const a = areas[id];
              if (!a) return null;
              const active = id === currentAreaId;
              return (
                <button
                  key={id}
                  className={`la-menu-item ${ITEM_CLASS}`}
                  style={nameCellStyle(active)}
                  onClick={() => {
                    switchArea(id);
                    close();
                  }}
                >
                  <Check size={13} className="flex-none" style={{ color: active ? ac.main : "transparent" }} />
                  <span className="truncate">{a.name}</span>
                </button>
              );
            })}
            <div className="mx-0.5 h-px" style={sepStyle} />
            <button className={`la-menu-item ${ITEM_CLASS}`} style={itemStyle} onClick={openCreate}>
              <Plus size={13} className="flex-none" style={{ color: t.mutedFg }} /> New look-ahead…
            </button>
            <button className={`la-menu-item ${ITEM_CLASS}`} style={itemStyle} onClick={openRename}>
              <Pencil size={13} className="flex-none" style={{ color: t.mutedFg }} /> Rename current…
            </button>
            <button
              className={`la-menu-item ${ITEM_CLASS}`}
              style={itemStyle}
              onClick={() => {
                duplicateArea(currentAreaId);
                close();
              }}
            >
              <Copy size={13} className="flex-none" style={{ color: t.mutedFg }} /> Duplicate current
            </button>
            {canDelete && !confirmDelete && (
              <button className={`la-menu-delete ${ITEM_CLASS}`} style={{ ...itemStyle, color: "#e11d48" }} onClick={() => setConfirmDelete(true)}>
                <Trash2 size={13} className="flex-none" /> Delete current…
              </button>
            )}
            {canDelete && confirmDelete && (
              <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
                <span className="font-semibold" style={{ fontSize: "11.5px", color: "#e11d48" }}>Delete “{current.name}”?</span>
                <button
                  className="cursor-pointer border-0 font-semibold text-white"
                  style={{ background: "#e11d48", fontSize: "11px", padding: "3px 9px", borderRadius: "5px" }}
                  onClick={() => {
                    deleteArea(currentAreaId);
                    close();
                  }}
                >
                  Delete
                </button>
                <button
                  className="cursor-pointer border font-semibold"
                  style={{ borderColor: t.border, background: t.panel, color: t.mutedFg, fontSize: "11px", padding: "3px 9px", borderRadius: "5px" }}
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {dialog && (
        <div
          className="fixed inset-0 flex items-center justify-center p-5"
          style={{ background: "rgba(0,0,0,.4)", zIndex: 95 }}
          onMouseDown={() => setDialog(null)}
        >
          <div
            className="max-w-full border"
            style={{ width: "380px", background: t.panel, borderRadius: "14px", borderColor: t.border, boxShadow: "0 24px 60px rgba(0,0,0,.35)", padding: "18px" }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-3 font-bold" style={{ fontSize: "15px", color: t.fg }}>
              {dialog.mode === "create" ? "New look-ahead" : "Rename look-ahead"}
            </div>
            <label className="mb-1 block font-semibold" style={{ fontSize: "11px", color: t.mutedFg }}>
              Area name
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                else if (e.key === "Escape") setDialog(null);
              }}
              placeholder="e.g. Interior, Exterior, Sitework"
              className="box-border h-9 w-full rounded-lg border px-2.5 outline-none"
              style={{ borderColor: t.border, background: t.panel, color: t.fg, fontSize: "13px", fontFamily: "inherit" }}
            />
            {dialog.mode === "create" && (
              <label className="mt-3 flex cursor-pointer items-center gap-2" style={{ fontSize: "12.5px", color: t.fg }}>
                <input type="checkbox" checked={copyCurrent} onChange={(e) => setCopyCurrent(e.target.checked)} />
                Copy task list from “{current.name}” (clears marks)
              </label>
            )}
            <div className="flex justify-end gap-2" style={{ marginTop: "18px" }}>
              <button
                className="cursor-pointer rounded-lg border px-3.5 py-2 font-medium"
                style={{ borderColor: t.border, background: t.panel, color: t.fg, fontSize: "12.5px" }}
                onClick={() => setDialog(null)}
              >
                Cancel
              </button>
              <button
                className="rounded-lg border-0 px-4 py-2 font-semibold"
                style={{ background: ac.main, color: ac.fg, cursor: name.trim() ? "pointer" : "default", opacity: name.trim() ? 1 : 0.5, fontSize: "12.5px" }}
                onClick={submit}
              >
                {dialog.mode === "create" ? "Create" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

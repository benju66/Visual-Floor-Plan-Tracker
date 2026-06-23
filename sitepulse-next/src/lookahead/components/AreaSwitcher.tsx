"use client";

import { useState, type CSSProperties } from "react";
import { Check, ChevronDown, Copy, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { useStore } from "@/lookahead/store/useStore";
import { getAccent, getTokens } from "@/lookahead/lib/tokens";
import { ACCENT } from "@/lookahead/lib/config";

type Dialog = { mode: "create" | "rename" } | null;

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

  const triggerStyle: CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: "6px", border: "1px solid " + t.border, background: t.panel,
    color: t.fg, cursor: "pointer", fontSize: "12px", fontWeight: 600, padding: "5px 9px", borderRadius: "8px", maxWidth: "220px",
  };
  const dropStyle: CSSProperties = {
    position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 80, minWidth: "240px", background: t.panel,
    border: "1px solid " + t.border, borderRadius: "10px", boxShadow: "0 12px 32px rgba(0,0,0,.22)", padding: "6px",
  };
  const kicker: CSSProperties = { fontSize: "9px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: t.faintFg, padding: "5px 8px 4px" };
  const item: CSSProperties = {
    display: "flex", alignItems: "center", gap: "8px", width: "100%", textAlign: "left", border: "none",
    background: "transparent", color: t.fg, cursor: "pointer", fontSize: "12.5px", fontWeight: 500, padding: "7px 8px", borderRadius: "6px",
  };
  const sep: CSSProperties = { height: "1px", background: t.border, margin: "5px 2px" };
  const nameCellStyle = (active: boolean): CSSProperties => ({ ...item, fontWeight: active ? 600 : 500, background: active ? t.hover : "transparent" });

  return (
    <div style={{ position: "relative" }}>
      <button style={triggerStyle} onClick={() => setOpen((o) => !o)} title="Switch look-ahead area">
        <Layers size={13} style={{ color: t.mutedFg, flex: "none" }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current.name}</span>
        <ChevronDown size={13} style={{ color: t.mutedFg, flex: "none" }} />
      </button>

      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 79 }} onMouseDown={close} />
          <div style={dropStyle}>
            <div style={kicker}>Area / Scope</div>
            {areaOrder.map((id) => {
              const a = areas[id];
              if (!a) return null;
              const active = id === currentAreaId;
              return (
                <button
                  key={id}
                  className="la-menu-item"
                  style={nameCellStyle(active)}
                  onClick={() => {
                    switchArea(id);
                    close();
                  }}
                >
                  <Check size={13} style={{ color: active ? ac.main : "transparent", flex: "none" }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                </button>
              );
            })}
            <div style={sep} />
            <button className="la-menu-item" style={item} onClick={openCreate}>
              <Plus size={13} style={{ color: t.mutedFg, flex: "none" }} /> New look-ahead…
            </button>
            <button className="la-menu-item" style={item} onClick={openRename}>
              <Pencil size={13} style={{ color: t.mutedFg, flex: "none" }} /> Rename current…
            </button>
            <button
              className="la-menu-item"
              style={item}
              onClick={() => {
                duplicateArea(currentAreaId);
                close();
              }}
            >
              <Copy size={13} style={{ color: t.mutedFg, flex: "none" }} /> Duplicate current
            </button>
            {canDelete && !confirmDelete && (
              <button className="la-menu-delete" style={{ ...item, color: "#e11d48" }} onClick={() => setConfirmDelete(true)}>
                <Trash2 size={13} style={{ flex: "none" }} /> Delete current…
              </button>
            )}
            {canDelete && confirmDelete && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 8px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "11.5px", fontWeight: 600, color: "#e11d48" }}>Delete “{current.name}”?</span>
                <button
                  style={{ border: "none", background: "#e11d48", color: "#fff", cursor: "pointer", fontSize: "11px", fontWeight: 600, padding: "3px 9px", borderRadius: "5px" }}
                  onClick={() => {
                    deleteArea(currentAreaId);
                    close();
                  }}
                >
                  Delete
                </button>
                <button
                  style={{ border: "1px solid " + t.border, background: t.panel, color: t.mutedFg, cursor: "pointer", fontSize: "11px", fontWeight: 600, padding: "3px 9px", borderRadius: "5px" }}
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
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}
          onMouseDown={() => setDialog(null)}
        >
          <div
            style={{ width: "380px", maxWidth: "100%", background: t.panel, borderRadius: "14px", border: "1px solid " + t.border, boxShadow: "0 24px 60px rgba(0,0,0,.35)", padding: "18px" }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: "15px", fontWeight: 700, color: t.fg, marginBottom: "12px" }}>
              {dialog.mode === "create" ? "New look-ahead" : "Rename look-ahead"}
            </div>
            <label style={{ fontSize: "11px", fontWeight: 600, color: t.mutedFg, marginBottom: "4px", display: "block" }}>
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
              style={{ width: "100%", height: "36px", border: "1px solid " + t.border, background: t.panel, color: t.fg, borderRadius: "8px", padding: "0 10px", fontSize: "13px", fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
            />
            {dialog.mode === "create" && (
              <label style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px", fontSize: "12.5px", color: t.fg, cursor: "pointer" }}>
                <input type="checkbox" checked={copyCurrent} onChange={(e) => setCopyCurrent(e.target.checked)} />
                Copy task list from “{current.name}” (clears marks)
              </label>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "18px" }}>
              <button
                style={{ border: "1px solid " + t.border, background: t.panel, color: t.fg, cursor: "pointer", fontSize: "12.5px", fontWeight: 500, padding: "8px 14px", borderRadius: "8px" }}
                onClick={() => setDialog(null)}
              >
                Cancel
              </button>
              <button
                style={{ border: "none", background: ac.main, color: ac.fg, cursor: name.trim() ? "pointer" : "default", opacity: name.trim() ? 1 : 0.5, fontSize: "12.5px", fontWeight: 600, padding: "8px 16px", borderRadius: "8px" }}
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

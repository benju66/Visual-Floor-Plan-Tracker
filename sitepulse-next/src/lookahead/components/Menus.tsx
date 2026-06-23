"use client";

import type { CSSProperties } from "react";
import { useStore } from "@/lookahead/store/useStore";
import { getTokens } from "@/lookahead/lib/tokens";

export default function Menus() {
  const theme = useStore((s) => s.theme);
  const menu = useStore((s) => s.menu);
  const cellMenu = useStore((s) => s.cellMenu);
  const insertRow = useStore((s) => s.insertRow);
  const duplicateRow = useStore((s) => s.duplicateRow);
  const deleteRow = useStore((s) => s.deleteRow);
  const closeRowMenu = useStore((s) => s.closeRowMenu);
  const setCellStatusAt = useStore((s) => s.setCellStatusAt);
  const startEdit = useStore((s) => s.startEdit);
  const closeCellMenu = useStore((s) => s.closeCellMenu);

  const t = getTokens(theme);

  const backdropStyle: CSSProperties = { position: "fixed", inset: 0, zIndex: 79 };
  const itemStyle: CSSProperties = {
    display: "block", width: "100%", textAlign: "left", border: "none", background: "transparent", color: t.fg,
    cursor: "pointer", fontSize: "12.5px", fontWeight: 500, padding: "7px 10px", borderRadius: "6px",
  };
  const sepStyle: CSSProperties = { height: "1px", background: t.border, margin: "4px 2px" };

  return (
    <>
      {menu && (
        <>
          <div className="no-print" style={backdropStyle} onMouseDown={() => closeRowMenu()} />
          <div
            className="no-print"
            style={{
              position: "fixed", left: menu.x + "px", top: menu.y + "px", zIndex: 80, background: t.panel,
              border: "1px solid " + t.border, borderRadius: "9px", boxShadow: "0 12px 32px rgba(0,0,0,.22)",
              padding: "5px", minWidth: "176px",
            }}
          >
            <button className="la-menu-item" style={itemStyle} onClick={() => insertRow(menu.rowId, false)}>Insert task above</button>
            <button className="la-menu-item" style={itemStyle} onClick={() => insertRow(menu.rowId, true)}>Insert task below</button>
            <button className="la-menu-item" style={itemStyle} onClick={() => duplicateRow(menu.rowId)}>Duplicate task</button>
            <div style={sepStyle} />
            <button
              className="la-menu-delete"
              style={{ ...itemStyle, color: "#e11d48" }}
              onClick={() => deleteRow(menu.rowId)}
            >
              Delete task
            </button>
          </div>
        </>
      )}

      {cellMenu && (
        <>
          <div
            className="no-print"
            style={backdropStyle}
            onMouseDown={() => closeCellMenu()}
            onContextMenu={(e) => {
              e.preventDefault();
              closeCellMenu();
            }}
          />
          <div
            className="no-print"
            style={{
              position: "fixed", left: cellMenu.x + "px", top: cellMenu.y + "px", zIndex: 80, background: t.panel,
              border: "1px solid " + t.border, borderRadius: "9px", boxShadow: "0 12px 32px rgba(0,0,0,.22)",
              padding: "5px", minWidth: "150px",
            }}
          >
            <button
              className="la-menu-item"
              style={{ ...itemStyle, color: t.st.start.color, fontWeight: 600 }}
              onClick={() => {
                setCellStatusAt(cellMenu.rowId, cellMenu.di, "start");
                closeCellMenu();
              }}
            >
              Start
            </button>
            <button
              className="la-menu-item"
              style={{ ...itemStyle, color: t.st.ongoing.color, fontWeight: 600 }}
              onClick={() => {
                setCellStatusAt(cellMenu.rowId, cellMenu.di, "ongoing");
                closeCellMenu();
              }}
            >
              In progress
            </button>
            <button
              className="la-menu-item"
              style={{ ...itemStyle, color: t.st.done.color, fontWeight: 600 }}
              onClick={() => {
                setCellStatusAt(cellMenu.rowId, cellMenu.di, "done");
                closeCellMenu();
              }}
            >
              Done
            </button>
            <div style={sepStyle} />
            <button
              className="la-menu-item"
              style={itemStyle}
              onClick={() => {
                closeCellMenu();
                startEdit(cellMenu.rowId, cellMenu.di);
              }}
            >
              Add / edit note…
            </button>
            <button
              className="la-menu-item"
              style={itemStyle}
              onClick={() => {
                setCellStatusAt(cellMenu.rowId, cellMenu.di, null);
                closeCellMenu();
              }}
            >
              Clear
            </button>
          </div>
        </>
      )}
    </>
  );
}

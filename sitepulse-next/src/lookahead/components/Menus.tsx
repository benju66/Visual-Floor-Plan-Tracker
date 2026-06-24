"use client";

import type { CSSProperties } from "react";
import { useStore } from "@/lookahead/store/useStore";
import { getTokens } from "@/lookahead/lib/tokens";

// Phase 3 (UI convergence): row + cell context menus reskinned to Tailwind for
// structure/spacing. Dynamic placement (left/top from menu.x/menu.y), the panel
// surface/border colors (tokens), per-item status colors + weights, and the odd
// 9px radius / 5px pad / 12.5px font (no clean Tailwind step) stay inline. The
// `la-menu-item` / `la-menu-delete` hover classes (lookahead.css) are preserved.
const ITEM_CLASS = "block w-full cursor-pointer rounded-md border-0 bg-transparent text-left";

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

  const itemStyle: CSSProperties = { color: t.fg, fontSize: "12.5px", fontWeight: 500, padding: "7px 10px" };
  const sepStyle: CSSProperties = { background: t.border };
  const popoverStyle: CSSProperties = {
    zIndex: 80, background: t.panel, borderColor: t.border, borderRadius: "9px",
    boxShadow: "0 12px 32px rgba(0,0,0,.22)", padding: "5px",
  };

  return (
    <>
      {menu && (
        <>
          <div className="no-print fixed inset-0" style={{ zIndex: 79 }} onMouseDown={() => closeRowMenu()} />
          <div className="no-print fixed border" style={{ ...popoverStyle, left: menu.x + "px", top: menu.y + "px", minWidth: "176px" }}>
            <button className={`la-menu-item ${ITEM_CLASS}`} style={itemStyle} onClick={() => insertRow(menu.rowId, false)}>Insert task above</button>
            <button className={`la-menu-item ${ITEM_CLASS}`} style={itemStyle} onClick={() => insertRow(menu.rowId, true)}>Insert task below</button>
            <button className={`la-menu-item ${ITEM_CLASS}`} style={itemStyle} onClick={() => duplicateRow(menu.rowId)}>Duplicate task</button>
            <div className="mx-0.5 my-1 h-px" style={sepStyle} />
            <button
              className={`la-menu-delete ${ITEM_CLASS}`}
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
            className="no-print fixed inset-0"
            style={{ zIndex: 79 }}
            onMouseDown={() => closeCellMenu()}
            onContextMenu={(e) => {
              e.preventDefault();
              closeCellMenu();
            }}
          />
          <div className="no-print fixed border" style={{ ...popoverStyle, left: cellMenu.x + "px", top: cellMenu.y + "px", minWidth: "150px" }}>
            <button
              className={`la-menu-item ${ITEM_CLASS}`}
              style={{ ...itemStyle, color: t.st.start.color, fontWeight: 600 }}
              onClick={() => {
                setCellStatusAt(cellMenu.rowId, cellMenu.di, "start");
                closeCellMenu();
              }}
            >
              Start
            </button>
            <button
              className={`la-menu-item ${ITEM_CLASS}`}
              style={{ ...itemStyle, color: t.st.ongoing.color, fontWeight: 600 }}
              onClick={() => {
                setCellStatusAt(cellMenu.rowId, cellMenu.di, "ongoing");
                closeCellMenu();
              }}
            >
              In progress
            </button>
            <button
              className={`la-menu-item ${ITEM_CLASS}`}
              style={{ ...itemStyle, color: t.st.done.color, fontWeight: 600 }}
              onClick={() => {
                setCellStatusAt(cellMenu.rowId, cellMenu.di, "done");
                closeCellMenu();
              }}
            >
              Done
            </button>
            <div className="mx-0.5 my-1 h-px" style={sepStyle} />
            <button
              className={`la-menu-item ${ITEM_CLASS}`}
              style={itemStyle}
              onClick={() => {
                closeCellMenu();
                startEdit(cellMenu.rowId, cellMenu.di);
              }}
            >
              Add / edit note…
            </button>
            <button
              className={`la-menu-item ${ITEM_CLASS}`}
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

// Design tokens + small style helpers — ported verbatim from the prototype.
import type { CSSProperties } from "react";
import type { Theme, Accent, Flag } from "./types";

export interface StatusPalette {
  bg: string;
  color: string;
}

export interface Tokens {
  appBg: string;
  panel: string;
  border: string;
  borderStrong: string;
  fg: string;
  mutedFg: string;
  faintFg: string;
  headBg: string;
  stickyBg: string;
  groupBg: string;
  addBg: string;
  barBg: string;
  hover: string;
  st: { start: StatusPalette; ongoing: StatusPalette; done: StatusPalette };
  flag: Record<Flag, string>;
}

export interface AccentTok {
  main: string;
  fg: string;
}

export function getTokens(theme: Theme): Tokens {
  if (theme === "dark")
    return {
      appBg: "#09090b", panel: "#0c0c0f", border: "#27272a", borderStrong: "#3f3f46",
      fg: "#fafafa", mutedFg: "#a1a1aa", faintFg: "#71717a",
      headBg: "#18181b", stickyBg: "#0c0c0f", groupBg: "#17171b", addBg: "#0e0e12", barBg: "#18181b", hover: "#27272a",
      st: {
        start: { bg: "rgba(59,130,246,.17)", color: "#93c5fd" },
        ongoing: { bg: "rgba(249,115,22,.18)", color: "#fdba74" },
        done: { bg: "rgba(16,185,129,.16)", color: "#6ee7b7" },
      },
      flag: { weekend: "rgba(255,255,255,.045)", holiday: "rgba(244,63,94,.16)", closed: "rgba(255,255,255,.10)" },
    };
  return {
    appBg: "#fafafa", panel: "#ffffff", border: "#e4e4e7", borderStrong: "#d4d4d8",
    fg: "#18181b", mutedFg: "#71717a", faintFg: "#a1a1aa",
    headBg: "#f4f4f5", stickyBg: "#ffffff", groupBg: "#f4f4f5", addBg: "#fcfcfc", barBg: "#18181b", hover: "#f4f4f5",
    st: {
      start: { bg: "#eff6ff", color: "#1d4ed8" },
      ongoing: { bg: "#fff7ed", color: "#c2410c" },
      done: { bg: "#ecfdf5", color: "#047857" },
    },
    flag: { weekend: "rgba(113,113,122,.08)", holiday: "rgba(244,63,94,.10)", closed: "rgba(113,113,122,.20)" },
  };
}

export function getAccent(accent: Accent, theme: Theme): AccentTok {
  if (accent === "Blue") return { main: "#2563eb", fg: "#ffffff" };
  if (accent === "Slate")
    return theme === "dark" ? { main: "#fafafa", fg: "#18181b" } : { main: "#18181b", fg: "#ffffff" };
  return { main: "#ea580c", fg: "#ffffff" };
}

/** Layer an overlay tint over a base color (used for flag tints). */
export function blend(base: string, overlay: string): string {
  return "linear-gradient(" + overlay + "," + overlay + "), " + base;
}

/** Segmented-control button style. */
export function seg(active: boolean, t: Tokens): CSSProperties {
  return {
    border: "none", cursor: "pointer", fontSize: "12px", fontWeight: 600, padding: "5px 11px",
    borderRadius: "6px", background: active ? t.panel : "transparent", color: active ? t.fg : t.mutedFg,
    boxShadow: active ? "0 1px 2px rgba(0,0,0,.10)" : "none",
  };
}

/** Legend swatch pill. */
export function swatch(pal: StatusPalette): CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", fontSize: "11px", fontWeight: 600, padding: "3px 9px",
    borderRadius: "999px", background: pal.bg, color: pal.color,
    fontFamily: "'Geist Mono', ui-monospace, monospace",
  };
}

export function switchTrack(on: boolean, ac: AccentTok, t: Tokens): CSSProperties {
  return {
    width: "42px", height: "24px", borderRadius: "999px", border: "none", cursor: "pointer",
    background: on ? ac.main : t.borderStrong, position: "relative", padding: 0, flex: "none",
  };
}

export function switchKnob(on: boolean): CSSProperties {
  return {
    position: "absolute", top: "2px", left: on ? "20px" : "2px", width: "20px", height: "20px",
    borderRadius: "50%", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.3)",
  };
}

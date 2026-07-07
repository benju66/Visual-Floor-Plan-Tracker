// Design tokens + small style helpers — ported from the prototype, then
// converged onto SitePulse's design system (slate palette + app font vars).
import type { CSSProperties } from "react";
import type { Theme, Accent, Flag } from "./types";
import { STATUS_INLINE } from "@/utils/statusColors";

// Centralized font stacks — wired to the app's loaded fonts (`src/app/layout.js`
// exposes Outfit as `--font-outfit` and Roboto Mono as `--font-roboto-mono`).
// The prototype's `'Geist'` was never loaded by SitePulse, so it silently fell
// back to the OS default; these vars make Look-Ahead match the rest of the app.
export const FONT_SANS = "var(--font-outfit), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
export const FONT_MONO = "var(--font-roboto-mono), ui-monospace, monospace";

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

// Neutrals are SitePulse slate (matching `globals.css`). The four canonical
// surfaces — app background, primary text, muted text, and border — wire
// straight to the app CSS vars (`--bg`/`--text-h`/`--text`/`--border`) so they
// always track the live theme; the rest are slate hexes that fill the gaps the
// app vars don't name (panels, group/head rows, hover, the dark action bar).
// Status palettes wire to the canonical status-color language (UI Polish P2,
// `src/utils/statusColors.ts`): start → planned (amber) · ongoing → ongoing
// (blue) · done → completed (emerald). Flag tints are intentionally kept.
export function getTokens(theme: Theme): Tokens {
  if (theme === "dark")
    return {
      appBg: "var(--bg)", panel: "#0f172a", border: "var(--border)", borderStrong: "#334155",
      fg: "var(--text-h)", mutedFg: "var(--text)", faintFg: "#64748b",
      headBg: "#1e293b", stickyBg: "#0f172a", groupBg: "#1e293b", addBg: "#0b1120", barBg: "#0f172a", hover: "#1e293b",
      st: {
        start: STATUS_INLINE.dark.planned,
        ongoing: STATUS_INLINE.dark.ongoing,
        done: STATUS_INLINE.dark.completed,
      },
      flag: { weekend: "rgba(255,255,255,.045)", holiday: "rgba(244,63,94,.16)", closed: "rgba(255,255,255,.10)" },
    };
  return {
    appBg: "var(--bg)", panel: "#ffffff", border: "var(--border)", borderStrong: "#94a3b8",
    fg: "var(--text-h)", mutedFg: "var(--text)", faintFg: "#94a3b8",
    headBg: "#f1f5f9", stickyBg: "#ffffff", groupBg: "#f1f5f9", addBg: "#f8fafc", barBg: "#0f172a", hover: "#f1f5f9",
    st: {
      start: STATUS_INLINE.light.planned,
      ongoing: STATUS_INLINE.light.ongoing,
      done: STATUS_INLINE.light.completed,
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

/** Segmented-control button — data-driven fill/text/shadow stay here; the
 *  structure (cursor / rounded-md / border-0 / font-semibold) is Tailwind at the
 *  SettingsDrawer call site (Phase 4). The 12px font and 5px/11px pad have no
 *  clean Tailwind step, so they stay inline with the palette. */
export function seg(active: boolean, t: Tokens): CSSProperties {
  return {
    fontSize: "12px", padding: "5px 11px",
    background: active ? t.panel : "transparent", color: active ? t.fg : t.mutedFg,
    boxShadow: active ? "0 1px 2px rgba(0,0,0,.10)" : "none",
  };
}

/** Legend swatch pill — data-driven fill/text from the status palette. The
 *  structural styling (inline-flex / items-center / rounded-full / font-semibold)
 *  is Tailwind at the Toolbar call site (Phase 3); the 11px font, 3px/9px pad and
 *  mono face have no clean Tailwind step, so they stay here with the palette. */
export function swatch(pal: StatusPalette): CSSProperties {
  return { fontSize: "11px", padding: "3px 9px", background: pal.bg, color: pal.color, fontFamily: FONT_MONO };
}

/** Toggle-switch track — only the data-driven on/off background stays here; the
 *  structure (relative / flex-none / cursor / rounded-full / border-0 / p-0) is
 *  Tailwind at the SettingsDrawer call site (Phase 4). The 42×24px pill has no
 *  clean Tailwind step, so its dimensions stay inline. */
export function switchTrack(on: boolean, ac: AccentTok, t: Tokens): CSSProperties {
  return { width: "42px", height: "24px", background: on ? ac.main : t.borderStrong };
}

/** Toggle-switch knob — only the dynamic on/off `left` slide and the constant
 *  white fill/shadow stay here; position/size/round (absolute / top-0.5 / h-5 /
 *  w-5 / rounded-full) is Tailwind at the SettingsDrawer call site (Phase 4). */
export function switchKnob(on: boolean): CSSProperties {
  return { left: on ? "20px" : "2px", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.3)" };
}

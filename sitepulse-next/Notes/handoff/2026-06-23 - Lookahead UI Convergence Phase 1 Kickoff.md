# Kickoff — Look-Ahead UI Convergence, Phase 1: Visual foundation (theme bridge, accent, fonts, palette)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Look-Ahead UI Convergence** (make the Look-Ahead view share SitePulse's
> dark mode, fonts, blue accent, and slate palette — visual only, no interaction/layout changes).
> Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-23 - Lookahead UI Convergence Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Lookahead-UI-Convergence-Plan.md` (Phase 1)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main` (a fresh branch — NOT `feat/project-contacts-phase-1`). Build **only Phase 1**.
> The saved plan document must stay byte-identical (`projectBlob` unchanged) and don't disturb the
> autosave seam in `LookaheadWorkspace.tsx`. Don't commit or push until I say "Approved."

---

## Context for the session

You are converging an **absorbed view** onto the host app's design system. The Look-Ahead view
(`src/lookahead/**`) was brought into SitePulse "blob verbatim" (see parent plan), so it carries
its own styling system, palette, fonts, and a private dark-mode switch — it visibly reads as a
different app. Phase 1 fixes the four highest-impact, lowest-risk mismatches. **No interaction or
layout work in this phase** — that's later phases.

### Required reading (in full, before editing)
1. `sitepulse-next/AGENTS.md` — esp. §0 (how to talk to the owner: lead with plain English),
   §2 (state/persistence isolation), §4 (Tailwind), §6 (TS guardrails).
2. `sitepulse-next/Notes/plans/Lookahead-UI-Convergence-Plan.md` — the whole plan; you build Phase 1.
3. Then **re-read the real files fresh** (line numbers in docs drift):
   - `src/lookahead/lib/tokens.ts`, `src/lookahead/lib/config.ts`
   - `src/lookahead/LookaheadWorkspace.tsx`, `src/lookahead/components/SettingsDrawer.tsx`
   - `src/lookahead/components/LookAhead.tsx` (only the inline `'Geist'` font spots)
   - The target design system: `src/app/globals.css` (CSS vars + `[data-theme="dark"]`),
     `src/app/layout.js` (Outfit/Roboto Mono font vars).

### Scope (Phase 1 only)
1. **Palette:** in `tokens.ts` `getTokens`, remap the zinc hexes to SitePulse **slate** (match
   `globals.css`: `--bg`/`--text`/`--text-h`/`--border`), wiring to the app CSS vars where it's
   clean. Keep the status palettes (start/ongoing/done) and flag tints.
2. **Accent:** `config.ts` `ACCENT = "Blue"`; make `getAccent`'s default/Blue match the app's
   sky/blue (`#2563eb` is already the Blue value — confirm it reads right next to `sky-500` chrome).
3. **Fonts:** replace every `'Geist'` / `'Geist Mono'` stack with `var(--font-outfit)` /
   `var(--font-roboto-mono)` (centralize in `tokens.ts`; also the inline spots in `LookAhead.tsx`
   and the placeholder/error text in `LookaheadWorkspace.tsx`).
4. **Theme bridge:** add a **separate** `useEffect` in `LookaheadWorkspace.tsx` that reads the
   app-wide theme from `document.documentElement`'s `[data-theme]` (initial value + a
   `MutationObserver` on the `data-theme` attribute) and calls `useStore.getState().setTheme(
   'dark' | 'light')`. Then **remove** the Light/Dark segmented toggle in `SettingsDrawer.tsx`
   (the "Appearance" row) — keep "Row density". Leave the density and all other settings alone.

### Hard guardrails for this phase
- **`projectBlob` must stay `{ project, areas, areaOrder, currentAreaId }`.** Theme is device-local
  store state and must NOT enter the saved blob. (It already doesn't — keep it that way.)
- **Do not fold the theme bridge into the autosave subscription** in `LookaheadWorkspace.tsx`. It's
  a standalone effect. Don't change the `lastSavedRef` change-detector or the debounce/flush logic.
- **Touch only the lookahead module + its mount.** Do not edit `TopHeader.tsx` or any other view.
- **No interaction/layout/responsive/touch changes** — those are Phases 2–6.
- TypeScript: no `any`; keep it typecheck-clean.

### Exit criteria (Definition of Done → then STOP)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build` green.
  (No new unit tests in Phase 1 — `selection.ts`/`gesture.ts` extraction is Phase 3/6.)
- Live `npm run dev:3010` (from `sitepulse-next/`), open a project → Look-Ahead view:
  - Toggle the **app's** dark mode (SitePulse settings) → the Look-Ahead view flips with it. The
    in-drawer Light/Dark toggle is gone.
  - Brand accent, primary button (Print/Export), selection + focus rings read **blue**, not orange.
  - Text renders in **Outfit** (sans) and **Roboto Mono** (the mono cells), matching other views.
  - Open an existing saved plan → unchanged; make an edit → it still autosaves (no console errors,
    no spurious saves from theme changes).
- Close the phase with the **`verify-feature`** skill (its Definition of Done / merge gate).
- **Do not commit or push until the owner says "Approved."**

### Notes / gotchas
- **Geist was never loaded** by the app (`layout.js` loads Outfit + Roboto Mono only), so today the
  view silently falls back to OS default — switching to the app font vars is a real, visible fix.
- The theme bridge replaces a *user* control with *automatic* mirroring; that's intended (owner
  decision — theme follows the app). Don't leave a dead toggle behind.
- `getAccent` still has Orange/Slate branches — leaving them is fine; just change the default the
  view uses (`ACCENT`). The picker that exposes them lives in settings and is reconciled in Phase 4.

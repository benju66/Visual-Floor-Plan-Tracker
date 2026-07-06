# Kickoff — Robustness & Trust Hardening, Phase 1: kill silent no-op writes (dev-time wiring guard)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Robustness & Trust Hardening** (a dev-time guard so any write action that fires without a save path shouts instead of silently doing nothing). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-29 - Robustness Trust Hardening Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Robustness-Trust-Hardening-Plan.md` (§ Phase 1)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 1**. Touch `FloorplanCanvas.tsx` minimally (decomposition is a separate track); no DB/queue/RLS changes. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists
This workstream was born from the 2026-06-29 polygon audit, which found **two
silent-failure bugs**: (1) the project-map pending polygon vanished during naming
because `useMapActions` stopped *returning* `pendingPolygonPoints`, and (2) workbench
geometry edits never persisted because `WorkbenchTracer` never *wired*
`onUpdateUnitPolygon`. Both compiled clean, threw no error, and failed silently.
Phase 1 closes that exact hole: in development, an interactive write that *fires*
without a save path now screams in the console (and is unit-tested). Production is
untouched. It's the cheapest, highest-leverage prevention — do it first.

## Required reading (in full, fresh — do not trust line numbers)
1. `sitepulse-next/AGENTS.md` — esp. §0 (how to talk to the owner), §2 (do NOT touch
   the mutation queue / `status_logs` path), §6 (TS guardrails, no `any`), §9 (Vitest:
   globals OFF, import from `'vitest'`, co-locate tests).
2. `sitepulse-next/Notes/plans/Robustness-Trust-Hardening-Plan.md` — the whole plan;
   build **only § Phase 1** and the `wiringGuard` entry under "Pure logic".
3. `src/components/FloorplanCanvas.tsx` — find the CURRENT call sites of
   `onUpdateUnitPolygon` (node move, whole-polygon drag, arrow-key nudge, flip,
   rotate), `onPolygonComplete`, and `onInstantStamp`. (As of this writing they sit in
   `handleAnchorDragEnd`, `handlePolygonDragEnd`, the arrow-key keydown handler,
   `handleFlip`, `handleRotatePolygon`, `handleStageClick`/`finishDrawing`, and the
   stamp handler — but re-grep, do not trust these names/locations blindly.)

## Scope (build only this)
1. **`src/utils/wiringGuard.ts` + `src/utils/wiringGuard.test.ts`**
   - `export function warnIfUnwired(cb: ((...args: never[]) => unknown) | null | undefined, actionName: string): boolean`
   - Dev-only: when `cb == null`, `console.error('[wiring] "<actionName>" fired but its
     save callback is not wired — this would silently do nothing')` and return `false`.
     When `cb` is a function, return `true` and stay silent.
   - **No-op in production:** when `process.env.NODE_ENV === 'production'`, never log;
     just return `cb != null`. (Pure + deterministic; no `Date.now()`.)
   - Test with a spied `console.error` and `vi.stubEnv('NODE_ENV', 'development' | 'production')`.
2. **Guard the real write-callback call sites in `FloorplanCanvas.tsx`.** Wrap each
   interactive write so a fired-but-unwired action triggers the guard, e.g.:
   ```ts
   if (warnIfUnwired(onUpdateUnitPolygon, 'move node')) onUpdateUnitPolygon!(unitId, newPoints);
   ```
   Apply to: the `onUpdateUnitPolygon` invocations (node move, whole-polygon drag,
   arrow-nudge, flip, rotate), `onPolygonComplete`, and `onInstantStamp`. Keep edits
   **surgical** — wrap the existing calls; do not restructure the file. The arrow-nudge
   path uses a ref (`onUpdateUnitPolygonRef.current`) — guard the ref's current value.

## Explicitly do NOT
- Do **not** make the canvas props blanket-`required` in TypeScript. Several are
  legitimately optional per surface (the map omits `onCaptureBox`; the workbench omits
  `onInstantStamp`/`onDuplicateUnit`). The runtime guard is correct *because* it fires
  only when the action actually happens without a handler.
- Do **not** touch the mutation queue, `status_logs`, RLS/auth, or the data model.
- Do **not** start decomposing `FloorplanCanvas` (separate track).
- Do **not** add visible UI here — the user-facing save badge is Phase 2.

## Exit criteria (Definition of Done → then STOP)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` clean.
- `... run test` green, including the new `wiringGuard.test.ts` (warns in dev, silent
  in prod, correct return value).
- `... run build` green.
- Live sanity on `npm run dev:3010` (from `sitepulse-next/`, port 3010): normal edits
  on the map and in the workbench produce **no** `[wiring]` warnings (everything is
  wired after the recent fixes) — the guard is a tripwire for future regressions, not
  a current alarm.
- Close with the `verify-feature` skill (its Definition of Done / Merge Gate, then
  stop). **Do not commit or push until the owner says "Approved."**

## After approval (standing handoff ritual)
Once the owner approves and you commit Phase 1, draft the **Phase 2** kickoff
(`Notes/handoff/<date> - Robustness Trust Hardening Phase 2 Kickoff.md` — visible
save/error feedback), move this Phase 1 file to `Notes/handoff/archive/`, and paste
the short Phase 2 launch prompt into chat.

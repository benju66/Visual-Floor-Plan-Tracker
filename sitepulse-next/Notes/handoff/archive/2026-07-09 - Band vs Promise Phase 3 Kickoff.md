# Kickoff — Band vs Promise, Phase 3: first-class baseline capture (the make-or-break)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3 of Band vs Promise** — make the schedule **baseline** a first-class,
> *capturable* object: surface a "Capture baseline" control outside the MSP importer, prompt for
> it at the two moments it matters, and give every baseline surface an honest "no baseline yet"
> empty state. Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-09 - Band vs Promise Phase 3 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Band-vs-Promise-Plan.md` (Phase 3 + Open decisions 3–4)
> - `sitepulse-next/AGENTS.md` §4 (the `schedule_baselines` invariants: append-only, immutable,
>   privileged + online-first; reuse `useScheduleBaselines` + `scheduleBaseline.ts`, never fork)
>
> Branch off `main` (or off `band-vs-promise-phase2` if P1–P2 aren't merged yet — check
> `git log main`). Build **only Phase 3**. **No migration, no new table, no new hook** — it reuses
> the existing `schedule_baselines` table + hooks. Capture is privileged + online-first. Don't
> commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Where P1–P2 left off
- **P1** (commit `738b385`): Project Info settings tab + the two nullable date columns on
  `projects` (migration applied to prod). **P2** (`7cd9bc3`): the promise line on the hero card
  (`promiseOutlook`). Plus a **Forecast Coherence** follow-on (`e515bb6`): the hero + Floor Pulse now
  headline the confidence-band **midpoint (P50)** so the projected date can't contradict its own
  range. All three are on branch `band-vs-promise-phase2` — **check `git log main`; if not merged,
  branch P3 off `band-vs-promise-phase2`** so the promise + coherence work is present (though P3
  doesn't strictly depend on it — it's the baseline layer).
- The **manual-promise block (P1–P2) is done and validated** — the owner set a real contract date,
  saw the promise line, and confirmed the "promise" framing resonates. P3 begins the **baseline
  layer** (P3–P5): make the frozen schedule baseline first-class and visible.

## Why this phase (the make-or-break)
A baseline only has value if it's actually **captured**. Today the ONLY way to snap one is a button
buried in the MSP import panel — so most projects have none, and any baseline display would ship
dark. P3's whole job is to make capture **frictionless and prompted**, and to make every "where's
the baseline?" surface honest when there isn't one. **Do not build baseline displays (List columns,
drift headline — that's P4) before capture is first-class**, or they ship empty.

## Required reading (re-read fresh — do not trust line numbers)
- `sitepulse-next/AGENTS.md` §4 — `schedule_baselines` is **append-only + immutable** (RLS: read =
  member, INSERT/DELETE = owner/admin/pm, **no UPDATE**; fix a bad one by delete + re-capture).
  Snapshot = the frozen PLAN only (level×activity windows + each dated slot's planned window),
  **never progress fields**. Narrow the JSONB with `isScheduleBaselineSnapshot` at the boundary
  (a malformed snapshot degrades to "no baseline", never a crash). Hooks are **online-first**
  (schedule authoring, never the offline queue).
- `sitepulse-next/Notes/plans/Band-vs-Promise-Plan.md` — Phase 3 scope + **Open decisions 3 & 4**
  (resolve both; recommended defaults below).
- Re-read fresh:
  - `src/hooks/useScheduleBaselines.ts` — `useScheduleBaselines` (newest-first read),
    `useSetScheduleBaseline` (append), `useDeleteScheduleBaseline`. **REUSE — no new hook.**
  - `src/utils/scheduleBaseline.ts` — `buildBaselineSnapshot` (what capture calls), snapshot type,
    `isScheduleBaselineSnapshot`. Extend, never fork.
  - `src/components/schedule/MspImportPanel.tsx` — the ONLY current baseline UI: the "Set baseline"
    button + the "Comparing against {name} from {capture date}" strip. **Reuse its wording**; move
    capture OUT of the importer's exclusive ownership so it's reachable at project setup too.
  - `src/components/schedule/ScheduleWorkspace.tsx` (+ its header) — the recommended home for the
    plain "Capture baseline" control (Schedule view header).
  - `src/components/SettingsMenu.tsx` — the Project Info tab (P1); a secondary capture home is a
    P3 call (Open decision 4).

## Scope (build ONLY this)
1. **A plain "Capture baseline" control** in an obvious home (recommend the **Schedule view header**),
   reusing `useSetScheduleBaseline` + `buildBaselineSnapshot`. Privileged (owner/admin/pm), online-first.
2. **A prompt/nudge at the two moments a baseline is worth taking:** first meaningful schedule setup,
   and right after a large re-import (the importer already has the button — add the nudge there).
3. **An honest empty state everywhere a baseline would be shown:** "No baseline captured — snapshot
   the current plan to track drift," with the capture button inline.
4. **Show the current baseline's name + capture date** (reuse the importer's strip wording). v1 uses
   the **newest** baseline as "the current baseline" — no picker.
5. **No List columns, no drift headline** — that's Phase 4.

## Open decisions to resolve this phase (recommended defaults — confirm with the owner)
3. **Which baseline the layer uses** — *default:* the **newest** captured baseline as "the current
   baseline," no picker (keeps it out of P6 territory). Only add a picker if the owner asks.
4. **Capture entry points** — *default:* **Schedule view header** + a prompt after a large re-import
   (keep the importer's button). Whether it ALSO lives in the Project Info tab is your call this phase
   — recommend deferring unless it's trivial.

## Guardrails specific to this phase
- **No migration, no new table, no new hook** — reuse `schedule_baselines` + `useScheduleBaselines` +
  `scheduleBaseline.ts` (AGENTS.md §4). No approval gate.
- **Capture is privileged (owner/admin/pm) + online-first** — never the offline mutation queue.
  Append-only: never UPDATE a baseline (fix = delete + re-capture).
- **Honest empty state, never a fabricated/blank baseline.** A malformed snapshot degrades to
  "no baseline."
- No `any`; new/edited files `.ts`/`.tsx`; tests import `{ describe, it, expect }` from `'vitest'`.

## Exit criteria
- `typecheck` + `test` + `build` green (verification commands in the plan).
- dev:3010: from the new control, **capture a baseline on a real project** → it appears (name +
  capture date), the empty state is gone; a project with none shows the empty state + an obvious
  capture affordance.
- Close with the **verify-feature** skill (Definition of Done → STOP). Commit; do NOT push until the
  owner says "Approved." Then draft the **Phase 4** (baseline columns in the List) kickoff.

# Kickoff — Unified Schedule Engine, Phase 2: make the two layers legible + fix the Save/Apply confusion

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of the Unified Schedule Engine** (reframe `CascadePanel` around the
> "level plan → these N locations" model and collapse the confusing Save/Apply dual
> buttons). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-06 - Unified Schedule Engine Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Unified-Schedule-Engine-Plan.md` (Phase 2)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main` (Phase 1 landed fbcbfbc). Build **only Phase 2** — pure UX/relabel
> pass, no data-model change, no migration. Don't commit or push until I say "Approved."

---

> Context for the session. (Phase 2 was in fact built in the SAME session that closed
> Phase 1 — this doc exists for the record/ritual; see the plan's Phase 2 landed note.)

## What & why (plain English)
Phase 1 made the level panel powerful (staggered crew-flow dates, derived durations) but
its two buttons confuse: "Apply to locations" ALSO saves the level defaults, so the
standalone "Save level dates" is nearly redundant, and nothing tells you per activity how
many locations are already dated vs would be filled. This phase makes the two layers
visible (level plan → N locations) and collapses the actions into one clear primary.

## Scope (build ONLY this — plan Phase 2)
1. Visible "Level plan → these N locations" framing in the panel header.
2. Collapse the dual buttons: one primary **"Save & apply"**; decide WITH THE OWNER
   whether a secondary "Save draft only" survives (plan's open decision).
3. Per-activity "already dated vs will be filled" counts (small pure presenter helper +
   co-located tests; compute from `existing` + applicability, per activity).
4. Consider per-activity overwrite vs the global checkbox — bias to less; keep global
   unless the owner asks.

## Guardrails
- Pure UX/relabel — the WRITE payloads stay byte-identical (same
  `cascadeLevelToLocations` call, same `useBulkInsertStatusLogs` upsert path).
- No migration / RLS / offline-queue change. Lint is not a gate.

## Exit criteria (Definition of Done → then STOP)
- typecheck + test + build green · presenter helper unit-tested · live dev:3010
  click-through confirming the relabeled flow writes exactly as before ·
  `verify-feature` → stop; no commit/push until "Approved."

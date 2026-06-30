# Kickoff — Trace Naming & Type Assist, Phase 1: smarter deterministic name + type rules

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Trace Naming & Type Assist** (smarter, frontend-only room-name extraction +
> dictionary/alias-aware type guessing on manual trace). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-27 - Trace Naming & Type Assist Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Trace-Naming-Type-Assist-Plan.md` (Phase 1)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 1** — frontend-only, no backend, no DB migration. Don't commit
> or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## What this phase is
Two frontend-only improvements to the workbench trace naming popup — they ship immediately and work
on every sheet already loaded (no backend, no re-processing, no migration):

- **A — cleaner name:** today `matchRoomName` grabs **every** PDF word inside the traced polygon and
  mashes them together, so the name field comes pre-filled with square-footage notes, dimensions, and
  door tags that the owner then has to delete. Use the owner's fixed **"Name + Number"** convention to
  isolate the room-number token + the adjacent name word(s) and drop the noise.
- **D1 — right type:** today the type guesser (`suggestTaxonomyFromText`) uses a **hard-coded keyword
  list** that never reads the editable dictionary or its aliases and has **zero housing types**, so a
  user alias like "Unit" → "Dwelling Unit" does nothing for the guess. Make the guess consult the live
  `subtypes` dictionary **and its aliases**.

## Required reading (in order)
1. `sitepulse-next/AGENTS.md` — esp. §6 (TypeScript/JSONB/IDB guardrails) and §9 (testing).
2. `sitepulse-next/Notes/plans/Trace-Naming-Type-Assist-Plan.md` — the plan-of-record; build Phase 1.
3. Parent: `sitepulse-next/Notes/plans/AI-Tracing-Assist-Plan.md` (this refines its Phase 2).
4. Re-read these source files **fresh** (line numbers drift — find the real code):
   - `src/utils/roomNameMatch.ts` (lever A) · `src/utils/roomSuggestion.ts` (the
     `buildRoomSuggestion` entry point + `ROOM_TEXT_MODEL_VERSION`)
   - `src/utils/locationTaxonomy.ts` (`suggestTaxonomyFromText` + `ROOM_KEYWORD_TO_SUBTYPE`)
   - `src/utils/subtypes.ts` (**reuse `rankSubtypes`/`matchRank`** — the alias-aware matcher the manual
     Type Picker already uses; don't write a new one)
   - `src/components/workbench/WorkbenchTracer.tsx` (where `buildRoomSuggestion` is called and the
     suggestion is applied) · `src/types/domain.ts` (`TextWord`, `Subtype`)

## Scope (build only this)
- **A:** strengthen `matchRoomName` (pure): number-token + adjacent-name isolation; drop SF
  (`250 SF` / `S.F.`), dimensions (`12'-6"`, feet/inch marks), door + equipment tags; prefer the 1–2
  lines nearest the polygon centroid over joining all interior words. Keep the existing
  "return null when no interior text" behavior.
- **D1:** route the type guess through the **live dictionary + aliases** (reuse `matchRank`), with
  `ROOM_KEYWORD_TO_SUBTYPE` kept only as a fallback seed. `buildRoomSuggestion` already receives
  `subtypes` — thread the alias-aware match in there and resolve to a live `subtype_id` + role.
- Bump `ROOM_TEXT_MODEL_VERSION` → `text-prefill-v2`.
- **Tests:** extend/add co-located `*.test.ts` for `matchRoomName` (noise-dropping, number+name
  isolation, centroid line-limiting, still-returns-null-on-empty) and for the alias-aware type match
  ("Unit" → "Dwelling Unit"; housing types now reachable).

## Guardrails / do-not
- **No backend, no migration, no RLS, no push.** Frontend pure-logic + its wiring only.
- Keep functions **pure & deterministic** (no `Date.now()`, no DB inside the matchers) — AGENTS.md §9.
- **Geometry untouched** — `method` stays `'manual'`; only the name/type is assisted.
- **Keep training capture working:** the frozen `suggested_label` + `deriveSuggestionSource`
  (`ai_accepted`/`ai_edited`) path must still function; bumping `ROOM_TEXT_MODEL_VERSION` is required
  so old/new suggestions stay distinguishable.
- Don't fork `subtypes.ts` ranking — reuse it. Don't let raw `Json` reach props (§6).

## Exit criteria (Definition of Done → then STOP)
Run from repo root with absolute prefix (bash cwd persists; a stray `cd` prompts):
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` (primary gate)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test`
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build`
- Live `dev:3010` click-through (from `sitepulse-next/`, port 3010): trace (1) a housing room labeled
  like "Unit 101" → type pre-selects "Dwelling Unit"; (2) a noisy room with an SF note + a dimension →
  name pre-fills clean. Lint is NOT a gate.
- Close with the `verify-feature` skill (its DoD/merge-gate), then **stop — do not commit or push until
  the owner says "Approved."**

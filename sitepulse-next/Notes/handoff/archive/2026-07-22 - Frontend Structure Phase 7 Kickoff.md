# Kickoff — Frontend Structure (W3), Phase 7 (FINAL, owner-approved): MobileSwipeDeck pure-logic extraction + tests

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 7 of Frontend Structure (W3)** — the owner-approved optional finale: extract the pure logic from `src/components/MobileSwipeDeck.tsx` (~614 lines, ZERO tests today — the mobile crew's primary input surface) into `src/utils/swipeDeck.ts` (+ `swipeDeck.test.ts`), leaving the framer-motion gesture wiring in the component. Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-22 - Frontend Structure Phase 7 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Frontend-Structure-Plan.md` (Phase 7 + "Pure logic to extract")
> - `sitepulse-next/AGENTS.md` §2/§6 (the `pendingChanges`/`pendingTimelineChanges` rules) and §3 (Container/Presenter, lazy-load)
>
> Branch off `main`, PR through CI. Build **only Phase 7**. ⛔ ZERO behavior change — extraction must be behavior-identical, and because this component feeds the IDB offline queue, **write the characterization tests FIRST** (pin today's behavior against the inline logic), then extract under green. No importer edits beyond `MobileSwipeDeck.tsx` itself, no `@ts-nocheck`/`@ts-ignore`/new `any`. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
On a phone, field crews update statuses by swiping location cards. That swipe deck is 614 lines mixing gesture animation with real decision logic — which card comes next, what undo/redo restores, how a swipe maps to a status change — and none of it has a single test. This phase separates the decision logic into a small pure module with tests, so the deck's behavior is pinned and future edits (or the framer-motion library updating) can't silently change what a swipe does to real project data. It closes the last test gap flagged by the 2026-07-15 review.

## Where the workstream stands
**W3 core (P1–P6) COMPLETE on main (P6 = #26 `fd35ac6`); JS→TS migration 100%; suite = 1428.** The data layer is ten domain files behind the `useProjectQueries` barrel; `statusWrite.ts` holds the write contract. This phase is independent of all of that — it touches ONLY `MobileSwipeDeck.tsx` + new `src/utils/swipeDeck.ts` (+ test). **Read `MobileSwipeDeck.tsx` fresh, top to bottom, before planning the extraction** — the scope below is from the plan, not from a recent read of the file.

## Scope (from the plan — verify each against the actual file)
Extract to pure `src/utils/swipeDeck.ts` (+ `swipeDeck.test.ts`), leaving JSX/framer-motion/gesture thresholds in the component:
1. **Deck ordering** — the `main` vs `skippedToBack` card queues (what "skip" does to the order, when the deck is exhausted, what re-entry looks like).
2. **Undo/redo pending-map reducer** — the deep-snapshot queues over `pendingChanges`/`pendingTimelineChanges` (AGENTS §6 notes `setPendingTimelineChanges` is exported precisely for this). Pure reducer in/out — the maps themselves STAY local `useState` in `useFieldData` (⛔ never migrate them to Zustand/Query — AGENTS §2).
3. **The swipe → status transition machine** — none→planned→ongoing→completed progression (and whatever choose-status branching exists) as a pure function.
Pass state IN, return new state OUT — no `Date.now()` inside (timestamps/`capturedAt` stay stamped at the call sites, capture-time rule).

## Guardrails
- ⛔ **Tests FIRST, then extract.** The deck's outputs feed `handleLocalUpdate`/`pendingChanges` → the IDB offline queue (AGENTS §2). Pin today's behavior with characterization tests against the extracted functions' expected outputs BEFORE swapping the component onto them; the full suite + the new tests stay green throughout.
- The component keeps: framer-motion wiring, gesture thresholds, layout/JSX, the lazy-load boundary (`next/dynamic`, `ssr: false` — do not disturb how it's imported by `FieldStatusTable`).
- `pendingChanges`/`pendingTimelineChanges` semantics byte-identical: project-scoped IDB keys untouched, `hasRehydrated` guard untouched, `capturedAt` stamping stays at capture time.
- Vitest conventions: import from `'vitest'` (globals OFF); `renderWithQuery` harness only if a component-level test is genuinely needed — prefer pure-function tests.
- ⚠️ dev:3010 → PROD Supabase. Live smoke on the throwaway "Test" project only (project `8796bbe0-…`); restore any status you change (P5's SQL-baseline recipe; unit `Up Dn` × Framing baseline: planned / #3b82f6 / 2026-01-15→2026-01-30 / null logged / null actual).

## Exit criteria (Definition of Done)
- Triple-green: typecheck / full suite (1428 + new) / build.
- `swipeDeck.test.ts` green, covering: skip-to-back ordering incl. exhaustion/wrap, undo→redo round-trip restores the exact pending maps, each status transition (and that a transition never fabricates dates — mirror the statusWrite rules if the deck stamps any).
- `git diff` touches ONLY `MobileSwipeDeck.tsx`, `src/utils/swipeDeck.ts`, `swipeDeck.test.ts` (+ this kickoff doc at commit).
- Live dev:3010 smoke at a mobile viewport (~390×844): swipe-right progression advances a card + stages a pending change, undo restores it, redo re-applies, choose-status works, `SyncIndicator` reflects pending→synced; apply + SQL-verify + restore the touched slot. No console errors.
- Close with **verify-feature**; present diff + flags; **STOP — no merge until the owner says "Approved."** After approval + merge: archive this kickoff, update [[frontend-structure-workstream]] to **W3 FULLY COMPLETE (P1–P7)**, and surface the post-W3 fix backlog as the next lane: (1) planned-date clearing on status taps (P5 discovery), (2) silent errors when toasts off, (3) N/A confirm mislabeled "Delete".

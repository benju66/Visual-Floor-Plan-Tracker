# Kickoff — Swipe Deck Excellence, Phase 2: fluid — flick to commit, instant directional exits, ghost-kill

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of Swipe Deck Excellence** — make the mobile field deck feel *fluid*: a quick flick commits (not just a 100px drag), swiped cards fly off **in the swipe direction immediately**, no dead "ghost" card lingers on top eating the next swipe, and the next card settles under the thumb fast. Nothing about WHAT a swipe stages changes — only when a gesture commits and how cards animate. Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-22 - Swipe Deck Excellence Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Swipe-Deck-Excellence-Plan.md` (Phase 2 + "Why this exists" + hard guardrails)
> - `sitepulse-next/AGENTS.md` (§2/§6 pendingChanges + staging rules, §3 lazy-load boundary)
>
> Branch off `main` (Phase 1 shipped as #28 `2b74952`). Build **only Phase 2**. ⛔ ZERO staging-semantics change — the 25 `swipeDeck.test.ts` characterization tests must stay green and untouched; new gesture logic is ADDITIVE (`resolveSwipeGesture` + its own new tests). ⛔ **Merge is gated on the OWNER's real-phone feel-check** — flick + exit speed are thumb judgments an emulator can't make. Don't commit or push until the owner says "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
Phase 1 made every card *swipeable* (no card can refuse a swipe anymore — the scroll-steal bug class is dead). Phase 2 makes swiping *feel instant*. Three owner-reported drags on the feel, diagnosed live 2026-07-22:
1. **No velocity flick.** `handleDragEnd` (SwipeCard.tsx) commits only when `info.offset.x` passes ±100px. A fast, short flick that doesn't travel 100px fails — the card springs back even though the user clearly threw it.
2. **Exits fade in place, not directional.** On a swipe, `MobileSwipeDeck` calls `setActionDirection('none')`, so the card `motion.div`'s exit variant (`x: dir === 'left' ? -300 : dir === 'right' ? 300 : undefined`) gets `undefined` — the card just fades/scales where it sits instead of flying off the way it was thrown.
3. **A lingering "ghost".** The dead card was measured on screen **1.5–3+ seconds** after release with `pointer-events` still live (the `layout` + `AnimatePresence popLayout` + spring interplay), and during that window it eats the next swipe.

## Scope (four items, all in the plan's Phase 2)
1. **Velocity flick** — add a PURE `resolveSwipeGesture(offsetX, velocityX, opts?) → 'left' | 'right' | null` to `src/utils/swipeDeck.ts` **with its own new tests** (extend `swipeDeck.test.ts`; the existing 25 stay untouched). Commit when `|offset| ≥ OFFSET_THRESHOLD` (100, unchanged) **OR** `|velocity| ≥ VELOCITY_THRESHOLD` (~500 px/s starting point, tune on-device) **with offset and velocity agreeing in sign** (a flick left while the card sits right of center must NOT commit right). Direction from offset sign when offset-committed, velocity sign when flick-committed. Thresholds are passed-in/defaulted constants — no `Date.now()`, fully deterministic. `handleDragEnd` consumes it; **haptics (`navigator.vibrate`) preserved**. Behavior is a **superset**: every gesture that commits today still commits.
2. **Directional, instant exits** — swiped cards fly off in the swipe direction (thread the real direction into the exit instead of `'none'`, or give the card its own exit-x). Exit becomes a short tween (**~0.18–0.22s**), and **exiting cards get `pointer-events: none`** so a dead card can never eat the next gesture.
3. **Kill the lingering ghost** — investigate the `layout` prop + `popLayout` + spring interplay on the card `motion.div`; make removal deterministic (hard-capped duration). **Re-measure** with the P7 instrumentation recipe (bounding-box + opacity polling) — the exiting card must be unmounted or pointer-inert within **~400ms** of release.
4. **Entry/settle tuning** — the next card's settle-under-thumb should feel immediate. Review the `entryDirection` spring (300/25) and the stack's `animate` transition; **tune, don't redesign.**

## Guardrails
- ⛔ The 25 `swipeDeck.test.ts` tests stay green and UNTOUCHED — they pin staging semantics. `resolveSwipeGesture` and its tests are ADDITIVE. A red existing test means the change altered decision logic, not feel: fix the change, never the test.
- The Timeline overlay's scroll + `onPointerDownCapture` stopPropagation stays (deliberate scroll surface).
- MobileSwipeDeck stays lazy-loaded (`next/dynamic`, `ssr: false`) via FieldStatusTable — do not disturb the import boundary.
- No `Date.now()` in pure functions (thresholds/inputs passed in). No `@ts-nocheck`/new `any`; Tailwind utilities only.
- framer-motion is **^12.38.0** — `onDragEnd`'s `info.velocity.x` is available; verify APIs against the installed version before use.
- ⚠️ dev:3010 → PROD Supabase: click-throughs stage-and-discard only (never Apply on real projects).

## Exit criteria (Definition of Done)
- Triple-green: typecheck / full suite (**1453 + the new `resolveSwipeGesture` tests** — count goes UP by the new tests only) / build.
- New `resolveSwipeGesture` tests green: offset-only commit, velocity-only flick commit, sign-disagreement → null, sub-threshold both → null, boundary values.
- Live dev:3010 instrumentation shows exiting cards unmounted (or pointer-inert) within **~400ms** of release.
- ⛔ **Owner real-phone feel-check:** the owner flicks and swipes long-named cards on their actual phone and confirms it feels "bulletproof and fluid" — flick commits, exits are immediate + directional, no ghost. Their word decides.
- Close with **verify-feature**; present diff + flags; STOP — no commit/push until "Approved." On close: **archive the Phase 1 kickoff** (`2026-07-22 - Swipe Deck Excellence Phase 1 Kickoff.md` → `handoff/archive/`) and this one alongside the merge, since Phase 2 completes the workstream.

## Open decisions (owner's thumb is the judge)
- **Velocity threshold** (~500 px/s starting point) — tuned on-device.
- **Whether `chooseStatusState` is deleted** from `swipeDeck.ts` once confirmed unconsumed — flagged in Phase 1; resolve here if the P7 suite is revised (cosmetic).

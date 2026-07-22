# Swipe Deck Excellence — bulletproof + fluid mobile swipe cards (self-contained build plan)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: follows W3 Frontend Structure P7 (the swipeDeck.ts pure-logic extraction, PR #27 `418916b`) — this plan touches the GESTURE/ANIMATION layer P7 deliberately left alone.

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants — §2/§6 `pendingChanges` offline-queue rules, §3 Container/Presenter + MobileSwipeDeck lazy-load).
2. Re-read the files named below fresh — do not trust line numbers; they drift.
3. Build the sub-phases in order. Verify after each (§ verification).
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence plain-English summary; explain jargon in passing; keep it short.

## Goal
On a phone, every card in the field deck swipes on the first try, every time — no card can silently refuse a swipe — and swiping feels instant: a quick flick commits, the card flies off in the swipe direction immediately, and the next card is ready under the thumb with no dead ghost lingering on top. Nothing about WHAT a swipe stages changes; only how the gesture and animation feel.

## Why this exists (owner-reported, 2026-07-22, real-phone use)
1. **A card can refuse to swipe** ("114 Housekeeping" in Orchard Path III, reproducibly): the card face's middle region is `overflow-y-auto` + `touch-pan-y` (SwipeCard.tsx, the `flex-1` face div). On cards whose text overflows (long wrapped location name + long activity name) that region becomes a live scroll zone, the mobile browser claims diagonal thumb swipes as scrolls and fires `pointercancel` mid-drag — the card moves slightly then springs back. **Touch-only: synthetic mouse drags bypass `touch-action` entirely, so this is invisible to automated testing** (proven during diagnosis — automation could not reproduce what the owner's thumb hit immediately).
2. **Swipes feel slow**: (a) no velocity flick — `handleDragEnd` commits on `info.offset.x` ±100px only, so a fast short flick fails; (b) swiped cards exit by fading IN PLACE (`actionDirection` is set to `'none'` on swipes, so the exit variant's `x` is undefined) and the dead card was measured lingering on screen **1.5–3+ seconds** with `pointer-events` still active (AnimatePresence `popLayout` + `layout` + spring interplay) — during that window it eats the next swipe.
3. **Dead code found during diagnosis**: `SwipeCard` receives `onChooseStatus` but renders NO trigger for it — the activity-picker shortcut is unreachable on mobile and has been for some time. Owner decided: delete it (Timeline covers the job).

## Out of scope / deferred
- **No staging-semantics changes.** What a swipe stages (nextSwipeState, buildHistoryEntry, undo/redo restores) is pinned by `src/utils/swipeDeck.test.ts` (25 tests, W3 P7) and MUST NOT change. This plan changes when a gesture COMMITS and how cards ANIMATE — never what a commit does.
- The other post-W3 fixes are a separate workstream: planned-date clearing on status taps (useMapActions), silent errors when toasts off, N/A confirm mislabeled "Delete".
- No changes to `useFieldData`, the offline queue, `pendingChangesStore`, or the Apply path.
- No redesign of the card's information layout beyond making it fit (owner-locked below).

## Locked product decisions (from the owner, 2026-07-22)
- **Card faces always fit — never scroll.** Long names shrink/clamp to fit; the face's scrollable middle region is REMOVED entirely (and with it `touch-pan-y`). Full per-activity detail stays one tap away in the Timeline overlay. This eliminates the scroll-steal bug class outright.
- **Timeline is the one path for cross-activity updates.** The dead `onChooseStatus` wiring is deleted end-to-end (no new tap target).
- **"Bulletproof and fluid"** is the bar: swipe must win the gesture war on every card; a flick must commit; exits must be immediate and directional.

## Data model
None. No tables, columns, RPCs, or migrations. All writes continue to flow through the untouched staging → Apply pipeline (AGENTS §2).

## Build-on inventory (read these fresh before using)
- **`src/components/SwipeCard.tsx`** (~560 lines) — the gesture/animation home. Key structures: the drag `motion.div` (drag='x', `dragConstraints {0,0}`, `dragElastic 0.7`, `onDragEnd` with ±100px offset thresholds, `layout`, exit variant keyed on the deck's `actionDirection` custom); the face div (`flex-1 … overflow-y-auto no-scrollbar touch-pan-y overscroll-contain`) holding type badge, `text-5xl/6xl` unit number, Current Activity block, STATUS radio row; the bottleneck banner; the Timeline button; the Timeline overlay (its own `overflow-y-auto` — that one is CORRECT and stays, it's a deliberate scroll surface with `onPointerDownCapture` stopPropagation); the `entryDirection` effect (`x.set(±300)` + spring on actionDirection changes).
- **`src/components/MobileSwipeDeck.tsx`** (~513 lines) — deck state + wiring onto the P7 pure module; `actionDirection` state drives both entry animation and the `AnimatePresence mode="popLayout" custom={…}` exit variant; swipes call `setActionDirection('none')` (why exits fade in place today). `onChooseStatus` prop threads through here — part of the deletion.
- **`src/utils/swipeDeck.ts` + `.test.ts`** (W3 P7, 25 tests) — the deck's DECISION logic and its characterization net. New gesture-commit logic belongs HERE as a pure function, not inline in the component.
- **`framer-motion`** — check the installed version in `sitepulse-next/package.json` before using APIs; `onDragEnd`'s `info.velocity.x` is available across modern versions.
- The `onChooseStatus` chain to delete: grep `onChooseStatus` / `ChooseStatus` across `SwipeCard.tsx`, `MobileSwipeDeck.tsx`, `FieldStatusTable.tsx`, and the project page — remove the dead limbs only; the desktop StatusTrigger path is separate and stays.

## Pure logic to extract + unit-test
- **`resolveSwipeGesture(offsetX, velocityX, opts?) → 'left' | 'right' | null`** in `src/utils/swipeDeck.ts` (+ tests in the existing suite): commit when |offset| ≥ OFFSET_THRESHOLD (100, unchanged) **OR** |velocity| ≥ VELOCITY_THRESHOLD (~500 px/s — tune on-device) *with offset and velocity agreeing in sign* (a flick left while the card sits right of center must not commit right). Direction from offset sign when offset-committed, velocity sign when flick-committed. Thresholds passed in/defaulted as constants — no environment reads, fully deterministic tests: offset-only commit, velocity-only flick commit, sign-disagreement → null, sub-threshold both → null, boundary values.

## Sub-phasing (ship + verify each)

### Phase 1 — Bulletproof: no card can refuse a swipe
- **Scope:**
  1. **Fit-always face** (SwipeCard.tsx): remove `overflow-y-auto no-scrollbar touch-pan-y overscroll-contain` from the face div. Make the content guaranteed to fit at small phone heights: clamp the unit number (e.g. `line-clamp-2` + a reduced size step for long names — the current `text-5xl sm:text-6xl` is the main overflow driver) and the activity name (`line-clamp-2`); verify the face lays out at 320×568 (smallest common viewport) with the longest real names (use "114 Housekeeping" / "Punch List Completed" as the fixture). The Timeline overlay's own scroll area is untouched.
  2. **Delete the dead choose-status wiring** end-to-end (SwipeCard prop/type, MobileSwipeDeck prop + `chooseStatusState` call site, FieldStatusTable/page chain as grep dictates). ⚠️ `chooseStatusState` stays in `swipeDeck.ts` (it is test-pinned and harmless — annotate it as currently unconsumed rather than deleting, to keep the P7 test suite intact; flag for later removal).
  3. Verify no other `touch-action` landmines on the deck path (grep `touch-pan` under src/components).
- **Approval gates:** ⛔ **Owner real-phone verification REQUIRED before merge** — synthetic input cannot validate `touch-action` behavior (proven). The owner must swipe "114 Housekeeping" (Orchard Path III, Level 1) and a handful of long-named cards on their actual phone and confirm first-try swipes. Standing rules: branch off main, no commit/push until "Approved."
- **Exit criteria:** typecheck + full suite (1453, incl. the 25 swipeDeck tests untouched-and-green) + build · live dev:3010 at 390×844 AND 320×568: longest-name cards fit with no scrollbar and swipe cleanly · owner phone check passes · close with verify-feature.

### Phase 2 — Fluid: flick to commit, instant directional exits
- **Scope:**
  1. **Velocity flick**: add `resolveSwipeGesture` (§ pure logic) to `swipeDeck.ts` + tests; `handleDragEnd` consumes it (haptics preserved). Behavior superset: every gesture that commits today still commits.
  2. **Directional, instant exits**: swiped cards fly off in the swipe direction — thread the direction into the exit (today `setActionDirection('none')` on swipes makes exits fade in place; either pass a real direction or give the card its own exit-x). Exit becomes a short tween (~0.18–0.22s), and **exiting cards get `pointer-events: none`** so a dead card can never eat the next gesture.
  3. **Kill the lingering ghost**: the measured 1.5–3s+ zombie exit — investigate the `layout` prop + `popLayout` + spring interplay on the card `motion.div`; the fix must make removal deterministic (hard-capped duration). Re-measure with the P7 instrumentation recipe (bounding-box + opacity polling).
  4. **Entry/settle tuning**: next card's settle-under-thumb should feel immediate (review the `entryDirection` spring 300/25 and the stack's animate transition) — tune, don't redesign.
- **Approval gates:** ⛔ Owner real-phone feel-check before merge (flick + exit speed are feel judgments; emulator ≠ thumb). Standing rules apply.
- **Exit criteria:** typecheck + full suite (1453 + new gesture tests) + build · new `resolveSwipeGesture` tests green · dev:3010 instrumentation shows exiting cards unmounted (or pointer-inert) within ~400ms of release · owner phone feel-check passes ("bulletproof and fluid" is their call) · close with verify-feature.

## Hard guardrails (AGENTS.md — do not violate)
- `pendingChanges`/`pendingTimelineChanges` stay local `useState` in `useFieldData`; staging semantics byte-identical — the 25 P7 characterization tests are the tripwire; if one goes red, the change altered decision logic, not feel: fix the change, never the test.
- The Timeline overlay's scroll + `onPointerDownCapture` stopPropagation stays (deliberate scroll surface).
- MobileSwipeDeck stays lazy-loaded (`next/dynamic`, `ssr: false`) via FieldStatusTable — do not disturb the import boundary.
- No `Date.now()` in pure functions — thresholds and inputs passed in.
- No `@ts-nocheck`/`@ts-ignore`/new `any`; derive types from domain.ts.
- ⚠️ dev:3010 → PROD Supabase: click-throughs stage-and-discard only (never Apply on real projects); the owner's phone checks read/stage only — anything they Apply is their own real field data, their call.

## Verification commands (the exit-criteria gate)
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
Lint is NOT a gate (~1850 pre-existing). Live checks via `npm run dev:3010` at mobile viewports; **real-phone verification is a hard gate in BOTH phases** (touch-action and feel are not emulatable).

## Open decisions
- **Velocity threshold value** (~500 px/s starting point) — tuned on-device in Phase 2; owner's thumb is the judge.
- **Whether `chooseStatusState` is deleted from `swipeDeck.ts`** once its last consumer is gone — flagged in Phase 1, resolved whenever the P7 test suite is next revised (cosmetic).

# Kickoff — Swipe Deck Excellence, Phase 1: no card can refuse a swipe (fit-always faces + dead-wiring removal)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Swipe Deck Excellence** — make the mobile swipe cards bulletproof: remove the card face's scrollable middle (the `touch-pan-y` region that lets the phone browser steal swipes as scrolls on tall-content cards like "114 Housekeeping"), make card text always fit via clamping, and delete the dead `onChooseStatus` wiring end-to-end. Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-22 - Swipe Deck Excellence Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Swipe-Deck-Excellence-Plan.md` (Phase 1 + "Why this exists" + guardrails)
> - `sitepulse-next/AGENTS.md` (§2/§6 pendingChanges rules, §3 lazy-load boundary)
>
> Branch off `main`. Build **only Phase 1**. ⛔ ZERO staging-semantics change — the 25 `swipeDeck.test.ts` characterization tests must stay green untouched; this phase is layout/CSS + dead-code deletion only. ⛔ **Merge is gated on the OWNER's real-phone check** (synthetic input bypasses `touch-action` — automation cannot verify this fix). Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
On the owner's real phone, the card "114 Housekeeping" (Orchard Path III) repeatedly refused to swipe — it moved slightly and snapped back. Root cause (diagnosed live 2026-07-22): the card face's middle region is scrollable (`overflow-y-auto` + `touch-pan-y` — SwipeCard.tsx, the `flex-1` face div). On cards whose long names overflow, the browser claims diagonal thumb swipes as scrolls and cancels the drag mid-gesture. Owner's locked decision: card faces **always fit and never scroll** — clamp the text, delete the scroll region, and the whole bug class dies. Detail stays one tap away in the Timeline overlay. Also found during diagnosis: `SwipeCard` receives `onChooseStatus` but renders no trigger — a dead activity-picker shortcut. Owner: delete it (Timeline covers the job).

## Scope (three items, all in the plan's Phase 1)
1. **Fit-always face** (`src/components/SwipeCard.tsx`): remove `overflow-y-auto no-scrollbar touch-pan-y overscroll-contain` from the face div; clamp the unit number (size-step + `line-clamp-2` — `text-5xl/6xl` is the overflow driver) and activity name (`line-clamp-2`); prove fit at 320×568 with the longest real fixtures ("114 Housekeeping" / "Punch List Completed"). Timeline overlay's own scroll area untouched (deliberate scroll surface with pointer capture — keep).
2. **Delete dead `onChooseStatus` wiring** end-to-end: grep the chain (`SwipeCard.tsx` prop/type → `MobileSwipeDeck.tsx` prop + its `chooseStatusState(...)` call site → `FieldStatusTable.tsx` → page). Desktop StatusTrigger is a separate path — untouched. ⚠️ Keep `chooseStatusState` in `swipeDeck.ts` (test-pinned; annotate as currently unconsumed, flag for later removal).
3. Grep `touch-pan` under `src/components` for any other deck-path landmines; report findings.

## Guardrails
- ⛔ The 25 `swipeDeck.test.ts` tests stay green and UNTOUCHED — they pin staging semantics this phase must not alter. A red test means the change went beyond layout: revert the change, never edit the test.
- MobileSwipeDeck's `next/dynamic` `ssr: false` import boundary untouched.
- No new `any`/`@ts-nocheck`; Tailwind utilities only (no custom CSS files).
- ⚠️ dev:3010 → PROD Supabase: stage-and-discard only, never Apply on real projects.

## Exit criteria (Definition of Done)
- Triple-green: typecheck / full suite (1453 — no count change expected beyond deletions) / build.
- Live dev:3010 at **390×844 AND 320×568**: the longest-name cards render fully with no scrollable face, and drag-swipes work (mouse-level sanity only — see the gate).
- Diff touches only `SwipeCard.tsx`, `MobileSwipeDeck.tsx`, and the dead-wiring files grep dictates (+ this kickoff at commit).
- ⛔ **Owner real-phone gate:** before merge, the owner swipes "114 Housekeeping" (Orchard Path III, Level 1) and several long-named cards on their actual phone — first-try swipes, no snap-backs. Their word decides.
- Close with **verify-feature**; present diff + flags; STOP — no commit/push until "Approved." After approval + merge, draft the Phase 2 kickoff (fluid: velocity flick + instant directional exits + ghost-kill) per the handoff ritual.

# Kickoff — Trace Naming & Type Assist, Phase 3: font-size signal (lever B) — *build only if needed*

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3 of Trace Naming & Type Assist** (lever B — use the **biggest text inside the
> room** as the strongest "which words are the name" signal). **FIRST CONFIRM THIS PHASE IS WANTED:**
> it's gated — we build it only if, after living with Phases 1–2, room **names** still come out wrong
> often enough to justify backend re-extraction. If names are good, we SKIP to Phase 4 (wire the brain
> onto the project map). This phase touches the backend extractor **and re-processes stored `sheet_text`
> for every existing sheet → that backfill is an APPROVAL GATE** (never run a write/backfill against
> real rows without an explicit go-ahead). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-28 - Trace Naming & Type Assist Phase 3 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Trace-Naming-Type-Assist-Plan.md` (§ Phase 3, + Data model + guardrails)
> - `sitepulse-next/AGENTS.md` (esp. §6 JSONB/IDB, §7 backend auth/timeouts, §9 testing)
>
> Branch off `main` once Phase 2 (PR #3 — `feat/trace-naming-type-assist-phase-2`) is merged. Build
> **only Phase 3**. Don't commit or push until I say "Approved", and **do not run the backfill until I
> explicitly approve running it against real data**.

---

> Context for the session (the detail the launch prompt points at).

## ⚠️ Decision gate — read first
Phase 3 is **planned, not promised** (plan § Open decisions). The whole point of shipping Phases 1–2
first was to see whether the deterministic rules + learned vocabulary already pre-fill clean names. So
before writing any code:
1. **Live with Phases 1–2.** Trace real rooms. Are the *names* (not types — that's C/D2) still pulling
   in the wrong words on noisy sheets where the room label is simply the biggest text?
2. If names are reliably clean → **skip Phase 3 entirely** and go to Phase 4 (project-map wiring — pure
   wiring of the finished brain, no new logic, no backend, no backfill).
3. Only if names still need help is lever B worth the backend re-extraction + backfill cost.

## Where we are
- **Phase 1 (A + D1) SHIPPED to main** (PR #2, `d17831d`).
- **Phase 2 (C + D2) BUILT + APPROVED**, on branch `feat/trace-naming-type-assist-phase-2` (`0ac4517`,
  **PR #3 open** — merge left to the owner since it deploys to prod). Company-wide learning via a
  client-side paginated `units` read (no migration); `ROOM_TEXT_MODEL_VERSION` is `text-prefill-v3`.
- Phase 3 is the next slice in `Notes/plans/Trace-Naming-Type-Assist-Plan.md`.

## What this phase is
The single strongest "which text is the name" signal: **on a real sheet, the room name is the biggest
text inside the room.** Phases 1–2 use position + pattern + learned frequency but are blind to font
size. Lever B keeps each extracted word's normalized **height** and lets `matchRoomName` prefer the
largest-text line when size is present — and behave EXACTLY as today when it's absent (old cached rows,
scanned sheets).

## Required reading (in order)
1. `sitepulse-next/AGENTS.md` — **§6** (the `TextWord` shape flows through the IDB cache — the new size
   field must keep it plain-JSON; narrow at the query boundary), **§7** (backend auth is JWKS/ES256;
   Supabase client timeouts; no debug file writes), **§9** (testing — both frontend Vitest and backend
   pytest).
2. `sitepulse-next/Notes/plans/Trace-Naming-Type-Assist-Plan.md` — **§ Phase 3**, plus **§ Data model**
   (Phase 3 is a JSON *shape* change, **NOT DDL** — no migration) and **§ Hard guardrails**.
3. Re-read these source files **fresh** (line numbers drift):
   - `sitepulse-backend/main.py` — `extract_text_from_pdf` (the PyMuPDF word extractor that writes
     `sheet_text`). Keep each word's normalized height `(y1 - y0)` alongside the existing center point.
   - `sitepulse-backend/backfill_text.py` — the existing re-extraction script (reuse it to backfill the
     size onto already-cached `sheet_text` rows).
   - `sitepulse-next/src/types/domain.ts` — `TextWord` (+ `isTextWordArray`). Add an **optional** size
     field; the guard must accept rows WITHOUT it (old cached rows stay valid).
   - `sitepulse-next/src/utils/roomNameMatch.ts` — `matchRoomName`: prefer the largest-text line when
     size is present; identical to Phase 1/2 when absent. It already takes the optional Phase-2
     `knownNameTokens` — thread size in alongside without breaking that.
   - `sitepulse-next/src/hooks/useSheetText.ts` — the read path that narrows `sheet_text.text`; make
     sure the new optional field survives the narrow.

## Scope (build only this)
- **Backend:** `extract_text_from_pdf` keeps a per-word normalized height; the write-through into
  `sheet_text` includes it. Backend test/extraction sanity on a sample PDF (pytest, hermetic — §9).
- **Frontend type + guard:** `TextWord` gains an **optional** size field; `isTextWordArray` tolerates
  its absence (old rows valid). No raw `Json` into props.
- **Matcher:** `matchRoomName` prefers the largest-text line when size is present; **byte-identical
  behavior when absent** (covered by the existing Phase-1/2 tests + new size-present tests).
- **Backfill (GATED):** re-extract existing sheets via `backfill_text.py` so cached rows gain the size.
  **Present the backfill plan and STOP for explicit owner go-ahead before running it against real data.**
- Bump `ROOM_TEXT_MODEL_VERSION` → `text-prefill-v4`.

## Guardrails / do-not
- **No migration / no DDL** — `sheet_text.text` is already JSONB; this is a payload shape change only.
- **Backfill = approval gate** — re-running extraction touches stored data for every existing sheet.
  Get explicit go-ahead first ([[no-live-write-probes]]: never run write probes against prod rows blindly).
- **Backward compatible** — old cached rows (no size) and scanned sheets (no text) must keep working;
  size-absent path is exactly Phase 1/2.
- **No `Map`/`Set`** in the cache path (§6); keep `TextWord` plain JSON.
- **Geometry untouched** (`method` stays `'manual'`); keep training capture intact; the version bump is
  required so old/new suggestions stay distinguishable at training time.
- **Backend §7** — don't touch the JWKS/ES256 auth, the Supabase client timeouts, or write debug files.

## Exit criteria (Definition of Done → then STOP)
Run from repo root with absolute prefix:
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck`
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test`
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build`
- Backend: `python -m pytest -q` from `sitepulse-backend/` + extraction sanity on a sample PDF.
- `matchRoomName` tests cover **both** size-present (prefers the biggest-text line) and size-absent
  (unchanged) paths; `isTextWordArray` accepts rows with and without the size field.
- Backfill plan presented; **run only after explicit approval**, then spot-check a re-extracted sheet
  live on `dev:3010`.
- Close with the `verify-feature` skill, then **stop — do not commit or push until "Approved."**

## After this (or instead of this)
**Phase 4 — extend the assist to the project map (draw flow) + capture.** Pure wiring of the finished
brain onto `src/app/project/[projectId]/page.jsx` (`handlePolygonComplete`) + `useMapActions.createUnit`
(same `method:'manual'` / `ai_accepted`/`ai_edited` / frozen `suggested_label` / `trace_events`
provenance the workbench writes). No new logic, no migration. If Phase 3 is skipped, Phase 4 is the
direct next build.

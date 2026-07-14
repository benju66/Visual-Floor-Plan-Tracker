# Kickoff — Vector Payload Cap, Phase 1: cap dense-sheet extraction so the snapping cache always saves

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Vector Payload Cap** (backend-only: cap `extract_vectors_from_pdf` output at 40k longest segments + store rounded coords, so dense sheets fit the 8s DB write limit). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-14 - Vector Payload Cap Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Vector-Payload-Cap-Plan.md` (the whole plan — it is one phase)
> - `sitepulse-next/AGENTS.md` (§5, §7, §9)
>
> Branch off `main`. Backend only — `sitepulse-backend/main.py` + a new test file; zero frontend edits, no migrations. ⛔ The optional empirical check against the prod dense sheet is READ-ONLY — never write anything to prod. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## What this is
The one remaining real defect from the 2026-07-14 backlog verification: a pathologically dense drawing (~66k line segments) produces a `sheet_vectors` payload too large to save within the database's 8-second `statement_timeout` (a DB-side role setting — it is NOT in repo code, confirmed live on prod 2026-07-14: `authenticated`/`authenticator` = 8s). The save fails non-fatally (and since `e1a6401` is at least logged), so wall-snapping falls back to slow re-extraction on every visit. Nothing is failing on prod today — all dense sheets are cached — so this is proactive: it makes the failure impossible for the next dense upload.

## Scope (one session)
1. In `sitepulse-backend/main.py`:
   - Add `VECTOR_CAP_LINES` (env-overridable int, default **40000**, mirroring the `MAX_UPLOAD_MB` pattern).
   - Add pure `cap_vector_payload(lines, width, height, cap)` — under cap: return unchanged; over cap: keep the `cap` longest segments (length in PDF points via pct deltas × page dims, aspect-correct like the `MIN_SEGMENT_PTS` filter), tie-break by original index, preserve original order.
   - Call it as the final step of `extract_vectors_from_pdf`, and print `[INFO] vector payload capped: kept {cap} of {n} lines` when it engages.
   - Store the **5-decimal-rounded** coordinates in the returned lines (today rounding exists only in the dedupe key; the stored floats are full precision — keep original start→end orientation).
2. New `sitepulse-backend/tests/test_vector_extraction.py`, mirroring `tests/test_text_extraction.py`'s in-memory-fitz style: pure-helper tests (passthrough, longest-kept, order, tie-break, aspect-correctness) + one integration test through `extract_vectors_from_pdf` with a small cap.
3. Optional but recommended: READ-ONLY empirical check — download `originals/fd66ff07-2bdd-4ab7-8e40-c4120f027d7e.pdf` from the public `floorplans` bucket, run the new extractor locally (root `venv`), report final count + JSON size. ⛔ **No prod writes of any kind** (standing no-live-write-probes rule).

## Why the cap lands in extract_vectors_from_pdf (not the call sites)
Its return value feeds all three backend cache writes (`/upload-and-convert`, `/attach-original`, `/extract-vectors/{sheet_id}`) AND the API response the frontend write-through caches — one change covers every path. Do not duplicate the cap anywhere else.

## Guardrails (beyond AGENTS.md)
- Keep all three `sheet_vectors` upserts non-fatal with their existing `[WARN]` log lines — that logging is the detection layer.
- Do not touch `MIN_SEGMENT_PTS = 1.0`, the `SafeClientOptions` 25s client timeouts, or anything in `sitepulse-next/`.
- No DB migration, no RLS change, no attempt to alter the DB `statement_timeout`.

## Exit criteria (then stop)
- `python -m pytest -q` green from `sitepulse-backend/` (all suites).
- Report to the owner in plain English: what changed, test results, and (if run) the empirical numbers for the known dense sheet — if the capped payload still looks big (>~4 MB), flag it and ask before changing the default; don't silently retune.
- Close with the `verify-feature` skill. Do NOT commit or push until the owner says "Approved" (a push to main auto-deploys the backend on Render; after deploy, confirm service health).

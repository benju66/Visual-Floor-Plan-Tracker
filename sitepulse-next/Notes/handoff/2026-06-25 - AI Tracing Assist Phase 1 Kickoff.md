# Kickoff — AI Tracing Assist, Phase 1: `sheet_text` extraction + cache

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of AI Tracing Assist** (extract a sheet’s PDF text words into a cached `sheet_text` table — the free naming source for auto-tracing). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-25 - AI Tracing Assist Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/AI-Tracing-Assist-Plan.md` (Phase 1)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 1**. ⛔ This phase has a DB migration: generate the `sheet_text` SQL via the `create-migration` skill, show me the exact SQL, and **STOP for my approval before applying** — never touch production data without my go-ahead. Don’t commit or push until I say “Approved.”

---

## Context for the session

### What this phase delivers (plain English)
Most of the floor-plan PDFs in the workbench have a searchable text layer — the room
numbers and names are real text, not just pixels. This phase pulls those words out of a
sheet’s PDF (with their on-page positions) and caches them, so a later phase can read a
room’s name straight off the drawing for free. Nothing user-visible yet — it’s the data
plumbing the “Auto-trace sheet” feature will name rooms from.

### Required reading (in order)
1. `sitepulse-next/AGENTS.md` — esp. §4/§6 (schema → `database.types.ts` → `domain.ts`),
   §5 (the `sheet_vectors` write-through cache pattern you’re mirroring), §7 (backend
   auth/timeout/exception rules), §9 (pytest conventions).
2. `sitepulse-next/Notes/plans/AI-Tracing-Assist-Plan.md` — Phase 1 scope + Data model.
3. Parent specs: `docs/ai-tracing-pipeline-plan.md` (M2.1) + `docs/ANNOTATION_SPEC.md`.

### Re-read these real files before editing (don’t trust line numbers)
- `sitepulse-backend/main.py` — `extract_vectors_from_pdf` + its `map_point()` PDF→percent
  transform (REUSE `map_point` so words land in the same percent space as vectors/polygons);
  the `sheet_vectors` write-through endpoint; `get_current_user` + `verify_sheet_access`.
- `sitepulse-backend/backfill_vectors.py` — the one-off backfill script to model `backfill_text.py` on.
- `sitepulse-next/supabase/migrations/20260625_trace_capture.sql` and any `sheet_vectors`
  migration — the idempotent + RLS style to mirror.
- `sitepulse-next/src/types/database.types.ts` + `domain.ts` — where the new table’s types go.

### Scope (build ONLY this)
1. **Migration `sheet_text`** (⛔ gate): 1:1 cache keyed by `sheet_id` (FK → `sheets`,
   `ON DELETE CASCADE`), a `text` JSONB column holding `[{ text, pctX, pctY }]`, standard
   timestamps. RLS mirrors `sheet_vectors` (read = project member; write = service-role/
   privileged, same as the vectors cache). Idempotent (`IF NOT EXISTS`, `pg_policies`
   guards). **Generate via the `create-migration` skill, show the SQL, STOP.**
2. **Endpoint `/extract-text/{sheet_id}`**: `Depends(get_current_user)` + `verify_sheet_access`;
   download the original PDF; in `asyncio.to_thread`, run PyMuPDF `page.get_text("words")`,
   map each word’s position through `map_point` → `{ text, pctX, pctY }`; write-through to
   `sheet_text` (like the vectors endpoint). Empty text (scanned PDF) → cache an empty list,
   not an error.
3. **`backfill_text.py`**: one-off, modeled on `backfill_vectors.py`.
4. **Types:** add `sheet_text` to `database.types.ts` (Tables) + derive in `domain.ts`.
5. **Tests (pytest):** the percent mapping (tiny fixture) + the empty-text path.

### Out of scope (later phases)
Room geometry/proposal (Phase 2), any UI (Phase 3), Claude typing (Phase 4). Do not build
a frontend read hook yet — Phase 2/3 will add it when they consume the cache.

### Exit criteria (Definition of Done → then stop)
- ⛔ Migration SQL shown and **approved by the owner** before applying; applied via the
  Supabase tooling only after “go”; `database.types.ts` regenerated/synced + `domain.ts` derived.
- `python -m pytest -q` green (from `sitepulse-backend/`); frontend `npm run typecheck` green.
- Endpoint returns located words for a real vector sheet and `[]` for a scanned one.
- Close with the **`verify-feature`** skill (run its Definition-of-Done checklist, then STOP).
- **Do not commit or push until the owner says “Approved.”** Then the owner (or you, on
  approval) drafts the Phase 2 kickoff and pastes its launch prompt.

### Guardrails specific to this phase
- Backend: PyJWT only, no `supabase.auth.get_user()`, keep the 25s client timeouts, no
  debug file writes (PII), wrap handlers in the standard try/except (AGENTS.md §7).
- Schema → types: never hand-duplicate a table shape; derive from `database.types.ts` (§6).
- Mirror `sheet_vectors` exactly — this is a cache, not a new concept. Don’t invent a
  different shape or RLS posture.

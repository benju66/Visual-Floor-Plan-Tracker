# Kickoff — AI Tracing Assist, Phase 1: `sheet_text` extraction + cache

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of AI Tracing Assist** (extract a sheet’s PDF text words into a cached `sheet_text` table — the free foundation that every later capture tool names rooms / reads labels from). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-25 - AI Tracing Assist Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/AI-Tracing-Assist-Plan.md` (Phase 1 + Data model + Build-on inventory)
> - `sitepulse-next/AGENTS.md`
>
> Work on branch `claude/ai-location-tracing-pipeline-ip709o` (it currently equals `main` — confirm with `git status` before starting). Build **only Phase 1**. ⛔ This phase has a DB migration: generate the `sheet_text` SQL with the `create-migration` skill, show me the exact SQL, and **STOP for my approval before applying** — never touch production data without my go-ahead. Don’t commit or push until I say “Approved.”

---

## Context for the session

### What this phase delivers (plain English)
Most of the workbench’s floor-plan PDFs have a real, searchable text layer — the room
numbers, names, sheet titles, and grid labels are actual text, not just pixels. This
phase pulls those words out of a sheet’s PDF along with each word’s position on the page,
and caches them. Nothing is user-visible yet — it’s the data plumbing that the next phases
use to auto-fill room names, read the title block, and label gridlines. It deliberately
mirrors the existing wall-vector cache, so it’s a small, well-trodden pattern, not a new concept.

### Required reading (in order)
1. `sitepulse-next/AGENTS.md` — esp. §4/§6 (schema → `database.types.ts` → `domain.ts`),
   §5 (the `sheet_vectors` write-through cache pattern you are mirroring), §7 (backend
   auth / timeout / exception rules), §9 (pytest conventions).
2. `sitepulse-next/Notes/plans/AI-Tracing-Assist-Plan.md` — read **Phase 1**, the **Data
   model** section (the `sheet_text` shape), the **Build-on inventory**, and **Pure logic
   to extract + unit-test**.
3. Parent specs: `docs/ai-tracing-pipeline-plan.md` (M2.1 + Feasibility findings) +
   `docs/ANNOTATION_SPEC.md`.

### Re-read these real files before editing (don’t trust line numbers — they drift)
- `sitepulse-backend/main.py` — `extract_vectors_from_pdf` and its **`map_point()`**
  PDF→percent transform (REUSE `map_point` verbatim so words land in the SAME percent space
  as vectors/polygons); the `sheet_vectors` write-through endpoint (your template); the
  `get_current_user` auth dep + `verify_sheet_access`.
- `sitepulse-backend/backfill_vectors.py` — model `backfill_text.py` on this one-off script.
- The `sheet_vectors` migration + `sitepulse-next/supabase/migrations/20260625_trace_capture.sql`
  — the idempotent + RLS style to mirror (DO-block policy guards, scalar `(SELECT auth.uid())`).
- `sitepulse-next/src/types/database.types.ts` + `domain.ts` — where the new table’s types go.

### Scope — build ONLY this
1. **Migration `sheet_text`** (⛔ gate): a 1:1 cache keyed by `sheet_id` (FK → `sheets`,
   `ON DELETE CASCADE`), a `text` JSONB column holding `[{ text, pctX, pctY }]` (word +
   its position in percent space), standard timestamps. **RLS mirrors `sheet_vectors`**
   (read = any authenticated project member; write = owner/admin/pm). Idempotent
   (`IF NOT EXISTS`, `pg_policies` guards). **Generate via the `create-migration` skill,
   show the SQL, and STOP for approval.** Apply via the Supabase tooling only after “go.”
2. **Endpoint `/extract-text/{sheet_id}`**: `Depends(get_current_user)` + `verify_sheet_access`;
   download the original PDF; inside `asyncio.to_thread`, run PyMuPDF `page.get_text("words")`,
   map each word’s position through `map_point` → `{ text, pctX, pctY }`; write-through to
   `sheet_text` (exactly like the vectors endpoint). Empty text (a scanned PDF) → cache an
   empty list and flag for OCR later; it is NOT an error.
3. **`backfill_text.py`** — one-off backfill, modeled on `backfill_vectors.py`.
4. **Types:** add `sheet_text` to `database.types.ts` (Tables block) + derive in `domain.ts`
   (`Database['public']['Tables']['sheet_text']['Row']`), narrowing the JSONB if it reaches the client.
5. **Tests (pytest, `sitepulse-backend/tests/`):** the percent mapping (a tiny fixture,
   mirroring how the vector tests work) + the empty-text (scanned PDF) path.

### Out of scope (later phases — do NOT build here)
- Room name auto-fill / point-in-polygon matching → **Phase 2**.
- A frontend read hook / any UI → Phase 2+ add consumption; Phase 1 is backend + types only.
- Title block, gridlines, openings, callouts, calibration, CAD-layer extraction → Phases 3+.
Don’t add a frontend `useSheetText` hook yet — the phase that consumes the cache will add it.

### Exit criteria (Definition of Done → then stop)
- ⛔ Migration SQL **shown and approved by the owner** before applying; applied via the
  Supabase tooling only after “go”; `database.types.ts` synced + `domain.ts` derived.
- `python -m pytest -q` green (from `sitepulse-backend/`); frontend
  `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green.
- Endpoint returns located words for a real vector sheet and `[]` for a scanned one.
- Close with the **`verify-feature`** skill (run its Definition-of-Done checklist, then STOP).
- **Do not commit or push until the owner says “Approved.”** On approval, merge to `main`
  (fast-forward) to deploy, then draft the Phase 2 kickoff and paste its launch prompt in chat.

### Guardrails specific to this phase (AGENTS.md)
- **Backend §7:** PyJWT only; never call `supabase.auth.get_user()`; keep the 25s client
  timeouts; no debug file writes (PII — Render’s FS is ephemeral/shared); wrap the handler in
  the standard `try / except fitz.FileDataError / except HTTPException / except Exception`.
- **Schema → types §4/§6:** never hand-duplicate a table shape — derive from
  `database.types.ts`; narrow JSONB at the query boundary (no `Json` in props).
- **§5:** `sheet_text` is a write-through cache exactly like `sheet_vectors` — don’t invent
  a different shape, RLS posture, or caching strategy. It IS the vectors pattern, for text.
- **Percent space:** all positions go through `map_point` so `sheet_text` shares the one
  coordinate system used by `sheet_vectors` and `units.polygon_coordinates`.

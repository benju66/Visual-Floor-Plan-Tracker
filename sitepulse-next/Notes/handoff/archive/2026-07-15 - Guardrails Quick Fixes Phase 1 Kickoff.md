# Kickoff — Guardrails & Quick Fixes, Phase 1: Bug batch + housekeeping

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Guardrails & Quick Fixes** (fix the 4 known bugs + repo housekeeping — no refactors, no renames). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-15 - Guardrails Quick Fixes Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Guardrails-Quick-Fixes-Plan.md` (Phase 1)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 1**. ⛔ No schema/RLS changes, no `.js`/`.jsx` renames, no refactors beyond the listed edits. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
Four small, verified bugs and a pile of repo housekeeping, batched so they ship in one review: the quick-status popup shows leftover selections from the last location it was opened on; the upload API's response doesn't contain a field the frontend pretends to read (two "save the image URL" calls silently do nothing); a corrupt PDF upload tells users "server error, try again" when retrying can never help; and one data hook exists in two diverged copies sharing a cache. Plus: a fresh clone of the repo can't actually run because the required environment variables were never documented.

## Scope — the bugs (three here; the fourth known bug — corrupt-PDF → 400 — is deliberately Phase 3's, batched with the backend test work. Don't drift into it.)
1. **QuickStatusModal resync** (`src/components/QuickStatusModal.jsx`): the modal is permanently mounted (the `if (!isOpen) return null` is inside), so `useState(currentStatus || 'none')` seeds once per app load. Add the resync `useEffect` exactly mirroring `QuickActivityModal.jsx` (~lines 6–8): re-seed `selectedState` from `currentStatus`, reset `startDate`/`endDate` to `''`, deps `[currentStatus, unitId, isOpen]`. Keep the file `.jsx` — do not convert or restyle.
2. **Upload response contract**: in `sitepulse-backend/main.py` `upload_and_convert_floorplan`, add `"base_image_url": public_url` to the return and drop the vestigial `"tile_manifest_url"` key; pin the response shape in a backend test. In the frontend, DELETE the two redundant `.update({ base_image_url })` write-backs (`src/hooks/useProjectActions.ts` ~108–110, `src/hooks/useWorkbenchActions.ts` ~139–151 — the backend's own write at main.py ~372 is authoritative; keep the invalidations and the workbench orphan-cleanup flow intact) and fix `UploadFloorplanResult` in `src/services/api.ts` to the real shape.
3. **`useSnappingVectors` dedupe**: the canonical hook is `src/hooks/useSnappingVectors.ts` (returns `{ vectors, isLoading, error, hasVectors }` — no `isFetching`). Add `isFetching` to its return and port the duplicate's retry-once-on-`'Failed to fetch'` policy into it. Then delete the duplicate `useSnappingVectors` + `SnappingVectorLine` from `src/hooks/useProjectQueries.ts` (~355–434) and repoint the two spinner consumers (`app/project/[projectId]/page.tsx` ~18/~246, `components/workbench/WorkbenchTracer.tsx` ~17/~141) to `@/hooks/useSnappingVectors`. `WorkbenchTracer.test.tsx` (~89) mocks the hook via the `useProjectQueries` module path — move that mock. Do NOT change the `queryKeys.snappingVectors` key shape (persisted IDB caches exist in the field).

## Scope — housekeeping
- `.env.example` in `sitepulse-next/` and `sitepulse-backend/` with every variable (the verified inventory is in the plan § Build-on inventory), comments, secrets blank. ⚠️ `sitepulse-next/.gitignore` has `.env*` — add `!.env.example` there or the file won't commit.
- README: Node 20+, dev on :3010 (`npm run dev:3010`), backend on :8001 with `FRONTEND_URL=http://localhost:3010` and frontend `NEXT_PUBLIC_API_URL=http://127.0.0.1:8001`, complete env sections pointing at the `.env.example` files.
- `npm uninstall qs` (frontend); remove `requests==2.33.1` from `sitepulse-backend/requirements.txt` (ONLY that line — AGENTS §8 pins must not move).
- `git rm --cached sitepulse-next/public/pdf.worker.min.mjs` + gitignore `/public/pdf.worker.min.mjs` (the postinstall/prebuild scripts regenerate it everywhere, including Vercel).
- `git rm sitepulse-backend/test_fitz.py` (scratch script; pytest.ini/.dockerignore already exclude it).
- `sitepulse-next/AGENTS.md` §4: `project_type` "(1 of 8)" → "(1 of 9)".

## Guardrails
- ⛔ No schema/RLS/grant changes; no migrations. No `.js`/`.jsx` renames (W2 owns conversion). No refactors beyond the listed edits — the useProjectQueries edit is a pure deletion.
- Nothing touches `pendingChanges`, the offline queue, or any status write path — the QuickStatusModal fix is local component state; its `onCommit` flow is unchanged.
- Snapping hook keeps returning raw JSON (never RBush into the Query cache — AGENTS §5/§6).
- Backend: keep every §7 invariant (auth dependency, `except HTTPException: raise` tails, capped reads, upsert-in-place storage) untouched; the response edit is additive.
- Lint is not a gate; verify with typecheck + test + build (+ backend pytest).

## Exit criteria (Definition of Done)
- Frontend triple green: `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` / `run test` / `run build`.
- Backend `python -m pytest -q` green from `sitepulse-backend/`, including the new upload-response-contract pin.
- Live click-through on dev:3010: quick-status popup on location A → close → open on location B shows fresh defaults; one end-to-end level-PDF upload (local backend on :8001) renders; trace tool still snaps on a sheet with vectors (spinner appears/clears).
- Close with the **verify-feature** skill, present the diff summary, then **STOP — no commit/push until the owner says "Approved."**

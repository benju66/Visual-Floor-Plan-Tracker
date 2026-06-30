# Kickoff — Trace Naming & Type Assist, Phase 2: learns from your corrections, company-wide

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of Trace Naming & Type Assist** (the naming brain now **learns from the rooms
> you've already confirmed across all your projects** — keep real name words, drop noise tokens it's
> never seen as a name, and guess the type most often paired with a name in your history). Frontend-only
> by default (a paginated client-side read of confirmed `units`; **no migration unless you choose the
> server-aggregation path — that's an approval gate**). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-27 - Trace Naming & Type Assist Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Trace-Naming-Type-Assist-Plan.md` (§ Phase 2, + Data model + guardrails)
> - `sitepulse-next/AGENTS.md` (esp. §2/§6 — IDB serialization & JSONB narrowing — and §9 testing)
>
> Branch off `main` (Phase 1 — `feat/trace-naming-type-assist-phase-1` — must be merged first; Phase 2
> threads a new arg into the `buildRoomSuggestion` it changed). Build **only Phase 2**. Don't commit or
> push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Where we are
- **Phase 1 is DONE** (branch `feat/trace-naming-type-assist-phase-1`, commit `f9287f3` — verify it's
  merged to `main` before starting): `matchRoomName` drops noise + centroid-limits lines (lever A), and
  `buildRoomSuggestion` routes the type guess through the **live dictionary + aliases** via
  `matchSubtypeForName` (lever D1), with `ROOM_KEYWORD_TO_SUBTYPE` as fallback. `ROOM_TEXT_MODEL_VERSION`
  is `text-prefill-v2`. Geometry stays manual; training capture untouched.
- Phase 2 is the next slice in `Notes/plans/Trace-Naming-Type-Assist-Plan.md` (the plan-of-record).

## What this phase is
Phase 1 made the rules smarter. Phase 2 makes them **learn**: the suggestion gets better the more you
trace, by reading the rooms you've **already confirmed** (their `unit_number` + `subtype_id` +
`top_level_role`) **across every project you're a member of** — company-wide, not per-project.

Two new signals fold into the *existing* `buildRoomSuggestion` (no new surface, no geometry change):
- **C — keep real names, drop learned noise:** a plain frequency table of name *tokens* you've actually
  confirmed lets the name matcher prefer words it's seen as real room names and drop tokens it's never
  seen as a name — sharpening lever A beyond the hard-coded noise patterns.
- **D2 — learn name→type:** when the dictionary/keyword guess (Phase 1's D1) is **weak or absent**,
  propose the `subtype_id` most frequently paired with this name in your confirmed history.

Learning is **best-effort and online-only** (the owner traces in an office): it degrades to "no
learning" on error/offline, exactly like `useSheetText` degrades to "no auto-fill". It must never
block or break a trace.

## Required reading (in order)
1. `sitepulse-next/AGENTS.md` — **§2** (offline mutation queue / IDB) + **§6** (JSONB narrowing & the
   **no `Map`/`Set`/class instances in TanStack cache** rule — the vocabulary model is load-bearing
   here) + **§9** (testing).
2. `sitepulse-next/Notes/plans/Trace-Naming-Type-Assist-Plan.md` — **§ Phase 2**, plus **§ Data model**
   (the ⚠️ 1000-row cap note) and **§ Hard guardrails**.
3. Re-read these source files **fresh** (line numbers drift — find the real code):
   - `src/utils/roomSuggestion.ts` — the single entry point `buildRoomSuggestion(polygon, words,
     subtypes)`; thread an **optional** `vocabulary` arg in here. Also `deriveSuggestionSource` /
     `suggestedLabelFromSuggestion` / `ROOM_TEXT_MODEL_VERSION` (bump to `text-prefill-v3`).
   - `src/utils/roomNameMatch.ts` — where lever C plugs into `matchRoomName` (pass the token frequencies
     in; keep the function pure — no DB).
   - `src/utils/subtypes.ts` — `matchSubtypeForName` (Phase 1's D1, the fallback the D2 guess complements).
   - `src/hooks/useSheetText.ts` — **copy its warm-cached, gracefully-degrading shape** for the new hook.
   - `src/hooks/useProjectQueries.ts` — the established **pagination** pattern (`fetchAllIn` /
     `paginateAll`) for the 1000-row cap; reuse it, don't hand-roll a loop.
   - `src/components/workbench/WorkbenchTracer.tsx` — where `useSubtypes()`/`useSheetText()` are read and
     `buildRoomSuggestion(...)` is called on trace-close; the new `useNamingVocabulary()` plugs in here
     alongside, and its result threads into the same call.

## Scope (build only this)
- **`buildNamingVocabulary(units)`** (new pure util, e.g. `src/utils/namingVocabulary.ts` + co-located
  test) → a **plain-JSON** frequency model `{ nameTokenCounts: Record<string, number>,
  nameToSubtype: Record<string, Record<string /*subtype_id*/, number>> }`. **Never a `Map`/`Set`**
  (AGENTS.md §6 — it flows through TanStack cache → IDB). Pass `units` in; no `Date.now()`, no DB.
  Tolerate empty/garbage input → empty model.
- **`useNamingVocabulary()`** (new hook) — fetches confirmed rooms **across all the user's projects**
  (`unit_number, subtype_id, top_level_role` where they're set), **paginated** (reuse `fetchAllIn` /
  `paginateAll` — the 1000-row cap is a real bug magnet here), narrows the JSONB at the query boundary
  (§6), and returns the **plain-JSON** vocabulary. Warm-cached + best-effort; **degrade to an empty
  vocabulary on error/offline** (mirror `useSheetText`). No raw `Json` into props.
- **Thread `vocabulary` into `buildRoomSuggestion`** as an **optional** arg (so callers without it — and
  the existing tests — keep working): (C) feed token frequencies to `matchRoomName` to keep seen-as-name
  words / drop never-seen tokens; (D2) when D1's dictionary/keyword guess is weak/absent, fall back to
  the most-frequent `subtype_id` paired with this name in `nameToSubtype`, resolved to a live subtype.
- Wire `useNamingVocabulary()` into `WorkbenchTracer` and pass its result to the `buildRoomSuggestion`
  call on trace-close.
- Bump `ROOM_TEXT_MODEL_VERSION` → `text-prefill-v3`.

## Guardrails / do-not
- **Default to NO migration** — build the client-side paginated `units` read first. ⛔ **Only if** you
  decide a server-side aggregation RPC/view is genuinely needed for performance, that's DDL → present
  the SQL via the **`create-migration` skill** and **STOP for owner approval**. Don't reach for it
  pre-emptively.
- **No `Map`/`Set`/class instances** anywhere the vocabulary touches the TanStack cache (§6). If
  `JSON.parse(JSON.stringify(model))` would lose data, it can't be cached.
- **Geometry untouched** — `method` stays `'manual'`; assist lives only on name/type (`source`).
- **Keep training capture intact** — frozen `suggested_label` + `deriveSuggestionSource`
  (`ai_accepted`/`ai_edited`); bumping `ROOM_TEXT_MODEL_VERSION` is required so old/new suggestions stay
  distinguishable at training time.
- **Degrade silently** — a failed/empty vocabulary must fall back to Phase 1's rule-only suggestion
  (or no suggestion); never block or break a trace. **No new blocking online dependency** in the trace
  flow.
- Don't fork the pagination or the ranking helpers — reuse them.

## Exit criteria (Definition of Done → then STOP)
Run from repo root with absolute prefix (bash cwd persists; a stray `cd` prompts):
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` (primary gate)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test`
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build`
- Unit tests: `buildNamingVocabulary` (incl. empty/garbage → empty model, and that it **never emits a
  `Map`/`Set`**) + the vocabulary-aware scoring (C drops a never-seen token; D2 proposes the most-paired
  type when D1 is weak).
- Live `dev:3010` click-through (from `sitepulse-next/`, port 3010): after several confirmed "… Unit"
  rooms exist, tracing the next one guesses **Dwelling Unit** even where the dictionary alias wouldn't
  alone; a name with a learned-noise token comes out cleaner. (Tip: the dev server on :3010 can go stale
  — restart `npm run dev:3010` if a route renders blank with a Jest-worker error.)
- Close with the `verify-feature` skill (its DoD/merge-gate), then **stop — do not commit or push until
  the owner says "Approved."**

## Open decisions (resolve at the start of the phase)
- **Data source:** client-side paginated `units` read (default, no migration) vs. a server-side
  aggregation RPC (faster at scale, but DDL + approval gate). Start with the client path; only escalate
  if the confirmed-room count makes the client read slow.
- **Whether Phase 3 (font-size signal, lever B) is needed at all** is decided *after* living with
  Phases 1–2 — it's planned, not promised. Phase 4 (extend the assist to the project-map draw flow) is
  pure wiring of the finished brain and comes after.

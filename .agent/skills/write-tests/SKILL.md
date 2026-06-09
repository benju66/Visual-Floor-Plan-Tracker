# TASK: Write Tests (SitePulse conventions)

Use this whenever you add or change behavior that can be covered by a test. Ground everything in `sitepulse-next/AGENTS.md`. Do not invent a new test framework — use the ones already wired up below.

## Where tests live and how to run them

**Frontend (`sitepulse-next/`) — Vitest + React Testing Library**
* Co-locate tests next to the code: `foo.ts` → `foo.test.ts` (the runner globs `src/**/*.{test,spec}.{ts,tsx}`).
* Config: `vitest.config.ts` (jsdom env, `@/*` alias via native tsconfig paths, setup in `vitest.setup.ts`).
* **Globals are off** — start every file with `import { describe, it, expect, vi } from 'vitest';`. This keeps `tsc --noEmit` clean.
* Run: `npm run test` (once), `npm run test:watch`, `npm run test:coverage`.

**Backend (`sitepulse-backend/`) — pytest**
* Tests live in `tests/`. The root `conftest.py` sets hermetic `SUPABASE_*` env vars *before* `main` is imported (required — `main` raises at import without them) and exports `TEST_JWT_SECRET`.
* Run from the backend dir with the venv python: `./venv/Scripts/python.exe -m pytest -q` (Windows) / `python -m pytest -q` (activated venv). Dev deps: `pip install -r requirements-dev.txt`.

## What to test (priority order)

1. **Pure logic** — the cheapest, highest-value targets. Geometry/snapping math (`src/utils/geometry.ts`), type guards (`src/types/domain.ts`), serialization/key helpers (`src/utils/pendingChangesStore.ts`). No mocks needed beyond simple stubs.
2. **Sync & serialization invariants** — these are the repo's crown jewels (AGENTS.md §2, §6). Cover: project-scoped IDB keys (`sitepulse-pending-changes-${projectId}`), empty-map-deletes-key behavior, silent degradation when IDB throws, and JSON-serializability of anything bound for the Query cache.
3. **Backend auth & contracts** — `get_current_user` must accept a valid `authenticated` JWT and reject expired/wrong-role/tampered tokens with 401; protected routes must reject a missing bearer before any handler runs.
4. **Hooks/components** — only when logic-level tests can't reach the behavior.

## How to mock the SitePulse stack

* **`idb-keyval`** → `vi.mock('idb-keyval', () => ({ get: ..., set: ..., del: ... }))`. Assert on the project-scoped key and the set-vs-del branch. See `src/utils/pendingChangesStore.test.ts`.
* **`RBush`** → never import the real index for unit tests; pass a stub `{ search: () => items } as never`. See the `getSnappedCoordinate` tests in `src/utils/geometry.test.ts`.
* **Supabase / TanStack Query** → don't hit the network. Stub the query hook's `queryFn` or the supabase client. For backend, do not call real Supabase — test the dependency function directly or rely on auth short-circuiting (see `tests/test_endpoints.py`).
* **Zustand stores** → reset state between tests; prefer testing the pure selector/action logic over rendering.
* **Backend JWTs** → mint tokens with `jwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256")`. Keep secrets ≥32 bytes to avoid PyJWT key-length warnings.

## Gotchas

* `tsc --noEmit` compiles test files too — keep them type-clean (no stray `any`, import vitest symbols).
* Guards in `domain.ts` are **not null-safe per element** — don't assert `isPercentPointArray([null])` returns false; it throws. Test with a safe primitive (`[42]`) instead.
* Don't disable `react-konva`/canvas tests by importing the real Stage in jsdom — extract the logic and test that.

## Definition of done

`npm run test` and `npm run typecheck` pass in `sitepulse-next/`; `pytest` passes in `sitepulse-backend/` for any backend change. Report the commands run and their output.

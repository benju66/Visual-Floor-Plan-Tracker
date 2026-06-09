# TASK: Convert a File from JavaScript to TypeScript (SitePulse)

This codebase is migrating incrementally from JS to strict TS. `tsconfig.json` has `allowJs: true` / `checkJs: false`, so `.js`/`.jsx` files stay valid mid-migration. Use this skill when converting a file. Ground everything in `sitepulse-next/AGENTS.md` §6 (TypeScript Guardrails). Stop and ask if a conversion forces a behavioral change.

**Step 1: Scope the conversion**
* Identify the file and its importers/consumers. Converting a widely-imported module can cascade type errors — know the blast radius first.
* Check whether the file already carries `// @ts-nocheck` (a prior partial conversion). Your job is to remove it, not preserve it.

**Step 2: Rename**
* `.js` → `.ts`, `.jsx` → `.tsx`. Keep the same path so imports resolve unchanged.
* Components using client hooks must keep the `"use client"` directive at the top.

**Step 3: Type it against the registry — do not invent shapes**
* Shared domain types live in `src/types/`. The single source of truth is `src/types/domain.ts`, which derives Row/Insert types from the auto-generated `src/types/database.types.ts`. **Never** hand-write a type that duplicates a Supabase table — import or derive it.
* **JSONB narrowing:** Supabase types JSONB columns as `Json`. Narrow at the query boundary (inside `queryFn`) with a type guard (e.g. `isPercentPointArray` for `polygon_coordinates`) — never let `Json` reach component props.
* **No `any`:** prefer `unknown` + narrowing. `any` is not an acceptable end state.
* **Zustand stores:** create with an explicit interface — `create<MyState>()(...)`. Setters taking functional updaters are typed `(val: T | ((prev: T) => T)) => void`.
* **IDB serialization safety:** anything flowing through TanStack Query cache must be JSON-serializable. Never type a cache value as holding a class instance (`RBush`, `Map`, `Set`, DOM node). If `JSON.parse(JSON.stringify(x))` would lose data, it can't be cached — return raw JSON and instantiate the class in the component.
* Respect the deliberate exceptions: `pendingChanges` / `pendingTimelineChanges` in `useFieldData.ts` stay local `useState` typed `Record<string, PendingChange>` — do not migrate them to Zustand/Query.

**Step 4: Resolve errors honestly**
* Fix the underlying type problem; do not paper over it with `as any` or `@ts-ignore`. A temporary `// @ts-nocheck` is allowed only on a large file mid-conversion and **must be removed before merging to `main`**.
* If a fix would change runtime behavior, stop and flag it rather than silently altering logic to satisfy the compiler.

**Step 5: Update references**
* Update any docs or imports that named the old extension (e.g. `AGENTS.md` references). Grep for the old `.js` path.

**Step 6: Verify**
* `npm run typecheck` — **zero errors**, and the file carries no `// @ts-nocheck`.
* `npm run lint`.
* If the file has testable logic, add/expand a Vitest test (see the `write-tests` skill); run `npm run test`.
* `npm run build` if the change touches App Router / server-component boundaries.

**Gate:** Report the verification output. No file with `// @ts-nocheck` may be committed to `main`.

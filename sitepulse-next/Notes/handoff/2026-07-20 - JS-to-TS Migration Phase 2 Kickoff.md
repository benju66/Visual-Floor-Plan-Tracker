# Kickoff — JS→TS Migration, Phase 2: data-shaped components (WalkSequenceModal + HoverHistoryTooltip + VelocityChart)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of the JS→TS Migration** (convert the three data-shaped components — `WalkSequenceModal`, `HoverHistoryTooltip`, `VelocityChart` — to strict TypeScript; 3 files, ~550 lines, zero behavior change). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-20 - JS-to-TS Migration Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/JS-to-TS-Migration-Plan.md` (Phase 2)
> - `.agent/skills/js-to-ts-conversion/SKILL.md` + `sitepulse-next/AGENTS.md` §6
>
> Branch off `main`, PR through CI. Build **only Phase 2**. ⛔ Zero behavior change — if the compiler forces a runtime edit, STOP and flag it. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Where Phase 1 left off
Phase 1 (AuthProvider + trivial pages + the six cast-removal components, 10 files, 7 casts deleted) shipped to **PR #17** (branch `w2-jsts-phase1`, commit `2cc4710`) and is merged to `main`. After it merged, a tiny **flag-cleanup follow-up** landed (pdfPageNumber parse-at-input, the QuickActivityModal misnomer rename + dead `status_color` fallback removal, and the two trivial assertions). **Re-baseline off current `main`** before starting — do not branch off `w2-jsts-phase1`. Remaining after Phase 2: `dashboard/page.jsx` + the two API routes (Phase 3), then `QueryProvider.jsx` at W3-end.

## Why this phase exists (plain English)
These three files each sit on a **typed seam** the compiler can't currently see through: the route-ordering modal writes location rows, the map hover-tooltip consumes ten props straight from `FloorplanCanvas`, and the dashboard's velocity chart takes a pre-computed data array. Converting them means the wrong shape flowing across any of those seams becomes a compile error instead of a silent runtime surprise — with no change to what the owner sees.

## Scope — conversion order (least-entangled first)
1. **`WalkSequenceModal.jsx` → `.tsx`** (~219 lines). Props `{ units: Unit[]; sheetId: string; onClose: () => void }`. The inner `SortableItem` gets `{ id: string; unit: Unit; onRemove: (id: string) => void }`. `handleDragEnd(event)` → dnd-kit's **`DragEndEvent`** (from `@dnd-kit/core`). The mutation is `useUpdateWalkSequence(sheetId)` — already typed `{ id: string; walk_sequence: number | null }[]`, so `handleSave`'s `updates` array just needs to match (it does). `Unit.walk_sequence` IS in `database.types.ts` (`number | null`) — the reads/sorts type cleanly.
   - ⚠️ **FLAG, don't fix:** the save path is `try/catch` with a **`console.error(e)`-only** failure branch (no user-facing error, silent `setIsSaving(false)`). Honest-error smell — record it for W3, leave the logic byte-identical.
2. **`HoverHistoryTooltip.jsx` → `.tsx`** (~178 lines) — the fiddliest seam. Ten props destructured at the top: `hoveredUnit`, `getPointerPos`, `units`, `rawStatuses`, `trackingMode`, `activities`, `dimensions`, `toolMode`, `contextMenu`, `applicabilityIndex`. **Pin each prop type from the source of truth**, do not invent:
   - `computeUnitVariance`, `varianceFill`, `varianceLabel` (`@/utils/progressAnalytics`) and `isActivityApplicable`, `applicableActivities` (`@/utils/applicability`) are already TS — read their signatures and let the prop types (e.g. `applicabilityIndex: ApplicabilityIndex`, `activities: Activity[]`, `rawStatuses: StatusLog[]`) fall out of what those helpers demand.
   - `hoveredUnit: Unit | null`, `getPointerPos: () => { x: number; y: number } | null | undefined` (called `getPointerPos?.()`), `dimensions` = the canvas `{ width; height }` pair FloorplanCanvas passes (match the type it threads), `toolMode: string`, `contextMenu` = the same nullable context-menu state type FloorplanCanvas uses.
   - Timeout refs are `useRef<ReturnType<typeof setTimeout> | null>(null)`. If there's a native listener (`el.addEventListener('wheel', …)`), type the handler `(e: WheelEvent) => void` and keep `{ passive: false }` (AGENTS §3).
   - **Consumers that must stay valid:** the real call site is `FloorplanCanvas.tsx:~1565` (prop-threading becomes checked — expect to satisfy the compiler at both ends, but change NO runtime behavior); the test mock `FloorplanCanvas.test.tsx:141` is `default: () => null` and stays valid regardless.
3. **`VelocityChart.jsx` → `.tsx`** (~155 lines) — Recharts generics are the one sharp edge. Export an interface for the `chartData` row (JSDoc'd today as `{ date, label, dailyVelocity, cumulativeCompleted, totalScope }[]`) — **and include the fields the inner `ChartTooltip` actually reads off `payload[0].payload`**: `plannedCumulative?` (used) and `totalScope`. `ProjectDashboard.tsx:~606` consumes `<VelocityChart chartData={chartData} />` via `next/dynamic` — import the exported row type there so that prop becomes checked. Type `ChartTooltip` with Recharts' `TooltipProps<ValueType, NameType>` (from `recharts`); narrow `payload` entries rather than casting.

## Guardrails
- ⛔ **Zero behavior change.** Conversions only; discovered bugs/smells → phase report as FLAGS. Compiler pushing toward a runtime edit = stop and ask.
- AGENTS §6 + skill: derive shapes from `domain.ts`/`database.types.ts`; narrow, don't cast; no `any`/`@ts-ignore` end states; no `@ts-nocheck` on main; keep `"use client"` where present; rename in place.
- **Not in scope (leave alone, flag if noticed):** the stale `as any` **inside** `useUpdateWalkSequence` (`useProjectQueries.ts:~1446`, comment claims `walk_sequence` isn't in the schema — it now IS; that's a W3 cleanup, not a Phase-2 file). Don't touch `QueryProvider.jsx`, the offline queue, or any Phase 3 file (`dashboard/page.jsx`, the two API routes).
- Existing tests pass unmodified (type annotations inside tests excepted). Lint is NOT a gate.
- ⚠️ dev:3010 points at PROD Supabase — click-through with throwaway data only; delete what you create.

## Exit criteria (Definition of Done)
- Triple green: `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` / `run test` / `run build`.
- Grep proof: zero `@ts-nocheck`, no new `any` in the diff.
- Live dev:3010 click-through: open **Route Sort** (walk-sequence modal from the field list) and drag a row + remove/add one · hover a mapped location so the **history tooltip** renders (states + variance color/label) · open the dashboard so the **velocity chart** renders with its tooltip.
- Close with the **verify-feature** skill, present the diff summary + any flags, then **STOP — no merge until the owner says "Approved."**

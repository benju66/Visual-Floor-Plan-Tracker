# Kickoff Prompt — Location Taxonomy Foundation, Phase 1

> Paste the block below into a fresh Claude Code session to start Phase 1.
> Planning and implementation stay in separate sessions on purpose (cold, focused context).

---

You are implementing **Phase 1** of the Location Taxonomy Foundation. The plan of record is
`sitepulse-next/Notes/Location-Taxonomy-Foundation-Plan.md` — read it in full first.

Before writing any code, also read, in this order:
1. `sitepulse-next/AGENTS.md` (CRITICAL architectural invariants).
2. `docs/location-labeling-standard.md` §5 + §5.7 (the role/sub-type taxonomy + target data model).
3. `docs/initiative-brief.md` (the initiative + guardrails §2).

Then **re-read the real files fresh** (do not trust line numbers in the plan — they drift):
`src/types/domain.ts`, `src/types/database.types.ts`, and `src/utils/applicability.ts`
(for how `unit_type` strings feed milestone applicability — which is why the schema stays additive).

**Phase 1 scope (this session only):** create `src/utils/locationTaxonomy.ts` + a co-located
`locationTaxonomy.test.ts`. Pure, framework-free, deterministic logic — no DB, no UI, no other file
imports it yet:
- `CANONICAL_ROLES` (`program`/`common`/`support`/`other`) and `PROJECT_TYPES` (the 8) as `const` unions.
- `SEED_SUBTYPES` from standard §5.4 (universal Common/Support + per-project-type Program; each maps to a canonical role + default project types).
- `ROLE_DISPLAY_LABELS` (per-project-type, presentation-only) + `roleLabel(role, projectType)` resolving to the override or the canonical title-case fallback.
- `subtypesForProjectType(projectType, dict)` — orders the pick-list defaults-first, never restricts.
- `mapLegacyUnitType(unitType): { role, subtypeName }` — the migration mapping; unknown/`Other` → `other` / `Other (pending)`.

**Tests:** every seed sub-type maps to a valid canonical role; `mapLegacyUnitType` covers the known
palette (`Apartment Unit`, `Common Area`, `Back of House`, `Commercial Space`, `Other`) + the
unknown fallback; `roleLabel` returns overrides where defined, canonical otherwise.

**Hard guardrails:** `top_level_role` values are STABLE CANONICAL — never per-project; display labels
are presentation-only (never stored/exported in their place). No `any` (import `{ describe, it, expect }`
from `'vitest'` — globals are OFF). This is pure logic only — do not touch the schema, the create flow,
or any live component this phase.

**Branch:** work on `claude/polygon-drawing-performance-n976r3` (brief §2), small commits. Do not push to `main`.

**Exit criteria — then STOP at the phase boundary:**
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test -- src/utils/locationTaxonomy.test.ts
```
Both green, then close the phase with the **verify-feature** skill (Definition of Done → stop). Ask the
owner to review `SEED_SUBTYPES`, `ROLE_DISPLAY_LABELS`, and `mapLegacyUnitType` (they encode product
decisions, incl. the three open items in brief §9). **Do not commit/push until the owner says "Approved,"**
and do not start Phase 2 (the DB migration — which has an approval gate) in this session.

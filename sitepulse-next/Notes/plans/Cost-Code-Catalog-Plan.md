# Cost Code Catalog — global cost-code library, importer, manager + milestone wiring (self-contained build plan)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent / sibling specs: this is **Phase-0 adoption-foundation** work. The *subcontractor-attribution*
> workstream (a thin `subcontractors` table seeded from `project_contacts` companies + milestone-level
> attribution) is a **separate, not-yet-written plan**; this plan deliberately stops at milestone wiring
> and hands the sub↔cost-code link to that workstream (see § Out of scope).

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) first.
2. Re-read the files named in **§ Build-on inventory** fresh — do not trust line numbers; they drift.
3. Build the sub-phases in order. Verify after each slice (§ Sub-phasing exit criteria).
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence plain-English
   summary; explain jargon in passing; keep it short.

## Goal
When this is done, SitePulse has a **single company-wide cost-code library** — your standard CSI
MasterFormat catalog (code · description · type · division) — imported once and managed from the
**Global Settings** modal, exactly like the existing global Location-Type library. Each **milestone**
(a scope/trade gate like "Drywall") can be tagged with a cost code, so every status a field worker logs
is automatically associated with a standardized cost code. This is the **normalization key** that later
lets production rates ("12 units/week") be compared across projects in the language estimators already use.

Plain-English: *we load your standard cost-code list into the app once, give you a screen to manage it,
and let you stamp the right code onto each milestone — no dollars, no budgets, just the code as a label.*

## Out of scope / deferred
- **No cost/dollar/budget logic.** Cost codes are imported and used purely as **labels / normalization
  keys**. No amounts, committed vs. actual cost, change orders, or invoicing. (If that ever happens it is
  a separate workstream.)
- **Subcontractor ↔ cost-code link is deferred.** A `subcontractors` table does not exist yet. When the
  *subcontractor-attribution* workstream lands it, that workstream owns adding default cost codes to a
  subcontractor. This plan only wires cost codes to **milestones**. (§ Sub-phasing Phase 5 names the handoff.)
- **No live estimating-app integration.** We import a **snapshot file** (CSV/JSON) now. A future live sync
  to the estimating app (`src/lib/estimate-catalog.json` in the other repo) is explicitly out of scope.
- **No automatic milestone→code mapping.** The user assigns codes to milestones by hand in v1 (no AI/auto-map).

## Locked product decisions (from the owner + this build)
- **Company-level / global, not project-scoped.** The catalog is one shared list used across all projects,
  mirroring the global `subtypes` dictionary. Lives in `GlobalSettingsModal`, next to the Location Library.
- **Import full granular fidelity (227 codes).** Store every code from the catalog (`DD-NNNN.SSS`,
  description, type, division). Nothing is collapsed on import.
- **Tagging grain = the 6-digit MasterFormat "section" (`DD-NNNN`)**, *derived from the code* (the part
  before the `.SSS`). This is the coarser "rollup" grain for milestone tagging, and it needs **no external
  Procore-rollup table** — it is computed from the code string. The manager groups by division → section →
  code; the milestone picker guides toward section-level picks but stores a specific `cost_code` row.
- **User-facing, repeatable importer** (not a one-time DB seed). Mirror the Procore-contacts CSV importer
  (`procoreDirectoryCsv.ts`): a pure parser + an upload/paste control. The initial 227 codes are populated
  by running this importer once on the catalog file (`docs/estimate-cost-codes-catalog.md` → CSV, or the
  estimating app's JSON export).
- **Lightweight status: `active` / `archived`** (retire obsolete codes). **No** `pending`/proposal review
  queue — codes are authoritative (they come from import), unlike field-proposed sub-types.
- **Labels not enforcement:** the milestone↔code link is nullable and advisory; it never gates a status write.

## Data model
New + changed schema (one migration, **⛔ approval-gated** — see Phase 1):

**New table `cost_codes` (global, like `subtypes`):**
| column | type | notes |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `code` | text **UNIQUE NOT NULL** | e.g. `09-2116.001` — the granular catalog code; UNIQUE enables import upsert |
| `description` | text | e.g. `Gypsum Board Assemblies` |
| `code_type` | text | `Subcontract` \| `Material` \| `Labor` (plain TEXT, no CHECK — matches taxonomy convention) |
| `division` | text | 2-digit MasterFormat division, e.g. `09` |
| `section` | text | derived 6-digit base `DD-NNNN`, e.g. `09-2116` (the rollup grain; stored for fast grouping) |
| `status` | text default `'active'` | `active` \| `archived` |
| `created_at` | timestamptz default now() | |

- **RLS (mirror `subtypes` / AGENTS.md §4):** read = any authenticated project member; write =
  `owner`/`admin`/`pm` only; **never `anon`.** Because it is global (no project FK), the policy is a bare
  `authenticated` check for read and a privileged-role check for write — confirm against how `subtypes`
  RLS is written in `20260616_location_taxonomy.sql` and replicate that exact shape.
- Index on `division` and `section` for the manager's grouped view; `code` UNIQUE already indexed.

**Changed table `project_milestones`:**
- Add `cost_code_id uuid` **nullable** FK → `cost_codes(id)` `ON DELETE SET NULL` (a deleted/archived code
  must not cascade-delete milestones). Index it. Additive + nullable; the live app ignores it until the
  Phase-4 UI reads it. **`status_logs` / the `UNIQUE(unit_id, track, milestone)` slot model is untouched.**

Idempotent migration (ADD COLUMN/TABLE IF NOT EXISTS, `pg_policies` existence checks), per the
`create-migration` skill. After applying: regenerate `src/types/database.types.ts`, then derive
`CostCode = Database['public']['Tables']['cost_codes']['Row']` in `src/types/domain.ts` (AGENTS.md §6).

## Build-on inventory (read these fresh before using)
REUSE these — do **not** fork them:
- **Global-dictionary hook pattern:** `src/hooks/useSubtypes.ts` — `useQuery` (warm `staleTime`), upsert /
  set-status / bulk mutations, `queryKeys.subtypes()` invalidation, narrowing at the boundary. Mirror for
  `useCostCodes.ts`.
- **CSV importer pattern:** `src/utils/procoreDirectoryCsv.ts` (+ `.test.ts`) — pure RFC-4180-ish parser,
  header-by-name mapping, blank→null, unit-tested. Mirror for `costCodeCatalogCsv.ts`.
- **Import control UI:** the contacts importer control referenced from `SettingsMenu.tsx`
  (`ImportContactsControl` / `useImportProjectContacts`) — file read + preview count + bulk mutate.
- **Manager UI pattern:** `src/components/taxonomy/LocationLibraryPanel.tsx` — grouped list, search,
  status filter, add/edit, `canManage` gate. Mirror for `CostCodeLibraryPanel.tsx`.
- **Global-settings mount point:** `src/components/GlobalSettingsModal.jsx` — `LocationLibraryPanel` is
  mounted there (a "Location Library" section). Add a sibling "Cost Codes" section the same way.
- **Milestone editor:** `src/components/SettingsMenu.tsx` (the project-scoped milestone manager) +
  `useProjectQueries.ts` (`useMilestones` and the milestone create/update mutations). The Phase-4
  cost-code picker hangs off the per-milestone row here.
- **Types:** `src/types/domain.ts` (`Milestone` at the `project_milestones` Row), `src/types/queryKeys.ts`
  (add `costCodes()`), `src/types/database.types.ts` (regenerate after the migration).
- **Source catalog:** `docs/estimate-cost-codes-catalog.md` (227 codes, the seed data + the division legend).

Do **not** touch: `progressAnalytics.ts`, the `status_logs` write path / `upsert_status_log`, the offline
`pendingChanges` queue, `mapDisplayStatuses`. None of them are in this feature's blast radius.

## Pure logic to extract + unit-test (`src/utils/costCodeCatalogCsv.ts` + `.test.ts`)
Framework-free, deterministic — this is where correctness lives:
- `parseCostCodeCatalogCsv(text): CostCodeDraft[]` — RFC-4180-ish parse (reuse the tokenizer shape from
  `procoreDirectoryCsv.ts`), columns mapped by header name (`Cost Code`/`Description`/`Type`/`Div`), skip
  rows with no code, trim, dedupe by code (last wins).
- `deriveSection(code): string` — `'09-2116.001'` → `'09-2116'` (split on `.`; fall back to the whole code
  if no dot). Pure; covers odd inputs (`'50-2000.008'`, `'80-8001.001'`, malformed).
- `deriveDivision(code): string` — `'09-2116.001'` → `'09'` (first token before `-`).
- Grouping helpers `groupByDivision` / `groupBySection` for the manager (pure; sorted, stable).
- `COST_CODE_DIVISIONS: Record<string,string>` — the division-number → label legend from the catalog doc
  (01 General Requirements … 80 TBD). Keep it a plain const for display.
- Optional: `parseEstimateCatalogJson(json): CostCodeDraft[]` if the estimating-app JSON shape is trivial —
  otherwise CSV only in v1.
Pass values IN; never call `Date.now()` inside these. Tests import `{ describe, it, expect }` from `'vitest'`.

## Sub-phasing (ship + verify each)

### Phase 1 — Schema foundation (migration only) ⛔
- **Scope:** the `cost_codes` table + `project_milestones.cost_code_id` per § Data model. Regenerate
  `database.types.ts`; derive `CostCode` in `domain.ts`; add `queryKeys.costCodes()`. **No hooks, no UI.**
- **Approval gates:** ⛔ **DB migration / DDL + RLS.** Author the SQL via the `create-migration` skill,
  present the **full SQL**, and **STOP for owner approval before applying.** Do not touch production data.
- **Exit criteria:** typecheck + build green · `database.types.ts` regenerated and `CostCode` derived ·
  migration applied only after the owner approves · close with `verify-feature` (Definition of Done → stop;
  no commit/push until owner says "Approved").

### Phase 2 — Pure importer + data hooks (no live UI yet)
- **Scope:** `src/utils/costCodeCatalogCsv.ts` (+ `.test.ts`, the § Pure logic). `src/hooks/useCostCodes.ts`:
  `useCostCodes()` (global, warm), `useUpsertCostCode()`, `useSetCostCodeStatus()`, `useImportCostCodes()`
  (bulk upsert `onConflict: 'code'`). Mirror `useSubtypes.ts` exactly (invalidate `queryKeys.costCodes()`).
- **Approval gates:** none (pure + hooks; no schema, no live component mounted).
- **Exit criteria:** the parser is **unit-tested** (round-trip the catalog sample; `deriveSection`/division
  edge cases) · typecheck + test green · build green (nothing live changed).

### Phase 3 — Manager UI in Global Settings (mirror the Location Library)
- **Scope:** `src/components/costcodes/CostCodeLibraryPanel.tsx` — list grouped by division → section,
  search across code/description, status filter (active/archived), add/edit a code, archive/restore, and an
  **Import** control (upload/paste a catalog CSV → preview count → `useImportCostCodes`). `canManage`
  (owner/admin/pm) gates writes. Mount it as a new **"Cost Codes"** section in `GlobalSettingsModal.jsx`
  beside the Location Library. **Seed the 227 codes** by running the importer once on the catalog file;
  note the source in the PR description.
- **Approval gates:** none beyond the standard live-UI verification (no schema, no production data writes
  beyond the user's own import action in dev).
- **Exit criteria:** live `dev:3010` click-through — open Global Settings → Cost Codes → import the catalog
  → see the grouped, searchable list; archive/restore works · typecheck + build green · `verify-feature`.

### Phase 4 — Milestone wiring UI
- **Scope:** add a **cost-code picker** to each milestone row in `SettingsMenu.tsx` (writes
  `project_milestones.cost_code_id`). A `useUpdateMilestoneCostCode` mutation (or extend the existing
  milestone-update mutation in `useProjectQueries.ts`). The picker reads `useCostCodes()`, groups by
  division → section, is searchable, shows `code — description`, and defaults to filtering `Subcontract`
  codes (with a "show all types" toggle). Show the assigned code on the milestone row.
- **Approval gates:** none beyond live-UI verification.
- **Exit criteria:** live `dev:3010` — assign a code to a milestone, reload, it persists; clearing it works ·
  typecheck + build green · `verify-feature`.

### Phase 5 — Subcontractor ↔ cost-code link (DEFERRED — handoff only)
- **Owned by the subcontractor-attribution workstream, not this plan.** When that `subcontractors` table
  exists, it adds default cost codes to a subcontractor (e.g. a `subcontractor_cost_codes` join or a
  `default_cost_code_ids` column) and reuses `useCostCodes()` for the picker. Listed here so the dependency
  is explicit; **do not build it under this plan.**

## Hard guardrails (AGENTS.md — do not violate)
- **Status writes untouched:** never alter `status_logs`, `upsert_status_log`, or the
  `UNIQUE(unit_id, track, milestone)` slot model. Cost codes are a side label on `project_milestones`.
- **Offline queue untouched:** do not touch `pendingChanges` / `useFieldData` / `pendingChangesStore`.
- **RLS:** `cost_codes` write = `owner`/`admin`/`pm`, read = any member, **never `anon`** — mirror `subtypes`.
- **Types:** derive `CostCode` from `database.types.ts`; never hand-write a table shape (§6). All columns are
  scalar text — no JSONB narrowing needed, but keep `Json` out of props.
- **No `progressAnalytics` fork; no recolor of `mapDisplayStatuses`.** (Not in scope, but stated for safety.)
- **Plain TEXT for `code_type`/`status`** (no DB CHECK enums) — matches the taxonomy convention; allowed
  values documented here, not enforced in the DB.

## Open decisions
- **Grain mechanism (confirmable):** this plan derives the rollup grain as the 6-digit MasterFormat
  `section` from the code itself. If the owner's estimating app holds a *different* explicit Procore-rollup
  mapping they want used instead, that mapping would need to be imported too — out of scope until provided.
  Default (section-from-code) stands unless the owner says otherwise.
- **Estimate-app JSON import:** CSV is the v1 import format. Whether to also accept the estimating app's
  `estimate-catalog.json` directly is decided in Phase 2 (include only if the shape is trivial).
- **Milestone picker default filter:** Phase 4 defaults the picker to `Subcontract` codes; confirm during
  that phase's click-through whether Material/Labor should be shown by default too.

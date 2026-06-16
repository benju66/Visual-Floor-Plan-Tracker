/**
 * Location taxonomy — pure, framework-free constants + mapping logic.
 *
 * This is the **single source of truth** for the three-axis location taxonomy
 * described in `docs/location-labeling-standard.md` §5:
 *   - Project type (8) — lives on the project; "what kind of job is this?"
 *   - Top-level role (4) — lives on the location; rigid/canonical; "what does
 *     this space do in any building?"
 *   - Sub-type — lives on the location; a single global governed dictionary;
 *     "specifically what is it?"
 *
 * Phase 1 of the Location Taxonomy Foundation: nothing imports this yet. It
 * exists so the Phase-2 DB migration (seed + backfill) and the Phase-3 pickers
 * can be built against logic that is already unit-tested.
 *
 * Invariants (see AGENTS.md / docs/initiative-brief.md):
 *   - `top_level_role` values are STABLE CANONICAL — never per-project, never
 *     renamed. They are what trains the AI and what gets exported.
 *   - Display labels (ROLE_DISPLAY_LABELS / roleLabel) are PRESENTATION-ONLY.
 *     Never store or export a display label in place of the canonical role.
 *   - This module is deterministic and side-effect-free: no DB, no Date.now(),
 *     no `any`. Pass any timestamps in from the caller.
 */

// ---------------------------------------------------------------------------
// Canonical roles (the rigid layer — standard §5.2)
// ---------------------------------------------------------------------------

export const CANONICAL_ROLES = ['program', 'common', 'support', 'other'] as const;
export type TopLevelRole = (typeof CANONICAL_ROLES)[number];

/**
 * Canonical title-case label for a role, used as the fallback when no
 * per-project-type display override exists. Stable; not the place to rename.
 */
const CANONICAL_ROLE_TITLE: Record<TopLevelRole, string> = {
  program: 'Program',
  common: 'Common',
  support: 'Support',
  other: 'Other',
};

// ---------------------------------------------------------------------------
// Project types (the 8 — standard §5.3)
// ---------------------------------------------------------------------------

export const PROJECT_TYPES = [
  'Commercial',
  'Educational',
  'Government',
  'Healthcare',
  'Housing and Hotel',
  'Industrial',
  'Restaurant',
  'Workplace',
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

// ---------------------------------------------------------------------------
// Display labels (presentation-only — standard §5 / locked decision 3)
// ---------------------------------------------------------------------------

/**
 * Per-project-type relabelling of a canonical role for display ONLY. The same
 * canonical role can render differently per project type (e.g. `program` shows
 * as "Units" in a Housing-and-Hotel project) without changing the stored value.
 *
 * Only overrides are listed; anything absent falls back to the canonical
 * title-case via {@link roleLabel}. This map intentionally starts small — the
 * only override grounded in the standard today is Housing and Hotel → "Units".
 * Add more here as the owner confirms preferred wording per vertical. A later
 * phase moves this to an owner-editable `project_type_role_labels` table; the
 * shape here mirrors that so the move is trivial.
 */
export type RoleDisplayLabels = Partial<Record<ProjectType, Partial<Record<TopLevelRole, string>>>>;

export const ROLE_DISPLAY_LABELS: RoleDisplayLabels = {
  'Housing and Hotel': { program: 'Units' },
};

/**
 * Resolve the display label for a role in the context of a project type:
 * the per-project-type override if one exists, otherwise the canonical
 * title-case. `null`/`undefined` project type (e.g. a project with no
 * `project_type` set yet) always falls back to canonical.
 *
 * Presentation-only — never persist or export this value in place of `role`.
 */
export function roleLabel(role: TopLevelRole, projectType?: ProjectType | null): string {
  if (projectType) {
    const override = ROLE_DISPLAY_LABELS[projectType]?.[role];
    if (override) return override;
  }
  return CANONICAL_ROLE_TITLE[role];
}

// ---------------------------------------------------------------------------
// Seed sub-type dictionary (standard §5.4)
// ---------------------------------------------------------------------------

export interface SeedSubtype {
  /** Canonical sub-type name. Globally UNIQUE (the DB column is `name TEXT UNIQUE`). */
  name: string;
  /** The canonical role this sub-type rolls up to. */
  role: TopLevelRole;
  /**
   * Which project types surface this sub-type first in the pick-list. This is
   * pick-list SCOPING only — it never restricts. Universal Common/Support
   * sub-types list all 8; vertical-specific Program sub-types list their own.
   */
  defaultProjectTypes: readonly ProjectType[];
}

/** Sentinel sub-type name for "no fit yet" — standard §5.5 governance. */
export const PENDING_SUBTYPE_NAME = 'Other (pending)';

/**
 * The seed dictionary from standard §5.4. Sub-types are GLOBAL, not locked to a
 * project type (a café in a hospital uses Restaurant's `Dining Area`); the
 * `defaultProjectTypes` field only orders the pick-list.
 *
 * Universal Common/Support sub-types are defined once and default into every
 * vertical. Program sub-types are vertical-specific. Where the same sub-type is
 * relevant to multiple verticals (e.g. `Lab` in Healthcare and Industrial) it
 * is ONE entry listing both project types — the global-not-duplicated rule
 * (§5.4 cross-cutting). `Other (pending)` is NOT seeded here; it is the §5.5
 * sentinel ({@link PENDING_SUBTYPE_NAME}) and is seeded separately by Phase 2.
 *
 * NOTE FOR OWNER REVIEW — this list encodes product decisions. Open items from
 * brief §9 / standard Appendix B that touch it: Restaurant `Kitchen` is seeded
 * as Program; "Housing and Hotel" is a single project type spanning Dwelling
 * Unit + Guestroom.
 */
export const SEED_SUBTYPES: readonly SeedSubtype[] = [
  // Universal — Common (every vertical) -------------------------------------
  { name: 'Lobby/Entry', role: 'common', defaultProjectTypes: PROJECT_TYPES },
  { name: 'Vestibule', role: 'common', defaultProjectTypes: PROJECT_TYPES },
  { name: 'Corridor', role: 'common', defaultProjectTypes: PROJECT_TYPES },
  { name: 'Stair', role: 'common', defaultProjectTypes: PROJECT_TYPES },
  { name: 'Elevator/Elevator Lobby', role: 'common', defaultProjectTypes: PROJECT_TYPES },
  { name: 'Public Restroom', role: 'common', defaultProjectTypes: PROJECT_TYPES },
  { name: 'Reception/Waiting', role: 'common', defaultProjectTypes: PROJECT_TYPES },
  { name: 'Amenity/Lounge', role: 'common', defaultProjectTypes: PROJECT_TYPES },

  // Universal — Support (every vertical) ------------------------------------
  { name: 'Mechanical', role: 'support', defaultProjectTypes: PROJECT_TYPES },
  { name: 'Electrical', role: 'support', defaultProjectTypes: PROJECT_TYPES },
  { name: 'Data/IT/Telecom', role: 'support', defaultProjectTypes: PROJECT_TYPES },
  { name: 'Plumbing/Riser', role: 'support', defaultProjectTypes: PROJECT_TYPES },
  { name: 'Storage', role: 'support', defaultProjectTypes: PROJECT_TYPES },
  { name: 'Janitor/Custodial', role: 'support', defaultProjectTypes: PROJECT_TYPES },
  { name: 'Trash/Refuse', role: 'support', defaultProjectTypes: PROJECT_TYPES },
  { name: 'Loading/Receiving', role: 'support', defaultProjectTypes: PROJECT_TYPES },
  { name: 'Staff-Only', role: 'support', defaultProjectTypes: PROJECT_TYPES },

  // Program — Commercial ----------------------------------------------------
  { name: 'Retail Sales Floor', role: 'program', defaultProjectTypes: ['Commercial'] },
  { name: 'Tenant Suite (shell)', role: 'program', defaultProjectTypes: ['Commercial'] },
  { name: 'Showroom', role: 'program', defaultProjectTypes: ['Commercial'] },
  { name: 'Salon Studio', role: 'program', defaultProjectTypes: ['Commercial'] },
  { name: 'Fitness Studio', role: 'program', defaultProjectTypes: ['Commercial'] },
  { name: 'Service Counter', role: 'program', defaultProjectTypes: ['Commercial'] },

  // Program — Educational ---------------------------------------------------
  { name: 'Classroom', role: 'program', defaultProjectTypes: ['Educational'] },
  { name: 'Lecture Hall', role: 'program', defaultProjectTypes: ['Educational'] },
  { name: 'Teaching Lab', role: 'program', defaultProjectTypes: ['Educational'] },
  { name: 'Library/Media Center', role: 'program', defaultProjectTypes: ['Educational'] },
  { name: 'Gymnasium', role: 'program', defaultProjectTypes: ['Educational'] },
  { name: 'Cafeteria/Dining', role: 'program', defaultProjectTypes: ['Educational'] },
  { name: 'Art/Music Studio', role: 'program', defaultProjectTypes: ['Educational'] },

  // Program — Government -----------------------------------------------------
  { name: 'Office', role: 'program', defaultProjectTypes: ['Government'] },
  { name: 'Courtroom', role: 'program', defaultProjectTypes: ['Government'] },
  { name: 'Hearing/Council Chamber', role: 'program', defaultProjectTypes: ['Government'] },
  { name: 'Public Service Counter', role: 'program', defaultProjectTypes: ['Government'] },
  { name: 'Records', role: 'program', defaultProjectTypes: ['Government'] },
  { name: 'Holding/Detention', role: 'program', defaultProjectTypes: ['Government'] },

  // Program — Healthcare -----------------------------------------------------
  { name: 'Patient Room', role: 'program', defaultProjectTypes: ['Healthcare'] },
  { name: 'Exam Room', role: 'program', defaultProjectTypes: ['Healthcare'] },
  { name: 'Operating Room', role: 'program', defaultProjectTypes: ['Healthcare'] },
  { name: 'Procedure Room', role: 'program', defaultProjectTypes: ['Healthcare'] },
  { name: 'Dental Operatory', role: 'program', defaultProjectTypes: ['Healthcare'] },
  { name: 'Imaging/Radiology', role: 'program', defaultProjectTypes: ['Healthcare'] },
  { name: 'Treatment Bay', role: 'program', defaultProjectTypes: ['Healthcare'] },
  { name: "Nurses' Station", role: 'program', defaultProjectTypes: ['Healthcare'] },
  { name: 'Pharmacy', role: 'program', defaultProjectTypes: ['Healthcare'] },
  // `Lab` is global: seeded once, defaulting into both Healthcare and Industrial.
  { name: 'Lab', role: 'program', defaultProjectTypes: ['Healthcare', 'Industrial'] },

  // Program — Housing and Hotel ---------------------------------------------
  { name: 'Dwelling Unit', role: 'program', defaultProjectTypes: ['Housing and Hotel'] },
  { name: 'Guestroom', role: 'program', defaultProjectTypes: ['Housing and Hotel'] },
  { name: 'Suite', role: 'program', defaultProjectTypes: ['Housing and Hotel'] },
  { name: 'Live/Work Unit', role: 'program', defaultProjectTypes: ['Housing and Hotel'] },
  { name: 'Event/Ballroom', role: 'program', defaultProjectTypes: ['Housing and Hotel'] },
  { name: 'Meeting Room', role: 'program', defaultProjectTypes: ['Housing and Hotel'] },

  // Program — Industrial -----------------------------------------------------
  { name: 'Manufacturing Floor', role: 'program', defaultProjectTypes: ['Industrial'] },
  { name: 'Assembly Area', role: 'program', defaultProjectTypes: ['Industrial'] },
  { name: 'Warehouse Bay', role: 'program', defaultProjectTypes: ['Industrial'] },
  { name: 'Clean Room', role: 'program', defaultProjectTypes: ['Industrial'] },
  { name: 'Process Area', role: 'program', defaultProjectTypes: ['Industrial'] },
  { name: 'Cold Storage', role: 'program', defaultProjectTypes: ['Industrial'] },

  // Program — Restaurant -----------------------------------------------------
  { name: 'Dining Area', role: 'program', defaultProjectTypes: ['Restaurant'] },
  { name: 'Bar/Lounge', role: 'program', defaultProjectTypes: ['Restaurant'] },
  { name: 'Private Dining', role: 'program', defaultProjectTypes: ['Restaurant'] },
  // Open item (brief §9): Restaurant production kitchen seeded as Program.
  { name: 'Kitchen', role: 'program', defaultProjectTypes: ['Restaurant'] },
  { name: 'Prep', role: 'program', defaultProjectTypes: ['Restaurant'] },
  { name: 'Outdoor/Patio Dining', role: 'program', defaultProjectTypes: ['Restaurant'] },

  // Program — Workplace ------------------------------------------------------
  { name: 'Open Workstation Area', role: 'program', defaultProjectTypes: ['Workplace'] },
  { name: 'Private Office', role: 'program', defaultProjectTypes: ['Workplace'] },
  { name: 'Conference Room', role: 'program', defaultProjectTypes: ['Workplace'] },
  { name: 'Huddle/Phone Room', role: 'program', defaultProjectTypes: ['Workplace'] },
  { name: 'Training Room', role: 'program', defaultProjectTypes: ['Workplace'] },
  { name: 'Collaboration Area', role: 'program', defaultProjectTypes: ['Workplace'] },
];

/**
 * Order a sub-type dictionary for a project type's pick-list: defaults first
 * (sub-types whose `defaultProjectTypes` includes this project type), then
 * everything else — in stable original order within each group. NEVER restricts
 * (all allowed; project type only scopes ordering — standard §5.3/§5.4).
 *
 * Generic over the row shape so it works on {@link SEED_SUBTYPES} now and on
 * narrowed DB rows later, as long as they expose `defaultProjectTypes`.
 */
export function subtypesForProjectType<T extends { defaultProjectTypes: readonly ProjectType[] }>(
  projectType: ProjectType,
  dict: readonly T[],
): T[] {
  const defaults: T[] = [];
  const rest: T[] = [];
  for (const subtype of dict) {
    if (subtype.defaultProjectTypes.includes(projectType)) {
      defaults.push(subtype);
    } else {
      rest.push(subtype);
    }
  }
  return [...defaults, ...rest];
}

// ---------------------------------------------------------------------------
// Legacy migration mapping (standard §5.7 / plan Phase 2 backfill)
// ---------------------------------------------------------------------------

export interface LegacyUnitTypeMapping {
  role: TopLevelRole;
  subtypeName: string;
}

/**
 * Mapping for the known legacy `unit_type` palette (the historical default:
 * `["Apartment Unit", "Common Area", "Back of House", "Commercial Space", "Other"]`).
 *
 * Design principle (standard §5.6): the canonical ROLE is the confident,
 * stable layer, so we assign it wherever the legacy string clearly implies it.
 * The SUB-TYPE is the governed detail — assigned only where the legacy string
 * maps unambiguously to exactly one seed sub-type (`Apartment Unit` →
 * `Dwelling Unit`). The other legacy strings are too generic to name a specific
 * sub-type, so they land on their confident role + `Other (pending)`, which
 * surfaces them in the review queue for the owner to promote in bulk.
 *
 * NOTE FOR OWNER REVIEW: `Commercial Space` is mapped to `program` on the
 * assumption the historical palette was housing-oriented (commercial = the
 * ground-floor commercial program). Re-decide here if that assumption is wrong.
 */
const LEGACY_UNIT_TYPE_MAP: Record<string, LegacyUnitTypeMapping> = {
  'Apartment Unit': { role: 'program', subtypeName: 'Dwelling Unit' },
  'Common Area': { role: 'common', subtypeName: PENDING_SUBTYPE_NAME },
  'Back of House': { role: 'support', subtypeName: PENDING_SUBTYPE_NAME },
  'Commercial Space': { role: 'program', subtypeName: PENDING_SUBTYPE_NAME },
  'Other': { role: 'other', subtypeName: PENDING_SUBTYPE_NAME },
};

/**
 * Map a legacy `unit_type` string to a `{ role, subtypeName }` pair. The
 * Phase-2 SQL backfill mirrors this table exactly. Unknown, empty, and
 * `null`/`undefined` inputs fall back to `other` / `Other (pending)` — never
 * throws, so the backfill is total over whatever strings exist in the data.
 *
 * `unit_type` itself is NOT dropped by the migration (milestone applicability
 * still keys on it — see AGENTS.md §2); this only derives the additive
 * `top_level_role` + `subtype_id`.
 */
export function mapLegacyUnitType(unitType: string | null | undefined): LegacyUnitTypeMapping {
  const key = (unitType ?? '').trim();
  return LEGACY_UNIT_TYPE_MAP[key] ?? { role: 'other', subtypeName: PENDING_SUBTYPE_NAME };
}

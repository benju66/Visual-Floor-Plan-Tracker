import type { Database } from './database.types';
import { PROJECT_TYPES, type ProjectType, type TopLevelRole } from '@/utils/locationTaxonomy';

// The canonical taxonomy unions live in locationTaxonomy.ts (the framework-free
// source of truth). Re-export them here so domain.ts stays the single type
// registry (AGENTS.md §6) — the DB stores these as plain TEXT, so they can't be
// derived from database.types.ts.
export type { ProjectType, TopLevelRole };

export type Project    = Database['public']['Tables']['projects']['Row'];
export type Sheet      = Database['public']['Tables']['sheets']['Row'];
// Per-drawing sidecar for the Location Labeling Workbench (1:1 with a workbench
// `sheets` row). No JSONB columns, so no narrowing/guard needed (unlike Unit /
// Subtype). The `Unit` flags spans_levels/level_note/has_void are derived
// automatically from units['Row'] above — no hand-written extension.
export type WorkbenchSheet = Database['public']['Tables']['workbench_sheets']['Row'];
// A workbench drawing as the library lists it: a `sheets` row under the hidden
// workbench container, joined to its 1:1 `workbench_sheets` sidecar metadata
// (`workbench` is null until Phase 5 captures per-drawing metadata). Read ONLY
// via the dedicated workbench hooks (`src/hooks/useWorkbench.ts`), which always
// scope to the container so a workbench row can never reach a live surface.
export type WorkbenchDrawing = Sheet & { workbench: WorkbenchSheet | null };
export type Unit = Omit<Database['public']['Tables']['units']['Row'], 'polygon_coordinates'> & { polygon_coordinates: PercentPoint[] | null };
export type Milestone  = Database['public']['Tables']['project_milestones']['Row'];
export type StatusLog  = Database['public']['Tables']['status_logs']['Row'];
export type Profile    = Database['public']['Tables']['profiles']['Row'];
export type ProjectMember = Database['public']['Tables']['project_members']['Row'];
export type StatusAuditLog = Database['public']['Tables']['status_audit_log']['Row'];
export type MilestoneOverride = Database['public']['Tables']['milestone_applicability_overrides']['Row'];
// Look-Ahead Schedule plan (1:1 with a project). `doc` is the vendored module's
// `ProjectBlob`, stored opaquely as JSONB — keep it `Json` here and narrow it to
// `ProjectBlob` at the query boundary with `isProjectBlob` (src/lookahead/isProjectBlob.ts),
// never let `Json` reach component props (AGENTS.md §6). The blob's shape is owned
// by the vendored Look-Ahead module, not this central registry.
export type LookaheadPlan = Database['public']['Tables']['lookahead_plans']['Row'];
export type LookaheadPlanInsert = Database['public']['Tables']['lookahead_plans']['Insert'];

export type StatusLogInsert = Database['public']['Tables']['status_logs']['Insert'];
export type UnitInsert      = Database['public']['Tables']['units']['Insert'];
export type WorkbenchSheetInsert = Database['public']['Tables']['workbench_sheets']['Insert'];

// Sub-type dictionary row (Location Taxonomy). The two JSONB columns are
// narrowed off the generated `Json` to their real shapes (mirroring how `Unit`
// narrows `polygon_coordinates`); narrow them at the query boundary with the
// guards below. `aliases` is a list of alias-name strings that map TO this
// sub-type; `default_project_types` scopes the pick-list.
export type SubtypeStatus = 'active' | 'pending' | 'deprecated';
export type Subtype = Omit<
  Database['public']['Tables']['subtypes']['Row'],
  'aliases' | 'default_project_types'
> & {
  aliases: string[];
  default_project_types: ProjectType[];
};
export type SubtypeInsert = Database['public']['Tables']['subtypes']['Insert'];

export type TemporalState = 'planned' | 'ongoing' | 'completed' | 'none';
export type MemberRole    = 'admin' | 'pm' | 'superintendent' | 'viewer';
export type TrackName     = string;
export type TrackingMode  = TrackName;

export type PercentPoint = { pctX: number; pctY: number };
export type LegendPosition = { pctX: number; pctY: number; scaleX: number; scaleY: number; rotation: number; isVisible: boolean };
export type MilestoneScheduleEntry = { start_date?: string | null; end_date?: string | null };
export type MilestoneSchedules = Record<string, MilestoneScheduleEntry>;

export type UnitWithStatus = Unit & { status_logs?: StatusLog[] };

// Canvas layout computed from image dimensions
export type CanvasLayout = { offsetX: number; offsetY: number; drawW: number; drawH: number };

// Runtime-augmented StatusLog (outOfSequence is computed in-memory, not a DB column)
export type StatusLogAugmented = StatusLog & { outOfSequence?: BottleneckSequence[] };
export type BottleneckSequence = { milestone: string; status_color: string; temporal_state: string };

export interface PendingChange {
  unit: Unit;
  log: StatusLog | null;
  state: TemporalState;
  /** ISO timestamp — when change was made on-device (offline-capture time) */
  capturedAt: string;
  extraProps: {
    milestoneObj?: Pick<Milestone, 'name' | 'color' | 'track'>;
    startDate?: string | null;
    endDate?: string | null;
    loggedDate?: string | null;
    outOfSequence?: boolean;
  };
}

export type PendingChangesMap = Record<string, PendingChange>;

export function isPercentPointArray(val: unknown): val is PercentPoint[] {
  return (
    Array.isArray(val) &&
    val.every(p => typeof (p as PercentPoint).pctX === 'number' && typeof (p as PercentPoint).pctY === 'number')
  );
}

/**
 * Narrows a sub-type's `aliases` JSONB to a string array (the alias names that
 * map to this sub-type). Use at the query boundary, like {@link isPercentPointArray}.
 * Null-safe per element: a non-string element yields `false`, never throws.
 */
export function isStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every(v => typeof v === 'string');
}

/**
 * Narrows a sub-type's `default_project_types` JSONB to ProjectType[] — accepts
 * only arrays whose every element is one of the 8 canonical project types.
 */
export function isProjectTypeArray(val: unknown): val is ProjectType[] {
  return Array.isArray(val) && val.every(v => (PROJECT_TYPES as readonly string[]).includes(v as string));
}

/**
 * Narrows a milestone's `applies_to_unit_types` JSONB to a string array.
 * Returns null for null/empty/malformed values — meaning "applies to all unit types".
 */
export function getAppliesTo(milestone: Pick<Milestone, 'applies_to_unit_types'>): string[] | null {
  const val = milestone.applies_to_unit_types;
  if (!Array.isArray(val) || val.length === 0) return null;
  const strings = val.filter((t): t is string => typeof t === 'string');
  return strings.length > 0 ? strings : null;
}

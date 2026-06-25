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

// Project Contacts — a shared project-level contact directory (one row per
// person, grouped by company). Managed in the project Settings menu; later
// reused by Look-Ahead as a cell palette and bulk-imported from a Procore CSV.
// No JSONB columns, so no narrowing/guard needed (unlike Unit / Subtype).
export type ProjectContact = Database['public']['Tables']['project_contacts']['Row'];
export type ProjectContactInsert = Database['public']['Tables']['project_contacts']['Insert'];

export type StatusLogInsert = Database['public']['Tables']['status_logs']['Insert'];
export type UnitInsert      = Database['public']['Tables']['units']['Insert'];
export type WorkbenchSheetInsert = Database['public']['Tables']['workbench_sheets']['Insert'];

// Append-only AI-tracing capture log (one row per traced action). The JSONB
// before/after polygon + label columns stay `Json` here and are written through
// the camelCase `recordTraceEvent` helper (src/utils/traceCapture.ts), which owns
// the narrowing — never let `Json` reach component props (AGENTS.md §6).
export type TraceEvent = Database['public']['Tables']['trace_events']['Row'];
export type TraceEventInsert = Database['public']['Tables']['trace_events']['Insert'];

// 1:1 cache of a sheet's extracted PDF text words (AI Tracing Assist — Phase 1).
// It IS the sheet_vectors write-through pattern, for text: keyed by sheet_id,
// the `text` JSONB column holds `[{ text, pctX, pctY }]` in the SAME percent
// space as units.polygon_coordinates / sheet_vectors. Kept as the raw Row here
// (text stays `Json`), mirroring TraceEvent / LookaheadPlan: the phase that
// consumes this cache adds the read hook and narrows `text` to
// `{ text, pctX, pctY }[]` at its query boundary — never letting `Json` reach
// component props (AGENTS.md §6). A scanned sheet with no text layer caches an
// empty array (an OCR candidate, not an error).
export type SheetText = Database['public']['Tables']['sheet_text']['Row'];
export type SheetTextInsert = Database['public']['Tables']['sheet_text']['Insert'];

// Confirmed title-block facts for a sheet (AI Tracing Assist — Phase 3a). A 1:1
// verified-capture annotation: the human-confirmed sheet number / name / architect
// firm read from the title block, plus Milestone-1 provenance. The two JSONB
// columns (`title_block_bbox`, `suggested_fields`) stay `Json` on the Row and are
// narrowed at the query boundary via the guards below — never let `Json` reach
// component props (AGENTS.md §6). Mirrors SheetText / TraceEvent.
export type SheetMetadata = Omit<
  Database['public']['Tables']['sheet_metadata']['Row'],
  'title_block_bbox' | 'suggested_fields'
> & {
  title_block_bbox: PercentRect | null;
  suggested_fields: TitleBlockFields | null;
};
export type SheetMetadataInsert = Database['public']['Tables']['sheet_metadata']['Insert'];

// The percent-space (0..1) rectangle a user drags over a region (e.g. the title
// block) — the narrowed shape of `sheet_metadata.title_block_bbox`, and the single
// source of truth for that box geometry across the parser, the canvas capture-box
// callback, and the write hook.
export type PercentRect = { x0: number; y0: number; x1: number; y1: number };

// The proposed/confirmed title-block fields — the narrowed shape of
// `sheet_metadata.suggested_fields` (the FROZEN original machine proposal) and the
// return type of the pure title-block parser (`src/utils/titleBlockParse.ts`).
export type TitleBlockFields = {
  sheetNumber: string | null;
  sheetName: string | null;
  architectFirm: string | null;
};

// One located PDF text word from {@link SheetText}.text — the word string plus its
// bbox-center position in the SAME percent space as {@link PercentPoint} /
// units.polygon_coordinates / sheet_vectors. The narrowed shape of the `text` JSONB
// (AI Tracing Assist — Phase 2 is the consuming phase, so the guard lives here).
export type TextWord = { text: string; pctX: number; pctY: number };

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
 * Narrows {@link SheetText}.text (typed `Json` by the generator) to {@link TextWord}[]
 * at the query boundary (AGENTS.md §6). An empty array is valid — it is the legitimate
 * "scanned sheet / no text layer" state, not a failure. Like {@link isPercentPointArray}
 * it is NOT null-safe per element (a `null`/non-object element throws, not `false`);
 * the backend only ever caches well-formed words, so test with safe primitives.
 */
export function isTextWordArray(val: unknown): val is TextWord[] {
  return (
    Array.isArray(val) &&
    val.every(
      w =>
        typeof (w as TextWord).text === 'string' &&
        typeof (w as TextWord).pctX === 'number' &&
        typeof (w as TextWord).pctY === 'number',
    )
  );
}

/**
 * Narrows `sheet_metadata.title_block_bbox` (typed `Json`) to a {@link PercentRect}
 * at the query boundary (AGENTS.md §6). Null-safe: a null/non-object/partial value
 * yields `false`, never throws.
 */
export function isPercentRect(val: unknown): val is PercentRect {
  if (!val || typeof val !== 'object') return false;
  const r = val as Record<string, unknown>;
  return (
    typeof r.x0 === 'number' &&
    typeof r.y0 === 'number' &&
    typeof r.x1 === 'number' &&
    typeof r.y1 === 'number'
  );
}

/**
 * Narrows `sheet_metadata.suggested_fields` (typed `Json`) to {@link TitleBlockFields}
 * — the frozen original proposal — at the query boundary (AGENTS.md §6). Each field
 * is a string or null. Null-safe: a malformed value yields `false`, never throws.
 */
export function isTitleBlockFields(val: unknown): val is TitleBlockFields {
  if (!val || typeof val !== 'object') return false;
  const f = val as Record<string, unknown>;
  const ok = (v: unknown) => v === null || typeof v === 'string';
  return ok(f.sheetNumber) && ok(f.sheetName) && ok(f.architectFirm);
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

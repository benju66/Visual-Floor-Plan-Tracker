import { supabase } from '@/supabaseClient';
import type { PercentPoint, TraceEventInsert, Unit } from '@/types/domain';

// AI-tracing capture (plan M1 / docs/ANNOTATION_SPEC.md). Turns every workbench
// trace into model-ready training data WITH the human-correction signal: durable
// provenance lands on the `units` row, and this module appends a richer, immutable
// `trace_events` row per action. All capture is BEST-EFFORT — it must never block
// or break a trace, so the event write here never throws.

/** The annotation-spec version every trace is stamped with (docs/ANNOTATION_SPEC.md). */
export const ANNOTATION_SPEC_VERSION = 'v1';

/**
 * How a trace's GEOMETRY originated. The DB column is plain TEXT (so a new method
 * never needs a migration); this union is the source of truth. `manual` = drawn by
 * hand; the rest are wired as the AI-assist spike lands (geometric room-detect,
 * SAM click-to-segment, vision-LLM, bulk import).
 */
export const TRACE_METHODS = ['manual', 'geometric', 'sam', 'vision_llm', 'imported'] as const;
export type TraceMethod = (typeof TRACE_METHODS)[number];

/**
 * Provenance of a trace's FINAL accepted value. `human` = made from scratch;
 * `ai_suggested` = an untouched machine proposal; `ai_accepted` = a proposal kept
 * as-is; `ai_edited` = a proposal a human corrected (the highest-value signal).
 */
export const TRACE_SOURCES = ['human', 'ai_suggested', 'ai_accepted', 'ai_edited'] as const;
export type TraceSource = (typeof TRACE_SOURCES)[number];

export type TraceEventType =
  | 'create'
  | 'update_label'
  | 'update_geometry'
  | 'delete'
  | 'accept_suggestion'
  | 'reject_suggestion';

/** The label fields captured in a before/after trace snapshot (no geometry). */
export interface LabelSnapshot {
  unit_number: string | null;
  unit_type: string | null;
  top_level_role: string | null;
  subtype_id: string | null;
  spans_levels: boolean | null;
  level_note: string | null;
  has_void: boolean | null;
}

/** Build a label snapshot from a `units` row. */
export function labelSnapshotFromUnit(u: Unit): LabelSnapshot {
  return {
    unit_number: u.unit_number ?? null,
    unit_type: u.unit_type ?? null,
    top_level_role: u.top_level_role ?? null,
    subtype_id: u.subtype_id ?? null,
    spans_levels: u.spans_levels ?? null,
    level_note: u.level_note ?? null,
    has_void: u.has_void ?? null,
  };
}

/**
 * When a human edits an existing label, the FINAL source becomes `ai_edited` if the
 * value originated from a machine proposal, else plain `human`. This is what makes
 * the suggested-vs-corrected signal work the moment AI assist lands — today every
 * edit is `human` because nothing AI-origin exists yet.
 */
export function deriveEditSource(beforeSource: string | null | undefined): TraceSource {
  return beforeSource && beforeSource.startsWith('ai') ? 'ai_edited' : 'human';
}

/** A friendly (camelCase) shape for recording one trace event. */
export interface TraceEventDraft {
  sheetId: string;
  unitId?: string | null;
  eventType: TraceEventType;
  method?: TraceMethod | null;
  source?: TraceSource | null;
  beforePolygon?: PercentPoint[] | null;
  afterPolygon?: PercentPoint[] | null;
  beforeLabel?: LabelSnapshot | null;
  afterLabel?: LabelSnapshot | null;
  modelVersion?: string | null;
  /** Wall-clock ms the user spent on this action — the metric that proves AI speeds tracing up. */
  durationMs?: number | null;
  groupKey?: string | null;
}

/**
 * Append one row to the immutable `trace_events` log. BEST-EFFORT by design: the
 * durable per-unit provenance on `units` is the source of truth, so a failed event
 * write must never break or block a trace. Never throws. `created_by` is left to the
 * DB default (`auth.uid()`), which also satisfies the append-only RLS INSERT check.
 */
export async function recordTraceEvent(draft: TraceEventDraft): Promise<void> {
  const row: TraceEventInsert = {
    sheet_id: draft.sheetId,
    unit_id: draft.unitId ?? null,
    event_type: draft.eventType,
    method: draft.method ?? null,
    source: draft.source ?? null,
    before_polygon: (draft.beforePolygon ?? null) as TraceEventInsert['before_polygon'],
    after_polygon: (draft.afterPolygon ?? null) as TraceEventInsert['after_polygon'],
    before_label: (draft.beforeLabel ?? null) as TraceEventInsert['before_label'],
    after_label: (draft.afterLabel ?? null) as TraceEventInsert['after_label'],
    model_version: draft.modelVersion ?? null,
    duration_ms: draft.durationMs ?? null,
    group_key: draft.groupKey ?? null,
    spec_version: ANNOTATION_SPEC_VERSION,
  };
  try {
    const { error } = await supabase.from('trace_events').insert([row]);
    if (error) throw error;
  } catch (err) {
    console.warn('[traceCapture] trace_events write failed (non-fatal):', err);
  }
}

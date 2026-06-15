import type { Database } from './database.types';

export type Project    = Database['public']['Tables']['projects']['Row'];
export type Sheet      = Database['public']['Tables']['sheets']['Row'];
export type Unit = Omit<Database['public']['Tables']['units']['Row'], 'polygon_coordinates'> & { polygon_coordinates: PercentPoint[] | null };
export type Milestone  = Database['public']['Tables']['project_milestones']['Row'];
export type StatusLog  = Database['public']['Tables']['status_logs']['Row'];
export type Profile    = Database['public']['Tables']['profiles']['Row'];
export type ProjectMember = Database['public']['Tables']['project_members']['Row'];
export type StatusAuditLog = Database['public']['Tables']['status_audit_log']['Row'];
export type MilestoneOverride = Database['public']['Tables']['milestone_applicability_overrides']['Row'];

export type StatusLogInsert = Database['public']['Tables']['status_logs']['Insert'];
export type UnitInsert      = Database['public']['Tables']['units']['Insert'];

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
 * Narrows a milestone's `applies_to_unit_types` JSONB to a string array.
 * Returns null for null/empty/malformed values — meaning "applies to all unit types".
 */
export function getAppliesTo(milestone: Pick<Milestone, 'applies_to_unit_types'>): string[] | null {
  const val = milestone.applies_to_unit_types;
  if (!Array.isArray(val) || val.length === 0) return null;
  const strings = val.filter((t): t is string => typeof t === 'string');
  return strings.length > 0 ? strings : null;
}

import type { StatusLogInsert, TemporalState, PercentPoint, StatusLog } from './domain';

export interface UpdateStatusVars extends Omit<StatusLogInsert, 'id' | 'created_at'> {}

export interface BulkUpdateStatusVars {
  unitIds: string[];
  milestone: string | '__KEEP_EXISTING__' | null;
  color: string;
  temporal_state: TemporalState | '__KEEP_EXISTING__';
  track: string;
  planned_start_date?: string | null;
  planned_end_date?: string | null;
  logged_date?: string | null;
  bottlenecks?: StatusLog[];
}

export interface UpdateUnitGeometryVars {
  unitId: string;
  polygon_coordinates: PercentPoint[];
}

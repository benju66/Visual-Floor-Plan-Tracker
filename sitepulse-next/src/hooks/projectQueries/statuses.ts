import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import type { StatusLog, TemporalState } from '@/types/domain';
import type { Database, Json } from '@/types/database.types';
import type { BulkUpdateStatusVars, UpdateStatusVars } from '@/types/mutations';
import { fetchAllIn, fetchStatusLogsForUnits } from './shared';
import {
  stripStatusWriteFields,
  withFallbackClientTimestamp,
  stampCompletionDate,
} from '@/utils/statusWrite';

type StatusLogInsert = Database['public']['Tables']['status_logs']['Insert'];

export function useStatuses(sheetId: string, unitIds: string[]) {
  const validUnitIds = unitIds?.filter(id => !String(id).startsWith('temp_')) || [];

  return useQuery({
    queryKey: queryKeys.statuses(sheetId, validUnitIds),
    queryFn: async (): Promise<StatusLog[]> => {
      if (!sheetId || validUnitIds.length === 0) return [];
      // Paginate: a single dense sheet (units × activities) can exceed PostgREST's
      // 1000-row cap, which would otherwise truncate logs and show stale statuses.
      // The slot-unique constraint (unit_id, activity_id) means no dedup needed.
      return fetchStatusLogsForUnits(validUnitIds);
    },
    enabled: !!sheetId && validUnitIds.length > 0,
    placeholderData: keepPreviousData
  });
}

export function useAllProjectStatuses(unitIds: string[]) {
  const validUnitIds = unitIds?.filter(id => !String(id).startsWith('temp_')) || [];
  return useQuery({
    queryKey: queryKeys.allProjectStatuses(validUnitIds),
    queryFn: async (): Promise<StatusLog[]> => {
      if (validUnitIds.length === 0) return [];
      // With the slot-unique constraint (unit_id, activity_id), the DB guarantees
      // one row per slot, so paginated chunks never overlap. No dedup needed.
      return fetchStatusLogsForUnits(validUnitIds);
    },
    enabled: validUnitIds.length > 0,
    placeholderData: keepPreviousData
  });
}

export function useUpdateStatus(sheetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (newLogData: UpdateStatusVars) => {
      // Phase 5 (Status Sequencing DB backstop): upsert_status_log now PRESERVES a field
      // whose JSON key is ABSENT and only CLEARS one that is present-but-null/empty. So we
      // must NOT drop a null logged_date — dropping it would turn an explicit "clear the
      // completion date" into a silent preserve. commitUnitActivity always sends logged_date
      // explicitly (a real value, or null to clear), so leaving the key present is exactly
      // the intent. (present-null and present-'' are equivalent clears in the RPC.)
      //
      // stripStatusWriteFields drops id/created_at + the synthesized activityName (the RPC
      // keys by activity_id) + the legacy milestone key; withFallbackClientTimestamp keeps
      // a capture-time client_timestamp (PendingChange.capturedAt) and stamps now only for
      // immediate online mutations (statusWrite.ts — the shared write contract).
      const safeData = withFallbackClientTimestamp(
        stripStatusWriteFields(newLogData),
        new Date().toISOString()
      );

      const { data, error } = await supabase
        .rpc('upsert_status_log', { log_data: safeData as Json })
        .single();
      if (error) throw error;
      return data;
    },
    onMutate: async (newLogData) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.statusesBySheet(sheetId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.allProjectStatusesAll() });

      const optimisticLog = {
        ...newLogData,
        id: `temp_${Date.now()}`,
        created_at: new Date().toISOString()
      } as StatusLog;

      queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.statusesBySheet(sheetId) }, old => {
        if (!old) return old;
        const filtered = old.filter(s => !(s.unit_id === newLogData.unit_id && s.activity_id === newLogData.activity_id));
        return [...filtered, optimisticLog];
      });

      queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.allProjectStatusesAll() }, old => {
        if (!old) return old;
        const filtered = old.filter(s => !(s.unit_id === newLogData.unit_id && s.activity_id === newLogData.activity_id));
        return [...filtered, optimisticLog];
      });

      return {};
    },
    onError: () => {},
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.statusesBySheet(sheetId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.allProjectStatusesAll() });
    }
  });
}

export function useClearStatus(sheetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ unitId, track, activityId }: { unitId: string, track: string, activityId: string, activityName?: string }) => {
      const newLog = {
          unit_id: unitId,
          track: track,
          activity_id: activityId,
          temporal_state: 'none' as TemporalState,
          // Clearing a slot to Not Started is a FULL reset. Post-Phase-5, upsert_status_log
          // PRESERVES any field we omit, so we must send these explicitly-empty to keep wiping
          // the slot's color + dates — a 'none' slot must not carry a stale color or a
          // planned/completion/actual-start date. '' is the RPC's present-but-empty clear
          // (NULLIF(...,'') → NULL). Before Phase 5 the same reset happened by omission
          // (absent = clear); now it is intentional and explicit.
          status_color: '',
          planned_start_date: '',
          planned_end_date: '',
          logged_date: '',
          actual_start_date: '',
          client_timestamp: new Date().toISOString()
      };
      const { error } = await supabase.rpc('upsert_status_log', { log_data: newLog });
      if (error) throw error;
    },
    onMutate: async ({ unitId, track, activityId, activityName }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.statusesBySheet(sheetId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.allProjectStatusesAll() });

      const optimisticLog = {
        unit_id: unitId,
        track,
        activity_id: activityId,
        activityName: activityName ?? '',
        temporal_state: 'none' as TemporalState,
        id: `temp_clear_${Date.now()}`,
        created_at: new Date().toISOString(),
        status_color: 'rgba(0,0,0,0)',
        planned_start_date: null,
        planned_end_date: null,
        logged_date: new Date().toISOString(),
        client_timestamp: null
      } as StatusLog;

      queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.statusesBySheet(sheetId) }, old => {
        if (!old) return old;
        const filtered = old.filter(s => !(s.unit_id === unitId && s.activity_id === activityId));
        return [...filtered, optimisticLog];
      });

      queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.allProjectStatusesAll() }, old => {
        if (!old) return old;
        const filtered = old.filter(s => !(s.unit_id === unitId && s.activity_id === activityId));
        return [...filtered, optimisticLog];
      });

      return {};
    },
    onError: () => {},
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.statusesBySheet(sheetId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.allProjectStatusesAll() });
    }
  });
}

export function useBulkUpdateStatus(sheetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ unitIds, activityName, activity_id, color, temporal_state, track, planned_start_date, planned_end_date, logged_date, bottlenecks }: BulkUpdateStatusVars) => {
      const CHUNK_SIZE = 800;

      // '__KEEP_EXISTING__' updates the temporal_state of each unit's existing slot; a
      // real bulk-apply carries the resolved activity_id (the stable slot key). A null
      // activityName/activity_id with no keep sentinel is a no-op (matches prior behavior).
      const keepExisting = activityName === '__KEEP_EXISTING__';

      for (let i = 0; i < unitIds.length; i += CHUNK_SIZE) {
        const chunkIds = unitIds.slice(i, i + CHUNK_SIZE);

        if (keepExisting) {
          if (temporal_state !== '__KEEP_EXISTING__') {
            // Write rows for the (unit_id, activity_id) upsert — always fully
            // formed here (both branches pick explicit fields; id/created_at
            // never ride a write). client_timestamp is stamped on the safe copy.
            type SlotWrite = Pick<StatusLog,
              'unit_id' | 'activity_id' | 'status_color' | 'temporal_state' | 'track' |
              'planned_start_date' | 'planned_end_date' | 'logged_date'
            > & { client_timestamp?: StatusLog['client_timestamp'] };
            const newLogs: SlotWrite[] = [];

            if (bottlenecks && bottlenecks.length > 0) {
              for (const id of chunkIds) {
                const b = bottlenecks.find(b => b.unit_id === id);
                if (b) {
                  newLogs.push({
                     unit_id: id,
                     activity_id: b.activity_id,
                     status_color: b.status_color || '',
                     temporal_state,
                     track,
                     planned_start_date: planned_start_date !== undefined ? planned_start_date : b.planned_start_date,
                     planned_end_date: planned_end_date !== undefined ? planned_end_date : b.planned_end_date,
                     logged_date: logged_date !== undefined ? logged_date : b.logged_date
                  });
                }
              }
            } else {
              // Chunked + paginated readback (fetchAllIn): the old single
              // `.in(unit_id, <up to 800 ids>)` blew the ~8KB request-URL limit
              // AND silently truncated at PostgREST's 1000-row cap — slots past
              // the cap vanished from latestStatusMap, so those units were
              // skipped by the bulk update while the toast still reported
              // "N locations updated". Track is filtered client-side (fetchAllIn
              // is generic over the id column only).
              const allLogs = await fetchAllIn<StatusLog>('status_logs', 'unit_id', chunkIds);
              const latestLogs = allLogs.filter(l => l.track === track);

              const latestStatusMap: Record<string, StatusLog> = {};
              latestLogs.forEach(log => {
                const key = `${log.unit_id}_${log.activity_id}`;
                if (!latestStatusMap[key] || new Date(log.created_at || 0) >= new Date(latestStatusMap[key].created_at || 0)) {
                  latestStatusMap[key] = log as unknown as StatusLog;
                }
              });

              for (const id of chunkIds) {
                const existingArray = Object.values(latestStatusMap).filter(s => s.unit_id === id);
                for (const existing of existingArray) {
                    newLogs.push({
                       unit_id: id,
                       activity_id: existing.activity_id,
                       status_color: existing.status_color,
                       temporal_state,
                       track,
                       planned_start_date: planned_start_date !== undefined ? planned_start_date : existing.planned_start_date,
                       planned_end_date: planned_end_date !== undefined ? planned_end_date : existing.planned_end_date,
                       logged_date: logged_date !== undefined ? logged_date : existing.logged_date
                    });
                }
              }
            }

            if (newLogs.length > 0) {
              const today = new Date().toISOString().split('T')[0];
              const clientTimestamp = new Date().toISOString();
              // Today is stamped ONLY for a genuinely-new completion (state is
              // 'completed' and no date survived the merge) — a bulk "mark Planned/
              // Ongoing" must never fabricate a completion date (mirrors
              // commitUnitActivity's single-path rule). Every row's temporal_state
              // is the one caller-supplied value, so the row-level check in
              // stampCompletionDate (statusWrite.ts) is the same condition.
              const safeNewLogs = newLogs.map(l =>
                stampCompletionDate({ ...l, client_timestamp: clientTimestamp }, today));
              const { error: upsertError } = await supabase.from('status_logs').upsert(safeNewLogs, { onConflict: 'unit_id,activity_id' });
              if (upsertError) throw upsertError;
            }
          }
        } else {
          if (activity_id && temporal_state !== '__KEEP_EXISTING__') {
            // Completion date: honor a caller-supplied value; otherwise today ONLY for a
            // completion, explicit-null for every other state (present-clears — a slot
            // re-marked planned/ongoing must not keep, or gain, a completion date).
            const finalLoggedDate = logged_date !== undefined ? logged_date : (temporal_state === 'completed' ? new Date().toISOString().split('T')[0] : null);
            const clientTimestamp = new Date().toISOString();
            const newLogs = chunkIds.map(id => {
              const baseLog: Record<string, unknown> = {
                unit_id: id,
                activity_id: activity_id as string,
                status_color: color,
                temporal_state,
                track,
                logged_date: finalLoggedDate,
                client_timestamp: clientTimestamp
              };
              // Omit-preserves, present-clears (the Phase-5 RPC contract, applied to the
              // bulk upsert): an undefined planned date is OMITTED so the conflict-update
              // leaves the stored window untouched; an explicit value/null/'' is sent to
              // set/clear it. Keys stay uniform across the chunk (they derive from one
              // caller arg), which PostgREST bulk writes require.
              if (planned_start_date !== undefined) baseLog.planned_start_date = planned_start_date || null;
              if (planned_end_date !== undefined) baseLog.planned_end_date = planned_end_date || null;
              return baseLog;
            });

            const { error: upsertError } = await supabase.from('status_logs').upsert(newLogs as any, { onConflict: 'unit_id,activity_id' });
            if (upsertError) throw upsertError;
          }
        }
      }
    },
    onMutate: async ({ unitIds, activityName, activity_id, color, temporal_state, track, planned_start_date, planned_end_date, logged_date }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.statusesBySheet(sheetId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.allProjectStatusesAll() });

      const updateCache = (old: StatusLog[] | undefined) => {
        if (!old) return old;

        if (activityName === '__KEEP_EXISTING__') {
          if (temporal_state === '__KEEP_EXISTING__') return old;
          return old.map(s => {
            if (unitIds.includes(s.unit_id as string) && s.track === track) {
              return {
                  ...s,
                  temporal_state: temporal_state as TemporalState,
                  planned_start_date: planned_start_date !== undefined ? planned_start_date : s.planned_start_date,
                  planned_end_date: planned_end_date !== undefined ? planned_end_date : s.planned_end_date,
                  logged_date: logged_date !== undefined ? logged_date : s.logged_date
              };
            }
            return s;
          });
        }

        // Prior rows for this slot, read BEFORE filtering: an omitted planned date
        // preserves the stored window in the cache exactly as the omit-preserves
        // upsert does in the DB (keeps cache and server in agreement).
        const priorBySlot = new Map<string, StatusLog>();
        for (const s of old) {
          if (unitIds.includes(s.unit_id as string) && s.activity_id === activity_id) priorBySlot.set(s.unit_id as string, s);
        }
        const filtered = old.filter(s => !(unitIds.includes(s.unit_id as string) && s.activity_id === activity_id));

        if (activityName === null || activity_id == null || temporal_state === '__KEEP_EXISTING__') {
          return filtered;
        }

        const finalLoggedDate = logged_date !== undefined ? logged_date : (temporal_state === 'completed' ? new Date().toISOString().split('T')[0] : null);
        const now = new Date().toISOString();
        const optimisticLogs = unitIds.map(id => ({
          id: `temp_${id}_${Date.now()}`,
          unit_id: id,
          activity_id,
          activityName,
          status_color: color,
          temporal_state: temporal_state as TemporalState,
          track,
          planned_start_date: planned_start_date !== undefined ? (planned_start_date || null) : (priorBySlot.get(id)?.planned_start_date ?? null),
          planned_end_date: planned_end_date !== undefined ? (planned_end_date || null) : (priorBySlot.get(id)?.planned_end_date ?? null),
          logged_date: finalLoggedDate,
          created_at: now,
          client_timestamp: now
        } as StatusLog));
        return [...filtered, ...optimisticLogs];
      };

      queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.statusesBySheet(sheetId) }, updateCache);
      queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.allProjectStatusesAll() }, updateCache);

      return {};
    },
    onError: () => {},
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.statusesBySheet(sheetId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.allProjectStatusesAll() });
    }
  });
}

export function useBulkInsertStatusLogs(sheetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (logsArray: StatusLog[]) => {
      const today = new Date().toISOString().split('T')[0];
      const clientTimestamp = new Date().toISOString();
      // The feeders (import / cascade / ripple) deliberately carry prior progress
      // through (`prior?.logged_date ?? null`) under the contract that a schedule
      // write never fabricates progress. stampCompletionDate stamps today ONLY when
      // the row itself records a completion missing its date; stripStatusWriteFields
      // drops id/created_at + the synthesized activityName + the legacy milestone
      // key (statusWrite.ts — the shared write contract).
      const safeLogs = logsArray.map(log => {
        const copy = stripStatusWriteFields(stampCompletionDate(log, today));
        copy.client_timestamp = clientTimestamp;
        return copy;
      });

      const CHUNK_SIZE = 800;
      for (let i = 0; i < safeLogs.length; i += CHUNK_SIZE) {
        const chunk = safeLogs.slice(i, i + CHUNK_SIZE);
        const { error } = await supabase.from('status_logs').upsert(chunk as StatusLogInsert[], { onConflict: 'unit_id,activity_id' });
        if (error) throw error;
      }
    },
    onMutate: async (logsArray) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.statusesBySheet(sheetId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.allProjectStatusesAll() });

      const updateCache = (old: StatusLog[] | undefined) => {
        if (!old) return old;

        const keysToRemove = new Set(logsArray.map(l => `${l.unit_id}_${l.activity_id}`));
        const filtered = old.filter(s => !keysToRemove.has(`${s.unit_id}_${s.activity_id}`));

        const optimisticLogs = logsArray.map((l, idx) => ({
          ...l,
          id: `temp_${Date.now()}_${idx}`,
          created_at: new Date().toISOString()
        } as StatusLog));
        return [...filtered, ...optimisticLogs];
      };

      queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.statusesBySheet(sheetId) }, updateCache);
      queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.allProjectStatusesAll() }, updateCache);
      return {};
    },
    onError: () => {},
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.statusesBySheet(sheetId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.allProjectStatusesAll() });
    }
  });
}

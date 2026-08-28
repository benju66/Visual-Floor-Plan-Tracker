import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/supabaseClient';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/types/queryKeys';
import type { Unit, StatusLog } from '@/types/domain';
import type { Json } from '@/types/database.types';
import type { ToolMode } from '@/store/useMapStore';
import { buildStatusResetPayload, buildStatusRestorePayload, type UndoStatusPayload } from '@/utils/undoWrite';

export interface UndoAction {
  actionType: 'UPDATE_GEOMETRY' | 'DELETE_UNIT' | 'UPDATE_STATUS' | 'BULK_UPDATE_STATUS' | 'CREATE_UNIT';
  unitId?: string;
  unitData?: Unit;
  statusLogs?: StatusLog[];
  oldData?: any;
  newData?: any;
  oldLog?: StatusLog | null;
  newLog?: StatusLog | null;
  // Status Sequencing Phase 4: an auto-advance side-write teed up alongside a status
  // completion (commitUnitActivity's `if (target)` block). When present, ONE undo/redo
  // reverses/re-applies BOTH slots so nothing is left half-changed. The teed-up slot's
  // "before" is ALWAYS Not Started — planAutoAdvance only ever targets a 'none' slot
  // (Phase 1) — so we store just `newLog` (its 'planned' after-state): undo restores it
  // to none, redo re-writes this planned log. `unitId` is the same unit as the primary.
  secondary?: { unitId: string; newLog?: StatusLog | null };
  unitIds?: string[];
  track?: string;
  activityName?: string;
  oldLogs?: StatusLog[];
  newLogs?: StatusLog[];
}

interface UseUndoRedoProps {
  toolMode: ToolMode;
  sheetId: string;
}

/**
 * Write ONE status slot through the `upsert_status_log` RPC — the single-mutation
 * form AGENTS §2 sanctions (bulk paths keep `.upsert({ onConflict })`), and the only
 * route with the last-write-wins guard and the omit-preserves/present-clears merge.
 *
 * THROWS on failure. Undo/redo used to discard every write result, so a rejected
 * write looked exactly like a successful one: the screen reverted, the database
 * didn't, and nobody was told. Throwing is what stops it silently succeeding —
 * surfacing the failure to the user (and deciding what happens to the undo stack)
 * is Phase 3's job.
 */
async function writeStatusSlot(payload: UndoStatusPayload): Promise<void> {
  const { error } = await supabase.rpc('upsert_status_log', { log_data: payload as Json });
  if (error) throw error;
}

export function useUndoRedo({ toolMode, sheetId }: UseUndoRedoProps) {
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAction[]>([]);
  const queryClient = useQueryClient();

  const triggerUndo = useCallback(async () => {
    if (undoStack.length === 0 || !sheetId) return;
    const action = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, action]);

    switch (action.actionType) {
      case 'UPDATE_GEOMETRY':
        queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, (old) => {
          if (!old) return old;
          return old.map(u => u.id === action.unitId ? { ...u, polygon_coordinates: action.oldData } : u);
        });
        await supabase.from('units').update({ polygon_coordinates: action.oldData as any }).eq('id', action.unitId as string);
        break;

      case 'DELETE_UNIT': {
        const unit = action.unitData;
        const logs = action.statusLogs;
        if (unit) {
          queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, (old) => {
            const without = (old || []).filter(u => u.id !== unit.id);
            return [...without, unit];
          });
        }
        if (unit && logs?.length) {
          queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.statusesBySheet(sheetId) }, (old) => {
            const without = (old || []).filter(s => s.unit_id !== unit.id);
            return [...without, ...logs];
          });
        }
        // Insert the unit before its status rows (status_logs.unit_id references units.id).
        if (unit) {
          await supabase.from('units').insert([unit as any]);
        }
        if (logs?.length) {
          // Strip the synthesized `activityName` (not a status_logs column); the slot
          // key is (unit_id, activity_id).
          const rows = logs.map(({ activityName, ...rest }: any) => rest);
          await supabase.from('status_logs').upsert(rows as any, { onConflict: 'unit_id,activity_id' });
        }
        break;
      }

      case 'UPDATE_STATUS': {
        // The slot this action touched. With neither snapshot there is no slot key at
        // all and nothing to write (structurally impossible from the push sites).
        const ref = action.oldLog ?? action.newLog;
        const unitId = action.unitId ?? ref?.unit_id ?? null;
        const activityId = ref?.activity_id ?? null;
        // One timestamp for the whole undo — see writeStatusSlot / undoWrite.ts: an undo
        // is a new decision made NOW, so it stamps fresh and wins last-write-wins.
        const nowIso = new Date().toISOString();

        queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.statusesBySheet(sheetId) }, (old) => {
          if (!old) return old;
          const filtered = old.filter(s => !(s.unit_id === action.unitId && s.activity_id === activityId));
          if (action.oldLog) {
            return [...filtered, action.oldLog];
          } else {
            return [...filtered, { unit_id: action.unitId, track: ref?.track, activity_id: activityId, activityName: ref?.activityName ?? '', temporal_state: 'none', id: `temp_${Date.now()}`, created_at: new Date().toISOString() } as StatusLog];
          }
        });

        if (action.oldLog) {
          // Put the previous value back exactly as captured (minus the DB-owned and
          // synthesized keys), with a fresh timestamp so the restore isn't rejected as
          // stale by the RPC's last-write-wins guard.
          await writeStatusSlot(buildStatusRestorePayload(action.oldLog, nowIso));
        } else if (unitId && activityId) {
          // The slot had NO prior status, so undo leaves a clean Not Started: colour and
          // all four dates cleared, present-and-empty (omitting them would PRESERVE the
          // values being undone). Never a row delete — RLS forbids client deletes on
          // status_logs, and deleting would break the history timeline's continuity.
          await writeStatusSlot(buildStatusResetPayload(unitId, activityId, ref?.track, nowIso));
        }

        // Phase 4: the SAME Undo also reverses the auto-advance side-write. That slot was
        // Not Started before it was teed up (planAutoAdvance only advances a 'none' slot),
        // so restore it to none — the identical cache + DB path the primary's first-time
        // ("no oldLog") branch above uses.
        if (action.secondary && action.secondary.newLog) {
          const secUnitId = action.secondary.unitId;
          const secLog = action.secondary.newLog;
          queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.statusesBySheet(sheetId) }, (old) => {
            if (!old) return old;
            const filtered = old.filter(s => !(s.unit_id === secUnitId && s.activity_id === secLog.activity_id));
            return [...filtered, { unit_id: secUnitId, track: secLog.track, activity_id: secLog.activity_id, activityName: secLog.activityName ?? '', temporal_state: 'none', id: `temp_${Date.now()}`, created_at: new Date().toISOString() } as StatusLog];
          });
          await writeStatusSlot(buildStatusResetPayload(secUnitId, secLog.activity_id, secLog.track, nowIso));
        }
        break;
      }

      case 'BULK_UPDATE_STATUS':
        queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.statusesBySheet(sheetId) }, (old) => {
          if (!old) return old;
          
          let filtered: StatusLog[];
          if (action.activityName && action.activityName !== '__KEEP_EXISTING__') {
            filtered = old.filter(s => !(action.unitIds?.includes(s.unit_id as string) && s.track === action.track && s.activityName === action.activityName));
          } else {
            filtered = old.filter(s => !(action.unitIds?.includes(s.unit_id as string) && s.track === action.track));
          }

          let addedBack: StatusLog[] = [];
          if (action.oldLogs && action.oldLogs.length > 0) {
            addedBack = [...action.oldLogs];
          }

          if (action.activityName && action.activityName !== '__KEEP_EXISTING__') {
             const unitsWithOldLog = new Set(action.oldLogs?.map(l => l.unit_id) || []);
             const unitsMissing = action.unitIds?.filter(id => !unitsWithOldLog.has(id)) || [];
             unitsMissing.forEach(id => {
                addedBack.push({ unit_id: id, track: action.track as string, activityName: action.activityName as string, temporal_state: 'none', id: `temp_${id}_${Date.now()}` } as StatusLog);
             });
          }

          return [...filtered, ...addedBack];
        });
        
        {
          const CHUNK_SIZE = 800;
          const logsToInsert: any[] = [];
          if (action.oldLogs && action.oldLogs.length > 0) {
             // Strip the synthesized `activityName` (not a column); rows carry activity_id.
             logsToInsert.push(...action.oldLogs.map(({ id, created_at, activityName, ...rest }: any) => rest));
          }

          if (logsToInsert.length > 0) {
            for (let i = 0; i < logsToInsert.length; i += CHUNK_SIZE) {
              await supabase.from('status_logs').upsert(logsToInsert.slice(i, i + CHUNK_SIZE) as any, { onConflict: 'unit_id,activity_id' });
            }
          }
        }
        break;

      case 'CREATE_UNIT':
        queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, (old) => old ? old.filter(u => u.id !== action.unitData?.id) : old);
        if (action.unitData) {
          await supabase.from('units').delete().eq('id', action.unitData.id);
        }
        break;
    }
  }, [undoStack, sheetId, queryClient]);

  const triggerRedo = useCallback(async () => {
    if (redoStack.length === 0 || !sheetId) return;
    const action = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    setUndoStack(prev => {
        const next = [...prev, action];
        return next.length > 50 ? next.slice(next.length - 50) : next;
    });

    switch (action.actionType) {
      case 'UPDATE_GEOMETRY':
        queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, (old) => {
          if (!old) return old;
          return old.map(u => u.id === action.unitId ? { ...u, polygon_coordinates: action.newData } : u);
        });
        await supabase.from('units').update({ polygon_coordinates: action.newData as any }).eq('id', action.unitId as string);
        break;

      case 'DELETE_UNIT': {
        const unit = action.unitData;
        if (unit) {
          queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, (old) => old ? old.filter(u => u.id !== unit.id) : old);
          queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.statusesBySheet(sheetId) }, (old) => old ? old.filter(s => s.unit_id !== unit.id) : old);
          // Remove status rows before the unit (mirror useDeleteUnit; FK-safe).
          await supabase.from('status_logs').delete().eq('unit_id', unit.id);
          await supabase.from('units').delete().eq('id', unit.id);
        }
        break;
      }

      case 'UPDATE_STATUS': {
        const ref = action.newLog ?? action.oldLog;
        const activityId = ref?.activity_id ?? null;
        // Fresh timestamp, same reasoning as the undo path: a redo is a decision made
        // now and must win last-write-wins against the undo it is reversing.
        const nowIso = new Date().toISOString();

        queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.statusesBySheet(sheetId) }, (old) => {
          if (!old) return old;
          const filtered = old.filter(s => !(s.unit_id === action.unitId && s.activity_id === activityId));
          if (action.newLog) {
            return [...filtered, action.newLog];
          }
          return filtered;
        });

        if (action.newLog) {
          await writeStatusSlot(buildStatusRestorePayload(action.newLog, nowIso));
        } else if (action.oldLog) {
          // No `newLog` means the undone action was a Clear Status, so redo must
          // re-clear the slot — the same full reset the undo path writes. Previously
          // this branch only dropped the row from the cache and wrote NOTHING, so the
          // database kept the restored status and a refresh brought it straight back.
          const clearedUnitId = action.unitId ?? action.oldLog.unit_id ?? null;
          if (clearedUnitId && activityId) {
            await writeStatusSlot(buildStatusResetPayload(clearedUnitId, activityId, action.oldLog.track, nowIso));
          }
        }

        // Phase 4: re-apply the auto-advance too — re-write its 'planned' after-state, the
        // identical cache + DB path the primary re-write above uses. Mirror of the undo case.
        if (action.secondary && action.secondary.newLog) {
          const secUnitId = action.secondary.unitId;
          const secLog = action.secondary.newLog;
          queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.statusesBySheet(sheetId) }, (old) => {
            if (!old) return old;
            const filtered = old.filter(s => !(s.unit_id === secUnitId && s.activity_id === secLog.activity_id));
            return [...filtered, secLog];
          });
          await writeStatusSlot(buildStatusRestorePayload(secLog, nowIso));
        }
        break;
      }

      case 'BULK_UPDATE_STATUS':
        queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.statusesBySheet(sheetId) }, (old) => {
          if (!old) return old;
          let filtered: StatusLog[];
          if (action.activityName && action.activityName !== '__KEEP_EXISTING__') {
             filtered = old.filter(s => !(action.unitIds?.includes(s.unit_id as string) && s.track === action.track && s.activityName === action.activityName));
          } else {
             filtered = old.filter(s => !(action.unitIds?.includes(s.unit_id as string) && s.track === action.track));
          }
          if (action.newLogs && action.newLogs.length > 0) {
            return [...filtered, ...action.newLogs];
          }
          return filtered;
        });

        if (action.newLogs && action.newLogs.length > 0) {
          const CHUNK_SIZE = 800;
          const logsToInsert: any[] = action.newLogs.map(({ id, created_at, activityName, ...rest }: any) => rest);
          for (let i = 0; i < logsToInsert.length; i += CHUNK_SIZE) {
            await supabase.from('status_logs').upsert(logsToInsert.slice(i, i + CHUNK_SIZE) as any, { onConflict: 'unit_id,activity_id' });
          }
        }
        break;

      case 'CREATE_UNIT':
        queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, (old) => old && action.unitData ? [...old, action.unitData] : (action.unitData ? [action.unitData] : old));
        if (action.unitData) {
          await supabase.from('units').insert([action.unitData as any]);
        }
        break;
    }
  }, [redoStack, sheetId, queryClient]);

  const undoStateRef = useRef({ toolMode, triggerUndo, triggerRedo });
  useEffect(() => {
    undoStateRef.current = { toolMode, triggerUndo, triggerRedo };
  });

  useEffect(() => {
    const handleGlobalUndoRedo = (e: KeyboardEvent) => {
      const { toolMode, triggerUndo, triggerRedo } = undoStateRef.current;
      if (toolMode === 'draw') return; 

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          triggerRedo();
        } else {
          triggerUndo();
        }
      }
    };

    window.addEventListener('keydown', handleGlobalUndoRedo);
    return () => window.removeEventListener('keydown', handleGlobalUndoRedo);
  }, []);

  return {
    undoStack,
    setUndoStack,
    redoStack,
    setRedoStack,
    triggerUndo,
    triggerRedo
  };
}

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/supabaseClient';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/types/queryKeys';
import type { Unit, StatusLog } from '@/types/domain';
import type { ToolMode } from '@/store/useMapStore';

export interface UndoAction {
  actionType: 'UPDATE_GEOMETRY' | 'DELETE_UNIT' | 'UPDATE_STATUS' | 'BULK_UPDATE_STATUS' | 'CREATE_UNIT';
  unitId?: string;
  unitData?: Unit;
  statusData?: StatusLog;
  oldData?: any;
  newData?: any;
  oldLog?: StatusLog | null;
  newLog?: StatusLog | null;
  unitIds?: string[];
  track?: string;
  milestone?: string;
  oldLogs?: StatusLog[];
  newLogs?: StatusLog[];
}

interface UseUndoRedoProps {
  toolMode: ToolMode;
  sheetId: string;
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

      case 'DELETE_UNIT':
        queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, (old) => old && action.unitData ? [...old, action.unitData] : (action.unitData ? [action.unitData] : old));
        if (action.statusData) {
          queryClient.setQueriesData<StatusLog[]>({ queryKey: ['statuses', sheetId] }, (old) => {
            const withoutTargetTrack = (old || []).filter(s => !(s.unit_id === action.unitData?.id && s.track === action.statusData?.track));
            return [...withoutTargetTrack, action.statusData!];
          });
        }
        if (action.unitData) {
          await supabase.from('units').insert([action.unitData as any]);
        }
        if (action.statusData) {
          await supabase.from('status_logs').upsert([action.statusData as any], { onConflict: 'unit_id,track,milestone' });
        }
        break;

      case 'UPDATE_STATUS':
        queryClient.setQueriesData<StatusLog[]>({ queryKey: ['statuses', sheetId] }, (old) => {
          if (!old) return old;
          const track = action.oldLog ? action.oldLog.track : action.newLog?.track;
          const milestone = action.oldLog ? action.oldLog.milestone : action.newLog?.milestone;
          const filtered = old.filter(s => !(s.unit_id === action.unitId && s.track === track && s.milestone === milestone));
          if (action.oldLog) {
            return [...filtered, action.oldLog];
          } else {
            return [...filtered, { unit_id: action.unitId, track, milestone, temporal_state: 'none', id: `temp_${Date.now()}`, created_at: new Date().toISOString() } as StatusLog];
          }
        });
        
        let insertObj: any;
        if (action.oldLog) {
          const { id, created_at, ...rest } = action.oldLog as any;
          insertObj = rest;
        } else {
          const track = action.newLog?.track;
          const milestone = action.newLog?.milestone;
          insertObj = { unit_id: action.unitId, track, milestone, temporal_state: 'none' };
        }
        await supabase.from('status_logs').upsert([insertObj], { onConflict: 'unit_id,track,milestone' });
        break;

      case 'BULK_UPDATE_STATUS':
        queryClient.setQueriesData<StatusLog[]>({ queryKey: ['statuses', sheetId] }, (old) => {
          if (!old) return old;
          
          let filtered: StatusLog[];
          if (action.milestone && action.milestone !== '__KEEP_EXISTING__') {
            filtered = old.filter(s => !(action.unitIds?.includes(s.unit_id as string) && s.track === action.track && s.milestone === action.milestone));
          } else {
            filtered = old.filter(s => !(action.unitIds?.includes(s.unit_id as string) && s.track === action.track));
          }

          let addedBack: StatusLog[] = [];
          if (action.oldLogs && action.oldLogs.length > 0) {
            addedBack = [...action.oldLogs];
          }

          if (action.milestone && action.milestone !== '__KEEP_EXISTING__') {
             const unitsWithOldLog = new Set(action.oldLogs?.map(l => l.unit_id) || []);
             const unitsMissing = action.unitIds?.filter(id => !unitsWithOldLog.has(id)) || [];
             unitsMissing.forEach(id => {
                addedBack.push({ unit_id: id, track: action.track as string, milestone: action.milestone as string, temporal_state: 'none', id: `temp_${id}_${Date.now()}` } as StatusLog);
             });
          }

          return [...filtered, ...addedBack];
        });
        
        {
          const CHUNK_SIZE = 800;
          const logsToInsert: any[] = [];
          if (action.oldLogs && action.oldLogs.length > 0) {
             logsToInsert.push(...action.oldLogs.map(({ id, created_at, ...rest }: any) => rest));
          }
          if (action.milestone && action.milestone !== '__KEEP_EXISTING__') {
             const unitsWithOldLog = new Set(action.oldLogs?.map(l => l.unit_id) || []);
             const unitsMissing = action.unitIds?.filter(id => !unitsWithOldLog.has(id)) || [];
             unitsMissing.forEach(id => {
                logsToInsert.push({ unit_id: id, track: action.track, milestone: action.milestone, temporal_state: 'none' });
             });
          }

          if (logsToInsert.length > 0) {
            for (let i = 0; i < logsToInsert.length; i += CHUNK_SIZE) {
              await supabase.from('status_logs').upsert(logsToInsert.slice(i, i + CHUNK_SIZE) as any, { onConflict: 'unit_id,track,milestone' });
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

      case 'DELETE_UNIT':
        queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, (old) => old ? old.filter(u => u.id !== action.unitData?.id) : old);
        queryClient.setQueriesData<StatusLog[]>({ queryKey: ['statuses', sheetId] }, (old) => old ? old.filter(s => s.unit_id !== action.unitData?.id) : old);
        if (action.unitData) {
          await supabase.from('units').delete().eq('id', action.unitData.id);
        }
        break;

      case 'UPDATE_STATUS':
        queryClient.setQueriesData<StatusLog[]>({ queryKey: ['statuses', sheetId] }, (old) => {
          if (!old) return old;
          const track = action.newLog ? action.newLog.track : action.oldLog?.track;
          const milestone = action.newLog ? action.newLog.milestone : action.oldLog?.milestone;
          const filtered = old.filter(s => !(s.unit_id === action.unitId && s.track === track && s.milestone === milestone));
          if (action.newLog) {
            return [...filtered, action.newLog];
          }
          return filtered;
        });
        if (action.newLog) {
          const { id, created_at, ...rest } = action.newLog as any;
          await supabase.from('status_logs').upsert([rest], { onConflict: 'unit_id,track,milestone' });
        }
        break;

      case 'BULK_UPDATE_STATUS':
        queryClient.setQueriesData<StatusLog[]>({ queryKey: ['statuses', sheetId] }, (old) => {
          if (!old) return old;
          let filtered: StatusLog[];
          if (action.milestone && action.milestone !== '__KEEP_EXISTING__') {
             filtered = old.filter(s => !(action.unitIds?.includes(s.unit_id as string) && s.track === action.track && s.milestone === action.milestone));
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
          const logsToInsert: any[] = action.newLogs.map(({ id, created_at, ...rest }: any) => rest);
          for (let i = 0; i < logsToInsert.length; i += CHUNK_SIZE) {
            await supabase.from('status_logs').upsert(logsToInsert.slice(i, i + CHUNK_SIZE) as any, { onConflict: 'unit_id,track,milestone' });
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

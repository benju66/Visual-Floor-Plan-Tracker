import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/supabaseClient';
import { useQueryClient } from '@tanstack/react-query';

export function useUndoRedo({
  toolMode,
  sheetId,
  unitIdsLength
}) {
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const queryClient = useQueryClient();

  const triggerUndo = async () => {
    if (undoStack.length === 0) return;
    const action = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, action]);

    switch (action.actionType) {
      case 'UPDATE_GEOMETRY':
        queryClient.setQueryData(['units', sheetId], old => old?.map(u => u.id === action.unitId ? { ...u, polygon_coordinates: action.oldData } : u));
        await supabase.from('units').update({ polygon_coordinates: action.oldData }).eq('id', action.unitId);
        queryClient.invalidateQueries({ queryKey: ['units', sheetId] });
        break;
      case 'DELETE_UNIT':
        queryClient.setQueryData(['units', sheetId], old => [...(old || []), action.unitData]);
        if (action.statusData) {
          queryClient.setQueryData(['statuses', sheetId, unitIdsLength], old => {
            const filtered = (old || []).filter(s => s.unit_id !== action.unitData.id);
            return [...filtered, action.statusData];
          });
        }
        await supabase.from('units').insert([action.unitData]);
        if (action.statusData) {
          await supabase.from('status_logs').insert([action.statusData]);
        }
        queryClient.invalidateQueries({ queryKey: ['units', sheetId] });
        queryClient.invalidateQueries({ queryKey: ['statuses', sheetId, unitIdsLength] });
        break;
      case 'UPDATE_STATUS':
        {
          const track = action.oldLog?.track || action.newLog?.track || 'Production';
          queryClient.setQueryData(['statuses', sheetId, unitIdsLength], old => {
              const filtered = (old || []).filter(s => !(s.unit_id === action.unitId && s.track === track));
              return action.oldLog ? [...filtered, action.oldLog] : filtered;
          });
          if (action.oldLog) {
              await supabase.from('status_logs').insert([{ 
                  unit_id: action.unitId, 
                  milestone: action.oldLog.milestone, 
                  status_color: action.oldLog.status_color, 
                  temporal_state: action.oldLog.temporal_state 
              }]);
          } else if (action.newLog) {
              await supabase.from('status_logs').delete().eq('unit_id', action.unitId).eq('milestone', action.newLog.milestone);
          }
          queryClient.invalidateQueries({ queryKey: ['statuses', sheetId, unitIdsLength] });
        }
        break;
      case 'CREATE_UNIT':
        queryClient.setQueryData(['units', sheetId], old => old?.filter(u => u.id !== action.unitData.id));
        await supabase.from('units').delete().eq('id', action.unitData.id);
        queryClient.invalidateQueries({ queryKey: ['units', sheetId] });
        break;
    }
  };

  const triggerRedo = async () => {
    if (redoStack.length === 0) return;
    const action = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    setUndoStack(prev => {
        const next = [...prev, action];
        return next.length > 50 ? next.slice(next.length - 50) : next;
    });

    switch (action.actionType) {
      case 'UPDATE_GEOMETRY':
        queryClient.setQueryData(['units', sheetId], old => old?.map(u => u.id === action.unitId ? { ...u, polygon_coordinates: action.newData } : u));
        await supabase.from('units').update({ polygon_coordinates: action.newData }).eq('id', action.unitId);
        queryClient.invalidateQueries({ queryKey: ['units', sheetId] });
        break;
      case 'DELETE_UNIT':
        queryClient.setQueryData(['units', sheetId], old => old?.filter(u => u.id !== action.unitData.id));
        queryClient.setQueryData(['statuses', sheetId, unitIdsLength], old => old?.filter(s => s.unit_id !== action.unitData.id));
        await supabase.from('units').delete().eq('id', action.unitData.id);
        queryClient.invalidateQueries({ queryKey: ['units', sheetId] });
        queryClient.invalidateQueries({ queryKey: ['statuses', sheetId, unitIdsLength] });
        break;
      case 'UPDATE_STATUS':
        if (action.newLog) {
           queryClient.setQueryData(['statuses', sheetId, unitIdsLength], old => {
              const filtered = (old || []).filter(s => !(s.unit_id === action.unitId && s.track === action.newLog.track));
              return [...filtered, action.newLog];
           });
           await supabase.from('status_logs').insert([{ 
               unit_id: action.unitId, 
               milestone: action.newLog.milestone, 
               status_color: action.newLog.status_color, 
               temporal_state: action.newLog.temporal_state 
           }]);
        } else if (action.oldLog) {
            queryClient.setQueryData(['statuses', sheetId, unitIdsLength], old => 
              (old || []).filter(s => !(s.unit_id === action.unitId && s.track === action.oldLog.track))
            );
            await supabase.from('status_logs').delete().eq('unit_id', action.unitId).eq('milestone', action.oldLog.milestone);
        }
        queryClient.invalidateQueries({ queryKey: ['statuses', sheetId, unitIdsLength] });
        break;
      case 'CREATE_UNIT':
        queryClient.setQueryData(['units', sheetId], old => [...(old || []), action.unitData]);
        await supabase.from('units').insert([action.unitData]);
        queryClient.invalidateQueries({ queryKey: ['units', sheetId] });
        break;
    }
  };

  const undoStateRef = useRef({ toolMode, triggerUndo, triggerRedo });
  useEffect(() => {
    undoStateRef.current = { toolMode, triggerUndo, triggerRedo };
  });

  useEffect(() => {
    const handleGlobalUndoRedo = (e) => {
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

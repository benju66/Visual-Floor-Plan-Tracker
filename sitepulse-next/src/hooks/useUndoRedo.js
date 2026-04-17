import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/supabaseClient';
import { useQueryClient } from '@tanstack/react-query';

export function useUndoRedo({
  toolMode,
  sheetId,
}) {
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const queryClient = useQueryClient();

  const triggerUndo = async () => {
    if (undoStack.length === 0 || !sheetId) return;
    const action = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, action]);

    switch (action.actionType) {
      case 'UPDATE_GEOMETRY':
        queryClient.setQueryData(['units', sheetId], (old) => {
          if (!old) return old;
          return old.map(u => u.id === action.unitId ? { ...u, polygon_coordinates: action.oldData } : u);
        });
        await supabase.from('units').update({ polygon_coordinates: action.oldData }).eq('id', action.unitId);
        break;

      case 'DELETE_UNIT':
        queryClient.setQueryData(['units', sheetId], (old) => old ? [...old, action.unitData] : [action.unitData]);
        if (action.statusData) {
          queryClient.setQueryData(['statuses', sheetId], (old) => {
            const withoutTargetTrack = (old || []).filter(s => !(s.unit_id === action.unitData.id && s.track === action.statusData.track));
            return [...withoutTargetTrack, action.statusData];
          });
        }
        await supabase.from('units').insert([action.unitData]);
        if (action.statusData) {
          await supabase.from('status_logs').insert([action.statusData]);
        }
        break;

      case 'UPDATE_STATUS':
        queryClient.setQueryData(['statuses', sheetId], (old) => {
          if (!old) return old;
          const track = action.oldLog ? action.oldLog.track : action.newLog?.track;
          const filtered = old.filter(s => !(s.unit_id === action.unitId && s.track === track));
          if (action.oldLog) {
            return [...filtered, action.oldLog];
          }
          return filtered;
        });
        const currentTrack = action.oldLog ? action.oldLog.track : action.newLog?.track;
        await supabase.from('status_logs').delete().eq('unit_id', action.unitId).eq('track', currentTrack);
        if (action.oldLog) {
          await supabase.from('status_logs').insert([action.oldLog]);
        }
        break;

      case 'CREATE_UNIT':
        queryClient.setQueryData(['units', sheetId], (old) => old ? old.filter(u => u.id !== action.unitData.id) : old);
        await supabase.from('units').delete().eq('id', action.unitData.id);
        break;
    }
  };

  const triggerRedo = async () => {
    if (redoStack.length === 0 || !sheetId) return;
    const action = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    setUndoStack(prev => {
        const next = [...prev, action];
        return next.length > 50 ? next.slice(next.length - 50) : next;
    });

    switch (action.actionType) {
      case 'UPDATE_GEOMETRY':
        queryClient.setQueryData(['units', sheetId], (old) => {
          if (!old) return old;
          return old.map(u => u.id === action.unitId ? { ...u, polygon_coordinates: action.newData } : u);
        });
        await supabase.from('units').update({ polygon_coordinates: action.newData }).eq('id', action.unitId);
        break;

      case 'DELETE_UNIT':
        queryClient.setQueryData(['units', sheetId], (old) => old ? old.filter(u => u.id !== action.unitData.id) : old);
        queryClient.setQueryData(['statuses', sheetId], (old) => old ? old.filter(s => s.unit_id !== action.unitData.id) : old);
        await supabase.from('units').delete().eq('id', action.unitData.id);
        break;

      case 'UPDATE_STATUS':
        queryClient.setQueryData(['statuses', sheetId], (old) => {
          if (!old) return old;
          const track = action.newLog ? action.newLog.track : action.oldLog?.track;
          const filtered = old.filter(s => !(s.unit_id === action.unitId && s.track === track));
          if (action.newLog) {
            return [...filtered, action.newLog];
          }
          return filtered;
        });
        const currentTrackRedo = action.newLog ? action.newLog.track : action.oldLog?.track;
        await supabase.from('status_logs').delete().eq('unit_id', action.unitId).eq('track', currentTrackRedo);
        if (action.newLog) {
          await supabase.from('status_logs').insert([action.newLog]);
        }
        break;

      case 'CREATE_UNIT':
        queryClient.setQueryData(['units', sheetId], (old) => old ? [...old, action.unitData] : [action.unitData]);
        await supabase.from('units').insert([action.unitData]);
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

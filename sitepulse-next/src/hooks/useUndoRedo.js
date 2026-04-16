import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/supabaseClient';

export function useUndoRedo({
  toolMode,
  setUnits,
  setActiveStatuses,
  onUpdateGeometry,
  onUpdateStatus
}) {
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  const triggerUndo = async () => {
    if (undoStack.length === 0) return;
    const action = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, action]);

    switch (action.actionType) {
      case 'UPDATE_GEOMETRY':
        await onUpdateGeometry(action.unitId, action.oldData, true); 
        break;
      case 'DELETE_UNIT':
        const { error: undoDelErr } = await supabase.from('units').insert([action.unitData]);
        if (!undoDelErr) {
          setUnits(prev => [...prev, action.unitData]);
          if (action.statusData) {
            await supabase.from('status_logs').insert([action.statusData]);
            setActiveStatuses(prev => [...prev.filter(s => s.unit_id !== action.unitData.id), action.statusData]);
          }
        }
        break;
      case 'UPDATE_STATUS':
        if (action.oldLog) {
            await onUpdateStatus({ id: action.unitId }, action.oldLog, true);
        }
        break;
      case 'CREATE_UNIT':
        const { error: undoCreErr } = await supabase.from('units').delete().eq('id', action.unitData.id);
        if (!undoCreErr) {
          setUnits(prev => prev.filter(u => u.id !== action.unitData.id));
        }
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
        await onUpdateGeometry(action.unitId, action.newData, true);
        break;
      case 'DELETE_UNIT':
        const { error: redoDelErr } = await supabase.from('units').delete().eq('id', action.unitData.id);
        if (!redoDelErr) {
          setUnits(prev => prev.filter(u => u.id !== action.unitData.id));
          setActiveStatuses(prev => prev.filter(s => s.unit_id !== action.unitData.id));
        }
        break;
      case 'UPDATE_STATUS':
        await onUpdateStatus({ id: action.unitId }, action.newLog, true);
        break;
      case 'CREATE_UNIT':
        const { error: redoCreErr } = await supabase.from('units').insert([action.unitData]);
        if (!redoCreErr) {
          setUnits(prev => [...prev, action.unitData]);
        }
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

@workspace
Please implement the Two-Tier Undo/Redo system for the visual floor plan tracker. We need to strictly distinguish between ephemeral UI changes (like drawing a draft polygon) and committed database actions (like moving a completed unit location). 

Here is the exact implementation plan. Please execute these updates across the codebase, ensuring you handle React dependencies (like `useCallback`) correctly to avoid stale state.

### Task 1: Ephemeral Undo in Canvas (`src/components/FloorplanCanvas.jsx`)
Locate the existing `useEffect` containing `handleKeyDown`. 
Add a listener for `Meta+Z` / `Ctrl+Z` that pops the last point off the `draftPoints` array. Ensure it only triggers if `!e.shiftKey`.

JavaScript
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault(); 
        if (toolMode === 'draw' && draftPointsRef.current.length > 0) {
          setDraftPoints(prev => prev.slice(0, -1));
        }
      }

### Task 2: Global Undo/Redo State (`src/app/page.jsx`)

Initialize the stacks at the top of the `App` componen

JavaScript
const [undoStack, setUndoStack] = useState([]);
const [redoStack, setRedoStack] = useState([]);

### Task 3: Implement the Command Pattern with DB Sync (`src/app/page.jsx`)

Modify the existing `handleUpdateUnitPolygon` to accept a third parameter `isUndoRedo`. If `!isUndoRedo`, push the old and new coordinates to the `undoStack`. Limit the `undoStack` to 50 items to prevent memory degradation over long working sessions. Critically, if the Supabase write fails in the `catch` block, pop the action back off the `undoStack` to prevent desync.

const handleUpdateUnitPolygon = async (unitId, newPoints, isUndoRedo = false) => {
    let actionAdded = false;

    if (!isUndoRedo) {
      const oldUnit = units.find(u => u.id === unitId);
      if (oldUnit) {
        setUndoStack(prev => {
          const nextStack = [...prev, {
            actionType: 'UPDATE_GEOMETRY',
            unitId: unitId,
            oldData: oldUnit.polygon_coordinates,
            newData: newPoints
          }];
          return nextStack.length > 50 ? nextStack.slice(nextStack.length - 50) : nextStack;
        });
        setRedoStack([]);
        actionAdded = true;
      }
    }

    const previousUnits = [...units];
    setUnits((prev) => prev.map((u) => u.id === unitId ? { ...u, polygon_coordinates: newPoints } : u));
    
    try {
      const { error } = await supabase.from('units').update({ polygon_coordinates: newPoints }).eq('id', unitId);
      if (error) throw error;
    } catch (err) {
      setUnits(previousUnits);
      // Revert the stack if the DB write failed
      if (actionAdded) {
        setUndoStack(prev => prev.slice(0, -1)); 
      }
      showToast('Error updating location geometry: ' + err.message, 'error');
    }
  };


### Task 4: Global Trigger Handlers (`src/app/page.jsx`)

Create `triggerUndo` and `triggerRedo` functions. Then, set up a global `useEffect` to listen for `Ctrl+Z` / `Cmd+Z` (Undo) and `Ctrl+Shift+Z` / `Cmd+Shift+Z` (Redo). 
Ensure this global listener is guarded by `if (toolMode === 'draw') return;` so it does not collide with the Canvas's ephemeral undo.

const triggerUndo = useCallback(async () => {
    if (undoStack.length === 0) return;
    
    const action = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, action]);

    if (action.actionType === 'UPDATE_GEOMETRY') {
      await handleUpdateUnitPolygon(action.unitId, action.oldData, true); 
    }
  }, [undoStack, handleUpdateUnitPolygon]); 

  const triggerRedo = useCallback(async () => {
    if (redoStack.length === 0) return;
    
    const action = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    setUndoStack(prev => {
        const next = [...prev, action];
        return next.length > 50 ? next.slice(next.length - 50) : next;
    });

    if (action.actionType === 'UPDATE_GEOMETRY') {
      await handleUpdateUnitPolygon(action.unitId, action.newData, true);
    }
  }, [redoStack, handleUpdateUnitPolygon]);

  useEffect(() => {
    const handleGlobalUndoRedo = (e) => {
      // Prevent Tier 2 undo if actively drawing (Canvas handles it)
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
  }, [toolMode, triggerUndo, triggerRedo]);
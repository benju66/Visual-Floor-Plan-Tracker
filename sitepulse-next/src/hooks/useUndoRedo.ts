import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/supabaseClient';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/types/queryKeys';
import type { Unit, StatusLog } from '@/types/domain';
import type { Database, Json } from '@/types/database.types';
import type { ToolMode } from '@/store/useMapStore';
import {
  buildStatusResetPayload,
  buildStatusRestorePayload,
  buildBulkUndoPayloads,
  toUniformPayloads,
  type UndoStatusPayload,
} from '@/utils/undoWrite';

type StatusLogInsert = Database['public']['Tables']['status_logs']['Insert'];

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
  // A BULK action's slots come from these two log sets, NOT from an activity name: the
  // slot key is (unit_id, activity_id) (AGENTS §2). `oldLogs` is the track-wide capture
  // of the selected units' prior state; `newLogs` is what the apply wrote, including any
  // auto-advanced next-activity slot. A slot in `newLogs` with no `oldLogs` counterpart
  // is one the apply CREATED — undo resets it. (There was also an `activityName` field
  // here; nothing ever set it, so its name-keyed filter branches were unreachable.)
  oldLogs?: StatusLog[];
  newLogs?: StatusLog[];
}

interface UseUndoRedoProps {
  toolMode: ToolMode;
  sheetId: string;
  /**
   * How a failed undo/redo reaches the user. **Required on purpose** (Phase 3): an
   * optional callback can be left unwired, and an unwired failure notice is exactly
   * the silence this workstream exists to remove — so the compiler enforces it
   * rather than a dev-time warning. `useMapActions.showToast` lets `error` through
   * even when the user has switched toasts off.
   */
  showToast: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

/** Best-effort human text from a thrown Error, a string, or a Supabase `{ error }` object. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'Unknown error';
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

/** PostgREST request-size ceiling for a bulk status write (unchanged from the original). */
const BULK_CHUNK_SIZE = 800;

/**
 * Write MANY status slots through the bulk form AGENTS §2 sanctions —
 * `.upsert({ onConflict: 'unit_id,activity_id' })`, chunked — checking every chunk and
 * throwing on the first failure (see {@link writeStatusSlot} for why throwing matters).
 *
 * Rows must already be key-uniform (`toUniformPayloads`): PostgREST builds ONE insert
 * from a single column list, so a ragged batch is rejected whole.
 */
async function writeStatusRows(rows: UndoStatusPayload[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BULK_CHUNK_SIZE) {
    const { error } = await supabase
      .from('status_logs')
      .upsert(rows.slice(i, i + BULK_CHUNK_SIZE) as StatusLogInsert[], { onConflict: 'unit_id,activity_id' });
    if (error) throw error;
  }
}

export function useUndoRedo({ toolMode, sheetId, showToast }: UseUndoRedoProps) {
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAction[]>([]);
  const queryClient = useQueryClient();

  // `showToast` is re-created on every render of the calling hook, so keep it in a ref
  // instead of a dependency — otherwise every render would rebuild triggerUndo/Redo.
  const showToastRef = useRef(showToast);
  useEffect(() => { showToastRef.current = showToast; });

  /**
   * A failed undo/redo must stop looking like a success (Phase 3). Phases 1 and 2 made
   * the writes correct and made a failure throw; this is what catches it. Three things
   * happen, and all three matter:
   *
   * 1. **The action goes back where it came from** — owner decision, 2026-08-28: on
   *    failure it returns to its own stack and is NOT pushed to the opposite one, so a
   *    change that couldn't save stays available to retry once the user is back online
   *    (the offline pending queue keeps failed items for the same reason). Both triggers
   *    move the action BEFORE attempting the write, so both moves are reversed here.
   *    The identity check means a concurrent trigger can't have its own push undone.
   * 2. **The user is told**, through the caller's toast (which shows errors even when
   *    toasts are switched off).
   * 3. **The screen re-syncs.** The optimistic cache update has already applied, so the
   *    display is showing a revert that never reached the database. Invalidating is the
   *    honest fix — a refetch, not a hand-rolled rollback. `units` is included because
   *    this catch is shared with the geometry actions.
   */
  const handleWriteFailure = useCallback((err: unknown, action: UndoAction, direction: 'undo' | 'redo') => {
    if (direction === 'undo') {
      setRedoStack(prev => (prev[prev.length - 1] === action ? prev.slice(0, -1) : prev));
      setUndoStack(prev => [...prev, action]);
    } else {
      setUndoStack(prev => (prev[prev.length - 1] === action ? prev.slice(0, -1) : prev));
      setRedoStack(prev => [...prev, action]);
    }

    showToastRef.current(`Couldn't ${direction} — nothing was changed. ${errorMessage(err)}`, 'error');

    queryClient.invalidateQueries({ queryKey: queryKeys.statusesBySheet(sheetId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.allProjectStatusesAll() });
    queryClient.invalidateQueries({ queryKey: queryKeys.units(sheetId) });
  }, [queryClient, sheetId]);

  /**
   * Apply ONE undo action's cache + database writes. Split out from `triggerUndo` so the
   * stack bookkeeping and the failure path read in one screen; it THROWS on a failed
   * write (Phases 1–2) and `triggerUndo` is what catches that.
   */
  const applyUndoAction = useCallback(async (action: UndoAction) => {
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
          // Restore each captured row through the shared builder: it drops the DB-owned
          // id/created_at and the synthesized activityName (the slot key is
          // (unit_id, activity_id)) and stamps a fresh client_timestamp.
          await writeStatusRows(toUniformPayloads(
            logs.map(l => buildStatusRestorePayload(l, new Date().toISOString()))));
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

      case 'BULK_UPDATE_STATUS': {
        const oldLogs = action.oldLogs ?? [];

        queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.statusesBySheet(sheetId) }, (old) => {
          if (!old) return old;
          // The one push site (handleApplyBulkStatus) records unitIds + track + the two
          // log sets and never an `activityName`, so the slot set comes from the logs —
          // never from the display name (AGENTS §2: the slot key is activity_id). Slots
          // the apply CREATED simply drop out here, which renders as Not Started, matching
          // the reset now written below.
          const filtered = old.filter(s => !(action.unitIds?.includes(s.unit_id as string) && s.track === action.track));
          return [...filtered, ...oldLogs];
        });

        // Revert every slot the action touched: the ones it WROTE (`newLogs`, which
        // includes any auto-advanced next-activity slot) plus the ones it captured a
        // before-state for. buildBulkUndoPayloads restores where a prior row exists and
        // RESETS where none does — and that reset is the row this path never used to
        // write, which is why undoing a bulk apply reverted the screen and left the
        // database alone for every location that had been Not Started.
        await writeStatusRows(buildBulkUndoPayloads(
          [...(action.newLogs ?? []), ...oldLogs],
          oldLogs,
          action.track,
          new Date().toISOString(),
        ));
        break;
      }

      case 'CREATE_UNIT':
        queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, (old) => old ? old.filter(u => u.id !== action.unitData?.id) : old);
        if (action.unitData) {
          await supabase.from('units').delete().eq('id', action.unitData.id);
        }
        break;
    }
  }, [sheetId, queryClient]);

  const triggerUndo = useCallback(async () => {
    if (undoStack.length === 0 || !sheetId) return;
    const action = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, action]);

    try {
      await applyUndoAction(action);
    } catch (err) {
      handleWriteFailure(err, action, 'undo');
    }
  }, [undoStack, sheetId, applyUndoAction, handleWriteFailure]);

  /** Apply ONE redo action's cache + database writes. Mirror of {@link applyUndoAction}. */
  const applyRedoAction = useCallback(async (action: UndoAction) => {
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
          // No explicit status_logs delete: `status_logs.unit_id` FKs `units(id)` ON
          // DELETE CASCADE, so the unit delete removes them (verified against production
          // 2026-08-28). The client couldn't delete them anyway — status_logs has RLS on
          // and no DELETE policy, so such a call removes zero rows and reports no error.
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

      case 'BULK_UPDATE_STATUS': {
        const newLogs = action.newLogs ?? [];

        queryClient.setQueriesData<StatusLog[]>({ queryKey: queryKeys.statusesBySheet(sheetId) }, (old) => {
          if (!old) return old;
          // Same slot set as the undo path above — from the logs, never the display name.
          const filtered = old.filter(s => !(action.unitIds?.includes(s.unit_id as string) && s.track === action.track));
          return [...filtered, ...newLogs];
        });

        // Re-apply ONLY the slots the bulk action wrote. A slot that appears solely in
        // `oldLogs` was never touched by the apply (the capture is track-wide), so
        // writing it here would clobber a slot nobody changed.
        await writeStatusRows(toUniformPayloads(
          newLogs.map(l => buildStatusRestorePayload(l, new Date().toISOString()))));
        break;
      }

      case 'CREATE_UNIT':
        queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, (old) => old && action.unitData ? [...old, action.unitData] : (action.unitData ? [action.unitData] : old));
        if (action.unitData) {
          await supabase.from('units').insert([action.unitData as any]);
        }
        break;
    }
  }, [sheetId, queryClient]);

  const triggerRedo = useCallback(async () => {
    if (redoStack.length === 0 || !sheetId) return;
    const action = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    setUndoStack(prev => {
        const next = [...prev, action];
        return next.length > 50 ? next.slice(next.length - 50) : next;
    });

    try {
      await applyRedoAction(action);
    } catch (err) {
      handleWriteFailure(err, action, 'redo');
    }
  }, [redoStack, sheetId, applyRedoAction, handleWriteFailure]);

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

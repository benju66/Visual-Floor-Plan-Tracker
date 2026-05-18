import { get, set, del } from 'idb-keyval';
import type { PendingChangesMap } from '@/types/domain';

// Keys are scoped to projectId to prevent cross-project contamination.
// Each project's pending changes are stored independently in IndexedDB.
const pendingKey = (projectId: string) => `sitepulse-pending-changes-${projectId}`;
const timelineKey = (projectId: string) => `sitepulse-pending-timeline-changes-${projectId}`;

/**
 * Persist the current pending changes map to IndexedDB.
 * Called on every state update via useEffect in useFieldData.
 */
export async function persistPendingChanges(projectId: string, changes: PendingChangesMap): Promise<void> {
  try {
    if (Object.keys(changes).length === 0) {
      await del(pendingKey(projectId));
    } else {
      await set(pendingKey(projectId), changes);
    }
  } catch {
    // IDB unavailable (private browsing, storage quota) — silent degradation.
    // In-memory state still works; changes just won't survive tab close.
  }
}

export async function persistPendingTimelineChanges(projectId: string, changes: PendingChangesMap): Promise<void> {
  try {
    if (Object.keys(changes).length === 0) {
      await del(timelineKey(projectId));
    } else {
      await set(timelineKey(projectId), changes);
    }
  } catch {
    // IDB unavailable — silent degradation
  }
}

/**
 * Rehydrate pending changes from IndexedDB on mount.
 * Returns empty maps if no data found or IDB is unavailable.
 */
export async function loadPendingChanges(projectId: string): Promise<PendingChangesMap> {
  try {
    return (await get<PendingChangesMap>(pendingKey(projectId))) || {};
  } catch {
    return {};
  }
}

export async function loadPendingTimelineChanges(projectId: string): Promise<PendingChangesMap> {
  try {
    return (await get<PendingChangesMap>(timelineKey(projectId))) || {};
  } catch {
    return {};
  }
}

/**
 * Clear all persisted pending changes for a project.
 * Called after successful apply (handleApplyAll) or discard (handleDiscardAll).
 */
export async function clearPersistedPendingChanges(projectId: string): Promise<void> {
  try {
    await del(pendingKey(projectId));
    await del(timelineKey(projectId));
  } catch {
    // IDB unavailable — no-op
  }
}

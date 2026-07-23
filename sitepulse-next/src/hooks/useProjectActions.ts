import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { useMapStore } from '@/store/useMapStore';
import { useUIStore } from '@/store/useUIStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { uploadFloorplanService, attachOriginalService, deleteSheetStorageService } from '@/services/api';
import { useUpdateActivity, useReorderSheets, fetchAllIn } from '@/hooks/useProjectQueries';
import type { Project, Sheet, Activity } from '@/types/domain';
import { queryKeys } from '@/types/queryKeys';
import { invalidatePdfBytes } from '@/utils/pdfByteCache';

export function useProjectActions(project: Project | null | undefined, sheets: Sheet[], projectId: string) {
  const queryClient = useQueryClient();
  const activeSheetId = useMapStore(s => s.activeSheetId);
  const setActiveSheetId = useMapStore(s => s.setActiveSheetId);
  const selectedFile = useMapStore(s => s.selectedFile);
  const setSelectedFile = useMapStore(s => s.setSelectedFile);
  const setIsUploading = useMapStore(s => s.setIsUploading);
  const isUploading = useMapStore(s => s.isUploading);
  const pdfPageNumber = useMapStore(s => s.pdfPageNumber);
  const setPdfPageNumber = useMapStore(s => s.setPdfPageNumber);

  const newLevelName = useUIStore(s => s.newLevelName);
  const setNewLevelName = useUIStore(s => s.setNewLevelName);
  const setIsModalOpen = useUIStore(s => s.setIsModalOpen);
  const isModalOpen = useUIStore(s => s.isModalOpen);
  const setToast = useUIStore(s => s.setToast);

  const settings = useSettingsStore(s => s.settings) || {};
  const updateActivityMutation = useUpdateActivity(project?.id as string, activeSheetId);
  const reorderSheetsMutation = useReorderSheets(project?.id || projectId);

  const showToast = (message: string, type: 'success' | 'error' | 'info' | 'warning') => {
    // Errors and warnings always surface — "toasts off" silences routine
    // success/info confirmations, never a failure the user needs to see.
    if (!settings.enableToasts && type !== 'error' && type !== 'warning') return;
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleAddActivity = async (name: string, color: string, track: string, dictionaryId?: string | null) => {
    const rawName = name?.trim();
    if (!rawName || !project || !project.id) return;
    try {
      const activities = queryClient.getQueryData<Activity[]>(queryKeys.activities(project.id)) || [];
      const trackActs = activities.filter(a => a.track === track);
      const maxOrder = trackActs.reduce((max, a) => Math.max(max, a.sequence_order || 0), -1);

      // dictionary_id links this project activity to the global governed activity
      // dictionary (Scheduling Foundation Slice A, Phase 2); null = unlinked (review queue).
      const { data, error } = await supabase.from('activities').insert([{ project_id: project.id, name: rawName, color, track, sequence_order: maxOrder + 1, dictionary_id: dictionaryId ?? null }]).select();
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: queryKeys.activities(project.id) });
    } catch (err: any) {
      showToast('Failed to add activity: ' + err.message, 'error');
    }
  };

  const handleUpdateActivity = async (id: string, oldName: string, newName: string, newColor: string) => {
    try {
      await updateActivityMutation.mutateAsync({ id, oldName, newName, newColor });
    } catch (err: any) {
      showToast('Failed to update activity: ' + err.message, 'error');
    }
  };

  const handleDeleteActivity = async (id: string) => {
    try {
      // Deleting the activity cascades to its current-state status_logs rows via the
      // status_logs.activity_id FK (ON DELETE CASCADE) — no manual name-matched cleanup
      // needed anymore. History in status_audit_log is preserved (ON DELETE SET NULL).
      const { error } = await supabase.from('activities').delete().eq('id', id);
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: queryKeys.activities(project?.id || projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.statusesAll() });
      // FS dependency edges cascade-delete with the activity (Phase 3b) — refresh
      // the cached graph so a surviving successor's chip doesn't go stale.
      queryClient.invalidateQueries({ queryKey: queryKeys.activityDependencies(project?.id || projectId) });
    } catch (err: any) {
      showToast('Failed to delete activity: ' + err.message, 'error');
    }
  };

  const handleAddLevel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !newLevelName) return;
    
    if (!project || !project.id) {
        showToast('FATAL: Invalid Project ID. Please navigate back to the dashboard home to refresh your active project.', 'error');
        return;
    }

    setIsUploading(true);

    try {
      const { data: newSheet, error } = await supabase
        .from('sheets')
        .insert([{ project_id: project.id, sheet_name: newLevelName }])
        .select();

      if (error) throw error;
      const sheetId = newSheet[0].id;

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) throw new Error('Missing auth token for file upload');

      // The backend writes sheets.base_image_url itself (authoritative) during the
      // conversion, so no client write-back is needed — just run the upload/convert.
      await uploadFloorplanService(sheetId, selectedFile, pdfPageNumber, token);

      queryClient.invalidateQueries({ queryKey: queryKeys.sheets(project.id) });
      // F7: Invalidate cached vectors so snapping uses fresh data
      queryClient.invalidateQueries({ queryKey: queryKeys.snappingVectors(sheetId) });
      setActiveSheetId(sheetId);
      setIsModalOpen(false);
      setNewLevelName('');
      setSelectedFile(null);
      setPdfPageNumber(1);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setIsUploading(false);
    }
  };

  const handleAttachOriginal = async (file: File) => {
    if (!activeSheetId || !file) return;
    try {
      showToast('Uploading original PDF...', 'info');
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Missing token');
      await attachOriginalService(activeSheetId, file, token);
      // Drop cached PDF bytes so the canvas re-downloads the new original
      invalidatePdfBytes(activeSheetId);
      // Refetch sheets so the bumped pdf_version flows to the canvas — the
      // versioned URL cache-busts browser/CDN and reloads the drawing.
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets(project?.id || projectId) });
      // F7: Invalidate cached vectors so snapping re-extracts from new PDF
      queryClient.invalidateQueries({ queryKey: queryKeys.snappingVectors(activeSheetId) });
      showToast('Successfully attached original PDF!', 'success');
    } catch (e: any) {
      showToast('Failed to attach: ' + e.message, 'error');
    }
  };

  const handleRenameSheet = async (sheetId: string, newName: string) => {
    try {
      const { error } = await supabase.from('sheets').update({ sheet_name: newName }).eq('id', sheetId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets(project?.id || projectId) });
      showToast('Level renamed successfully!', 'success');
    } catch (e: any) {
      showToast('Failed to rename: ' + e.message, 'error');
    }
  };

  const handleDeleteSheet = async (sheetId: string) => {
    try {
      showToast('Wiping level and all data...', 'info');

      // Remove stored images and original PDF via the BACKEND (service-role):
      // storage RLS denies the client's own `.remove()` project-wide, so deleting
      // here would orphan the blobs. Runs before the `sheets` row delete (the
      // backend resolves access from the still-present row). Best-effort/non-fatal
      // — a backend hiccup must never block the delete; it just re-orphans the
      // blobs (the pre-fix behaviour), recoverable from the Storage dashboard.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (token) await deleteSheetStorageService(sheetId, token);
      } catch (e) {
        console.warn('Storage cleanup warning (non-fatal):', e);
      }
      invalidatePdfBytes(sheetId);

      // F4: Clean up tile folder — list and remove all tile files
      try {
        const { data: tileFiles } = await supabase.storage.from('floorplans').list(`tiles/${sheetId}`, { limit: 1000 });
        if (tileFiles && tileFiles.length > 0) {
          // List files in subdirectories (output_files/0/, output_files/1/, etc.)
          const { data: subFiles } = await supabase.storage.from('floorplans').list(`tiles/${sheetId}/output_files`, { limit: 5000 });
          const allPaths: string[] = [`tiles/${sheetId}/output.dzi`];
          if (subFiles) {
            for (const sub of subFiles) {
              const { data: levelFiles } = await supabase.storage.from('floorplans').list(`tiles/${sheetId}/output_files/${sub.name}`, { limit: 5000 });
              if (levelFiles) {
                for (const tile of levelFiles) {
                  allPaths.push(`tiles/${sheetId}/output_files/${sub.name}/${tile.name}`);
                }
              }
            }
          }
          if (allPaths.length > 0) {
            // Supabase storage remove supports batches
            for (let i = 0; i < allPaths.length; i += 100) {
              await supabase.storage.from('floorplans').remove(allPaths.slice(i, i + 100));
            }
          }
        }
      } catch (e) {
        console.warn('Tile cleanup warning (non-fatal):', e);
      }

      // Clean up cached vectors
      try {
        await supabase.from('sheet_vectors').delete().eq('sheet_id', sheetId);
      } catch (e) {
        // Table may not exist yet
      }

      // Paginated id read (fetchAllIn): the old single select silently truncated
      // at PostgREST's 1000-row cap, so a big sheet left orphaned units that made
      // the sheets delete below fail. Deletes are chunked (an .in(...) URL with
      // every unit id 414s past ~250 units) and error-checked so a partial
      // failure surfaces in the catch toast instead of pretending success.
      const sheetUnits = await fetchAllIn<{ id: string }>('units', 'sheet_id', [sheetId], 'id');
      if (sheetUnits.length > 0) {
        const unitIds = sheetUnits.map(u => u.id);
        const DELETE_CHUNK = 200;
        for (let i = 0; i < unitIds.length; i += DELETE_CHUNK) {
          const chunk = unitIds.slice(i, i + DELETE_CHUNK);
          const { error: logDelError } = await supabase.from('status_logs').delete().in('unit_id', chunk);
          if (logDelError) throw logDelError;
        }
        // Units are keyed to the sheet, so one filtered delete needs no id list.
        const { error: unitDelError } = await supabase.from('units').delete().eq('sheet_id', sheetId);
        if (unitDelError) throw unitDelError;
      }

      const { error } = await supabase.from('sheets').delete().eq('id', sheetId);
      if (error) throw error;

      const newSheets = sheets.filter(s => s.id !== sheetId);
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets(project?.id || projectId) });
      
      if (activeSheetId === sheetId) {
        setActiveSheetId(newSheets.length > 0 ? newSheets[0].id : '');
      }
      showToast('Level deleted successfully!', 'success');
    } catch (e: any) {
      showToast('Failed to delete: ' + e.message, 'error');
    }
  };

  const handleReorderSheets = async (updatedSheets: Sheet[]) => {
    try {
      await reorderSheetsMutation.mutateAsync(updatedSheets);
      showToast('Level order saved successfully!', 'success');
    } catch (e: any) {
      showToast('Failed to save order: ' + e.message, 'error');
    }
  };

  return {
    isModalOpen, setIsModalOpen,
    newLevelName, setNewLevelName,
    selectedFile, setSelectedFile,
    pdfPageNumber, setPdfPageNumber,
    isUploading, setIsUploading,
    handleAddLevel,
    handleAttachOriginal,
    handleRenameSheet,
    handleDeleteSheet,
    handleReorderSheets,
    handleAddActivity,
    handleUpdateActivity,
    handleDeleteActivity
  };
}

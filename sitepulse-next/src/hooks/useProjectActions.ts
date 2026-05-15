import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { useMapStore } from '@/store/useMapStore';
import { useUIStore } from '@/store/useUIStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { uploadFloorplanService, attachOriginalService } from '@/services/api';
import { useUpdateMilestone, useReorderSheets } from '@/hooks/useProjectQueries';
import type { Project, Sheet, Milestone } from '@/types/domain';
import { queryKeys } from '@/types/queryKeys';

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
  const updateMilestoneMutation = useUpdateMilestone(project?.id as string, activeSheetId);
  const reorderSheetsMutation = useReorderSheets(project?.id || projectId);

  const showToast = (message: string, type: 'success' | 'error' | 'info' | 'warning') => {
    if (!settings.enableToasts) return;
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleAddMilestone = async (name: string, color: string, track: string) => {
    const rawName = name?.trim();
    if (!rawName || !project || !project.id) return;
    try {
      const milestones = queryClient.getQueryData<Milestone[]>(queryKeys.milestones(project.id)) || [];
      const trackMs = milestones.filter(m => m.track === track);
      const maxOrder = trackMs.reduce((max, m) => Math.max(max, m.sequence_order || 0), -1);
      
      const { data, error } = await supabase.from('project_milestones').insert([{ project_id: project.id, name: rawName, color, track, sequence_order: maxOrder + 1 }]).select();
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: queryKeys.milestones(project.id) });
    } catch (err: any) {
      showToast('Failed to add milestone: ' + err.message, 'error');
    }
  };

  const handleUpdateMilestone = async (id: string, oldName: string, newName: string, newColor: string) => {
    try {
      await updateMilestoneMutation.mutateAsync({ id, oldName, newName, newColor });
    } catch (err: any) {
      showToast('Failed to update milestone: ' + err.message, 'error');
    }
  };

  const handleDeleteMilestone = async (id: string) => {
    try {
      const { data: milestoneData, error: fetchErr } = await supabase.from('project_milestones').select('name').eq('id', id).single();
      if (fetchErr) throw fetchErr;

      if (milestoneData?.name) {
        const { error: logErr } = await supabase.from('status_logs').delete().eq('milestone', milestoneData.name);
        if (logErr) throw logErr;
      }

      const { error } = await supabase.from('project_milestones').delete().eq('id', id);
      if (error) throw error;
      
      queryClient.invalidateQueries({ queryKey: queryKeys.milestones(project?.id || projectId) });
      queryClient.invalidateQueries({ queryKey: ['statuses'] });
    } catch (err: any) {
      showToast('Failed to delete milestone: ' + err.message, 'error');
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

      const { base_image_url } = await uploadFloorplanService(sheetId, selectedFile, pdfPageNumber, token);

      await supabase.from('sheets').update({ base_image_url }).eq('id', sheetId);

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
      
      // Remove stored images and original PDF
      await supabase.storage.from('floorplans').remove([
        `converted/${sheetId}.png`,
        `originals/${sheetId}.pdf`
      ]);

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

      const { data: sheetUnits } = await supabase.from('units').select('id').eq('sheet_id', sheetId);
      if (sheetUnits && sheetUnits.length > 0) {
        const unitIds = sheetUnits.map(u => u.id);
        await supabase.from('status_logs').delete().in('unit_id', unitIds);
        await supabase.from('units').delete().in('id', unitIds);
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
    handleAddMilestone,
    handleUpdateMilestone,
    handleDeleteMilestone
  };
}

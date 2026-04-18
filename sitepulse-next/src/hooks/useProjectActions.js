import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { useAppStore } from '@/store/useAppStore';
import { uploadFloorplanService, attachOriginalService } from '@/services/api';
import { useUpdateMilestone } from '@/hooks/useProjectQueries';

export function useProjectActions(project, sheets) {
  const queryClient = useQueryClient();
  const activeSheetId = useAppStore(s => s.activeSheetId);
  const setActiveSheetId = useAppStore(s => s.setActiveSheetId);
  const selectedFile = useAppStore(s => s.selectedFile);
  const setSelectedFile = useAppStore(s => s.setSelectedFile);
  const newLevelName = useAppStore(s => s.newLevelName);
  const setNewLevelName = useAppStore(s => s.setNewLevelName);
  const setIsUploading = useAppStore(s => s.setIsUploading);
  const isUploading = useAppStore(s => s.isUploading);
  const setIsModalOpen = useAppStore(s => s.setIsModalOpen);
  const isModalOpen = useAppStore(s => s.isModalOpen);
  const pdfPageNumber = useAppStore(s => s.pdfPageNumber);
  const setPdfPageNumber = useAppStore(s => s.setPdfPageNumber);
  const setToast = useAppStore(s => s.setToast);
  const settings = useAppStore(s => s.settings) || {};

  const updateMilestoneMutation = useUpdateMilestone(project?.id, activeSheetId);

  const showToast = (message, type) => {
    if (!settings.enableToasts) return;
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleAddMilestone = async (name, color, track) => {
    const rawName = name?.trim();
    if (!rawName || !project) return;
    try {
      const { data, error } = await supabase.from('project_milestones').insert([{ project_id: project.id, name: rawName, color, track }]).select();
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['milestones'] });
    } catch (err) {
      showToast('Failed to add milestone: ' + err.message, 'error');
    }
  };

  const handleUpdateMilestone = async (id, oldName, newName, newColor) => {
    try {
      await updateMilestoneMutation.mutateAsync({ id, oldName, newName, newColor });
    } catch (err) {
      showToast('Failed to update milestone: ' + err.message, 'error');
    }
  };

  const handleDeleteMilestone = async (id) => {
    try {
      const { data: milestoneData, error: fetchErr } = await supabase.from('project_milestones').select('name').eq('id', id).single();
      if (fetchErr) throw fetchErr;

      if (milestoneData?.name) {
        const { error: logErr } = await supabase.from('status_logs').delete().eq('milestone', milestoneData.name);
        if (logErr) throw logErr;
      }

      const { error } = await supabase.from('project_milestones').delete().eq('id', id);
      if (error) throw error;
      
      queryClient.invalidateQueries({ queryKey: ['milestones'] });
      queryClient.invalidateQueries({ queryKey: ['statuses'] });
    } catch (err) {
      showToast('Failed to delete milestone: ' + err.message, 'error');
    }
  };

  const handleAddLevel = async (e) => {
    e.preventDefault();
    if (!selectedFile || !newLevelName) return;
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

      const { image_url } = await uploadFloorplanService(sheetId, selectedFile, pdfPageNumber, token);

      await supabase.from('sheets').update({ base_image_url: image_url }).eq('id', sheetId);

      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      setActiveSheetId(sheetId);
      setIsModalOpen(false);
      setNewLevelName('');
      setSelectedFile(null);
      setPdfPageNumber(1);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setIsUploading(false);
    }
  };

  const handleAttachOriginal = async (file) => {
    if (!activeSheetId || !file) return;
    try {
      showToast('Uploading original PDF...', 'success');
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      await attachOriginalService(activeSheetId, file, token);
      showToast('Successfully attached original PDF!', 'success');
    } catch (e) {
      showToast('Failed to attach: ' + e.message, 'error');
    }
  };

  const handleRenameSheet = async (sheetId, newName) => {
    try {
      const { error } = await supabase.from('sheets').update({ sheet_name: newName }).eq('id', sheetId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      showToast('Level renamed successfully!', 'success');
    } catch (e) {
      showToast('Failed to rename: ' + e.message, 'error');
    }
  };

  const handleDeleteSheet = async (sheetId) => {
    try {
      showToast('Wiping level and all data...', 'success');
      
      await supabase.storage.from('floorplans').remove([
        `converted/${sheetId}.png`,
        `originals/${sheetId}.pdf`
      ]);

      const { data: sheetUnits } = await supabase.from('units').select('id').eq('sheet_id', sheetId);
      if (sheetUnits && sheetUnits.length > 0) {
        const unitIds = sheetUnits.map(u => u.id);
        await supabase.from('status_logs').delete().in('unit_id', unitIds);
        await supabase.from('units').delete().in('id', unitIds);
      }

      const { error } = await supabase.from('sheets').delete().eq('id', sheetId);
      if (error) throw error;

      const newSheets = sheets.filter(s => s.id !== sheetId);
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      
      if (activeSheetId === sheetId) {
        setActiveSheetId(newSheets.length > 0 ? newSheets[0].id : '');
      }
      showToast('Level deleted successfully!', 'success');
    } catch (e) {
      showToast('Failed to delete: ' + e.message, 'error');
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
    handleAddMilestone,
    handleUpdateMilestone,
    handleDeleteMilestone
  };
}

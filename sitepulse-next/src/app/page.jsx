"use client";
import React, { useState, useEffect, useRef } from 'react';
import { Settings, FolderEdit } from 'lucide-react';
import FloorplanCanvas from '@/components/FloorplanCanvas';
import FieldStatusTable from '@/components/FieldStatusTable';
import MilestoneCommandMenu from '@/components/MilestoneCommandMenu';
import SettingsMenu from '@/components/SettingsMenu';
import ProjectManagementMenu from '@/components/ProjectManagementMenu';
import { supabase } from '@/supabaseClient';
import { MILESTONES } from '@/utils/constants';
import { resolveMilestoneColorById } from '@/utils/milestoneTheme';

function App() {
  const [viewMode, setViewMode] = useState('list');

  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);

  const [toast, setToast] = useState(null);
  const [settings, setSettings] = useState({ enableToasts: true, showHistoryHover: false });
  const [confirmModal, setConfirmModal] = useState(null);

  const [colorMode, setColorMode] = useState('system');

  useEffect(() => {
    const saved = localStorage.getItem('sitepulse-color-mode');
    if (saved) setColorMode(saved);
  }, []);
  const [filterMilestone, setFilterMilestone] = useState(null);
  const [milestoneMenu, setMilestoneMenu] = useState(null);
  const [savingUnitId, setSavingUnitId] = useState(null);

  const [pendingPolygonPoints, setPendingPolygonPoints] = useState(null);
  const [unitNamingOpen, setUnitNamingOpen] = useState(false);
  const [newUnitName, setNewUnitName] = useState('');

  const [project, setProject] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [activeSheetId, setActiveSheetId] = useState('');
  const [units, setUnits] = useState([]);
  const [activeStatuses, setActiveStatuses] = useState([]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newLevelName, setNewLevelName] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [pdfPageNumber, setPdfPageNumber] = useState(1);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    localStorage.setItem('sitepulse-color-mode', colorMode);
    const root = document.documentElement;
    if (colorMode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', colorMode);
  }, [colorMode]);

  useEffect(() => {
    async function loadData() {
      let { data: projects } = await supabase.from('projects').select('*');
      if (!projects || projects.length === 0) {
        const { data } = await supabase.from('projects').insert([{ name: 'Orchard Path III' }]).select();
        projects = data;
      }
      setProject(projects[0]);

      const { data: loadedSheets } = await supabase.from('sheets').select('*').eq('project_id', projects[0].id);
      setSheets(loadedSheets || []);
      if (loadedSheets && loadedSheets.length > 0) setActiveSheetId(loadedSheets[0].id);
    }
    loadData();
  }, []);

  useEffect(() => {
    async function loadUnitsAndStatuses() {
      if (!activeSheetId) {
        setUnits([]);
        setActiveStatuses([]);
        return;
      }

      const { data: loadedUnits, error: unitError } = await supabase
        .from('units')
        .select('*')
        .eq('sheet_id', activeSheetId);

      if (!unitError && loadedUnits) {
        setUnits(loadedUnits);

        if (loadedUnits.length > 0) {
          const unitIds = loadedUnits.map((u) => u.id);

          const { data: logs, error: logError } = await supabase
            .from('status_logs')
            .select('*')
            .in('unit_id', unitIds)
            .order('created_at', { ascending: false });

          if (!logError && logs) {
            const latestStatuses = [];
            const seenIds = new Set();
            for (const log of logs) {
              if (!seenIds.has(log.unit_id)) {
                latestStatuses.push(log);
                seenIds.add(log.unit_id);
              }
            }
            setActiveStatuses(latestStatuses);
          }
        } else {
          setActiveStatuses([]);
        }
      }
    }
    loadUnitsAndStatuses();
  }, [activeSheetId]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setMilestoneMenu({ mode: 'filter' });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const showToast = (message, type) => {
    if (!settings.enableToasts) return;
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const activeSheet = sheets.find((s) => s.id === activeSheetId);

  const floorplanRef = useRef(null);

  const exportToPDF = async () => {
    if (!activeSheetId || !activeSheet) return;
    
    showToast('Generating Vector PDF... This may take a few seconds.', 'success');
    
    const polygonsPayload = units.filter(u => u.polygon_coordinates && u.polygon_coordinates.length > 2).map(u => {
      const stat = activeStatuses.find((s) => s.unit_id === u.id);
      const color = stat ? stat.status_color : 'rgba(128,128,128,0.3)';
      return {
        unit_id: u.id,
        unit_number: u.unit_number,
        status: stat ? stat.milestone : 'Not Started',
        color: color,
        points: u.polygon_coordinates
      };
    });

    const payload = {
      include_data: settings.includeExportData !== false,
      polygons: polygonsPayload,
      project_name: project?.name || 'Project',
      sheet_name: activeSheet.sheet_name
    };

    try {
      const response = await fetch(`http://127.0.0.1:8000/export-pdf/${activeSheetId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Export failed on server');
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = downloadUrl;
      
      let filename = `${project?.name || 'SitePulse'}_${activeSheet.sheet_name}_Status.pdf`.replace(/\s+/g, '_');
      const disposition = response.headers.get('content-disposition');
      if (disposition && disposition.indexOf('filename=') !== -1) {
          const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
          if (matches != null && matches[1]) { 
              filename = matches[1].replace(/['"]/g, '');
          }
      }
      
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
      
      showToast('Vector PDF Exported!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
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

      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch(
        `http://127.0.0.1:8000/upload-floorplan/${sheetId}?page_number=${pdfPageNumber}`,
        {
          method: 'POST',
          body: formData,
        }
      );

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Failed to convert PDF');
      }

      const { image_url } = await response.json();

      await supabase.from('sheets').update({ base_image_url: image_url }).eq('id', sheetId);

      const updatedSheet = { ...newSheet[0], base_image_url: image_url };
      setSheets([...sheets, updatedSheet]);
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
      const formData = new FormData();
      formData.append('file', file);
      
      const res = await fetch(`http://127.0.0.1:8000/attach-original/${activeSheetId}`, {
        method: 'POST',
        body: formData
      });
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Failed to attach');
      }
      
      showToast('Successfully attached original PDF!', 'success');
    } catch (e) {
      showToast('Failed to attach: ' + e.message, 'error');
    }
  };

  const handleRenameSheet = async (sheetId, newName) => {
    try {
      const { error } = await supabase.from('sheets').update({ sheet_name: newName }).eq('id', sheetId);
      if (error) throw error;
      setSheets(sheets.map(s => s.id === sheetId ? { ...s, sheet_name: newName } : s));
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
      setSheets(newSheets);
      
      if (activeSheetId === sheetId) {
        setActiveSheetId(newSheets.length > 0 ? newSheets[0].id : '');
      }

      showToast('Level deleted successfully!', 'success');
    } catch (e) {
      showToast('Failed to delete: ' + e.message, 'error');
    }
  };

  const handlePolygonComplete = (points) => {
    setIsDrawingMode(false);
    setPendingPolygonPoints(points);
    setNewUnitName('');
    setUnitNamingOpen(true);
  };

  const saveNewUnitFromPopover = async () => {
    const name = newUnitName.trim();
    if (!name || !pendingPolygonPoints) return;

    try {
      const { data, error } = await supabase
        .from('units')
        .insert([
          {
            sheet_id: activeSheetId,
            unit_number: name,
            polygon_coordinates: pendingPolygonPoints,
          },
        ])
        .select();

      if (error) throw error;
      if (data) setUnits([...units, data[0]]);
      setUnitNamingOpen(false);
      setPendingPolygonPoints(null);
      setNewUnitName('');
      showToast('Unit saved.', 'success');
    } catch (err) {
      showToast('Error saving unit: ' + err.message, 'error');
    }
  };

  const cancelUnitNaming = () => {
    setUnitNamingOpen(false);
    setPendingPolygonPoints(null);
    setNewUnitName('');
  };

  const handleDeleteUnit = (unitId) => {
    setConfirmModal({
      message: 'Are you sure you want to delete this unit markup?',
      onConfirm: async () => {
        try {
          const { error } = await supabase.from('units').delete().eq('id', unitId);
          if (error) throw error;
          setUnits((prev) => prev.filter((u) => u.id !== unitId));
          setActiveStatuses((prev) => prev.filter((s) => s.unit_id !== unitId));
          showToast('Unit deleted successfully.', 'success');
        } catch (err) {
          showToast('Error deleting unit: ' + err.message, 'error');
        } finally {
          setConfirmModal(null);
        }
      },
    });
  };

  const handleStatusUpdate = (newStatusLog) => {
    setActiveStatuses((prev) => [
      ...prev.filter((s) => s.unit_id !== newStatusLog.unit_id),
      newStatusLog,
    ]);
  };

  const commitUnitMilestone = async (unit, milestone) => {
    setSavingUnitId(unit.id);
    try {
      const status_color = resolveMilestoneColorById(milestone.id);
      const { data, error } = await supabase
        .from('status_logs')
        .insert([
          {
            unit_id: unit.id,
            milestone: milestone.name,
            status_color,
          },
        ])
        .select();

      if (error) throw error;
      if (data) handleStatusUpdate(data[0]);
    } catch (err) {
      console.error(err);
      showToast('Failed to update status: ' + err.message, 'error');
    } finally {
      setSavingUnitId(null);
    }
  };

  const handleMilestoneMenuSelect = (m) => {
    if (milestoneMenu?.mode === 'filter') {
      setFilterMilestone(m.name);
    } else if (milestoneMenu?.mode === 'unit') {
      void commitUnitMilestone(milestoneMenu.unit, m);
    }
    setMilestoneMenu(null);
  };


  const cycleColorMode = () => {
    setColorMode((prev) => (prev === 'system' ? 'light' : prev === 'light' ? 'dark' : 'system'));
  };

  const colorModeLabel = colorMode === 'system' ? 'System' : colorMode === 'light' ? 'Light' : 'Dark';

  return (
    <div
      className="h-screen flex flex-col p-4 md:p-6 text-slate-800 dark:text-slate-100"
      style={{ fontFamily: 'sans-serif', background: 'var(--bg)' }}
    >
      <header className="mb-4 flex-shrink-0 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 rounded-2xl border px-4 py-3 glass-panel">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">SitePulse Visual Tracker</h1>
          <div className="flex flex-wrap gap-3 mt-2">
            <select
              className="border border-slate-300/80 dark:border-white/15 p-2 rounded-lg font-semibold shadow-sm bg-white/60 dark:bg-black/25"
              disabled >
              <option>{project ? project.name : 'Loading...'}</option>
            </select>
            <select
              className="border border-slate-300/80 dark:border-white/15 p-2 rounded-lg shadow-sm bg-white/60 dark:bg-black/25"
              value={activeSheetId}
              onChange={(e) => setActiveSheetId(e.target.value)}
            >
              {sheets.length === 0 && <option disabled value="">No levels added</option>}
              {sheets.map((sheet) => (
                <option key={sheet.id} value={sheet.id}>
                  {sheet.sheet_name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="border border-slate-300/80 dark:border-white/15 p-2 rounded-lg hover:bg-white/50 dark:hover:bg-white/10 cursor-pointer text-sm font-medium shadow-sm"
            >
              + Add Level
            </button>
            <button
              type="button"
              onClick={() => setIsProjectMenuOpen(true)}
              className="border border-slate-300/80 dark:border-white/15 p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-white/50 dark:hover:bg-white/10 cursor-pointer shadow-sm"
              title="Manage Levels"
            >
              <FolderEdit size={20} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="button"
            onClick={() => setMilestoneMenu({ mode: 'filter' })}
            className="px-3 py-2 rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/50 dark:bg-black/20 text-xs font-semibold shadow-sm"
          >
            Milestones (Ctrl+K)
          </button>
          <div className="flex rounded-lg border border-slate-300/80 dark:border-white/15 overflow-hidden shadow-sm">
            <button
              type="button"
              onClick={() => {
                setViewMode('list');
                setIsDrawingMode(false);
              }}
              className={`px-4 py-2 text-sm font-semibold cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200'
              }`}
            >
              Field list
            </button>
            <button
              type="button"
              onClick={() => setViewMode('map')}
              className={`px-4 py-2 text-sm font-semibold cursor-pointer border-l border-slate-300/80 dark:border-white/10 ${
                viewMode === 'map'
                  ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200'
              }`}
            >
              Map
            </button>
          </div>
          {viewMode === 'map' && activeSheet?.base_image_url && (
            <button
              type="button"
              onClick={exportToPDF}
              className="px-4 py-2 rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/50 dark:bg-black/20 font-medium shadow-sm text-sm"
            >
              Export PDF
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/50 dark:bg-black/20 font-medium shadow-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
            title="Settings"
          >
            <Settings size={20} />
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col">
        {viewMode === 'list' ? (
          <div className="h-full overflow-auto">
            <FieldStatusTable
              units={units}
              activeStatuses={activeStatuses}
              statusFilter={filterMilestone}
              savingUnitId={savingUnitId}
              onChooseStatus={(unit) => setMilestoneMenu({ mode: 'unit', unit })}
            />
          </div>
        ) : (
          <div className="h-full flex flex-col lg:flex-row gap-5 items-stretch min-h-0">
            <div className="flex-[3] lg:flex-[4] flex flex-col min-h-0 min-w-0 h-full">
              {activeSheet && activeSheet.base_image_url ? (
                <FloorplanCanvas
                  ref={floorplanRef}
                  imageUrl={activeSheet.base_image_url}
                  units={units}
                  activeStatuses={activeStatuses}
                  isDrawingMode={isDrawingMode}
                  onDrawingModeChange={setIsDrawingMode}
                  onPolygonComplete={handlePolygonComplete}
                  legendFilter={filterMilestone}
                />
              ) : (
                <div
                  className="w-full h-full border-2 border-dashed rounded-xl flex items-center justify-center text-slate-500 glass-panel"
                >
                  {sheets.length === 0
                    ? 'Click "+ Add Level" to upload your first floor plan.'
                    : 'Loading floor plan...'}
                </div>
              )}

              {unitNamingOpen && (
                <div
                  className="absolute top-6 right-6 z-[60] w-64 rounded-2xl border p-4 shadow-2xl animate-in fade-in zoom-in-95 duration-200 backdrop-blur-md"
                  style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
                >
                  <h2 className="text-sm font-bold mb-1.5 text-slate-900 dark:text-white">Name this unit</h2>
                  <input
                    type="text"
                    autoFocus
                    className="w-full text-sm border border-slate-300/80 dark:border-white/15 rounded-xl px-2.5 py-1.5 mb-3 bg-white/70 dark:bg-black/25 outline-none focus:ring-2 focus:ring-blue-500/50"
                    placeholder="e.g. 1204"
                    value={newUnitName}
                    onChange={(e) => setNewUnitName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveNewUnitFromPopover();
                      if (e.key === 'Escape') cancelUnitNaming();
                    }}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={cancelUnitNaming}
                      className="px-3 py-1.5 rounded-xl border border-slate-300/80 dark:border-white/15 font-medium text-xs hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveNewUnitFromPopover()}
                      className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 font-bold text-white text-xs shadow-sm transition-colors"
                    >
                      Save unit
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div
              className="w-full lg:w-[320px] p-4 rounded-xl border flex flex-col min-h-0 flex-shrink-0 glass-panel"
            >
              <h3 className="font-bold text-lg mb-3 border-b border-slate-200/60 dark:border-white/10 pb-2 flex-shrink-0 text-slate-800 dark:text-slate-100">
                Live legend
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
                Click a milestone to highlight matching units on the map. “All” clears the filter.
              </p>
              <div className="flex flex-wrap gap-1.5 mb-4 max-h-[120px] overflow-y-auto pr-1">
                <button
                  type="button"
                  onClick={() => setFilterMilestone(null)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition ${
                    !filterMilestone
                      ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900 border-transparent'
                      : 'bg-white/50 dark:bg-black/20 border-slate-200/80 dark:border-white/10'
                  }`}
                >
                  All
                </button>
                {MILESTONES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setFilterMilestone((prev) => (prev === m.name ? null : m.name))}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-medium border max-w-[140px] truncate transition ${
                      filterMilestone === m.name
                        ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-slate-900'
                        : ''
                    }`}
                    style={{
                      background: `var(--milestone-${m.id})`,
                      borderColor: 'var(--glass-border)',
                    }}
                    title={m.name}
                  >
                    {m.name.length > 22 ? `${m.name.slice(0, 20)}…` : m.name}
                  </button>
                ))}
              </div>

              <h4 className="font-bold text-sm mb-2 text-slate-800 dark:text-slate-100 border-b border-slate-200/60 dark:border-white/10 pb-2">
                Mapped units
              </h4>

              <div className="overflow-y-auto flex-1 pr-2">
                {units.length === 0 ? (
                  <p className="text-slate-500 text-sm italic">
                    No units mapped on this level yet. Use Draw on the map dock to begin.
                  </p>
                ) : (
                  <div className="border border-slate-200/60 dark:border-white/10 rounded-lg overflow-hidden shadow-sm flex flex-col">
                    <div className="bg-slate-800/95 dark:bg-white/10 text-white dark:text-slate-100 p-3 font-semibold text-sm flex items-center gap-2 backdrop-blur-sm">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                      </svg>
                      {activeSheet?.sheet_name || 'Level'}
                    </div>

                    <ul className="flex flex-col bg-white/40 dark:bg-black/15">
                      {units.map((unit, index) => (
                        <li
                          key={unit.id}
                          className="relative pl-10 pr-3 py-3 border-b border-slate-100/80 dark:border-white/5 last:border-0 hover:bg-white/50 dark:hover:bg-white/5 flex justify-between items-center group transition-colors"
                        >
                          <div
                            className={`absolute left-4 top-0 w-px bg-slate-300/80 dark:bg-white/20 ${
                              index === units.length - 1 ? 'h-1/2' : 'h-full'
                            }`}
                          />
                          <div className="absolute left-4 top-1/2 w-4 h-px bg-slate-300/80 dark:bg-white/20" />

                          <span className="font-medium text-sm text-slate-700 dark:text-slate-200">
                            Unit: {unit.unit_number}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteUnit(unit.id)}
                            className="text-red-600 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity hover:text-red-800 text-xs font-bold px-2 py-1 border border-red-200/80 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40"
                          >
                            Delete
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <MilestoneCommandMenu
        open={milestoneMenu !== null}
        onOpenChange={(open) => !open && setMilestoneMenu(null)}
        title={
          milestoneMenu?.mode === 'unit'
            ? `Status — Unit ${milestoneMenu.unit.unit_number}`
            : 'Filter & search milestones'
        }
        description={
          milestoneMenu?.mode === 'filter'
            ? 'Pick one to filter the map and field list. Use Ctrl+K anytime.'
            : 'Search and press Enter to save this unit’s status.'
        }
        onSelect={handleMilestoneMenuSelect}
      />

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="p-6 rounded-2xl shadow-2xl w-full max-w-md border glass-panel">
            <h2 className="text-xl font-bold mb-4 text-slate-900 dark:text-white">Add New Level</h2>
            <form onSubmit={handleAddLevel}>
              <div className="mb-4">
                <label className="block text-sm font-bold mb-2 text-slate-700 dark:text-slate-300">Level/Sheet Name</label>
                <input
                  type="text"
                  className="w-full border border-slate-300/80 dark:border-white/15 p-2 rounded-lg bg-white/60 dark:bg-black/25"
                  placeholder="e.g., Level 3"
                  value={newLevelName}
                  onChange={(e) => setNewLevelName(e.target.value)}
                  required
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-bold mb-2 text-slate-700 dark:text-slate-300">PDF Page Number</label>
                <input
                  type="number"
                  min="1"
                  className="w-full border border-slate-300/80 dark:border-white/15 p-2 rounded-lg bg-white/60 dark:bg-black/25"
                  value={pdfPageNumber}
                  onChange={(e) => setPdfPageNumber(e.target.value)}
                  required
                />
                <p className="text-xs text-slate-500 mt-1">Which page contains this specific floor plan?</p>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-bold mb-2 text-slate-700 dark:text-slate-300">Floor Plan PDF</label>
                <input
                  type="file"
                  accept=".pdf"
                  className="w-full border border-slate-300/80 dark:border-white/15 p-2 rounded-lg text-sm bg-white/60 dark:bg-black/25"
                  onChange={(e) => setSelectedFile(e.target.files[0])}
                  required
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300/80 dark:border-white/15 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUploading}
                  className="px-4 py-2 rounded-lg bg-slate-800 dark:bg-white text-white dark:text-slate-900 font-bold disabled:opacity-60"
                >
                  {isUploading ? 'Processing...' : 'Upload & Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center z-[60] p-4">
          <div className="rounded-2xl shadow-2xl border max-w-md w-full p-6 glass-panel">
            <p className="text-slate-800 dark:text-slate-100 mb-6">{confirmModal.message}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 rounded-lg border border-slate-300/80 dark:border-white/15 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => confirmModal.onConfirm()}
                className="px-4 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] px-6 py-3 rounded-lg shadow-lg font-medium text-white max-w-md text-center ${
            toast.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'
          }`}
        >
          {toast.message}
        </div>
      )}

      <SettingsMenu
        open={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={setSettings}
        colorMode={colorMode}
        setColorMode={setColorMode}
        onAttachOriginal={handleAttachOriginal}
      />

      <ProjectManagementMenu
        open={isProjectMenuOpen}
        onClose={() => setIsProjectMenuOpen(false)}
        sheets={sheets}
        onRenameSheet={handleRenameSheet}
        onDeleteSheet={handleDeleteSheet}
      />
    </div>
  );
}

export default App;



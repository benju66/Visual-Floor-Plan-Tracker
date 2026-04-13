import React, { useState, useEffect } from 'react';
import jsPDF from 'jspdf';
import FloorplanCanvas from './components/FloorplanCanvas';
import FieldStatusTable from './components/FieldStatusTable';
import { supabase } from './supabaseClient';

function App() {
  const [viewMode, setViewMode] = useState('list');

  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [showHistoryHover, setShowHistoryHover] = useState(false);

  const [toast, setToast] = useState(null);
  const [settings, setSettings] = useState({ enableToasts: true });
  const [confirmModal, setConfirmModal] = useState(null);

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

  // 1. Initial Load: Get Project and Sheets
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
          const unitIds = loadedUnits.map(u => u.id);

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

  const showToast = (message, type) => {
    if (!settings.enableToasts) return;
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const activeSheet = sheets.find(s => s.id === activeSheetId);

  const exportToPDF = () => {
    if (!activeSheetId || !activeSheet) return;
    const canvas = document.querySelector('#sitepulse-floorplan-container canvas');
    if (!canvas) {
      showToast('Open Map view with a loaded floor plan to export.', 'error');
      return;
    }

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('landscape');

    pdf.addImage(imgData, 'PNG', 10, 10, 277, 150);

    pdf.setFontSize(16);
    pdf.text(`${project?.name ?? 'Project'} - ${activeSheet.sheet_name} Status Report`, 10, 170);
    pdf.setFontSize(10);

    let yPos = 180;
    units.forEach((u, i) => {
      const stat = activeStatuses.find(s => s.unit_id === u.id);
      pdf.text(`Unit ${u.unit_number}: ${stat ? stat.milestone : 'Not Started'}`, 10 + (i % 4) * 60, yPos + Math.floor(i / 4) * 7);
    });

    pdf.save(`${project?.name ?? 'SitePulse'}_${activeSheet.sheet_name}_Status.pdf`);
    showToast('PDF exported.', 'success');
  };

  // 3. Handle PDF Upload
  const handleAddLevel = async (e) => {
    e.preventDefault();
    if (!selectedFile || !newLevelName) return;
    setIsUploading(true);

    try {
      const { data: newSheet, error } = await supabase.from('sheets').insert([
        { project_id: project.id, sheet_name: newLevelName }
      ]).select();
      
      if (error) throw error;
      const sheetId = newSheet[0].id;

      const formData = new FormData();
      formData.append('file', selectedFile);

      // Hits your FastAPI backend running in Terminal 1
      const response = await fetch(`http://127.0.0.1:8000/upload-floorplan/${sheetId}?page_number=${pdfPageNumber}`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Failed to convert PDF');
      }
      
      const { image_url } = await response.json();
      
      // THE FIX: Save the new URL into the Supabase 'sheets' table so it survives page reloads
      await supabase.from('sheets').update({ base_image_url: image_url }).eq('id', sheetId);

      const updatedSheet = { ...newSheet[0], base_image_url: image_url };
      setSheets([...sheets, updatedSheet]);
      setActiveSheetId(sheetId);
      setIsModalOpen(false);
      setNewLevelName('');
      setSelectedFile(null);
      setPdfPageNumber(1); // Reset
      
    } catch (err) {
      showToast('Upload failed: ' + err.message, 'error');
    } finally {
      setIsUploading(false);
    }
  };

  // 4. NEW: Handle Saving the Drawn Polygon
  const handlePolygonComplete = async (points) => {
    setIsDrawingMode(false);
    
    const unitNumber = prompt("Enter the unit or area number for this shape:");
    if (!unitNumber) return;

    try {
      const { data, error } = await supabase.from('units').insert([{
        sheet_id: activeSheetId,
        unit_number: unitNumber,
        polygon_coordinates: points
      }]).select();

      if (error) throw error;
      
      if (data) {
        setUnits([...units, data[0]]);
      }
    } catch (err) {
      showToast('Error saving unit: ' + err.message, 'error');
    }
  };

  const handleDeleteUnit = (unitId) => {
    setConfirmModal({
      message: 'Are you sure you want to delete this unit markup?',
      onConfirm: async () => {
        try {
          const { error } = await supabase.from('units').delete().eq('id', unitId);
          if (error) throw error;
          setUnits(prev => prev.filter(u => u.id !== unitId));
          setActiveStatuses(prev => prev.filter(s => s.unit_id !== unitId));
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
    setActiveStatuses(prev => [
      ...prev.filter(s => s.unit_id !== newStatusLog.unit_id),
      newStatusLog,
    ]);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 text-slate-800" style={{ fontFamily: 'sans-serif' }}>
      <header className="mb-6 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">SitePulse Visual Tracker</h1>
          <div className="flex flex-wrap gap-3 mt-2">
            <select className="border border-slate-300 p-2 rounded-lg bg-white font-semibold text-slate-800 shadow-sm" disabled>
              <option>{project ? project.name : 'Loading...'}</option>
            </select>
            <select
              className="border border-slate-300 p-2 rounded-lg bg-white text-slate-800 shadow-sm"
              value={activeSheetId}
              onChange={(e) => setActiveSheetId(e.target.value)}
            >
              {sheets.length === 0 && <option disabled value="">No levels added</option>}
              {sheets.map(sheet => (
                <option key={sheet.id} value={sheet.id}>{sheet.sheet_name}</option>
              ))}
            </select>
            <button type="button" onClick={() => setIsModalOpen(true)} className="border border-slate-300 p-2 rounded-lg bg-white hover:bg-slate-100 cursor-pointer text-sm font-medium shadow-sm">
              + Add Level
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex rounded-lg border border-slate-300 overflow-hidden shadow-sm">
            <button
              type="button"
              onClick={() => {
                setViewMode('list');
                setIsDrawingMode(false);
              }}
              className={`px-4 py-2 text-sm font-semibold cursor-pointer ${viewMode === 'list' ? 'bg-slate-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              Field list
            </button>
            <button
              type="button"
              onClick={() => setViewMode('map')}
              className={`px-4 py-2 text-sm font-semibold cursor-pointer border-l border-slate-300 ${viewMode === 'map' ? 'bg-slate-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              Map
            </button>
          </div>
          {viewMode === 'map' && activeSheet?.base_image_url && (
            <button
              type="button"
              onClick={exportToPDF}
              className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 font-medium shadow-sm hover:bg-slate-50"
            >
              Export PDF
            </button>
          )}
          {viewMode === 'map' && (
            <button
              type="button"
              onClick={() => setShowHistoryHover(!showHistoryHover)}
              className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 cursor-pointer shadow-sm hover:bg-slate-50 text-sm font-medium"
            >
              {showHistoryHover ? 'Hover History: ON' : 'Hover History: OFF'}
            </button>
          )}
        </div>
      </header>

      {viewMode === 'list' ? (
        <FieldStatusTable units={units} activeStatuses={activeStatuses} onStatusUpdate={handleStatusUpdate} />
      ) : (
        <div className="flex flex-col lg:flex-row gap-5 items-stretch min-h-0">
          <div className="min-w-0 flex-[3] flex flex-col">
            {activeSheet && activeSheet.base_image_url ? (
              <FloorplanCanvas
                imageUrl={activeSheet.base_image_url}
                units={units}
                activeStatuses={activeStatuses}
                isDrawingMode={isDrawingMode}
                onDrawingModeChange={setIsDrawingMode}
                onPolygonComplete={handlePolygonComplete}
              />
            ) : (
              <div className="w-full h-[70vh] border-2 border-dashed border-slate-300 rounded-xl flex items-center justify-center bg-slate-100 text-slate-500">
                {sheets.length === 0 ? 'Click "+ Add Level" to upload your first floor plan.' : 'Loading floor plan...'}
              </div>
            )}
          </div>

          <div className="flex-1 bg-white p-4 rounded-xl border border-slate-200 shadow-sm h-[70vh] flex flex-col">
            <h3 className="font-bold text-lg mb-4 border-b border-slate-200 pb-2 text-slate-800">Mapped Units</h3>

            <div className="overflow-y-auto flex-1">
              {units.length === 0 ? (
                <p className="text-slate-500 text-sm italic">No units mapped on this level yet. Use Draw on the map toolbar to begin.</p>
              ) : (
                <ul className="space-y-2">
                  {units.map(unit => (
                    <li key={unit.id} className="flex justify-between items-center p-3 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors">
                      <span className="font-semibold text-slate-700">Unit: {unit.unit_number}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteUnit(unit.id)}
                        className="text-red-600 hover:text-red-800 text-sm font-bold px-2 py-1 border border-red-200 rounded-lg hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-xl shadow-xl w-full max-w-md border border-slate-200">
            <h2 className="text-xl font-bold mb-4 text-slate-900">Add New Level</h2>
            <form onSubmit={handleAddLevel}>
              <div className="mb-4">
                <label className="block text-sm font-bold mb-2 text-slate-700">Level/Sheet Name</label>
                <input type="text" className="w-full border border-slate-300 p-2 rounded-lg" placeholder="e.g., Level 3" value={newLevelName} onChange={(e) => setNewLevelName(e.target.value)} required />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-bold mb-2 text-slate-700">PDF Page Number</label>
                <input
                  type="number"
                  min="1"
                  className="w-full border border-slate-300 p-2 rounded-lg"
                  value={pdfPageNumber}
                  onChange={(e) => setPdfPageNumber(e.target.value)}
                  required
                />
                <p className="text-xs text-slate-500 mt-1">Which page contains this specific floor plan?</p>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-bold mb-2 text-slate-700">Floor Plan PDF</label>
                <input type="file" accept=".pdf" className="w-full border border-slate-300 p-2 rounded-lg text-sm" onChange={(e) => setSelectedFile(e.target.files[0])} required />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 rounded-lg border border-slate-300 bg-slate-50 text-slate-800 font-medium">Cancel</button>
                <button type="submit" disabled={isUploading} className="px-4 py-2 rounded-lg bg-slate-800 text-white font-bold hover:bg-slate-900 disabled:opacity-60">
                  {isUploading ? 'Processing...' : 'Upload & Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-md w-full p-6">
            <p className="text-slate-800 mb-6">{confirmModal.message}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 font-medium hover:bg-slate-50"
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
    </div>
  );
}

export default App;
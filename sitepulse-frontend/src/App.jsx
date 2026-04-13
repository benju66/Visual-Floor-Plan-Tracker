import React, { useState, useEffect } from 'react';
import FloorplanCanvas from './components/FloorplanCanvas';
import { MILESTONES } from './utils/constants';
import { supabase } from './supabaseClient';

function App() {
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [showHistoryHover, setShowHistoryHover] = useState(false);
  
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

  // 2. NEW: Load units whenever the active sheet changes
  useEffect(() => {
    async function loadUnitsAndStatuses() {
      if (!activeSheetId) {
        setUnits([]);
        return;
      }

      const { data: loadedUnits, error } = await supabase
        .from('units')
        .select('*')
        .eq('sheet_id', activeSheetId);
        
      if (!error && loadedUnits) {
        setUnits(loadedUnits);
      }
    }
    loadUnitsAndStatuses();
  }, [activeSheetId]);

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
      alert("Upload failed: " + err.message);
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
      alert("Error saving unit: " + err.message);
    }
  };

  const activeSheet = sheets.find(s => s.id === activeSheetId);

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8" style={{fontFamily: 'sans-serif', color: '#333'}}>
      <header className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">SitePulse Visual Tracker</h1>
          <div className="flex gap-4 mt-2">
            <select className="border p-2 rounded bg-white font-semibold" disabled>
              <option>{project ? project.name : 'Loading...'}</option>
            </select>
            <select 
              className="border p-2 rounded bg-white"
              value={activeSheetId}
              onChange={(e) => setActiveSheetId(e.target.value)}
            >
              {sheets.length === 0 && <option disabled value="">No levels added</option>}
              {sheets.map(sheet => (
                <option key={sheet.id} value={sheet.id}>{sheet.sheet_name}</option>
              ))}
            </select>
            <button onClick={() => setIsModalOpen(true)} className="border border-gray-400 p-2 rounded bg-gray-200 hover:bg-gray-300 cursor-pointer text-sm">
              + Add Level
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={() => setShowHistoryHover(!showHistoryHover)} className="px-4 py-2 rounded border bg-white cursor-pointer shadow-sm">
            {showHistoryHover ? 'Hover History: ON' : 'Hover History: OFF'}
          </button>
          <button 
            onClick={() => setIsDrawingMode(!isDrawingMode)} 
            disabled={!activeSheet}
            className={`px-4 py-2 rounded font-bold cursor-pointer shadow-sm ${!activeSheet ? 'opacity-50' : ''}`} 
            style={{backgroundColor: isDrawingMode ? '#ef4444' : '#2563eb', color: 'white'}}
          >
            {isDrawingMode ? 'Cancel Drawing' : '+ Draw Unit'}
          </button>
        </div>
      </header>

      <div style={{display: 'flex', gap: '20px'}}>
        <div style={{flex: '3'}}>
          {activeSheet && activeSheet.base_image_url ? (
            <FloorplanCanvas 
              imageUrl={activeSheet.base_image_url}
              units={units}
              activeStatuses={activeStatuses}
              isDrawingMode={isDrawingMode}
              onPolygonComplete={handlePolygonComplete} // <--- Passed the new function here
              showHistoryHover={showHistoryHover}
            />
          ) : (
            <div className="w-full h-[70vh] border-2 border-dashed border-gray-300 rounded flex items-center justify-center bg-gray-100 text-gray-500">
              {sheets.length === 0 ? 'Click "+ Add Level" to upload your first floor plan.' : 'Loading floor plan...'}
            </div>
          )}
        </div>

        <div style={{flex: '1', backgroundColor: 'white', padding: '16px', borderRadius: '8px', border: '1px solid #ccc', height: '70vh', overflowY: 'auto'}}>
          <h3 className="font-bold text-lg mb-4 border-b pb-2">Update Status</h3>
          <p className="text-gray-500 text-sm">Draw units on the map to start tracking.</p>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl w-96">
            <h2 className="text-xl font-bold mb-4">Add New Level</h2>
            <form onSubmit={handleAddLevel}>
              <div className="mb-4">
                <label className="block text-sm font-bold mb-2">Level/Sheet Name</label>
                <input type="text" className="w-full border p-2 rounded" placeholder="e.g., Level 3" value={newLevelName} onChange={(e) => setNewLevelName(e.target.value)} required />
              </div>
              
              <div className="mb-4">
                <label className="block text-sm font-bold mb-2">PDF Page Number</label>
                <input 
                  type="number" 
                  min="1"
                  className="w-full border p-2 rounded" 
                  value={pdfPageNumber} 
                  onChange={(e) => setPdfPageNumber(e.target.value)} 
                  required 
                />
                <p className="text-xs text-gray-500 mt-1">Which page contains this specific floor plan?</p>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-bold mb-2">Floor Plan PDF</label>
                <input type="file" accept=".pdf" className="w-full border p-2 rounded text-sm" onChange={(e) => setSelectedFile(e.target.files[0])} required />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 rounded border bg-gray-100">Cancel</button>
                <button type="submit" disabled={isUploading} className="px-4 py-2 rounded bg-blue-600 text-white font-bold">
                  {isUploading ? 'Processing...' : 'Upload & Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
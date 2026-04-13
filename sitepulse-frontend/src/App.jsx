import React, { useState } from 'react';
import FloorplanCanvas from './components/FloorplanCanvas';
import { MILESTONES } from './utils/constants';

function App() {
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [showHistoryHover, setShowHistoryHover] = useState(false);
  const [units, setUnits] = useState([]);
  const [activeStatuses, setActiveStatuses] = useState([]);

  const handlePolygonComplete = (draftPoints) => {
    const unitNumber = prompt("Enter Unit/Space Number for this shape:");
    if (unitNumber) {
      const newUnit = {
        id: Math.random().toString(),
        unit_number: unitNumber,
        polygon_coordinates: draftPoints
      };
      setUnits([...units, newUnit]);
      setIsDrawingMode(false);
    }
  };

  const updateStatus = (unitId, milestoneObj) => {
    const newStatus = {
      unit_id: unitId,
      milestone: milestoneObj.name,
      status_color: milestoneObj.color,
      logged_date: new Date().toISOString().split('T')[0]
    };
    const filtered = activeStatuses.filter(s => s.unit_id !== unitId);
    setActiveStatuses([...filtered, newStatus]);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8" style={{fontFamily: 'sans-serif', color: '#333'}}>
      <header className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">SitePulse Visual Tracker</h1>
          <div className="flex gap-4 mt-2">
            <select className="border p-2 rounded bg-white"><option>Orchard Path III</option></select>
            <select className="border p-2 rounded bg-white"><option>Level 3</option></select>
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={() => setShowHistoryHover(!showHistoryHover)} className="px-4 py-2 rounded border bg-white cursor-pointer">
            {showHistoryHover ? 'Hover History: ON' : 'Hover History: OFF'}
          </button>
          <button onClick={() => setIsDrawingMode(!isDrawingMode)} className={`px-4 py-2 rounded font-bold cursor-pointer ${isDrawingMode ? 'bg-red-500 text-white' : 'bg-blue-600 text-white'}`} style={{backgroundColor: isDrawingMode ? '#ef4444' : '#2563eb', color: 'white'}}>
            {isDrawingMode ? 'Cancel Drawing' : '+ Draw Unit'}
          </button>
        </div>
      </header>

      <div style={{display: 'flex', gap: '20px'}}>
        {/* Canvas Area */}
        <div style={{flex: '3'}}>
          <FloorplanCanvas 
            imageUrl="https://via.placeholder.com/1200x800.png?text=Upload+Level+3+Floorplan+Here"
            units={units}
            activeStatuses={activeStatuses}
            isDrawingMode={isDrawingMode}
            onPolygonComplete={handlePolygonComplete}
            showHistoryHover={showHistoryHover}
          />
        </div>

        {/* Superintendent Input Panel */}
        <div style={{flex: '1', backgroundColor: 'white', padding: '16px', borderRadius: '8px', border: '1px solid #ccc', height: '70vh', overflowY: 'auto'}}>
          <h3 className="font-bold text-lg mb-4 border-b pb-2">Update Status</h3>
          
          {units.length === 0 ? (
            <p className="text-gray-500 text-sm">Draw units on the map to start tracking.</p>
          ) : (
            units.map(unit => (
              <div key={unit.id} style={{marginBottom: '16px', padding: '12px', border: '1px solid #e5e7eb', borderRadius: '4px', backgroundColor: '#f9fafb'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '8px'}}>
                  <h4 className="font-bold">Unit {unit.unit_number}</h4>
                  <input type="date" defaultValue={new Date().toISOString().split('T')[0]} style={{fontSize: '12px'}} />
                </div>
                <select 
                  style={{width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc'}}
                  onChange={(e) => {
                    const selected = MILESTONES.find(m => m.name === e.target.value);
                    if (selected) updateStatus(unit.id, selected);
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>Select Phase...</option>
                  {MILESTONES.map(m => (
                    <option key={m.id} value={m.name}>{m.id}. {m.name}</option>
                  ))}
                </select>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
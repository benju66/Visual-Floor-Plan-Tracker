import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { MILESTONES } from '../utils/constants';

export default function FieldStatusTable({ units, activeStatuses, onStatusUpdate }) {
  const [updatingId, setUpdatingId] = useState(null);

  const handleStatusChange = async (unit, milestoneName) => {
    setUpdatingId(unit.id);
    
    // Find the full milestone object to get the color
    const selectedMilestone = MILESTONES.find(m => m.name === milestoneName);
    
    try {
      const { data, error } = await supabase.from('status_logs').insert([{
        unit_id: unit.id,
        milestone: selectedMilestone.name,
        status_color: selectedMilestone.color
        // logged_date and created_at are handled automatically by your Supabase defaults
      }]).select();

      if (error) throw error;

      // Tell App.jsx to refresh the data so the UI updates
      if (data) {
        onStatusUpdate(data[0]);
      }
    } catch (err) {
      alert("Failed to update status: " + err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  if (!units || units.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500 bg-white rounded shadow">
        No units mapped on this level yet. Switch to Map View to draw units.
      </div>
    );
  }

  // Sort units alphabetically/numerically for a predictable list
  const sortedUnits = [...units].sort((a, b) => a.unit_number.localeCompare(b.unit_number));

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-100 border-b border-gray-200">
              <th className="p-4 font-bold text-gray-700 w-1/3">Unit / Area</th>
              <th className="p-4 font-bold text-gray-700 w-2/3">Current Status</th>
            </tr>
          </thead>
          <tbody>
            {sortedUnits.map(unit => {
              // Find the current status for this specific unit
              const currentStatus = activeStatuses.find(s => s.unit_id === unit.id);
              const currentMilestoneName = currentStatus ? currentStatus.milestone : "";

              return (
                <tr key={unit.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="p-4 font-semibold text-gray-800 text-lg">
                    {unit.unit_number}
                  </td>
                  <td className="p-4">
                    <select
                      className="w-full p-3 border border-gray-300 rounded-md bg-white font-medium text-gray-700 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                      value={currentMilestoneName}
                      onChange={(e) => handleStatusChange(unit, e.target.value)}
                      disabled={updatingId === unit.id}
                    >
                      <option value="" disabled>Select Status...</option>
                      {MILESTONES.map(milestone => (
                        <option key={milestone.id} value={milestone.name}>
                          {milestone.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
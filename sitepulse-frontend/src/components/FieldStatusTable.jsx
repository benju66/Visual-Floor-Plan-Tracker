import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { MILESTONES } from '../utils/constants';

export default function FieldStatusTable({ units, activeStatuses, onStatusUpdate }) {
  const [updatingId, setUpdatingId] = useState(null);

  const handleStatusChange = async (unit, milestoneName) => {
    setUpdatingId(unit.id);
    const selectedMilestone = MILESTONES.find(m => m.name === milestoneName);

    try {
      const { data, error } = await supabase.from('status_logs').insert([{
        unit_id: unit.id,
        milestone: selectedMilestone.name,
        status_color: selectedMilestone.color
      }]).select();

      if (error) throw error;
      if (data) onStatusUpdate(data[0]);
    } catch (err) {
      console.error("Failed to update status:", err);
    } finally {
      setUpdatingId(null);
    }
  };

  if (!units || units.length === 0) {
    return (
      <div className="p-8 text-center text-slate-500 bg-white rounded-xl shadow-sm border border-slate-200">
        No units mapped on this level yet. Switch to Admin View to draw units.
      </div>
    );
  }

  const sortedUnits = [...units].sort((a, b) => a.unit_number.localeCompare(b.unit_number));

  return (
    <div className="w-full">
      {/* Mobile View: Cards */}
      <div className="grid grid-cols-1 gap-4 md:hidden">
        {sortedUnits.map(unit => {
          const currentStatus = activeStatuses.find(s => s.unit_id === unit.id);
          return (
            <div key={unit.id} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex flex-col gap-3">
              <div className="text-lg font-bold text-slate-800">Unit: {unit.unit_number}</div>
              <select
                className="w-full p-3 border border-slate-300 rounded-lg bg-slate-50 font-medium text-slate-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all disabled:opacity-50"
                value={currentStatus ? currentStatus.milestone : ""}
                onChange={(e) => handleStatusChange(unit, e.target.value)}
                disabled={updatingId === unit.id}
              >
                <option value="" disabled>Select Status...</option>
                {MILESTONES.map(m => (
                  <option key={m.id} value={m.name}>{m.name}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      {/* Desktop View: Table */}
      <div className="hidden md:block bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="p-4 font-bold text-slate-600 w-1/3">Unit / Area</th>
              <th className="p-4 font-bold text-slate-600 w-2/3">Current Status</th>
            </tr>
          </thead>
          <tbody>
            {sortedUnits.map(unit => {
              const currentStatus = activeStatuses.find(s => s.unit_id === unit.id);
              return (
                <tr key={unit.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="p-4 font-semibold text-slate-800 text-lg">{unit.unit_number}</td>
                  <td className="p-4">
                    <select
                      className="w-full p-3 border border-slate-300 rounded-lg bg-white font-medium text-slate-700 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all disabled:opacity-50"
                      value={currentStatus ? currentStatus.milestone : ""}
                      onChange={(e) => handleStatusChange(unit, e.target.value)}
                      disabled={updatingId === unit.id}
                    >
                      <option value="" disabled>Select Status...</option>
                      {MILESTONES.map(m => (
                        <option key={m.id} value={m.name}>{m.name}</option>
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

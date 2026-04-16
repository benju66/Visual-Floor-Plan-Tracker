import { useState, useEffect } from 'react';
import { supabase } from '@/supabaseClient';

export function useProjectData() {
  const [project, setProject] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [activeSheetId, setActiveSheetId] = useState('');
  const [units, setUnits] = useState([]);
  const [activeStatuses, setActiveStatuses] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [trackingMode, setTrackingMode] = useState('Production');
  const [temporalFilters, setTemporalFilters] = useState(['none', 'planned', 'ongoing', 'completed']);
  const [mapSettings, setMapSettings] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('sitepulse-map-settings');
      if (saved) return JSON.parse(saved);
    }
    return { showHorizontalToolbar: true, pinnedTools: ['undo', 'redo', 'pan', 'draw', 'add_node'] };
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('sitepulse-map-settings', JSON.stringify(mapSettings));
    }
  }, [mapSettings]);

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

      // Fetch Milestones
      let { data: loadedMilestones } = await supabase
        .from('project_milestones')
        .select('*')
        .eq('project_id', projects[0].id)
        .order('id', { ascending: true });

      // CRITICAL SEEDING: If empty, seed from legacy constants AND Inspection defaults
      if (!loadedMilestones || loadedMilestones.length === 0) {
        const defaultMilestones = [
          // Production Track
          { project_id: projects[0].id, name: 'Framing', color: '#f59e0b', track: 'Production' },
          { project_id: projects[0].id, name: 'Drywall', color: '#3b82f6', track: 'Production' },
          { project_id: projects[0].id, name: 'Cabinets', color: '#f97316', track: 'Production' },
          { project_id: projects[0].id, name: 'Paint', color: '#8b5cf6', track: 'Production' },
          // Inspections Track
          { project_id: projects[0].id, name: 'AHJ Rough-in', color: '#eab308', track: 'Inspections' },
          { project_id: projects[0].id, name: 'AHJ Final', color: '#10b981', track: 'Inspections' },
        ];
        
        const { data: seeded } = await supabase.from('project_milestones').insert(defaultMilestones).select();
        loadedMilestones = seeded;
      }
      setMilestones(loadedMilestones || []);
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
            const seen = new Set();
            for (const log of logs) {
              // Find which track this milestone belongs to, default to Production
              const milestoneDef = milestones.find((m) => m.name === log.milestone);
              const track = milestoneDef ? milestoneDef.track : 'Production';
              const key = `${log.unit_id}-${track}`;
              
              if (!seen.has(key)) {
                latestStatuses.push({ ...log, track });
                seen.add(key);
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
  }, [activeSheetId, milestones]);

  return {
    project, setProject,
    sheets, setSheets,
    activeSheetId, setActiveSheetId,
    units, setUnits,
    activeStatuses, setActiveStatuses,
    milestones, setMilestones,
    trackingMode, setTrackingMode,
    temporalFilters, setTemporalFilters,
    mapSettings, setMapSettings
  };
}


### Antigravity Prompt

Please implement Phase 2: Custom Milestones Architecture for the visual tracker. We are deprecating the hardcoded `MILESTONES` in `src/utils/constants.js` in favor of a dynamic, database-driven model tied to the `project_id` and separated by a "Track" (Production vs. Inspections).

Please execute the following steps and use the provided code blocks to ensure safe data seeding and referential integrity.

### Task 1: Database Fetching & Auto-Seeding (`src/app/page.jsx`)

Initialize the state and modify the `loadData` function to fetch from a new `project_milestones` table. If the table is empty for this project, seed it with the legacy constants AND the new inspection defaults so the user never sees a broken/blank UI.

JavaScript

```
  // 1. Add the state near the top of App
  const [milestones, setMilestones] = useState([]);
  const [trackingMode, setTrackingMode] = useState('Production'); // 'Production' or 'Inspections'

  // 2. Update the loadData useEffect
  useEffect(() => {
    async function loadData() {
      let { data: projects } = await supabase.from('projects').select('*');
      if (!projects || projects.length === 0) {
        const { data } = await supabase.from('projects').insert([{ name: 'Orchard Path III' }]).select();
        projects = data;
      }
      setProject(projects[0]);

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
      setMilestones(loadedMilestones);
      
      // ... continue with existing loadData logic for sheets, units, and status_logs
    }
    loadData();
  }, []);
```

### Task 2: Milestone Settings UI & Track Switcher (`src/components/SettingsMenu.jsx`)

Create a "Custom Milestones" settings section that allows the user to add, rename, recolor, and delete milestones. Include a Master Context switch at the top of the menu so the user can toggle between editing the Production list or the Inspections list.

JavaScript

```
  const [activeSettingsTrack, setActiveSettingsTrack] = useState('Production');
  const [newMilestoneName, setNewMilestoneName] = useState('');
  const [newMilestoneColor, setNewMilestoneColor] = useState('#3b82f6');

  // Filter the milestones for the UI list based on the active tab
  const displayedMilestones = milestones.filter(m => m.track === activeSettingsTrack);

  const handleAddMilestone = async () => {
    if (!newMilestoneName) return;
    try {
      const { data, error } = await supabase.from('project_milestones').insert([{
        project_id: project.id, // Ensure you pass the current project_id
        name: newMilestoneName,
        color: newMilestoneColor,
        track: activeSettingsTrack // Assign it to the currently selected tab
      }]).select();
      
      if (error) throw error;
      setMilestones([...milestones, data[0]]);
      setNewMilestoneName('');
    } catch (err) {
      console.error('Failed to add milestone:', err);
    }
  };

  const handleUpdateMilestone = async (id, oldName, newName, newColor) => {
    try {
      // 1. Update the milestone definition
      const { error: updateErr } = await supabase
        .from('project_milestones')
        .update({ name: newName, color: newColor })
        .eq('id', id);
        
      if (updateErr) throw updateErr;

      // 2. THE RIPPLE EFFECT: Update all existing logs tied to this milestone
      if (oldName !== newName || newColor) {
        await supabase
          .from('status_logs')
          .update({ milestone: newName, status_color: newColor })
          .eq('milestone', oldName); 
      }

      setMilestones(milestones.map(m => m.id === id ? { ...m, name: newName, color: newColor } : m));
      // Note: You will also need to trigger a re-fetch or state update of activeStatuses in page.jsx 
      // to immediately reflect the color changes on the canvas.
    } catch (err) {
      console.error('Failed to update milestone:', err);
    }
  };

  const handleDeleteMilestone = async (id) => {
    try {
      const { error } = await supabase.from('project_milestones').delete().eq('id', id);
      if (error) throw error;
      setMilestones(milestones.filter(m => m.id !== id));
      // Existing status_logs remain as legacy data, preventing orphans.
    } catch (err) {
      console.error('Failed to delete milestone:', err);
    }
  };
```

_Build a simple UI list in the "Milestones" tab of the settings menu that utilizes these functions. Ensure there is a toggle switch at the top to flip `activeSettingsTrack` between 'Production' and 'Inspections'. Use standard `<input type="color">` for the color picker alongside a text input for the name._

### Task 3: State Propagation & Main UI Toggle (`src/app/page.jsx`)

1. Pass the dynamic `milestones` state down as a prop to `FieldStatusTable`, `FloorplanCanvas`, `MilestoneCommandMenu`, and `SettingsMenu`.
2. Remove imports of `MILESTONES` from `src/utils/constants.js` in all of these files.
3. **Main UI Toggle:** In the header of `page.jsx` (near the View Mode list/map toggle), add a new toggle switch bound to `trackingMode` allowing the user to switch the main canvas view between 'Production' and 'Inspections'.
4. **Filter the Legend:** Update the "Live legend" mapping in `page.jsx` so it only maps over `milestones.filter(m => m.track === trackingMode)`.
5. Update `FieldStatusTable.jsx` and `MilestoneCommandMenu.jsx` to accept `milestones` and `trackingMode` as props, ensuring the command menu only shows milestones relevant to the currently active track.

### Task 4: The Ripple Effect Safety (`src/components/SettingsMenu.jsx`)
In your `handleUpdateMilestone` function, ensure you pass the `project` object into the component so you can scope the Ripple Effect. 

If a user renames "Framing", we only want to update the `status_logs` for units in the current project. Update the query to look like this:

// 1. Get ALL sheets for the current project
      const { data: projectSheets } = await supabase
        .from('sheets')
        .select('id')
        .eq('project_id', project.id);
        
      const sheetIds = projectSheets ? projectSheets.map(s => s.id) : [];

      if (sheetIds.length > 0) {
        // 2. Get ALL units across ALL of those sheets
        const { data: projectUnits } = await supabase
          .from('units')
          .select('id')
          .in('sheet_id', sheetIds);

        const unitIds = projectUnits ? projectUnits.map(u => u.id) : [];

        // 3. Update the logs scoped strictly to this project's units
        if ((oldName !== newName || newColor) && unitIds.length > 0) {
          await supabase
            .from('status_logs')
            .update({ milestone: newName, status_color: newColor })
            .eq('milestone', oldName)
            .in('unit_id', unitIds);
        }
      }
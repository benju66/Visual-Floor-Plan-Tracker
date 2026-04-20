import React, { useState, useEffect } from 'react';
import { Settings, X, Palette, Monitor, PenTool, Flag, Plus, Trash2, Pencil, GripVertical, Calendar, User, Users, Shield } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useUpdateSheetScopes, useReorderMilestones, useAllProjectUnits, useUpdateUnitFields, useUpdateSheetScale, useProject, useUpdateProject, useUpdateSheetSchedule, useStatuses, useUpdateStatus, useProjectMembers, useCurrentUserRole } from '@/hooks/useProjectQueries';
import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/supabaseClient';

function SortableMilestoneItem({ m, editingMilestoneId, editMilestoneName, setEditMilestoneName, editMilestoneColor, setEditMilestoneColor, setEditingMilestoneId, onUpdateMilestone, onDeleteMilestone }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: m.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  
  return (
    <li ref={setNodeRef} style={style} className="flex items-center justify-between bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-2 pl-2 shadow-sm">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <button {...attributes} {...listeners} type="button" className="p-1 cursor-grab text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
          <GripVertical size={16} />
        </button>
        {editingMilestoneId === m.id ? (
          <div className="flex bg-white dark:bg-black/30 border border-slate-300 dark:border-white/10 rounded-lg p-1 w-full gap-2 items-center flex-1">
             <input type="text" value={editMilestoneName} onChange={(e) => setEditMilestoneName(e.target.value)} autoFocus className="w-full bg-transparent text-sm font-medium outline-none px-2 text-slate-900 dark:text-white" />
             <input type="color" value={editMilestoneColor} onChange={(e) => setEditMilestoneColor(e.target.value)} className="w-7 h-7 border-0 cursor-pointer bg-transparent shrink-0" />
             <button type="button" onClick={() => { onUpdateMilestone?.(m.id, m.name, editMilestoneName, editMilestoneColor); setEditingMilestoneId(null); }} className="px-3 bg-sky-500 hover:bg-sky-600 text-white rounded-md text-sm font-bold h-7 transition-colors">Save</button>
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-1 min-w-0">
             <span className="w-4 h-4 rounded-full shadow-sm shrink-0" style={{ backgroundColor: m.color }} />
             <span className="font-semibold text-sm truncate text-slate-800 dark:text-slate-200">{m.name}</span>
          </div>
        )}
      </div>
      
      {editingMilestoneId !== m.id && (
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <button type="button" onClick={() => { setEditingMilestoneId(m.id); setEditMilestoneName(m.name); setEditMilestoneColor(m.color); }} className="p-1.5 text-slate-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-slate-800 rounded-lg transition-colors" title="Edit">
            <Pencil size={14} />
          </button>
          <button type="button" onClick={() => onDeleteMilestone?.(m.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-slate-800 rounded-lg transition-colors" title="Delete">
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </li>
  );
}

export default function SettingsMenu({
  open,
  onClose,
  settings,
  onUpdateSettings,
  colorMode,
  setColorMode,
  onAttachOriginal,
  milestones = [],
  onAddMilestone,
  onUpdateMilestone,
  onDeleteMilestone,
  mapSettings,
  onUpdateMapSettings,
  sheets = [],
  projectId
}) {
  const { session } = useAuth();
  const { data: currentUserRole } = useCurrentUserRole(projectId);
  const { data: projectMembers = [] } = useProjectMembers(projectId);

  const [activeTab, setActiveTab] = useState('appearance');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('pm');
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  
  // Set initial display name
  useEffect(() => {
    async function loadProfile() {
      if (!session?.user?.id) return;
      const { data } = await supabase.from('profiles').select('display_name').eq('id', session.user.id).single();
      if (data?.display_name) setDisplayNameInput(data.display_name);
    }
    loadProfile();
  }, [session]);

  const uniqueScopes = [...new Set(milestones.map(m => m.track))];
  if (uniqueScopes.length === 0) uniqueScopes.push('Production');
  
  const [activeSettingsTrack, setActiveSettingsTrack] = useState(uniqueScopes[0] || 'Production');
  const [newSettingsTrackInput, setNewSettingsTrackInput] = useState('');
  const [newMilestoneName, setNewMilestoneName] = useState('');
  const [newMilestoneColor, setNewMilestoneColor] = useState('#3b82f6');
  const [editingMilestoneId, setEditingMilestoneId] = useState(null);
  const [editMilestoneName, setEditMilestoneName] = useState('');
  const [editMilestoneColor, setEditMilestoneColor] = useState('');
  const [expandedSchedules, setExpandedSchedules] = useState({});
  const [newUnitTypeAdd, setNewUnitTypeAdd] = useState('');
  
  const [scheduleLevelId, setScheduleLevelId] = useState(sheets?.[0]?.id || '');
  const [scheduleMilestoneId, setScheduleMilestoneId] = useState('');

  useEffect(() => {
    if (!scheduleLevelId && sheets?.length > 0) {
      setScheduleLevelId(sheets[0].id);
    }
  }, [sheets, scheduleLevelId]);

  const reorderMilestonesMutation = useReorderMilestones(projectId);
  const updateSheetScopesMutation = useUpdateSheetScopes(projectId);
  const updateSheetScaleMutation = useUpdateSheetScale(projectId);
  const updateSheetScheduleMutation = useUpdateSheetSchedule(projectId);
  const updateUnitFieldsMutation = useUpdateUnitFields(null);
  const updateStatusMutation = useUpdateStatus(scheduleLevelId);

  const { data: project } = useProject(projectId);
  const updateProjectMutation = useUpdateProject(projectId);
  const { data: allUnits = [] } = useAllProjectUnits(sheets?.map(s => s.id) || []);
  
  const scheduleUnits = allUnits.filter(u => u.sheet_id === scheduleLevelId);
  const { data: scheduleStatuses = [] } = useStatuses(scheduleLevelId, scheduleUnits.map(u => u.id), milestones);
  
  const projectUnitTypes = project?.unit_types || ['Apartment Unit', 'Common Area', 'Back of House', 'Commercial Space', 'Other'];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  if (!open) return null;

  const currentScopeMilestones = milestones.filter(m => m.track === activeSettingsTrack).sort((a,b) => (a.sequence_order || 0) - (b.sequence_order || 0));

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (active.id !== over?.id && over) {
      const oldIndex = currentScopeMilestones.findIndex(m => m.id === active.id);
      const newIndex = currentScopeMilestones.findIndex(m => m.id === over.id);
      
      const newArray = arrayMove(currentScopeMilestones, oldIndex, newIndex);
      const updates = newArray.map((m, index) => ({ id: m.id, sequence_order: index }));
      reorderMilestonesMutation.mutate(updates);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm transition-opacity"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl rounded-2xl border p-6 shadow-2xl glass-panel animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Settings className="w-5 h-5" /> Settings
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-500/20 transition-colors"
          >
            <X className="w-5 h-5 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100" />
          </button>
        </div>

        {/* Tabs navigation */}
        <div className="flex border-b border-slate-200/50 dark:border-white/10 mb-5 pb-0 overflow-x-auto">
          <button
            onClick={() => setActiveTab('appearance')}
            className={`flex items-center gap-2 shrink-0 px-3 py-2 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'appearance'
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Palette size={16} /> Appearance
          </button>
          <button
            onClick={() => setActiveTab('milestones')}
            className={`flex items-center gap-2 shrink-0 px-3 py-2 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'milestones'
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Flag size={16} /> Milestones
          </button>
          <button
            onClick={() => setActiveTab('system')}
            className={`flex items-center gap-2 shrink-0 px-3 py-2 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'system'
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Monitor size={16} /> System
          </button>
          <button
            onClick={() => setActiveTab('drawing')}
            className={`flex items-center gap-2 shrink-0 px-3 py-2 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'drawing'
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <PenTool size={16} /> Drawing
          </button>
          <button
            onClick={() => setActiveTab('data')}
            className={`flex items-center gap-2 shrink-0 px-3 py-2 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'data'
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Settings size={16} /> Data & Units
          </button>
          <button
            onClick={() => setActiveTab('schedule')}
            className={`flex items-center gap-2 shrink-0 px-3 py-2 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'schedule'
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Calendar size={16} /> Schedule
          </button>
          <button
            onClick={() => setActiveTab('profile')}
            className={`flex items-center gap-2 shrink-0 px-3 py-2 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'profile'
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <User size={16} /> Profile
          </button>
          {(currentUserRole === 'admin' || currentUserRole === 'pm') && (
            <button
              onClick={() => setActiveTab('team')}
              className={`flex items-center gap-2 shrink-0 px-3 py-2 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === 'team'
                  ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Users size={16} /> Team
            </button>
          )}
        </div>

        <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1 pb-2 custom-scrollbar">
          {activeTab === 'appearance' && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold block text-sm">Color Theme</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Match system or override</span>
                </div>
                <select
                  value={colorMode}
                  onChange={(e) => setColorMode(e.target.value)}
                  className="bg-white/50 dark:bg-black/20 border border-slate-300/80 dark:border-white/10 rounded-lg p-1.5 text-sm font-medium shadow-sm outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200/50 dark:border-white/10 pt-4">
                <div>
                  <span className="font-semibold block text-sm">Default Main View</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Launch directly into list or map</span>
                </div>
                <select
                  value={settings.defaultViewMode || 'dashboard'}
                  onChange={(e) => onUpdateSettings({ ...settings, defaultViewMode: e.target.value })}
                  className="bg-white/50 dark:bg-black/20 border border-slate-300/80 dark:border-white/10 rounded-lg p-1.5 text-sm font-medium shadow-sm outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="dashboard">Dashboard</option>
                  <option value="list">Field List</option>
                  <option value="map">Interactive Map</option>
                </select>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200/50 dark:border-white/10 pt-4">
                <div>
                  <span className="font-semibold block text-sm">Default Field View</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Set the default layout style for Field list</span>
                </div>
                <select
                  value={settings.defaultFieldView || 'table'}
                  onChange={(e) => onUpdateSettings({ ...settings, defaultFieldView: e.target.value })}
                  className="bg-white/50 dark:bg-black/20 border border-slate-300/80 dark:border-white/10 rounded-lg p-1.5 text-sm font-medium shadow-sm outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="table">Table</option>
                  <option value="card">Cards</option>
                </select>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200/50 dark:border-white/10 pt-4">
                <div>
                  <span className="font-semibold block text-sm">PDF Export Size</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Set default paper size format</span>
                </div>
                <select
                  value={settings.pdfPaperSize || 'tabloid'}
                  onChange={(e) => onUpdateSettings({ ...settings, pdfPaperSize: e.target.value })}
                  className="bg-white/50 dark:bg-black/20 border border-slate-300/80 dark:border-white/10 rounded-lg p-1.5 text-sm font-medium shadow-sm outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="a4">A4</option>
                  <option value="letter">Letter (8.5&quot;x11&quot;)</option>
                  <option value="tabloid">Tabloid (11&quot;x17&quot;)</option>
                </select>
              </div>

              <div className="pt-6 mt-4 border-t border-slate-200 dark:border-white/10">
                <h3 className="font-bold text-sm mb-4">Map Interface Settings</h3>
                
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <span className="font-semibold block text-sm">Horizontal Toolbar</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">Show floating top toolbar</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={mapSettings?.showHorizontalToolbar || false}
                      onChange={(e) => onUpdateMapSettings({ ...mapSettings, showHorizontalToolbar: e.target.checked })}
                    />
                    <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
                  </label>
                </div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <span className="font-semibold block text-sm">Canvas Crosshair</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">Display alignment overlay on index</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={mapSettings?.showCrosshair || false}
                      onChange={(e) => onUpdateMapSettings({ ...mapSettings, showCrosshair: e.target.checked })}
                    />
                    <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
                  </label>
                </div>
                <div>
                  <span className="font-semibold block text-sm mb-2">Pinned Toolbar Actions</span>
                  <div className="flex flex-wrap gap-2">
                    {['undo', 'redo', 'pan', 'draw', 'add_node', 'delete_node', 'stamp', 'select', 'multi_select', 'crosshair'].map((tool) => {
                      const isPinned = mapSettings?.pinnedTools?.includes(tool);
                      return (
                        <button
                          key={tool}
                          onClick={() => {
                            const current = mapSettings?.pinnedTools || [];
                            const newPinned = isPinned
                              ? current.filter(t => t !== tool)
                              : [...current, tool];
                            onUpdateMapSettings({ ...mapSettings, pinnedTools: newPinned });
                          }}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                            isPinned
                              ? 'bg-sky-500 text-white shadow-sm'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/20'
                          }`}
                        >
                          {tool.charAt(0).toUpperCase() + tool.slice(1).replace('_', ' ')}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'milestones' && (
            <div className="flex flex-col h-full space-y-4">
              <div className="flex flex-col mb-2">
                <span className="text-sm font-bold mb-2">Scopes of Work</span>
                <div className="flex flex-wrap gap-2">
                  {uniqueScopes.map(scope => (
                     <button
                       key={scope}
                       onClick={() => setActiveSettingsTrack(scope)}
                       className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors border ${activeSettingsTrack === scope ? 'bg-sky-500 text-white border-sky-600 shadow-sm' : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                     >
                        {scope}
                     </button>
                  ))}
                  <div className="flex items-center gap-1 border border-slate-200 dark:border-slate-700 rounded-lg p-1">
                     <input
                       type="text"
                       placeholder="New Scope"
                       value={newSettingsTrackInput}
                       onChange={e => setNewSettingsTrackInput(e.target.value)}
                       className="w-24 px-2 py-0.5 text-xs bg-transparent outline-none"
                     />
                     <button
                       type="button"
                       onClick={() => {
                          const val = newSettingsTrackInput.trim();
                          if (val && !uniqueScopes.includes(val)) {
                            setActiveSettingsTrack(val);
                            setNewSettingsTrackInput('');
                          }
                       }}
                       className="p-1 rounded-md bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600"
                     >
                       <Plus size={14} />
                     </button>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={`Add to ${activeSettingsTrack}...`}
                  value={newMilestoneName}
                  onChange={e => setNewMilestoneName(e.target.value)}
                  className="flex-1 bg-white dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500"
                />
                <input
                  type="color"
                  value={newMilestoneColor}
                  onChange={e => setNewMilestoneColor(e.target.value)}
                  className="w-10 h-10 border-0 rounded-lg cursor-pointer bg-white dark:bg-black/20 p-1"
                />
                <button
                  type="button"
                  onClick={() => {
                    onAddMilestone?.(newMilestoneName, newMilestoneColor, activeSettingsTrack);
                    setNewMilestoneName('');
                  }}
                  className="h-10 px-3 bg-sky-500 hover:bg-sky-600 text-white rounded-lg flex items-center justify-center transition-colors shadow-sm"
                >
                  <Plus size={18} />
                </button>
              </div>

              <div className="mt-2 flex-col flex space-y-1">
                <div className="text-xs text-slate-500 italic mb-2">Drag to reorder sequence within scope.</div>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={currentScopeMilestones.map(m => m.id)} strategy={verticalListSortingStrategy}>
                    <ul className="space-y-2">
                      {currentScopeMilestones.map(m => (
                        <SortableMilestoneItem
                          key={m.id}
                          m={m}
                          editingMilestoneId={editingMilestoneId}
                          editMilestoneName={editMilestoneName}
                          setEditMilestoneName={setEditMilestoneName}
                          editMilestoneColor={editMilestoneColor}
                          setEditMilestoneColor={setEditMilestoneColor}
                          setEditingMilestoneId={setEditingMilestoneId}
                          onUpdateMilestone={onUpdateMilestone}
                          onDeleteMilestone={onDeleteMilestone}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
                {currentScopeMilestones.length === 0 && (
                  <div className="text-center py-6 text-slate-500 text-sm bg-slate-50 dark:bg-slate-900/50 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl">
                    No milestones in {activeSettingsTrack}.
                  </div>
                )}
              </div>

              <div className="border-t border-slate-200 dark:border-white/10 pt-4 mt-6">
                 <h3 className="font-bold text-sm mb-3">Sheet Scope Assignments</h3>
                 <p className="text-xs text-slate-500 mb-3 text-balance">Assign which Scopes of Work apply to each floor plan level. Unassigned scopes will be hidden from the map for that level.</p>
                 <div className="space-y-3">
                   {sheets.map(sheet => {
                     const activeScopes = Array.isArray(sheet.active_scopes) ? sheet.active_scopes : [];
                     const handlePresetChange = (e) => {
                        const preset = e.target.value;
                        let ratio = sheet.scale_ratio || 1;
                        if (preset === '1/8" = 1\'') ratio = 96;
                        else if (preset === '1/4" = 1\'') ratio = 48;
                        else if (preset === '3/8" = 1\'') ratio = 32;
                        else if (preset === '1/2" = 1\'') ratio = 24;
                        else if (preset === '1" = 10\'') ratio = 120;
                        else if (preset === '1" = 20\'') ratio = 240;
                        updateSheetScaleMutation.mutate({ sheetId: sheet.id, scale_preset: preset, scale_ratio: ratio });
                     };
                     
                     return (
                       <div key={sheet.id} className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-3">
                         <div className="font-bold text-sm mb-2 text-slate-800 dark:text-slate-100 flex justify-between items-center">
                           <span>{sheet.sheet_name}</span>
                           <div className="flex gap-2 items-center">
                             <select 
                               value={sheet.scale_preset || 'custom'} 
                               onChange={handlePresetChange}
                               className="text-xs border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 rounded px-1.5 py-0.5"
                             >
                               <option value="custom">Custom Scale</option>
                               <option value="1/8&quot; = 1'">1/8&quot; = 1'</option>
                               <option value="1/4&quot; = 1'">1/4&quot; = 1'</option>
                               <option value="3/8&quot; = 1'">3/8&quot; = 1'</option>
                               <option value="1/2&quot; = 1'">1/2&quot; = 1'</option>
                               <option value="1&quot; = 10'">1&quot; = 10'</option>
                               <option value="1&quot; = 20'">1&quot; = 20'</option>
                             </select>
                             {(!sheet.scale_preset || sheet.scale_preset === 'custom') && (
                               <input 
                                 type="number" 
                                 step="0.01"
                                 value={sheet.scale_ratio || 1}
                                 onChange={(e) => updateSheetScaleMutation.mutate({ sheetId: sheet.id, scale_preset: 'custom', scale_ratio: parseFloat(e.target.value) || 1 })}
                                 className="text-xs border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 rounded px-1.5 py-0.5 w-16"
                               />
                             )}
                           </div>
                         </div>
                         <div className="flex flex-wrap gap-2">
                           {uniqueScopes.map(scope => {
                             const isActive = activeScopes.includes(scope);
                             return (
                               <button
                                 key={scope}
                                 type="button"
                                 onClick={() => {
                                    const newScopes = isActive ? activeScopes.filter(s => s !== scope) : [...activeScopes, scope];
                                    updateSheetScopesMutation.mutate({ sheetId: sheet.id, active_scopes: newScopes });
                                 }}
                                 className={`px-3 py-1 text-xs font-bold rounded-lg border transition-colors ${isActive ? 'bg-sky-500 text-white border-sky-600 shadow-sm' : 'bg-white dark:bg-black/20 text-slate-500 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-white/10'}`}
                               >
                                 {scope}
                               </button>
                             );
                           })}
                         </div>
                         
                         {/* Level Schedulues Expansion */}
                         <div className="mt-3 border-t border-slate-200 dark:border-slate-700/50 pt-2">
                           <button 
                             type="button"
                             onClick={() => setExpandedSchedules(prev => ({ ...prev, [sheet.id]: !prev[sheet.id] }))}
                             className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:text-sky-700 flex items-center"
                           >
                             {expandedSchedules[sheet.id] ? 'Hide Level Schedule' : 'Set Level Schedule'}
                           </button>
                           {expandedSchedules[sheet.id] && (
                             <div className="mt-2 space-y-2">
                               {milestones.filter(m => activeScopes.includes(m.track)).map(m => {
                                 const schedule = sheet.milestone_schedules?.[m.name] || { start_date: '', end_date: '' };
                                 return (
                                   <div key={m.id} className="flex flex-col sm:flex-row sm:items-center justify-between bg-white dark:bg-black/20 p-2 rounded border border-slate-200 dark:border-white/10 text-xs">
                                      <div className="font-medium flex items-center gap-2 mb-1 sm:mb-0 w-1/3">
                                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: m.color }} />
                                        <span className="truncate" title={m.name}>{m.name}</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <div className="flex flex-col">
                                          <span className="text-[10px] text-slate-500 mb-0.5">Start</span>
                                          <input 
                                            type="date"
                                            value={schedule.start_date || ''}
                                            onChange={(e) => {
                                              const newSchedules = { ...sheet.milestone_schedules, [m.name]: { ...schedule, start_date: e.target.value } };
                                              updateSheetScheduleMutation.mutate({ sheetId: sheet.id, milestone_schedules: newSchedules });
                                            }}
                                            className="px-1.5 py-0.5 border rounded dark:bg-slate-800 dark:border-slate-600 outline-none"
                                          />
                                        </div>
                                        <div className="flex flex-col">
                                          <span className="text-[10px] text-slate-500 mb-0.5">End</span>
                                          <input 
                                            type="date"
                                            value={schedule.end_date || ''}
                                            onChange={(e) => {
                                              const newSchedules = { ...sheet.milestone_schedules, [m.name]: { ...schedule, end_date: e.target.value } };
                                              updateSheetScheduleMutation.mutate({ sheetId: sheet.id, milestone_schedules: newSchedules });
                                            }}
                                            className="px-1.5 py-0.5 border rounded dark:bg-slate-800 dark:border-slate-600 outline-none"
                                          />
                                        </div>
                                      </div>
                                   </div>
                                 );
                               })}
                               {milestones.filter(m => activeScopes.includes(m.track)).length === 0 && (
                                  <div className="text-[11px] text-slate-500 italic">No milestones available. Assign scopes first.</div>
                               )}
                             </div>
                           )}
                         </div>
                       </div>
                     );
                   })}
                   {sheets.length === 0 && <p className="text-xs text-slate-500">No levels added yet.</p>}
                 </div>
              </div>
            </div>
          )}

          {activeTab === 'system' && (
            <>
              <div className="flex items-center justify-between border-b border-slate-200/50 dark:border-white/10 pb-4">
                <div>
                  <span className="font-semibold block text-sm">Auto-Advance Locations</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Chain reaction to next trade when completed</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={settings.auto_advance_enabled !== false}
                    onChange={(e) => onUpdateSettings({ ...settings, auto_advance_enabled: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
                </label>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200/50 dark:border-white/10 pt-4">
                <div>
                  <span className="font-semibold block text-sm">Visual Delay Warning</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Show pulsing red icon on delayed locations</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={settings.show_delay_indicators !== false}
                    onChange={(e) => onUpdateSettings({ ...settings, show_delay_indicators: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-500"></div>
                </label>
              </div>

              <div className="flex items-center justify-between pt-4">
                <div>
                  <span className="font-semibold block text-sm">Hover History</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Show a timeline of status updates</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={settings.showHistoryHover}
                    onChange={(e) => onUpdateSettings({ ...settings, showHistoryHover: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
                </label>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200/50 dark:border-white/10 pt-4">
                <div>
                  <span className="font-semibold block text-sm">Include Export Data</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Add titles and unit statuses to PDF</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={settings.includeExportData !== false}
                    onChange={(e) => onUpdateSettings({ ...settings, includeExportData: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
                </label>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200/50 dark:border-white/10 pt-4">
                <div>
                  <span className="font-semibold block text-sm">Notifications / Toasts</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Enable success/error popups</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={settings.enableToasts}
                    onChange={(e) => onUpdateSettings({ ...settings, enableToasts: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200/50 dark:border-white/10 pt-4">
                <div>
                  <span className="font-semibold block text-sm text-red-600 dark:text-red-400">Rescue Original Document</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 max-w-[200px] block">Upload the source PDF directly to enable Vector Export.</span>
                </div>
                <label className="cursor-pointer px-3 py-1.5 text-xs font-bold text-white bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 rounded-lg shadow-sm transition-colors">
                  Attach PDF
                  <input
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.[0]) onAttachOriginal(e.target.files[0]);
                    }}
                  />
                </label>
              </div>
            </>
          )}

          {activeTab === 'drawing' && (
            <>
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="font-semibold block text-sm">Markup Border Thickness</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">Adjust the line thickness of map polygons</span>
                  </div>
                  <span className="text-sm font-bold bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md">
                    {settings.markupThickness || 1}x
                  </span>
                </div>
                <input
                  type="range"
                  min="0.25"
                  max="4"
                  step="0.25"
                  value={settings.markupThickness || 1}
                  onChange={(e) => onUpdateSettings({ ...settings, markupThickness: parseFloat(e.target.value) })}
                  className="w-full accent-sky-500 mt-2"
                />
              </div>
            </>
          )}

          {activeTab === 'data' && (
            <div className="flex flex-col h-[50vh]">
              <div className="shrink-0 mb-6 border border-slate-200 dark:border-white/10 rounded-xl bg-slate-50 dark:bg-white/5 p-4">
                <h3 className="font-bold text-sm mb-3">Project Unit Types</h3>
                <div className="flex flex-wrap gap-2 mb-3">
                  {projectUnitTypes.map((type) => (
                    <div key={type} className="flex items-center gap-1 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 px-2 py-1 rounded text-xs font-medium">
                      {type}
                      <button 
                        onClick={() => {
                          const newTypes = projectUnitTypes.filter(t => t !== type);
                          updateProjectMutation.mutate({ unit_types: newTypes });
                        }}
                        className="text-slate-400 hover:text-red-500 ml-1"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  {projectUnitTypes.length === 0 && <span className="text-xs text-slate-500">No unit types defined.</span>}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newUnitTypeAdd}
                    onChange={e => setNewUnitTypeAdd(e.target.value)}
                    placeholder="New unit type..."
                    className="flex-1 max-w-[200px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 rounded px-2 py-1 text-xs outline-none"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newUnitTypeAdd.trim()) {
                         updateProjectMutation.mutate({ unit_types: [...newUnitTypeAdd.trim()] });
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      if (newUnitTypeAdd.trim() && !projectUnitTypes.includes(newUnitTypeAdd.trim())) {
                        updateProjectMutation.mutate({ unit_types: [...projectUnitTypes, newUnitTypeAdd.trim()] });
                        setNewUnitTypeAdd('');
                      }
                    }}
                    className="bg-slate-800 text-white dark:bg-slate-200 dark:text-black px-3 py-1 rounded text-xs font-medium hover:opacity-90"
                  >
                    Add
                  </button>
                </div>
              </div>

              <h3 className="font-bold text-sm mb-3 shrink-0">Unit Data Management</h3>
              <div className="overflow-y-auto flex-1 rounded-xl border border-slate-200 dark:border-white/10">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0 z-10 shadow-sm border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="px-4 py-2 font-semibold">Location</th>
                      <th className="px-4 py-2 font-semibold">Level</th>
                      <th className="px-4 py-2 font-semibold">Unit Type</th>
                      <th className="px-4 py-2 font-semibold text-right">Computed Area</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900/50">
                    {allUnits.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-slate-500">No project data available.</td>
                      </tr>
                    )}
                    {allUnits.map(unit => {
                      const sheet = sheets.find(s => s.id === unit.sheet_id);
                      return (
                        <tr key={unit.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                          <td className="px-4 py-2 font-medium">{unit.unit_number}</td>
                          <td className="px-4 py-2 text-slate-600 dark:text-slate-400 text-xs">{sheet?.sheet_name || 'Unknown'}</td>
                          <td className="px-4 py-2 text-slate-800 dark:text-slate-200">
                            <select 
                              className="bg-transparent border border-slate-200 dark:border-slate-700 rounded px-2 py-0.5 outline-none hover:bg-slate-100 dark:hover:bg-slate-800 text-xs w-full max-w-[160px]"
                              value={unit.unit_type || 'Unknown'}
                              onChange={(e) => updateUnitFieldsMutation.mutate({ unitId: unit.id, updates: { unit_type: e.target.value }})}
                            >
                              <option value="Unknown" disabled>Select Type...</option>
                              {projectUnitTypes.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-600 dark:text-slate-400">
                            {unit.computed_area ? unit.computed_area.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' sq units' : '--'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'schedule' && (
            <div className="flex flex-col h-[65vh]">
              <div className="shrink-0 mb-4 border border-slate-200 dark:border-white/10 rounded-xl bg-slate-50 dark:bg-white/5 p-4 flex flex-wrap gap-4 items-end">
                <div className="flex-1 min-w-[200px]">
                  <span className="block text-xs font-semibold text-slate-500 mb-1">Filter by Level</span>
                  <select 
                    value={scheduleLevelId}
                    onChange={e => setScheduleLevelId(e.target.value)}
                    className="w-full bg-white dark:bg-black/20 border border-slate-300 dark:border-slate-600 rounded px-2 py-1.5 text-sm outline-none"
                  >
                    {sheets.map(s => <option key={s.id} value={s.id}>{s.sheet_name}</option>)}
                    {sheets.length === 0 && <option value="">No levels exist</option>}
                  </select>
                </div>
                <div className="flex-1 min-w-[200px]">
                  <span className="block text-xs font-semibold text-slate-500 mb-1">Filter by Milestone</span>
                  <select 
                    value={scheduleMilestoneId}
                    onChange={e => setScheduleMilestoneId(e.target.value)}
                    className="w-full bg-white dark:bg-black/20 border border-slate-300 dark:border-slate-600 rounded px-2 py-1.5 text-sm outline-none"
                  >
                    <option value="" disabled>Select Milestone...</option>
                    {milestones.filter(m => {
                      const activeSheet = sheets.find(s => s.id === scheduleLevelId);
                      return activeSheet?.active_scopes?.includes(m.track);
                    }).map(m => (
                      <option key={m.id} value={m.name}>{m.name} ({m.track})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="overflow-y-auto flex-1 rounded-xl border border-slate-200 dark:border-white/10">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0 z-10 shadow-sm border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="px-4 py-2 font-semibold w-1/4">Location</th>
                      <th className="px-4 py-2 font-semibold w-1/4">Temporal Status</th>
                      <th className="px-4 py-2 font-semibold w-1/4">Planned Start</th>
                      <th className="px-4 py-2 font-semibold w-1/4">Planned Finish</th>
                      <th className="px-4 py-2 font-semibold text-slate-500 text-xs text-right">
                        <div className="flex flex-col items-end gap-1">
                          <span>Actual Completed</span>
                          <input
                            type="date"
                            title="Apply actual completed date to all currently displayed units"
                            onChange={(e) => {
                              const val = e.target.value;
                              const targetMilestone = milestones.find(m => m.name === scheduleMilestoneId);
                              if (!targetMilestone) return;
                              
                              scheduleUnits.forEach(unit => {
                                const log = scheduleStatuses.find(s => s.unit_id === unit.id && s.milestone === scheduleMilestoneId && s.track === targetMilestone?.track);
                                if (log?.temporal_state === 'completed') {
                                   updateStatusMutation.mutate({
                                     unit_id: unit.id,
                                     milestone: targetMilestone.name,
                                     status_color: targetMilestone.color,
                                     temporal_state: 'completed',
                                     track: targetMilestone.track,
                                     planned_start_date: log.planned_start_date || null,
                                     planned_end_date: log.planned_end_date || null,
                                     logged_date: val || null
                                   });
                                }
                              });
                            }}
                            className="bg-transparent border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5 outline-none hover:bg-slate-100 dark:hover:bg-slate-800 text-[10px] w-[110px] font-medium"
                          />
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900/50">
                    {scheduleUnits.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500 font-medium">No locations exist on this level.</td>
                      </tr>
                    ) : (
                      scheduleUnits.map(unit => {
                        const targetMilestone = milestones.find(m => m.name === scheduleMilestoneId);
                        const log = scheduleStatuses.find(s => s.unit_id === unit.id && s.milestone === scheduleMilestoneId && s.track === targetMilestone?.track);
                        
                        const isAssigned = !!targetMilestone;
                        const isCompleted = log?.temporal_state === 'completed';
                      
                       const handleDateUpdate = (type, val) => {
                         if (!targetMilestone) return;
                         updateStatusMutation.mutate({
                           unit_id: unit.id,
                           milestone: targetMilestone.name,
                           status_color: targetMilestone.color,
                           temporal_state: log?.temporal_state || 'none',
                           track: targetMilestone.track,
                           planned_start_date: type === 'start' ? (val || null) : (log?.planned_start_date || null),
                           planned_end_date: type === 'end' ? (val || null) : (log?.planned_end_date || null),
                           logged_date: type === 'actual' ? (val || null) : (log?.logged_date || null)
                         });
                      };
                      
                      return (
                        <tr key={unit.id} className={`transition-colors ${isAssigned ? 'hover:bg-slate-50 dark:hover:bg-slate-800/50' : 'opacity-40 hover:opacity-100 bg-slate-50/50 dark:bg-slate-900'}`}>
                          <td className="px-4 py-2 font-bold">{unit.unit_number}</td>
                          <td className="px-4 py-2">
                            {isAssigned ? (
                              <select
                                value={log?.temporal_state || 'none'}
                                onChange={(e) => {
                                  if (!targetMilestone) return;
                                  updateStatusMutation.mutate({
                                     unit_id: unit.id,
                                     milestone: targetMilestone.name,
                                     status_color: targetMilestone.color,
                                     temporal_state: e.target.value,
                                     track: targetMilestone.track,
                                     planned_start_date: log?.planned_start_date || null,
                                     planned_end_date: log?.planned_end_date || null
                                  });
                                }}
                                className={`bg-transparent border border-slate-200 dark:border-slate-700 rounded px-2 py-0.5 outline-none hover:bg-slate-100 dark:hover:bg-slate-800 text-xs w-full max-w-[140px] font-semibold ${isCompleted ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-200'}`}
                              >
                                 <option value="none">Not Started</option>
                                 <option value="planned">Planned</option>
                                 <option value="ongoing">Ongoing</option>
                                 <option value="completed">Completed</option>
                              </select>
                            ) : (
                               <span className="text-slate-400 italic text-[10px] pl-1">Unassigned</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <input 
                              type="date"
                              disabled={!isAssigned}
                              value={log?.planned_start_date || ''}
                              onChange={(e) => handleDateUpdate('start', e.target.value)}
                              className="bg-transparent border border-slate-200 dark:border-slate-700 rounded px-2 py-0.5 outline-none hover:bg-slate-100 dark:hover:bg-slate-800 text-xs w-[130px] font-medium disabled:opacity-50"
                            />
                          </td>
                          <td className="px-4 py-2">
                             <input 
                              type="date"
                              disabled={!isAssigned}
                              value={log?.planned_end_date || ''}
                              onChange={(e) => handleDateUpdate('end', e.target.value)}
                              className="bg-transparent border border-slate-200 dark:border-slate-700 rounded px-2 py-0.5 outline-none hover:bg-slate-100 dark:hover:bg-slate-800 text-xs w-[130px] font-medium disabled:opacity-50"
                            />
                          </td>
                          <td className="px-4 py-2 text-right text-xs text-slate-500 font-medium">
                            {isCompleted ? (
                              <input 
                                type="date"
                                value={log?.logged_date || ''}
                                onChange={(e) => handleDateUpdate('actual', e.target.value)}
                                className="bg-transparent border border-slate-200 dark:border-slate-700 rounded px-2 py-0.5 outline-none hover:bg-slate-100 dark:hover:bg-slate-800 text-xs w-[130px] font-medium"
                              />
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {activeTab === 'profile' && (
            <div className="space-y-4">
              <h3 className="font-bold text-sm mb-2">User Profile</h3>
              <div className="flex items-center justify-between border-b border-slate-200/50 dark:border-white/10 pb-4">
                <div>
                  <span className="font-semibold block text-sm">Email Address</span>
                  <span className="text-xs text-slate-500">{session?.user?.email}</span>
                </div>
              </div>
              <div className="pt-2">
                <label className="font-semibold block text-sm mb-2">Display Name</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={displayNameInput}
                    onChange={e => setDisplayNameInput(e.target.value)}
                    placeholder="Enter full name"
                    className="flex-1 max-w-[300px] bg-white dark:bg-black/20 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <button
                    onClick={async () => {
                      if (!session?.user?.id) return;
                      setIsSavingProfile(true);
                      await supabase.from('profiles').update({ display_name: displayNameInput }).eq('id', session.user.id);
                      setIsSavingProfile(false);
                    }}
                    disabled={isSavingProfile}
                    className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-sm font-bold shadow-sm transition-colors disabled:opacity-50"
                  >
                    {isSavingProfile ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'team' && (currentUserRole === 'admin' || currentUserRole === 'pm') && (
            <div className="space-y-4 min-h-[40vh]">
              <h3 className="font-bold text-sm mb-4">Project Team</h3>
              
              {/* Add member form */}
              <div className="mb-6 p-4 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl">
                 <h4 className="font-semibold text-xs text-slate-500 uppercase tracking-wider mb-3">Add Member</h4>
                 <div className="flex flex-wrap sm:flex-nowrap gap-2">
                    <input
                      type="email"
                      value={newMemberEmail}
                      onChange={e => setNewMemberEmail(e.target.value)}
                      placeholder="User email address"
                      className="flex-1 min-w-[200px] bg-white dark:bg-black/20 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500"
                    />
                    <select
                      value={newMemberRole}
                      onChange={e => setNewMemberRole(e.target.value)}
                      className="bg-white dark:bg-black/20 border border-slate-300 dark:border-slate-700 rounded-lg px-2 text-sm outline-none focus:ring-2 focus:ring-sky-500"
                    >
                      <option value="pm">Project Manager</option>
                      <option value="superintendent">Superintendent</option>
                      {currentUserRole === 'admin' && <option value="admin">Admin</option>}
                    </select>
                    <button
                      disabled={isAddingMember || !newMemberEmail.trim()}
                      onClick={async () => {
                        setIsAddingMember(true);
                        try {
                           const { data: profile, error: profileErr } = await supabase.from('profiles').select('id').eq('email', newMemberEmail.trim().toLowerCase()).single();
                           if (profileErr || !profile) {
                              alert("User not found. They must sign up first.");
                           } else {
                              const { error: insertErr } = await supabase.from('project_members').insert([{ project_id: projectId, user_id: profile.id, role: newMemberRole }]);
                              if (insertErr) {
                                alert("Failed to add member.");
                              } else {
                                setNewMemberEmail('');
                              }
                           }
                        } catch (err) {
                           console.error(err);
                           alert("Error adding member. They might already be on the project.");
                        } finally {
                           setIsAddingMember(false);
                        }
                      }}
                      className="bg-sky-500 hover:bg-sky-600 text-white rounded-lg px-4 py-1.5 text-sm font-bold transition-colors disabled:opacity-50"
                    >
                      {isAddingMember ? '...' : 'Add'}
                    </button>
                 </div>
              </div>

              {/* Members list */}
              <div className="overflow-y-auto max-h-[300px] border border-slate-200 dark:border-slate-700 rounded-xl">
                 <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0 z-10 border-b border-slate-200 dark:border-slate-700">
                      <tr>
                        <th className="px-4 py-2 font-semibold">User</th>
                        <th className="px-4 py-2 font-semibold">Role</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900/50">
                       {projectMembers.map(member => (
                          <tr key={member.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                            <td className="px-4 py-2">
                               <div className="font-medium text-slate-800 dark:text-slate-200">{member.profiles?.display_name || 'Unknown User'}</div>
                               <div className="text-xs text-slate-500">{member.profiles?.email}</div>
                            </td>
                            <td className="px-4 py-2">
                               <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${member.role === 'admin' ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30' : member.role === 'pm' ? 'bg-sky-100 text-sky-600 dark:bg-sky-900/30' : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30'}`}>
                                 {member.role}
                               </span>
                            </td>
                          </tr>
                       ))}
                       {projectMembers.length === 0 && (
                          <tr><td colSpan="2" className="px-4 py-6 text-center text-slate-500 text-sm">No members found.</td></tr>
                       )}
                    </tbody>
                 </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

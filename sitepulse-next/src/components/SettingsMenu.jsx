import React, { useState } from 'react';
import { Settings, X, Palette, Monitor, PenTool, Flag, Plus, Trash2, Pencil } from 'lucide-react';

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
}) {
  const [activeTab, setActiveTab] = useState('appearance');
  const [activeSettingsTrack, setActiveSettingsTrack] = useState('Production');
  const [newMilestoneName, setNewMilestoneName] = useState('');
  const [newMilestoneColor, setNewMilestoneColor] = useState('#3b82f6');
  const [editingMilestoneId, setEditingMilestoneId] = useState(null);
  const [editMilestoneName, setEditMilestoneName] = useState('');
  const [editMilestoneColor, setEditMilestoneColor] = useState('');

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm transition-opacity"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border p-6 shadow-2xl glass-panel animate-in fade-in zoom-in-95 duration-200"
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
        </div>

        <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1 pb-2">
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
                  className="bg-white/50 dark:bg-black/20 border border-slate-300/80 dark:border-white/10 rounded-lg p-1.5 text-sm font-medium shadow-sm"
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
                  value={settings.defaultViewMode || 'list'}
                  onChange={(e) => onUpdateSettings({ ...settings, defaultViewMode: e.target.value })}
                  className="bg-white/50 dark:bg-black/20 border border-slate-300/80 dark:border-white/10 rounded-lg p-1.5 text-sm font-medium shadow-sm"
                >
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
                  className="bg-white/50 dark:bg-black/20 border border-slate-300/80 dark:border-white/10 rounded-lg p-1.5 text-sm font-medium shadow-sm"
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
                  className="bg-white/50 dark:bg-black/20 border border-slate-300/80 dark:border-white/10 rounded-lg p-1.5 text-sm font-medium shadow-sm"
                >
                  <option value="a4">A4</option>
                  <option value="letter">Letter (8.5"x11")</option>
                  <option value="tabloid">Tabloid (11"x17")</option>
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

                <div>
                  <span className="font-semibold block text-sm mb-2">Pinned Toolbar Actions</span>
                  <div className="flex flex-wrap gap-2">
                    {['undo', 'redo', 'pan', 'draw', 'add_node', 'delete_node', 'stamp', 'select'].map((tool) => {
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
              <div className="flex justify-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setActiveSettingsTrack('Production')}
                  className={`flex-1 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                    activeSettingsTrack === 'Production'
                      ? 'bg-white dark:bg-slate-600 shadow-sm text-sky-600 dark:text-sky-400'
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                  }`}
                >
                  Production
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSettingsTrack('Inspections')}
                  className={`flex-1 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                    activeSettingsTrack === 'Inspections'
                      ? 'bg-white dark:bg-slate-600 shadow-sm text-sky-600 dark:text-sky-400'
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                  }`}
                >
                  Inspections
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="New Milestone"
                  value={newMilestoneName}
                  onChange={e => setNewMilestoneName(e.target.value)}
                  className="flex-1 bg-white dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-sky-500"
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
                  className="h-10 px-3 bg-sky-500 hover:bg-sky-600 text-white rounded-lg flex items-center justify-center transition-colors"
                >
                  <Plus size={18} />
                </button>
              </div>

              <ul className="space-y-2 mt-2">
                {milestones.filter(m => m.track === activeSettingsTrack).map(m => (
                  <li key={m.id} className="flex items-center justify-between bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-2 pl-3">
                    {editingMilestoneId === m.id ? (
                      <div className="flex bg-white dark:bg-black/30 border border-slate-300 dark:border-white/10 rounded-lg p-1 w-full gap-2 items-center">
                        <input
                          type="text"
                          value={editMilestoneName}
                          onChange={(e) => setEditMilestoneName(e.target.value)}
                          className="w-full bg-transparent text-sm font-medium outline-none px-2"
                        />
                        <input
                          type="color"
                          value={editMilestoneColor}
                          onChange={(e) => setEditMilestoneColor(e.target.value)}
                          className="w-7 h-7 border-0 cursor-pointer bg-transparent shrink-0"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            onUpdateMilestone?.(m.id, m.name, editMilestoneName, editMilestoneColor);
                            setEditingMilestoneId(null);
                          }}
                          className="px-3 bg-sky-500 hover:bg-sky-600 text-white rounded-md text-sm font-bold h-7"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-3">
                          <span className="w-4 h-4 rounded-full shadow-sm" style={{ backgroundColor: m.color }} />
                          <span className="font-semibold text-sm">{m.name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMilestoneId(m.id);
                              setEditMilestoneName(m.name);
                              setEditMilestoneColor(m.color);
                            }}
                            className="p-1.5 text-slate-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-slate-800 rounded-lg transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteMilestone?.(m.id)}
                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-slate-800 rounded-lg transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
                {milestones.filter(m => m.track === activeSettingsTrack).length === 0 && (
                  <div className="text-center py-6 text-slate-500 text-sm">
                    No milestones found in this track.
                  </div>
                )}
              </ul>
            </div>
          )}

          {activeTab === 'system' && (
            <>
              <div className="flex items-center justify-between">
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
        </div>
      </div>
    </div>
  );
}

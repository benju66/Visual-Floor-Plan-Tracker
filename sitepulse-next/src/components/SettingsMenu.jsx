import React from 'react';
import { Settings, X } from 'lucide-react';

export default function SettingsMenu({
  open,
  onClose,
  settings,
  onUpdateSettings,
  colorMode,
  setColorMode,
  onAttachOriginal,
}) {
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

        <div className="space-y-5">
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
              <span className="font-semibold block text-sm">Hover History</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">Show a timeline of status updates on hover</span>
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
              <span className="text-xs text-slate-500 dark:text-slate-400 max-w-[200px] block">Upload the source PDF directly to enable Vector Export for older floorplans without losing data.</span>
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
        </div>
      </div>
    </div>
  );
}

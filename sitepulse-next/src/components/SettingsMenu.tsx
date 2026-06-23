import React, { useState, useEffect, useRef } from 'react';
import { Settings, X, Palette, Monitor, PenTool, Flag, Plus, Trash2, Pencil, GripVertical, Calendar, User, Users, Shield, Contact, Building2, Upload, FileText, AlertCircle } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useUpdateSheetScopes, useReorderMilestones, useAllProjectUnits, useUpdateUnitFields, useUpdateSheetScale, useProject, useUpdateProject, useUpdateSheetSchedule, useProjectMembers, useCurrentUserRole, useUpdateProjectMemberRole, useUpdateMilestoneRules, useProjectContacts, useCreateProjectContact, useUpdateProjectContact, useDeleteProjectContact, useImportProjectContacts, type ProjectContactFields } from '@/hooks/useProjectQueries';
import { parseProcoreDirectoryCsv } from '@/utils/procoreDirectoryCsv';
import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/supabaseClient';
import { useQueryClient } from '@tanstack/react-query';
import { getAppliesTo } from '@/types/domain';
import { PROJECT_TYPES } from '@/utils/locationTaxonomy';
import { useUIStore } from '@/store/useUIStore';
import type { Milestone, Sheet, ProjectContact } from '@/types/domain';
import type { AppSettings as ProjectSettings, MapSettings } from '@/store/useSettingsStore';

interface SortableMilestoneItemProps {
  m: Milestone;
  editingMilestoneId: string | null;
  editMilestoneName: string;
  setEditMilestoneName: (name: string) => void;
  editMilestoneColor: string;
  setEditMilestoneColor: (color: string) => void;
  editMilestoneAppliesTo: string[] | null;
  setEditMilestoneAppliesTo: (val: string[] | null) => void;
  projectUnitTypes: string[];
  setEditingMilestoneId: (id: string | null) => void;
  onUpdateMilestone?: (id: string, oldName: string, newName: string, newColor: string) => void;
  onUpdateMilestoneRules?: (id: string, appliesTo: string[] | null) => void;
  onDeleteMilestone?: (id: string) => void;
}

function SortableMilestoneItem({ m, editingMilestoneId, editMilestoneName, setEditMilestoneName, editMilestoneColor, setEditMilestoneColor, editMilestoneAppliesTo, setEditMilestoneAppliesTo, projectUnitTypes, setEditingMilestoneId, onUpdateMilestone, onUpdateMilestoneRules, onDeleteMilestone }: SortableMilestoneItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: m.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const savedRule = getAppliesTo(m);
  // null = applies to all unit types; chips show the effective selection
  const effectiveSelection = editMilestoneAppliesTo ?? projectUnitTypes;

  const toggleAppliesTo = (type: string) => {
    const next = effectiveSelection.includes(type)
      ? effectiveSelection.filter(t => t !== type)
      : [...effectiveSelection, type];
    // All selected (or none) collapses back to the "applies to all" rule
    if (next.length === 0 || next.length === projectUnitTypes.length) {
      setEditMilestoneAppliesTo(null);
    } else {
      setEditMilestoneAppliesTo(next);
    }
  };

  const handleSave = () => {
    onUpdateMilestone?.(m.id, m.name, editMilestoneName, editMilestoneColor);
    const changed = JSON.stringify(editMilestoneAppliesTo) !== JSON.stringify(savedRule);
    if (changed) onUpdateMilestoneRules?.(m.id, editMilestoneAppliesTo);
    setEditingMilestoneId(null);
  };

  return (
    <li ref={setNodeRef} style={style} className="flex items-center justify-between bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-2 pl-2 shadow-sm">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <button {...attributes} {...listeners} type="button" className="p-1 cursor-grab text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
          <GripVertical size={16} />
        </button>
        {editingMilestoneId === m.id ? (
          <div className="flex flex-col bg-white dark:bg-black/30 border border-slate-300 dark:border-white/10 rounded-lg p-1 w-full gap-2 flex-1">
             <div className="flex gap-2 items-center w-full">
               <input type="text" value={editMilestoneName} onChange={(e) => setEditMilestoneName(e.target.value)} autoFocus className="w-full bg-transparent text-sm font-medium outline-none px-2 text-slate-900 dark:text-white" />
               <input type="color" value={editMilestoneColor} onChange={(e) => setEditMilestoneColor(e.target.value)} className="w-7 h-7 border-0 cursor-pointer bg-transparent shrink-0" />
               <button type="button" onClick={handleSave} className="px-3 bg-sky-500 hover:bg-sky-600 text-white rounded-md text-sm font-bold h-7 transition-colors">Save</button>
             </div>
             <div className="px-2 pb-1">
               <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                 Applies to {editMilestoneAppliesTo === null ? 'all space types' : `${effectiveSelection.length} of ${projectUnitTypes.length} space types`}
               </div>
               <div className="flex flex-wrap gap-1.5">
                 {projectUnitTypes.map(type => {
                   const active = effectiveSelection.includes(type);
                   return (
                     <button
                       key={type}
                       type="button"
                       onClick={() => toggleAppliesTo(type)}
                       className={`px-2 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                         active
                           ? 'bg-sky-100 text-sky-700 border-sky-300 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-700'
                           : 'bg-slate-100 text-slate-400 border-slate-200 line-through dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700'
                       }`}
                     >
                       {type}
                     </button>
                   );
                 })}
               </div>
               <div className="text-[10px] text-slate-400 italic mt-1.5">Deselected types are tracked as N/A for this milestone.</div>
             </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-1 min-w-0">
             <span className="w-4 h-4 rounded-full shadow-sm shrink-0" style={{ backgroundColor: m.color }} />
             <span className="font-semibold text-sm truncate text-slate-800 dark:text-slate-200">{m.name}</span>
             {savedRule && (
               <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 bg-slate-200/70 dark:bg-slate-800 px-1.5 py-0.5 rounded-full shrink-0" title={`Applies only to: ${savedRule.join(', ')}`}>
                 {savedRule.length} type{savedRule.length === 1 ? '' : 's'}
               </span>
             )}
          </div>
        )}
      </div>

      {editingMilestoneId !== m.id && (
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <button type="button" onClick={() => { setEditingMilestoneId(m.id); setEditMilestoneName(m.name); setEditMilestoneColor(m.color); setEditMilestoneAppliesTo(savedRule); }} className="p-1.5 text-slate-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-slate-800 rounded-lg transition-colors" title="Edit">
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

// ---- Project Contacts manager ----------------------------------------------
// A shared, project-level contact directory (Company, name, title, mobile,
// email), grouped by company. Mirrors the Milestones manager: list + add/edit/
// delete, role-gated. Self-contained (its own hooks/state) so the query only
// runs when the Contacts tab is opened and the big SettingsMenu stays lean.
// Writes are also enforced by RLS (owner/admin/pm) — `canEdit` just hides the
// controls for read-only members.

const EMPTY_CONTACT_FORM: ProjectContactFields = {
  company: '', first_name: '', last_name: '', job_title: '', mobile_phone: '', email: ''
};

// Trim, and collapse blanks to null so the DB stores NULL (not '') — important
// for the UNIQUE(project_id, email) de-dupe: Postgres treats NULLs as distinct,
// but two empty-string emails would collide.
function cleanContactFields(form: ProjectContactFields): ProjectContactFields {
  const t = (v?: string | null) => {
    const s = (v ?? '').trim();
    return s === '' ? null : s;
  };
  return {
    company: (form.company ?? '').trim(),
    first_name: t(form.first_name),
    last_name: t(form.last_name),
    job_title: t(form.job_title),
    mobile_phone: t(form.mobile_phone),
    email: t(form.email)
  };
}

function contactName(c: ProjectContact): string {
  return [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
}

interface ContactFormFieldsProps {
  form: ProjectContactFields;
  setForm: (f: ProjectContactFields) => void;
}

function ContactFormFields({ form, setForm }: ContactFormFieldsProps) {
  const inputCls = 'bg-white dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500';
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <input type="text" placeholder="Company *" value={form.company ?? ''} onChange={e => setForm({ ...form, company: e.target.value })} className={`${inputCls} sm:col-span-2`} />
      <input type="text" placeholder="First name" value={form.first_name ?? ''} onChange={e => setForm({ ...form, first_name: e.target.value })} className={inputCls} />
      <input type="text" placeholder="Last name" value={form.last_name ?? ''} onChange={e => setForm({ ...form, last_name: e.target.value })} className={inputCls} />
      <input type="text" placeholder="Job title" value={form.job_title ?? ''} onChange={e => setForm({ ...form, job_title: e.target.value })} className={inputCls} />
      <input type="tel" placeholder="Mobile phone" value={form.mobile_phone ?? ''} onChange={e => setForm({ ...form, mobile_phone: e.target.value })} className={inputCls} />
      <input type="email" placeholder="Email" value={form.email ?? ''} onChange={e => setForm({ ...form, email: e.target.value })} className={`${inputCls} sm:col-span-2`} />
    </div>
  );
}

// ---- Bulk import from a Procore directory CSV export (Phase 2) -------------
// File-upload OR paste → pure parse (src/utils/procoreDirectoryCsv.ts) →
// preview the count → confirm → chunked upsert (de-dupes on the table's
// UNIQUE(project_id, email), so re-importing the same file doesn't duplicate
// people who have an email). Rendered only when `canEdit`.
function ImportContactsControl({ projectId }: { projectId: string }) {
  const importContacts = useImportProjectContacts(projectId);
  const [open, setOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [parsed, setParsed] = useState<ProjectContactFields[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const preview = (text: string, sourceLabel: string) => {
    setError(null);
    setImportedCount(null);
    try {
      const contacts = parseProcoreDirectoryCsv(text);
      if (contacts.length === 0) {
        setParsed(null);
        setError(`No contacts found in ${sourceLabel}. Make sure it's a Procore project-directory CSV export with a Company column.`);
        return;
      }
      setParsed(contacts);
    } catch {
      setParsed(null);
      setError(`Could not read ${sourceLabel}.`);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setPasteText('');
    try {
      const text = await file.text();
      preview(text, `“${file.name}”`);
    } catch {
      setParsed(null);
      setError(`Could not read “${file.name}”.`);
    }
  };

  const reset = () => {
    setParsed(null);
    setPasteText('');
    setError(null);
    setImportedCount(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const confirmImport = () => {
    if (!parsed) return;
    importContacts.mutate(parsed, {
      onSuccess: (count) => {
        setImportedCount(count);
        setParsed(null);
        setPasteText('');
        if (fileInputRef.current) fileInputRef.current.value = '';
      },
      onError: (e: unknown) => {
        setError(e instanceof Error ? e.message : 'Import failed. Please try again.');
      }
    });
  };

  const companyCount = parsed ? new Set(parsed.map(c => c.company)).size : 0;
  const inputCls = 'bg-white dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500';

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 h-9 px-4 border border-dashed border-slate-300 dark:border-white/15 rounded-xl text-sm font-semibold text-slate-500 hover:text-sky-600 hover:border-sky-400 dark:hover:text-sky-300 transition-colors"
      >
        <Upload size={15} /> Import from Procore CSV
      </button>
    );
  }

  return (
    <div className="bg-white/50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
          <Upload size={13} /> Import from Procore CSV
        </div>
        <button type="button" onClick={() => { setOpen(false); reset(); }} className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors" title="Close">
          <X size={15} />
        </button>
      </div>

      <p className="text-xs text-slate-500 text-balance">
        Export your project directory from Procore as CSV, then upload it (or paste its contents) below.
        People are matched by email, so re-importing an updated file won't create duplicates.
      </p>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => handleFile(e.target.files?.[0])}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="h-9 px-4 bg-white dark:bg-white/5 border border-slate-300 dark:border-white/15 hover:border-sky-400 rounded-lg flex items-center justify-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200 transition-colors"
        >
          <FileText size={15} /> Choose CSV file…
        </button>
      </div>

      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" /> or paste <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
      </div>

      <textarea
        value={pasteText}
        onChange={(e) => setPasteText(e.target.value)}
        placeholder="Paste the CSV contents here…"
        rows={3}
        className={`${inputCls} w-full font-mono text-xs resize-y`}
      />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => preview(pasteText, 'the pasted text')}
          disabled={!pasteText.trim()}
          className="h-8 px-3 text-sm font-semibold text-sky-600 dark:text-sky-300 hover:underline disabled:opacity-40 disabled:no-underline"
        >
          Preview pasted text
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-lg p-2.5">
          <AlertCircle size={15} className="shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}

      {importedCount !== null && !error && (
        <div className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 rounded-lg p-2.5">
          Imported {importedCount} contact{importedCount === 1 ? '' : 's'}. They appear in the list below.
        </div>
      )}

      {parsed && (
        <div className="bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900/40 rounded-lg p-3 space-y-2">
          <div className="text-sm text-slate-700 dark:text-slate-200">
            Found <span className="font-bold">{parsed.length}</span> contact{parsed.length === 1 ? '' : 's'} across{' '}
            <span className="font-bold">{companyCount}</span> compan{companyCount === 1 ? 'y' : 'ies'}.
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={reset} disabled={importContacts.isPending} className="h-8 px-3 text-sm font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors disabled:opacity-50">
              Clear
            </button>
            <button type="button" onClick={confirmImport} disabled={importContacts.isPending} className="h-8 px-4 bg-sky-500 hover:bg-sky-600 text-white rounded-md text-sm font-bold transition-colors disabled:opacity-50 flex items-center gap-2">
              <Upload size={14} /> {importContacts.isPending ? 'Importing…' : `Import ${parsed.length}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ContactsManager({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { data: contacts = [], isLoading } = useProjectContacts(projectId);
  const createContact = useCreateProjectContact(projectId);
  const updateContact = useUpdateProjectContact(projectId);
  const deleteContact = useDeleteProjectContact(projectId);

  const [newContact, setNewContact] = useState<ProjectContactFields>(EMPTY_CONTACT_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ProjectContactFields>(EMPTY_CONTACT_FORM);

  // Group by company (already sorted by company → last → first from the query).
  const grouped: { company: string; rows: ProjectContact[] }[] = [];
  for (const c of contacts) {
    const key = c.company || 'Unspecified';
    const last = grouped[grouped.length - 1];
    if (last && last.company === key) last.rows.push(c);
    else grouped.push({ company: key, rows: [c] });
  }

  const handleAdd = () => {
    const cleaned = cleanContactFields(newContact);
    if (!cleaned.company) return;
    createContact.mutate(cleaned, { onSuccess: () => setNewContact(EMPTY_CONTACT_FORM) });
  };

  const beginEdit = (c: ProjectContact) => {
    setEditingId(c.id);
    setEditForm({
      company: c.company,
      first_name: c.first_name ?? '',
      last_name: c.last_name ?? '',
      job_title: c.job_title ?? '',
      mobile_phone: c.mobile_phone ?? '',
      email: c.email ?? ''
    });
  };

  const handleSaveEdit = () => {
    if (!editingId) return;
    const cleaned = cleanContactFields(editForm);
    if (!cleaned.company) return;
    updateContact.mutate({ id: editingId, updates: cleaned }, { onSuccess: () => setEditingId(null) });
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="font-bold text-sm flex items-center gap-2 text-slate-900 dark:text-white">
          <Contact size={16} className="text-sky-500" /> Project Contacts
        </h3>
        <p className="text-xs text-slate-500 mt-1 text-balance">
          The people working this job, grouped by company. Reused elsewhere in the app so subs are entered once, not re-typed.
        </p>
      </div>

      {canEdit && (
        <div className="bg-white/50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl p-3 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Add a contact</div>
          <ContactFormFields form={newContact} setForm={setNewContact} />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleAdd}
              disabled={!(newContact.company ?? '').trim() || createContact.isPending}
              className="h-9 px-4 bg-sky-500 hover:bg-sky-600 text-white rounded-lg flex items-center gap-2 text-sm font-semibold transition-colors shadow-sm disabled:opacity-50"
            >
              <Plus size={16} /> Add Contact
            </button>
          </div>
        </div>
      )}

      {canEdit && <ImportContactsControl projectId={projectId} />}

      {isLoading ? (
        <div className="text-center py-6 text-slate-500 text-sm">Loading contacts…</div>
      ) : contacts.length === 0 ? (
        <div className="text-center py-6 text-slate-500 text-sm bg-slate-50 dark:bg-slate-900/50 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl">
          No contacts yet{canEdit ? '. Add the first one above.' : '.'}
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(group => (
            <div key={group.company}>
              <div className="flex items-center gap-2 mb-1.5 text-xs font-bold uppercase tracking-widest text-slate-500">
                <Building2 size={13} className="shrink-0" />
                <span className="truncate">{group.company}</span>
                <span className="text-slate-400 font-semibold normal-case tracking-normal">({group.rows.length})</span>
              </div>
              <ul className="space-y-2">
                {group.rows.map(c => (
                  <li key={c.id} className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-3 shadow-sm">
                    {editingId === c.id ? (
                      <div className="space-y-2">
                        <ContactFormFields form={editForm} setForm={setEditForm} />
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setEditingId(null)} className="h-8 px-3 text-sm font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors">Cancel</button>
                          <button type="button" onClick={handleSaveEdit} disabled={!(editForm.company ?? '').trim() || updateContact.isPending} className="h-8 px-4 bg-sky-500 hover:bg-sky-600 text-white rounded-md text-sm font-bold transition-colors disabled:opacity-50">Save</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-slate-800 dark:text-slate-200 truncate">{contactName(c) || <span className="italic text-slate-400">No name</span>}</span>
                            {c.job_title && <span className="text-xs text-slate-500 truncate">{c.job_title}</span>}
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-slate-500">
                            {c.mobile_phone && <a href={`tel:${c.mobile_phone}`} className="hover:text-sky-500 transition-colors">{c.mobile_phone}</a>}
                            {c.email && <a href={`mailto:${c.email}`} className="hover:text-sky-500 transition-colors truncate">{c.email}</a>}
                          </div>
                        </div>
                        {canEdit && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button type="button" onClick={() => beginEdit(c)} className="p-1.5 text-slate-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-slate-800 rounded-lg transition-colors" title="Edit">
                              <Pencil size={14} />
                            </button>
                            <button type="button" onClick={() => { if (window.confirm(`Remove ${contactName(c) || 'this contact'} (${c.company})?`)) deleteContact.mutate(c.id); }} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-slate-800 rounded-lg transition-colors" title="Delete">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface SettingsMenuProps {
  open: boolean;
  onClose: () => void;
  settings: ProjectSettings;
  onUpdateSettings: (settings: ProjectSettings) => void;
  colorMode: string;
  setColorMode: (mode: string) => void;
  onAttachOriginal: (file: File) => void;
  milestones?: Milestone[];
  onAddMilestone?: (name: string, color: string, track: string) => void;
  onUpdateMilestone?: (id: string, oldName: string, newName: string, newColor: string) => void;
  onDeleteMilestone?: (id: string) => void;
  mapSettings?: MapSettings;
  onUpdateMapSettings: (settings: MapSettings) => void;
  sheets?: Sheet[];
  projectId: string;
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
}: SettingsMenuProps) {
  const { session } = useAuth() as any;
  const queryClient = useQueryClient();
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
      if ((data as any)?.display_name) setDisplayNameInput((data as any).display_name);
    }
    loadProfile();
  }, [session]);

  const uniqueScopes = [...new Set(milestones.map(m => m.track))];
  if (uniqueScopes.length === 0) uniqueScopes.push('Production');
  
  const [activeSettingsTrack, setActiveSettingsTrack] = useState(uniqueScopes[0] || 'Production');
  const [newSettingsTrackInput, setNewSettingsTrackInput] = useState('');
  const [newMilestoneName, setNewMilestoneName] = useState('');
  const [newMilestoneColor, setNewMilestoneColor] = useState('#3b82f6');
  const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(null);
  const [editMilestoneName, setEditMilestoneName] = useState('');
  const [editMilestoneColor, setEditMilestoneColor] = useState('');
  const [editMilestoneAppliesTo, setEditMilestoneAppliesTo] = useState<string[] | null>(null);
  const [expandedSchedules, setExpandedSchedules] = useState<Record<string, boolean>>({});
  const [newUnitTypeAdd, setNewUnitTypeAdd] = useState('');
  
  const setViewMode = useUIStore((s) => s.setViewMode);

  const reorderMilestonesMutation = useReorderMilestones(projectId);
  const updateMilestoneRulesMutation = useUpdateMilestoneRules(projectId);
  const updateSheetScopesMutation = useUpdateSheetScopes(projectId);
  const updateSheetScaleMutation = useUpdateSheetScale(projectId);
  const updateSheetScheduleMutation = useUpdateSheetSchedule(projectId);
  const updateUnitFieldsMutation = useUpdateUnitFields('');
  const updateMemberRoleMutation = useUpdateProjectMemberRole(projectId);

  const { data: project } = useProject(projectId);
  const updateProjectMutation = useUpdateProject(projectId);
  const { data: allUnits = [] } = useAllProjectUnits(sheets?.map(s => s.id) || []);

  const projectUnitTypes = (project?.unit_types as string[]) || ['Apartment Unit', 'Common Area', 'Back of House', 'Commercial Space', 'Other'];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  if (!open) return null;

  const currentScopeMilestones = milestones.filter(m => m.track === activeSettingsTrack).sort((a,b) => (a.sequence_order || 0) - (b.sequence_order || 0));

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (active.id !== over?.id && over) {
      const oldIndex = currentScopeMilestones.findIndex(m => m.id === active.id);
      const newIndex = currentScopeMilestones.findIndex(m => m.id === over.id);
      
      const newArray = arrayMove(currentScopeMilestones, oldIndex, newIndex);
      const updates = newArray.map((m, index) => ({ id: m.id, sequence_order: index }));
      reorderMilestonesMutation.mutate(updates as any);
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
            onClick={() => setActiveTab('contacts')}
            className={`flex items-center gap-2 shrink-0 px-3 py-2 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'contacts'
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Contact size={16} /> Contacts
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
                      onChange={(e) => onUpdateMapSettings({ ...(mapSettings as MapSettings), showHorizontalToolbar: e.target.checked })}
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
                      onChange={(e) => onUpdateMapSettings({ ...(mapSettings as MapSettings), showCrosshair: e.target.checked })}
                    />
                    <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
                  </label>
                </div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <span className="font-semibold block text-sm">Smooth Wheel Zoom</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">Glide when zooming with the mouse wheel instead of stepping</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={mapSettings?.smoothWheelZoom !== false}
                      onChange={(e) => onUpdateMapSettings({ ...(mapSettings as MapSettings), smoothWheelZoom: e.target.checked })}
                    />
                    <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
                  </label>
                </div>
                <div>
                  <span className="font-semibold block text-sm mb-2">Pinned Toolbar Actions</span>
                  <div className="flex flex-wrap gap-2">
                    {['undo', 'redo', 'pan', 'draw', 'add_node', 'delete_node', 'stamp', 'select', 'multi_select', 'crosshair'].map((tool) => {
                      const isPinned = mapSettings?.pinnedTools?.includes(tool as any);
                      return (
                        <button
                          key={tool}
                          onClick={() => {
                            const current = mapSettings?.pinnedTools || [];
                            const newPinned = isPinned
                              ? current.filter(t => t !== tool)
                              : [...current, tool as any];
                            onUpdateMapSettings({ ...(mapSettings as MapSettings), pinnedTools: newPinned });
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

              <div className="flex items-center justify-between bg-white/50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl p-3 mb-2">
                <div>
                  <span className="font-semibold block text-sm">Auto-Advance {activeSettingsTrack}</span>
                  <span className="text-xs text-slate-500">Automatically plan the next step when a milestone is completed.</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={settings.auto_advance_tracks?.[activeSettingsTrack] || false}
                    onChange={(e) => onUpdateSettings({ 
                      ...settings, 
                      auto_advance_tracks: {
                        ...(settings.auto_advance_tracks || {}),
                        [activeSettingsTrack]: e.target.checked
                      }
                    })}
                  />
                  <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
                </label>
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
                          editMilestoneAppliesTo={editMilestoneAppliesTo}
                          setEditMilestoneAppliesTo={setEditMilestoneAppliesTo}
                          projectUnitTypes={projectUnitTypes}
                          setEditingMilestoneId={setEditingMilestoneId}
                          onUpdateMilestone={onUpdateMilestone}
                          onUpdateMilestoneRules={(id, appliesTo) => updateMilestoneRulesMutation.mutate({ id, applies_to_unit_types: appliesTo })}
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
                     const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
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
                                 const schedule = ((sheet.milestone_schedules as any) || {})[m.name] || { start_date: '', end_date: '' };
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
                                              const newSchedules = { ...((sheet.milestone_schedules as any) || {}), [m.name]: { ...schedule, start_date: e.target.value } };
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
                                              const newSchedules = { ...((sheet.milestone_schedules as any) || {}), [m.name]: { ...schedule, end_date: e.target.value } };
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

          {activeTab === 'contacts' && (
            <ContactsManager
              projectId={projectId}
              canEdit={currentUserRole === 'owner' || currentUserRole === 'admin' || currentUserRole === 'pm' || currentUserRole === 'superintendent'}
            />
          )}

          {activeTab === 'system' && (
            <>
              <div className="flex items-center justify-between border-b border-slate-200/50 dark:border-white/10 pb-4">
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
                    checked={settings.showHistoryHover || false}
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
                    checked={settings.enableToasts || false}
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
              <div className="flex flex-col gap-2 mb-8">
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

              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="font-semibold block text-sm">Magnetic Snap Strength</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">Adjust the pull radius of the structural vector grid</span>
                  </div>
                  <span className="text-sm font-bold bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md">
                    {mapSettings?.snappingStrength || 15}px
                  </span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="50"
                  step="1"
                  value={mapSettings?.snappingStrength || 15}
                  onChange={(e) => onUpdateMapSettings({ ...(mapSettings as MapSettings), snappingStrength: parseInt(e.target.value) })}
                  className="w-full accent-sky-500 mt-2"
                />
              </div>
              
              <div className="flex items-center justify-between border-t border-slate-200/50 dark:border-white/10 pt-6 mt-4">
                <div>
                  <span className="font-semibold block text-sm">Vector Grid Snapping</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Snap drawing points to architectural lines</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={mapSettings?.enableSnapping || false}
                    onChange={(e) => onUpdateMapSettings({ ...(mapSettings as MapSettings), enableSnapping: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
                </label>
              </div>
            </>
          )}

          {activeTab === 'data' && (
            <div className="flex flex-col gap-6">
              <div>
                <h3 className="font-bold text-sm mb-1">Project Type</h3>
                <p className="text-xs text-slate-500 mb-3 text-balance">
                  Sets this project’s vertical. It orders the location-type picker so the most likely spaces appear first — it never restricts your choices.
                </p>
                <select
                  value={project?.project_type || ''}
                  onChange={(e) => updateProjectMutation.mutate({ project_type: e.target.value || null })}
                  className="w-full sm:w-72 bg-white dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="">— Not set —</option>
                  {PROJECT_TYPES.map((pt) => (
                    <option key={pt} value={pt}>{pt}</option>
                  ))}
                </select>
              </div>

              <div className="border-t border-slate-200 dark:border-white/10 pt-4">
                <h3 className="font-bold text-sm mb-3">Location Types</h3>
                <p className="text-xs text-slate-500 mb-3 text-balance">Define the types of spaces or units tracked in this project.</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {projectUnitTypes.map((type: string) => (
                    <div key={type} className="flex items-center gap-1.5 px-2 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-xs font-medium">
                      <span>{type}</span>
                      <button 
                        type="button" 
                        onClick={() => {
                          const newTypes = projectUnitTypes.filter((t: string) => t !== type);
                          updateProjectMutation.mutate({ unit_types: newTypes });
                        }}
                        className="text-slate-400 hover:text-red-500 ml-1"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={newUnitTypeAdd} 
                    onChange={e => setNewUnitTypeAdd(e.target.value)} 
                    placeholder="New Location Type" 
                    className="flex-1 bg-white dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none"
                  />
                  <button 
                    type="button" 
                    onClick={() => {
                      if (newUnitTypeAdd.trim() && !projectUnitTypes.includes(newUnitTypeAdd.trim())) {
                        updateProjectMutation.mutate({ unit_types: [...projectUnitTypes, newUnitTypeAdd.trim()] });
                        setNewUnitTypeAdd('');
                      }
                    }}
                    className="px-3 bg-slate-800 dark:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Add
                  </button>
                </div>
              </div>
              
              <div className="border-t border-slate-200 dark:border-white/10 pt-4">
                <h3 className="font-bold text-sm mb-3 text-red-600 dark:text-red-400">Danger Zone</h3>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("Are you sure? This will remove all assigned location types and assignees from all units in the project. This cannot be undone.")) {
                      allUnits.forEach(u => updateUnitFieldsMutation.mutate({ unitId: u.id, updates: { unit_type: null as any } }));
                    }
                  }}
                  className="px-4 py-2 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 rounded-lg text-sm font-semibold hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors w-full sm:w-auto"
                >
                  Clear All Field Data (Type & Assignee)
                </button>
              </div>
            </div>
          )}
          
          {activeTab === 'schedule' && (
            <div className="flex flex-col items-center justify-center text-center gap-4 py-12 px-6">
              <div className="w-14 h-14 rounded-2xl bg-sky-100 dark:bg-sky-500/20 flex items-center justify-center text-sky-500">
                <Calendar size={26} />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-800 dark:text-slate-100">Scheduling has moved</h3>
                <p className="text-sm text-slate-500 mt-1 max-w-sm">
                  Planned dates, the level→location cascade, and behind-schedule tracking now live in the full{' '}
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Schedule</span> view — a visual timeline you can read and edit directly.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setViewMode('schedule'); onClose(); }}
                className="inline-flex items-center gap-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold py-2 px-4 shadow-sm"
              >
                <Calendar size={16} /> Open the Schedule view
              </button>
            </div>
          )}
          
          {activeTab === 'profile' && (
            <div className="flex flex-col gap-6">
              <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-5 shadow-sm">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-16 h-16 bg-gradient-to-tr from-sky-400 to-blue-600 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-inner">
                    {displayNameInput ? displayNameInput.charAt(0).toUpperCase() : session?.user?.email?.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">{session?.user?.email}</h3>
                    <p className="text-sm text-slate-500 font-medium">SitePulse Account</p>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Display Name</label>
                    <input 
                      type="text" 
                      value={displayNameInput} 
                      onChange={e => setDisplayNameInput(e.target.value)} 
                      placeholder="e.g. John Doe"
                      className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500 transition-shadow"
                    />
                  </div>
                  <button 
                    type="button"
                    disabled={isSavingProfile || !displayNameInput.trim()}
                    onClick={async () => {
                      if (!session?.user?.id) return;
                      setIsSavingProfile(true);
                      await supabase.from('profiles').upsert({ id: session.user.id, display_name: displayNameInput } as any);
                      setIsSavingProfile(false);
                    }}
                    className="w-full sm:w-auto px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold rounded-lg shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {isSavingProfile ? 'Saving...' : 'Update Profile'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'team' && (currentUserRole === 'admin' || currentUserRole === 'pm') && (
            <div className="flex flex-col gap-6">
              <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-5 shadow-sm">
                 <h3 className="font-bold text-sm mb-1 text-slate-900 dark:text-white flex items-center gap-2">
                   <Users size={16} className="text-sky-500" /> Project Roster
                 </h3>
                 <p className="text-xs text-slate-500 mb-4 text-balance">Manage team members and their permission levels for this project.</p>
                 
                 <div className="space-y-2 mb-6">
                    {projectMembers.map(member => (
                       <div key={member.id} className="flex items-center justify-between p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm">
                         <div className="flex flex-col min-w-0 pr-4">
                           <span className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">{member.profiles?.display_name || member.user_email || 'Unknown User'}</span>
                           <span className="text-xs text-slate-500 truncate">{member.user_email}</span>
                         </div>
                         <div className="flex items-center gap-3 shrink-0">
                           <select
                             disabled={member.user_id === session?.user?.id || currentUserRole !== 'admin'}
                             value={member.role}
                             onChange={(e) => updateMemberRoleMutation.mutate({ memberId: member.id, role: e.target.value })}
                             className="text-xs font-semibold bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md px-2 py-1 outline-none disabled:opacity-50"
                           >
                             <option value="admin">Admin</option>
                             <option value="pm">Project Manager</option>
                             <option value="super">Superintendent</option>
                             <option value="sub">Subcontractor</option>
                             <option value="viewer">Viewer</option>
                           </select>
                           
                           {currentUserRole === 'admin' && member.user_id !== session?.user?.id && (
                             <button 
                               onClick={() => {
                                 if(window.confirm(`Remove ${member.user_email} from project?`)) {
                                   supabase.from('project_members').delete().eq('id', member.id).then(() => queryClient.invalidateQueries({ queryKey: ['projectMembers', projectId] }));
                                 }
                               }}
                               className="p-1 text-slate-400 hover:text-red-500 transition-colors" title="Remove Member"
                             >
                               <Trash2 size={16} />
                             </button>
                           )}
                         </div>
                       </div>
                    ))}
                    {projectMembers.length === 0 && <p className="text-sm text-slate-500 text-center py-4 border border-dashed rounded-lg">No members found.</p>}
                 </div>
                 
                 {currentUserRole === 'admin' && (
                   <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                     <h4 className="font-semibold text-xs text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wider">Invite Member</h4>
                     <form 
                       onSubmit={async (e) => {
                         e.preventDefault();
                         if(!newMemberEmail.trim()) return;
                         setIsAddingMember(true);
                         try {
                           // Basic implementation: Insert email directly into project_members
                           // In a real app, this might trigger an edge function to send an invite email.
                           await supabase.from('project_members').insert({
                             project_id: projectId,
                             user_email: newMemberEmail.trim().toLowerCase(),
                             role: newMemberRole
                           } as any);
                           setNewMemberEmail('');
                           queryClient.invalidateQueries({ queryKey: ['projectMembers', projectId] });
                         } catch(err) {
                           console.error(err);
                           alert("Failed to add member.");
                         } finally {
                           setIsAddingMember(false);
                         }
                       }}
                       className="flex flex-col sm:flex-row gap-3"
                     >
                       <input 
                         type="email" 
                         required
                         placeholder="user@company.com" 
                         value={newMemberEmail}
                         onChange={e => setNewMemberEmail(e.target.value)}
                         className="flex-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500"
                       />
                       <select 
                         value={newMemberRole}
                         onChange={e => setNewMemberRole(e.target.value)}
                         className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm outline-none font-semibold w-full sm:w-40"
                       >
                         <option value="admin">Admin</option>
                         <option value="pm">PM</option>
                         <option value="super">Super</option>
                         <option value="sub">Sub</option>
                         <option value="viewer">Viewer</option>
                       </select>
                       <button 
                         type="submit" 
                         disabled={isAddingMember || !newMemberEmail.trim()}
                         className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-lg shadow-sm transition-colors whitespace-nowrap disabled:opacity-50 flex items-center justify-center gap-2"
                       >
                         {isAddingMember ? 'Sending...' : <><Shield size={16} /> Invite</>}
                       </button>
                     </form>
                   </div>
                 )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { X, Search, Loader2, Save, User, AlertCircle, CheckCircle2, Users, Library, Settings, Folder, Trash2, AlertTriangle, Sparkles, ListChecks, Hash } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/supabaseClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/types/queryKeys';
import { useAuth } from '@/providers/AuthProvider';
import LocationLibraryPanel from '@/components/taxonomy/LocationLibraryPanel';
import ActivityLibraryPanel from '@/components/schedule/ActivityLibraryPanel';
import CostCodeLibraryPanel from '@/components/costcodes/CostCodeLibraryPanel';
import { deleteProjectService } from '@/services/api';
import { settledSupabaseFailures } from '@/utils/settledErrors';
import type { Profile, Project } from '@/types/domain';

// The profile fields this modal reads — the Team Directory list and the
// selected/searched user. Derived from `Profile` (AGENTS.md §6) but with `email`
// narrowed to non-null: every profile has a login email, the directory sorts +
// renders `email` unconditionally, and lookup matches by it, so it is asserted
// non-null at the query boundary, matching the file's existing runtime assumption.
type TeamMember = Pick<Profile, 'id' | 'display_name'> & { email: string };

// The admin project rows the modal is handed. The dashboard passes full `projects`
// rows (`projects (*)`); the modal only reads this subset — derive it from `Project`
// rather than re-declaring a table shape (AGENTS.md §6).
type AdminProject = Pick<Project, 'id' | 'name' | 'created_at' | 'ai_training_enabled'>;

// Per-project assign/role staging for the Users tab. `role`/`initialRole` mirror the
// `project_members.role` column (nullable free text — the picker offers pm/
// superintendent/admin); `memberId` is the existing membership row id, null when the
// user is not yet a member of that project.
type Assignment = {
  assigned: boolean;
  role: string | null;
  initialAssigned: boolean;
  initialRole: string | null;
  memberId: string | null;
};

// Inline success/error/info feedback shown by the save + project-action handlers.
type StatusMessage = { type: string; message: string };

type TabKey = 'users' | 'library' | 'activity-library' | 'cost-codes' | 'projects';

interface GlobalSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  adminProjects: AdminProject[];
  onProjectDeleted?: (projectId: string) => void;
  onProjectUpdated?: (projectId: string, patch: Partial<Project>) => void;
}

// Faithful port of the file's `err.message || fallback` pattern. Supabase throws a
// PostgrestError object (not always an `Error` instance), so read a non-empty string
// `message` off either an Error or a plain error object before falling back.
function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  return fallback;
}

export default function GlobalSettingsModal({ isOpen, onClose, adminProjects, onProjectDeleted, onProjectUpdated }: GlobalSettingsModalProps) {
  const { session } = useAuth() as { session: Session | null };
  const queryClient = useQueryClient();

  const [searchEmail, setSearchEmail] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [targetUser, setTargetUser] = useState<TeamMember | null>(null); // { id, display_name, email }
  const [searchError, setSearchError] = useState('');

  // State for the checkboxes and dropdowns
  const [assignments, setAssignments] = useState<Record<string, Assignment>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<StatusMessage>({ type: '', message: '' });

  // Which global-settings tab is showing: cross-project user management, the
  // global Location Library (the shared sub-type dictionary + review queue), or
  // the admin Projects manager (delete a project).
  const [activeTab, setActiveTab] = useState<TabKey>('users');

  // Projects tab state. `confirmProject` holds the project the admin has armed
  // for deletion; the type-the-name guard (`confirmText`) prevents fat-finger
  // destruction. `deletingId` drives the per-row spinner; `projectStatus`
  // surfaces success/error inline.
  const [confirmProject, setConfirmProject] = useState<AdminProject | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [projectStatus, setProjectStatus] = useState<StatusMessage>({ type: '', message: '' });

  // Per-project AI-training opt-out toggle (left of Delete). `trainingOverrides`
  // holds the optimistic per-project value while a write is in flight / since the
  // modal opened; `trainingSavingId` drives the in-flight disable + spinner.
  const [trainingOverrides, setTrainingOverrides] = useState<Record<string, boolean>>({});
  const [trainingSavingId, setTrainingSavingId] = useState<string | null>(null);

  // Global team directory — fetched via TanStack Query (§2: never
  // useState+useEffect for DB data). Cached across opens; the assignment save
  // appends a newly-assigned user to this cache via setQueryData.
  const { data: globalTeam = [], isLoading: loadingTeam } = useQuery({
    queryKey: queryKeys.globalTeamDirectory(),
    queryFn: async (): Promise<TeamMember[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, display_name');
      if (error) throw error;
      // Sort alphabetically by display_name or email. `email` is asserted
      // non-null here (see TeamMember) — every profile carries a login email.
      return (data as TeamMember[]).sort((a, b) => {
        const nameA = (a.display_name || a.email).toLowerCase();
        const nameB = (b.display_name || b.email).toLowerCase();
        return nameA.localeCompare(nameB);
      });
    },
    enabled: isOpen && !!adminProjects && adminProjects.length > 0,
  });

  // When modal closes, reset state
  useEffect(() => {
    if (!isOpen) {
      setTargetUser(null);
      setSearchEmail('');
      setSearchError('');
      setAssignments({});
      setSaveStatus({ type: '', message: '' });
      setConfirmProject(null);
      setConfirmText('');
      setProjectStatus({ type: '', message: '' });
      setTrainingOverrides({});
      setTrainingSavingId(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const loadUserAssignments = async (profile: TeamMember) => {
    setSearchError('');
    setTargetUser(profile);
    setSearchEmail(profile.email);
    setAssignments({});
    setSaveStatus({ type: '', message: '' });

    try {
      const { data: memberships, error: memErr } = await supabase
        .from('project_members')
        .select('id, project_id, role')
        .eq('user_id', profile.id);

      if (memErr) throw memErr;

      const newAssignments: Record<string, Assignment> = {};
      adminProjects.forEach(proj => {
        const mem = memberships?.find(m => m.project_id === proj.id);
        newAssignments[proj.id] = {
          assigned: !!mem,
          role: mem ? mem.role : 'pm',
          initialAssigned: !!mem,
          initialRole: mem ? mem.role : 'pm',
          memberId: mem ? mem.id : null
        };
      });

      setAssignments(newAssignments);
    } catch (err) {
      console.error("Error loading user assignments:", err);
      setSearchError("Failed to load user assignments.");
    }
  };

  const handleSearch = async (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (!searchEmail.trim()) return;

    setIsSearching(true);
    setSearchError('');
    setTargetUser(null);
    setAssignments({});
    setSaveStatus({ type: '', message: '' });

    try {
      const email = searchEmail.trim().toLowerCase();
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('id, email, display_name')
        .eq('email', email)
        .single();

      if (profileErr || !profile) {
        setSearchError('User not found. They must sign up to the platform first.');
        setIsSearching(false);
        return;
      }

      // `email` is non-null here — the query filtered on it, so the returned row's
      // email is the searched value (narrow to TeamMember at the boundary).
      await loadUserAssignments(profile as TeamMember);

    } catch (err) {
      console.error("Error searching user:", err);
      setSearchError("An error occurred while searching.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleToggleAssign = (projectId: string) => {
    setAssignments(prev => ({
      ...prev,
      [projectId]: {
        ...prev[projectId],
        assigned: !prev[projectId].assigned
      }
    }));
  };

  const handleRoleChange = (projectId: string, role: string) => {
    setAssignments(prev => ({
      ...prev,
      [projectId]: {
        ...prev[projectId],
        role
      }
    }));
  };

  const handleSave = async () => {
    if (!targetUser) return;
    setIsSaving(true);
    setSaveStatus({ type: '', message: '' });

    const promises = [];
    let hasChanges = false;

    for (const proj of adminProjects) {
      const current = assignments[proj.id];
      if (!current) continue;

      if (current.assigned && !current.initialAssigned) {
        hasChanges = true;
        promises.push(
          supabase.from('project_members').insert([{
            project_id: proj.id,
            user_id: targetUser.id,
            role: current.role
          }])
        );
      }
      else if (!current.assigned && current.initialAssigned && current.memberId) {
        hasChanges = true;
        promises.push(
          supabase.from('project_members').delete().eq('id', current.memberId)
        );
      }
      else if (current.assigned && current.initialAssigned && current.role !== current.initialRole && current.memberId) {
        hasChanges = true;
        promises.push(
          supabase.from('project_members').update({ role: current.role }).eq('id', current.memberId)
        );
      }
    }

    if (!hasChanges) {
      setSaveStatus({ type: 'info', message: 'No changes made.' });
      setIsSaving(false);
      return;
    }

    try {
      // Supabase builders RESOLVE with { error } (they never reject on an RLS
      // denial / constraint failure), so a rejected-only filter reported
      // "updated successfully" over a batch of failed writes.
      const results = await Promise.allSettled(promises);
      const failures = settledSupabaseFailures(results);

      queryClient.invalidateQueries({ queryKey: ['project_members'] });

      if (failures.length > 0) {
        console.error("Some saves failed:", failures);
        setSaveStatus({ type: 'error', message: `Saved with ${failures.length} errors. Please refresh.` });
      } else {
        setSaveStatus({ type: 'success', message: 'All assignments updated successfully!' });

        // Add new user to the cached global team list instantly if they aren't there
        queryClient.setQueryData<TeamMember[]>(queryKeys.globalTeamDirectory(), prev => {
          const list = prev ?? [];
          if (list.find(u => u.id === targetUser.id)) return list;
          return [...list, targetUser].sort((a, b) => {
            const nameA = (a.display_name || a.email).toLowerCase();
            const nameB = (b.display_name || b.email).toLowerCase();
            return nameA.localeCompare(nameB);
          });
        });
      }

      const { data: newMemberships } = await supabase
        .from('project_members')
        .select('id, project_id, role')
        .eq('user_id', targetUser.id);

      if (newMemberships) {
         const updatedAssignments: Record<string, Assignment> = {};
         adminProjects.forEach(proj => {
           const mem = newMemberships.find(m => m.project_id === proj.id);
           updatedAssignments[proj.id] = {
             assigned: !!mem,
             role: mem ? mem.role : 'pm',
             initialAssigned: !!mem,
             initialRole: mem ? mem.role : 'pm',
             memberId: mem ? mem.id : null
           };
         });
         setAssignments(updatedAssignments);
      }

    } catch (err) {
      console.error(err);
      setSaveStatus({ type: 'error', message: 'A critical error occurred while saving.' });
    } finally {
      setIsSaving(false);
    }
  };

  // Flip a project's AI-training contribution on/off. Optimistic: update the local
  // override immediately, write to `projects.ai_training_enabled` (RLS allows the
  // owner/admin who can see this tab), and revert on failure. Default-ON, so the
  // displayed state is `override ?? (flag !== false)`.
  const handleToggleTraining = async (project: AdminProject) => {
    const currentOn = trainingOverrides[project.id] ?? (project.ai_training_enabled !== false);
    const next = !currentOn;
    setTrainingSavingId(project.id);
    setTrainingOverrides(prev => ({ ...prev, [project.id]: next }));
    setProjectStatus({ type: '', message: '' });
    try {
      const { error } = await supabase
        .from('projects')
        .update({ ai_training_enabled: next })
        .eq('id', project.id);
      if (error) throw error;
      onProjectUpdated?.(project.id, { ai_training_enabled: next });
      setProjectStatus({
        type: 'success',
        message: next
          ? `“${project.name}” now contributes to AI training.`
          : `“${project.name}” will no longer contribute to AI training.`,
      });
    } catch (err) {
      console.error('AI-training toggle failed:', err);
      setTrainingOverrides(prev => ({ ...prev, [project.id]: currentOn })); // revert
      setProjectStatus({ type: 'error', message: toErrorMessage(err, 'Failed to update AI-training setting.') });
    } finally {
      setTrainingSavingId(null);
    }
  };

  const handleDeleteProject = async (project: AdminProject) => {
    setDeletingId(project.id);
    setProjectStatus({ type: '', message: '' });
    try {
      // The backend route is admin-gated and reclaims storage before the
      // cascade delete (client `.remove()` is RLS-denied). Needs the user JWT.
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const token = authSession?.access_token;
      if (!token) throw new Error('You appear to be signed out. Please refresh and try again.');

      await deleteProjectService(project.id, token);

      setConfirmProject(null);
      setConfirmText('');
      setProjectStatus({ type: 'success', message: `Deleted “${project.name}”.` });
      onProjectDeleted?.(project.id); // let the dashboard drop it from the grid
    } catch (err) {
      console.error('Project delete failed:', err);
      setProjectStatus({ type: 'error', message: toErrorMessage(err, 'Failed to delete project.') });
    } finally {
      setDeletingId(null);
    }
  };

  const isSelfModifying = targetUser?.email === session?.user?.email;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm transition-opacity" onClick={onClose}>
      <div className="w-full max-w-5xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>

        <div className="flex justify-between items-start p-5 pb-0 border-b border-slate-100 dark:border-white/5 shrink-0">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2 text-slate-900 dark:text-white">
              <Settings className="w-5 h-5 text-sky-500" />
              Global Settings
            </h2>
            <div className="flex gap-1 mt-3 -mb-px">
              <button
                onClick={() => setActiveTab('users')}
                className={`flex items-center gap-2 px-3 py-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'users' ? 'border-sky-500 text-sky-600 dark:text-sky-400' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
              >
                <Users className="w-4 h-4" /> User Management
              </button>
              <button
                onClick={() => setActiveTab('library')}
                className={`flex items-center gap-2 px-3 py-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'library' ? 'border-sky-500 text-sky-600 dark:text-sky-400' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
              >
                <Library className="w-4 h-4" /> Location Library
              </button>
              <button
                onClick={() => setActiveTab('activity-library')}
                className={`flex items-center gap-2 px-3 py-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'activity-library' ? 'border-sky-500 text-sky-600 dark:text-sky-400' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
              >
                <ListChecks className="w-4 h-4" /> Scopes &amp; Activities
              </button>
              <button
                onClick={() => setActiveTab('cost-codes')}
                className={`flex items-center gap-2 px-3 py-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'cost-codes' ? 'border-sky-500 text-sky-600 dark:text-sky-400' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
              >
                <Hash className="w-4 h-4" /> Cost Codes
              </button>
              <button
                onClick={() => setActiveTab('projects')}
                className={`flex items-center gap-2 px-3 py-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'projects' ? 'border-sky-500 text-sky-600 dark:text-sky-400' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
              >
                <Folder className="w-4 h-4" /> Projects
              </button>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {activeTab === 'library' && (
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            <LocationLibraryPanel canManage />
          </div>
        )}

        {activeTab === 'activity-library' && (
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            <ActivityLibraryPanel canManage />
          </div>
        )}

        {activeTab === 'cost-codes' && (
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            <CostCodeLibraryPanel canManage />
          </div>
        )}

        {activeTab === 'projects' && (
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            <div className="max-w-2xl mx-auto space-y-4">
              <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl text-sm font-medium text-amber-800 dark:text-amber-400">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <p>Deleting a project permanently removes its drawings, locations, statuses, history, team assignments and contacts. This cannot be undone.</p>
              </div>

              {projectStatus.message && (
                <div className={`flex items-center gap-1.5 text-xs font-bold ${projectStatus.type === 'success' ? 'text-emerald-500' : projectStatus.type === 'error' ? 'text-red-500' : 'text-slate-500 dark:text-slate-400'}`}>
                  {projectStatus.type === 'success' ? <CheckCircle2 size={14} /> : projectStatus.type === 'error' ? <AlertCircle size={14} /> : null}
                  {projectStatus.message}
                </div>
              )}

              <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm divide-y divide-slate-100 dark:divide-slate-800">
                {adminProjects.length === 0 ? (
                  <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">You do not have Admin access to any projects.</div>
                ) : (
                  adminProjects.map(project => {
                    const isArmed = confirmProject?.id === project.id;
                    const isDeleting = deletingId === project.id;
                    const canConfirm = confirmText.trim() === project.name && !isDeleting;
                    const trainingOn = trainingOverrides[project.id] ?? (project.ai_training_enabled !== false);
                    const isTrainingSaving = trainingSavingId === project.id;
                    return (
                      <div key={project.id} className="p-4 px-5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-500 shrink-0">
                              <Folder size={18} />
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold text-sm text-slate-900 dark:text-white truncate">{project.name}</div>
                              {project.created_at && (
                                <div className="text-xs text-slate-500 dark:text-slate-400">Created {new Date(project.created_at).toLocaleDateString()}</div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            {/* AI-training contribution toggle (left of Delete). When OFF,
                                traces in this project stop feeding the training corpus AND
                                the live naming-vocabulary learning. Default ON. */}
                            <label
                              className="flex items-center gap-2 cursor-pointer select-none"
                              title={trainingOn
                                ? 'Locations traced in this project help train the AI (naming + future auto-tracing). Click to stop this project contributing.'
                                : 'This project is excluded from AI training. Click to let it contribute again.'}
                            >
                              <Sparkles size={14} className={trainingOn ? 'text-sky-500' : 'text-slate-400 dark:text-slate-600'} />
                              <span className={`text-xs font-semibold hidden sm:inline ${trainingOn ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500'}`}>
                                AI training
                              </span>
                              <span className="relative inline-flex items-center">
                                <input
                                  type="checkbox"
                                  className="sr-only peer"
                                  disabled={isTrainingSaving}
                                  checked={trainingOn}
                                  onChange={() => handleToggleTraining(project)}
                                />
                                <span className="w-9 h-5 bg-slate-200 dark:bg-slate-700 rounded-full peer peer-checked:bg-sky-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4 peer-disabled:opacity-50"></span>
                              </span>
                              {isTrainingSaving && <Loader2 size={14} className="animate-spin text-slate-400" />}
                            </label>

                            {!isArmed && (
                              <button
                                onClick={() => { setConfirmProject(project); setConfirmText(''); setProjectStatus({ type: '', message: '' }); }}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0"
                              >
                                <Trash2 size={14} /> Delete
                              </button>
                            )}
                          </div>
                        </div>

                        {isArmed && (
                          <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/40 rounded-xl space-y-3">
                            <p className="text-xs font-semibold text-red-700 dark:text-red-300">
                              Type <span className="font-mono bg-white dark:bg-slate-900 px-1.5 py-0.5 rounded border border-red-200 dark:border-red-900/50">{project.name}</span> to permanently delete this project.
                            </p>
                            <input
                              type="text"
                              autoFocus
                              disabled={isDeleting}
                              value={confirmText}
                              onChange={e => setConfirmText(e.target.value)}
                              placeholder="Project name"
                              className="w-full bg-white dark:bg-slate-950 border border-red-300 dark:border-red-900/50 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-red-500"
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => { setConfirmProject(null); setConfirmText(''); }}
                                disabled={isDeleting}
                                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleDeleteProject(project)}
                                disabled={!canConfirm}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                {isDeleting ? 'Deleting…' : 'Delete Forever'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'users' && (
        <div className="flex flex-1 overflow-hidden min-h-0">

          {/* Left Column: Team Directory */}
          <div className="w-1/3 border-r border-slate-100 dark:border-white/5 flex flex-col bg-slate-50/50 dark:bg-slate-800/30">
            <div className="p-4 border-b border-slate-100 dark:border-white/5 shrink-0">
              <h3 className="font-bold text-sm text-slate-700 dark:text-slate-300 flex items-center gap-2 mb-1">
                <Users className="w-4 h-4 text-slate-400" />
                Team Directory
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">All users across your projects</p>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
              {loadingTeam ? (
                <div className="flex justify-center p-8 text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : globalTeam.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  No team members found.
                </div>
              ) : (
                <div className="space-y-1">
                  {globalTeam.map(member => (
                    <button
                      key={member.id}
                      onClick={() => loadUserAssignments(member)}
                      className={`w-full text-left p-3 rounded-xl flex items-center gap-3 transition-colors ${
                        targetUser?.id === member.id
                          ? 'bg-sky-100 dark:bg-sky-900/30 border border-sky-200 dark:border-sky-800'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-full flex flex-shrink-0 items-center justify-center font-bold text-xs ${
                         targetUser?.id === member.id ? 'bg-sky-500 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}>
                        {member.display_name?.charAt(0)?.toUpperCase() || member.email.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={`font-bold text-sm truncate ${targetUser?.id === member.id ? 'text-sky-900 dark:text-sky-100' : 'text-slate-700 dark:text-slate-200'}`}>
                          {member.display_name || 'Unknown User'}
                        </div>
                        <div className={`text-xs truncate ${targetUser?.id === member.id ? 'text-sky-600 dark:text-sky-400' : 'text-slate-500 dark:text-slate-400'}`}>
                          {member.email}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Lookup & Assignments */}
          <div className="w-2/3 flex flex-col bg-white dark:bg-slate-900 min-h-0">
            <div className="p-5 border-b border-slate-100 dark:border-white/5 shrink-0">
              <form onSubmit={handleSearch} className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input
                    type="email"
                    required
                    value={searchEmail}
                    onChange={e => setSearchEmail(e.target.value)}
                    placeholder="Find or invite a new user by email address..."
                    className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSearching || !searchEmail.trim()}
                  className="bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 px-5 py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm shrink-0"
                >
                  {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Lookup'}
                </button>
              </form>
              {searchError && <p className="text-red-500 text-xs font-bold mt-2">{searchError}</p>}
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {!targetUser ? (
                 <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                    <User className="w-12 h-12 mb-3 opacity-20" />
                    <p className="text-sm font-medium dark:text-slate-300 text-slate-700">Select a user from the directory or lookup by email.</p>
                    <p className="text-xs mt-1 max-w-xs text-balance dark:text-slate-400">You can manage their project assignments and permissions here.</p>
                 </div>
              ) : (
                <div className="space-y-4 max-w-2xl mx-auto">
                  <div className="flex items-center gap-3 p-4 bg-sky-50 dark:bg-sky-900/10 border border-sky-100 dark:border-sky-900/50 rounded-xl">
                    <div className="w-12 h-12 rounded-full bg-sky-100 dark:bg-sky-900/40 flex items-center justify-center text-sky-600 dark:text-sky-400 font-bold text-lg">
                      {targetUser.display_name?.charAt(0)?.toUpperCase() || targetUser.email.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-bold text-base text-slate-900 dark:text-white">{targetUser.display_name || 'Unknown User'}</div>
                      <div className="text-sm text-slate-500 dark:text-slate-400">{targetUser.email}</div>
                    </div>
                  </div>

                  {isSelfModifying && (
                    <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl text-sm font-medium text-amber-800 dark:text-amber-400 flex items-start gap-2">
                      <AlertCircle size={16} className="shrink-0 mt-0.5" />
                      <p>You cannot modify your own global permissions from this menu to prevent accidental lockouts.</p>
                    </div>
                  )}

                  <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
                    <div className="bg-slate-50 dark:bg-slate-800 px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      <span>Project</span>
                      <span>Role Assignment</span>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {adminProjects.length === 0 ? (
                        <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">You do not have Admin access to any projects.</div>
                      ) : (
                        adminProjects.map(proj => {
                          const current = assignments[proj.id];
                          if (!current) return null;

                          return (
                            <div key={proj.id} className="p-4 px-5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                              <div className="flex items-center gap-3">
                                <label className="relative inline-flex items-center cursor-pointer">
                                  <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    disabled={isSelfModifying}
                                    checked={current.assigned}
                                    onChange={() => handleToggleAssign(proj.id)}
                                  />
                                  <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500 peer-disabled:opacity-50"></div>
                                </label>
                                <span className={`font-semibold text-sm ${current.assigned ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                                  {proj.name}
                                </span>
                              </div>

                              <select
                                value={current.role ?? ''}
                                onChange={(e) => handleRoleChange(proj.id, e.target.value)}
                                disabled={!current.assigned || isSelfModifying}
                                className={`pl-3 pr-8 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider outline-none cursor-pointer border-r-4 border-transparent ${
                                  !current.assigned || isSelfModifying
                                    ? 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500 cursor-not-allowed opacity-50'
                                    : current.role === 'admin'
                                      ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30'
                                      : current.role === 'pm'
                                        ? 'bg-sky-100 text-sky-600 dark:bg-sky-900/30'
                                        : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30'
                                }`}
                              >
                                <option value="pm">PM</option>
                                <option value="superintendent">SUPERINTENDENT</option>
                                <option value="admin">ADMIN</option>
                              </select>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Save Bar */}
            <div className="p-5 border-t border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between shrink-0">
               <div className="flex-1">
                 {saveStatus.message && (
                   <div className={`flex items-center gap-1.5 text-xs font-bold ${saveStatus.type === 'success' ? 'text-emerald-500' : saveStatus.type === 'error' ? 'text-red-500' : 'text-slate-500 dark:text-slate-400'}`}>
                      {saveStatus.type === 'success' ? <CheckCircle2 size={14} /> : saveStatus.type === 'error' ? <AlertCircle size={14} /> : null}
                      {saveStatus.message}
                   </div>
                 )}
               </div>
               <div className="flex items-center gap-3">
                 <button
                    onClick={onClose}
                    disabled={isSaving}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!targetUser || isSelfModifying || isSaving}
                    className="bg-sky-500 hover:bg-sky-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm"
                  >
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {isSaving ? 'Saving...' : 'Save Assignments'}
                  </button>
               </div>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

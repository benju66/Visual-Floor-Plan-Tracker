import React, { useState, useEffect } from 'react';
import { X, Search, Loader2, Save, User, AlertCircle, CheckCircle2, Users, Library, Settings } from 'lucide-react';
import { supabase } from '@/supabaseClient';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/providers/AuthProvider';
import LocationLibraryPanel from '@/components/taxonomy/LocationLibraryPanel';

export default function GlobalSettingsModal({ isOpen, onClose, adminProjects }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  
  const [searchEmail, setSearchEmail] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [targetUser, setTargetUser] = useState(null); // { id, display_name, email }
  const [searchError, setSearchError] = useState('');
  
  // State for the checkboxes and dropdowns
  const [assignments, setAssignments] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState({ type: '', message: '' });

  // Which global-settings tab is showing: cross-project user management, or the
  // global Location Library (the shared sub-type dictionary + review queue).
  const [activeTab, setActiveTab] = useState('users');

  // New State for Global Team
  const [globalTeam, setGlobalTeam] = useState([]);
  const [loadingTeam, setLoadingTeam] = useState(false);

  useEffect(() => {
    async function fetchGlobalTeam() {
      if (!isOpen || !adminProjects || adminProjects.length === 0) return;
      
      setLoadingTeam(true);
      
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, display_name');
        
      if (data && !error) {
        // Sort alphabetically by display_name or email
        const allUsers = data.sort((a, b) => {
          const nameA = (a.display_name || a.email).toLowerCase();
          const nameB = (b.display_name || b.email).toLowerCase();
          return nameA.localeCompare(nameB);
        });
        
        setGlobalTeam(allUsers);
      } else {
        console.error("Error fetching global team:", error);
      }
      setLoadingTeam(false);
    }
    
    fetchGlobalTeam();
  }, [isOpen, adminProjects]);

  // When modal closes, reset state
  useEffect(() => {
    if (!isOpen) {
      setTargetUser(null);
      setSearchEmail('');
      setSearchError('');
      setAssignments({});
      setSaveStatus({ type: '', message: '' });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const loadUserAssignments = async (profile) => {
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

      const newAssignments = {};
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

  const handleSearch = async (e) => {
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

      await loadUserAssignments(profile);

    } catch (err) {
      console.error("Error searching user:", err);
      setSearchError("An error occurred while searching.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleToggleAssign = (projectId) => {
    setAssignments(prev => ({
      ...prev,
      [projectId]: {
        ...prev[projectId],
        assigned: !prev[projectId].assigned
      }
    }));
  };

  const handleRoleChange = (projectId, role) => {
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
      const results = await Promise.allSettled(promises);
      const failures = results.filter(r => r.status === 'rejected');
      
      queryClient.invalidateQueries({ queryKey: ['project_members'] });

      if (failures.length > 0) {
        console.error("Some saves failed:", failures);
        setSaveStatus({ type: 'error', message: `Saved with ${failures.length} errors. Please refresh.` });
      } else {
        setSaveStatus({ type: 'success', message: 'All assignments updated successfully!' });
        
        // Add new user to global team list instantly if they aren't there
        setGlobalTeam(prev => {
          if (!prev.find(u => u.id === targetUser.id)) {
            return [...prev, targetUser].sort((a, b) => {
              const nameA = (a.display_name || a.email).toLowerCase();
              const nameB = (b.display_name || b.email).toLowerCase();
              return nameA.localeCompare(nameB);
            });
          }
          return prev;
        });
      }

      const { data: newMemberships } = await supabase
        .from('project_members')
        .select('id, project_id, role')
        .eq('user_id', targetUser.id);
        
      if (newMemberships) {
         const updatedAssignments = {};
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
                                value={current.role}
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

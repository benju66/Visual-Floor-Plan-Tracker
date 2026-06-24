'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/supabaseClient';
import { useAuth } from '@/providers/AuthProvider';
import { LayoutDashboard, Plus, Loader2, Folder, Shield, ArrowRight, X, Info, Settings, Library } from 'lucide-react';
import GlobalSettingsModal from '@/components/GlobalSettingsModal';
import { PROJECT_TYPES } from '@/utils/locationTaxonomy';
export default function DashboardPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // NEW: Read link_procore_project parameter
  const [linkProcoreProject, setLinkProcoreProject] = useState(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Delay slightly to let Next.js router settle after AuthProvider cleans the hash
      setTimeout(() => {
        const searchParams = new URLSearchParams(window.location.search);
        const linkId = searchParams.get('link_procore_project');
        if (linkId) setLinkProcoreProject(linkId);
      }, 100);
    }
  }, []);
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGlobalSettingsOpen, setIsGlobalSettingsOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectType, setNewProjectType] = useState('');
  const [creating, setCreating] = useState(false);

  const adminProjects = projects.filter(p => p.role === 'admin').map(p => p.projects);

  useEffect(() => {
    if (!session?.user?.id) return;
    
    async function fetchProjects() {
      // Fetch projects via project_members
      const { data, error } = await supabase
        .from('project_members')
        .select(`
          role,
          projects (*)
        `)
        .eq('user_id', session.user.id);
        
      if (!error && data) {
        // Contamination guard: never let the hidden workbench container
        // (kind='workbench') into the live Projects Dashboard. Post-filter in JS
        // BEFORE the sort — a PostgREST filter on the embedded `projects` only
        // nulls the embed (leaving the row), and the sort below dereferences
        // `r.projects.created_at`, so a nulled row would throw.
        const liveProjects = data.filter((r) => r.projects && r.projects.kind !== 'workbench');
        // Sort projects by created_at descending
        const sorted = liveProjects.sort((a, b) => new Date(b.projects.created_at) - new Date(a.projects.created_at));
        setProjects(sorted);
      }
      setLoading(false);
    }
    
    fetchProjects();
  }, [session]);

  // After an admin deletes a project from Global Settings, drop it from local
  // state so it disappears from the grid (and recomputes `adminProjects`)
  // without a full refetch.
  const handleProjectDeleted = (projectId) => {
    setProjects(prev => prev.filter(p => p.projects?.id !== projectId));
  };

  const handleCreateProject = async (e) => {
    e.preventDefault();
    if (!newProjectName.trim() || !session?.user?.id) return;
    
    setCreating(true);
    try {
      // Call the server-side API route to bypass RLS issues
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newProjectName.trim(),
          procore_project_id: linkProcoreProject,
          project_type: newProjectType || null,
          user_id: session.user.id
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create project');
      }

      const projectRecord = await response.json();
      
      // 3. Redirect
      router.push(`/project/${projectRecord.id}`);
    } catch (err) {
      console.error("Error creating project:", err);
      alert("Failed to create project. Please try again.");
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Loader2 className="animate-spin w-8 h-8 text-sky-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 px-4 py-8 md:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3 mb-2">
              <span className="p-2 bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400 rounded-xl">
                <LayoutDashboard size={28} />
              </span>
              Projects Dashboard
            </h1>
            <p className="text-slate-500 dark:text-slate-400 font-medium">
              Manage and access your construction trackers.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Admin-only entry to the Location Labeling Workbench — reuses the
                same `adminProjects` gate as Global Settings (owner decision
                2026-06-17). The workbench container itself is excluded from
                `adminProjects` by the contamination filter above. */}
            {adminProjects.length > 0 && (
              <Link
                href="/workbench"
                className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-900/50 dark:hover:bg-slate-800 dark:text-slate-300 dark:border-white/10 px-5 py-2.5 rounded-xl font-bold transition-all shadow-sm group"
              >
                <Library size={20} className="text-violet-500" />
                Drawing Library
              </Link>
            )}
            {adminProjects.length > 0 && (
              <button
                onClick={() => setIsGlobalSettingsOpen(true)}
                className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-900/50 dark:hover:bg-slate-800 dark:text-slate-300 dark:border-white/10 px-5 py-2.5 rounded-xl font-bold transition-all shadow-sm group"
              >
                <Settings size={20} className="text-slate-500 group-hover:rotate-45 transition-transform" />
                Global Settings
              </button>
            )}
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 px-5 py-2.5 rounded-xl font-bold transition-all shadow-sm group"
            >
              <Plus size={20} className="group-hover:rotate-90 transition-transform" />
              New Project
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map(({ projects: project, role }) => (
            <div
              key={project.id}
              onClick={() => router.push(`/project/${project.id}`)}
              className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all cursor-pointer group hover:-translate-y-1 relative overflow-hidden"
            >
              {/* Subtle gradient bg focus effect */}
              <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-sky-400 to-blue-600 scale-x-0 group-hover:scale-x-100 transition-transform origin-left" />
              
              <div className="flex justify-between items-start mb-6">
                <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-600 dark:text-slate-300">
                  <Folder size={24} />
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-full">
                  <Shield size={12} className={role === 'admin' ? 'text-rose-500' : 'text-emerald-500'} />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    {role}
                  </span>
                </div>
              </div>
              
              <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2 line-clamp-1 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
                {project.name}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">
                Created on {new Date(project.created_at).toLocaleDateString()}
              </p>
              
              <div className="flex justify-end items-center mt-auto">
                <span className="text-sm font-semibold text-sky-600 dark:text-sky-400 flex items-center gap-1 opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all">
                  Open <ArrowRight size={16} />
                </span>
              </div>
            </div>
          ))}

          {projects.length === 0 && (
            <div 
              onClick={() => setIsModalOpen(true)}
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/50 hover:border-slate-400 dark:hover:border-slate-500 transition-all min-h-[220px]"
            >
              <div className="p-4 bg-slate-100 dark:bg-slate-800 rounded-full mb-4 text-slate-400">
                <Plus size={32} />
              </div>
              <h3 className="text-lg font-bold text-slate-700 dark:text-slate-300 mb-1">Create your first project</h3>
              <p className="text-sm text-slate-500">Get started by setting up a robust tracker.</p>
            </div>
          )}
        </div>
      </div>

      {/* New Project Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-white/5">
              <h2 className="text-xl font-bold flex items-center gap-2 text-slate-900 dark:text-white">
                <Folder size={20} className="text-sky-500" />
                New Project
              </h2>
              <button 
                onClick={() => !creating && setIsModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleCreateProject} className="p-5">
              
              {/* NEW: Show linking indicator */}
              {linkProcoreProject && (
                <div className="mb-5 p-3 bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-xl text-sm font-medium text-sky-700 dark:text-sky-300 flex items-center gap-2">
                  <Info size={16} className="shrink-0" />
                  This new tracker will be automatically linked to your active Procore project.
                </div>
              )}

              <div className="mb-6">
                <label htmlFor="projectName" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
                  Project Name
                </label>
                <input
                  id="projectName"
                  type="text"
                  autoFocus
                  required
                  disabled={creating}
                  className="w-full bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
                  placeholder="e.g. Oakhaven Residential Tower"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                />
              </div>

              <div className="mb-6">
                <label htmlFor="projectType" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
                  Project Type <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <select
                  id="projectType"
                  disabled={creating}
                  className="w-full bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
                  value={newProjectType}
                  onChange={(e) => setNewProjectType(e.target.value)}
                >
                  <option value="">— Not set —</option>
                  {PROJECT_TYPES.map((pt) => (
                    <option key={pt} value={pt}>{pt}</option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Sets the project’s vertical so the location-type picker surfaces the most likely spaces first. You can change this later in Settings → Data.
                </p>
              </div>

              <div className="flex justify-end gap-3 mt-8">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={creating}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !newProjectName.trim()}
                  className="px-5 py-2.5 rounded-xl text-sm font-bold bg-sky-500 hover:bg-sky-600 text-white shadow-sm flex items-center gap-2 transition-colors disabled:opacity-50"
                >
                  {creating && <Loader2 size={16} className="animate-spin" />}
                  {creating ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <GlobalSettingsModal
        isOpen={isGlobalSettingsOpen}
        onClose={() => setIsGlobalSettingsOpen(false)}
        adminProjects={adminProjects}
        onProjectDeleted={handleProjectDeleted}
      />
    </div>
  );
}

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/supabaseClient';
import { useAuth } from '@/providers/AuthProvider';
import { LayoutDashboard, Plus, Loader2, Folder, Shield, ArrowRight, X, Info } from 'lucide-react';

export default function DashboardPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // NEW: Read link_procore_project parameter
  const [linkProcoreProject, setLinkProcoreProject] = useState(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      const linkId = searchParams.get('link_procore_project');
      if (linkId) setLinkProcoreProject(linkId);
    }
  }, []);
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creating, setCreating] = useState(false);

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
        // Sort projects by created_at descending
        const sorted = data.sort((a, b) => new Date(b.projects.created_at) - new Date(a.projects.created_at));
        setProjects(sorted);
      }
      setLoading(false);
    }
    
    fetchProjects();
  }, [session]);

  const handleCreateProject = async (e) => {
    e.preventDefault();
    if (!newProjectName.trim() || !session?.user?.id) return;
    
    setCreating(true);
    try {
      // 1. Create project (WITH PROCORE ID)
      const insertData = { name: newProjectName.trim() };
      if (linkProcoreProject) {
        insertData.procore_project_id = linkProcoreProject;
      }

      const { data: projectRecord, error: projectError } = await supabase
        .from('projects')
        .insert([insertData])
        .select()
        .single();
        
      if (projectError) throw projectError;
      
      // 2. Assign admin role
      const { error: memberError } = await supabase
        .from('project_members')
        .insert([{
          project_id: projectRecord.id,
          user_id: session.user.id,
          role: 'admin'
        }]);
        
      if (memberError) throw memberError;
      
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
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 px-5 py-2.5 rounded-xl font-bold transition-all shadow-sm group"
          >
            <Plus size={20} className="group-hover:rotate-90 transition-transform" />
            New Project
          </button>
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
              <h2 className="text-xl font-bold flex items-center gap-2">
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
                  className="w-full bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
                  placeholder="e.g. Oakhaven Residential Tower"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                />
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
    </div>
  );
}

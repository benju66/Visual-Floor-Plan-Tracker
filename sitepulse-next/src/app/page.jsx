import { redirect } from 'next/navigation';
import { supabase } from '@/supabaseClient';

export default async function RootPage() {
  // Fetch the first available project
  const { data: project, error } = await supabase
    .from('projects')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (error || !project) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 text-slate-500">
        <p>No projects found. Please create a project to get started.</p>
      </div>
    );
  }

  // Redirect to the first project's dashboard
  redirect(`/project/${project.id}`);
}

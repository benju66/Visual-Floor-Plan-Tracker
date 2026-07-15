import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserFromRequest } from '@/utils/serverAuth';

// Create a project with the service-role key (server-side only) and make the
// creating user its admin. The user identity is taken from the caller's VERIFIED
// login token — never from the request body — so an unauthenticated caller can no
// longer create projects or grant themselves membership. Client-facing errors are
// generic; the real detail goes to `console.error` only.

export async function POST(request) {
  // 1. Require a real login token and derive the user from it.
  const { user, error: authError } = await getUserFromRequest(request);
  if (authError) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: authError.status });
  }

  try {
    const body = await request.json();
    const { name, procore_project_id, project_type } = body;

    if (!name) {
      return NextResponse.json({ error: 'Missing project name.' }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // 2. Create project
    const insertData = { name, project_type: project_type ?? null };
    if (procore_project_id) {
      insertData.procore_project_id = procore_project_id;
    }

    const { data: projectRecord, error: projectError } = await supabaseAdmin
      .from('projects')
      .insert([insertData])
      .select()
      .single();

    if (projectError) throw projectError;

    // 3. Assign the admin role to the VERIFIED user (ignore any body user_id).
    const { error: memberError } = await supabaseAdmin
      .from('project_members')
      .insert([{
        project_id: projectRecord.id,
        user_id: user.id,
        role: 'admin'
      }]);

    if (memberError) {
      // The membership row failed, so this project would be an orphan nobody can
      // reach. Best-effort delete it before failing, so we don't leave litter.
      const { error: cleanupError } = await supabaseAdmin
        .from('projects')
        .delete()
        .eq('id', projectRecord.id);
      if (cleanupError) {
        console.error('Project cleanup after member-insert failure also failed:', cleanupError);
      }
      throw memberError;
    }

    return NextResponse.json(projectRecord);
  } catch (error) {
    console.error('Project Creation Error:', error);
    return NextResponse.json({ error: 'Could not create the project.' }, { status: 500 });
  }
}

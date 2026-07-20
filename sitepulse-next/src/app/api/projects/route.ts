import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserFromRequest } from '@/utils/serverAuth';
import type { Database } from '@/types/database.types';

// Create a project with the service-role key (server-side only) and make the
// creating user its admin. The user identity is taken from the caller's VERIFIED
// login token — never from the request body — so an unauthenticated caller can no
// longer create projects or grant themselves membership. Client-facing errors are
// generic; the real detail goes to `console.error` only.

// The service-role client is intentionally untyped (house style — matches the
// callback + workbench-container routes), so derive the insert shape from the
// generated schema rather than hand-writing it (AGENTS §6).
type ProjectInsert = Database['public']['Tables']['projects']['Insert'];

export async function POST(request: Request) {
  // 1. Require a real login token and derive the user from it.
  const { user, error: authError } = await getUserFromRequest(request);
  if (authError) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: authError.status });
  }

  try {
    // Narrow the untyped JSON body to the fields this route consumes (AGENTS §6 —
    // never let the `any` from request.json() propagate). This is a compile-time
    // assertion, not a runtime validator: the `!name` reject below and a non-object
    // body still behave byte-identically to the pre-conversion `const { … } = body`.
    const body: unknown = await request.json();
    const { name, procore_project_id, project_type } = body as {
      name?: string;
      procore_project_id?: string | null;
      project_type?: string | null;
    };

    if (!name) {
      return NextResponse.json({ error: 'Missing project name.' }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string
    );

    // 2. Create project
    const insertData: ProjectInsert = { name, project_type: project_type ?? null };
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

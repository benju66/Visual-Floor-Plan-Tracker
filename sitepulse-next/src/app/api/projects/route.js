import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request) {
  try {
    const body = await request.json();
    const { name, procore_project_id, project_type, user_id } = body;

    if (!name || !user_id) {
      return NextResponse.json({ error: 'Missing name or user_id' }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // 1. Create project
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

    // 2. Assign admin role
    const { error: memberError } = await supabaseAdmin
      .from('project_members')
      .insert([{
        project_id: projectRecord.id,
        user_id: user_id,
        role: 'admin'
      }]);

    if (memberError) {
      // If member assignment fails, we might want to log it or handle cleanup, 
      // but for now we'll just throw the error.
      throw memberError;
    }

    return NextResponse.json(projectRecord);
  } catch (error) {
    console.error('Project Creation Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

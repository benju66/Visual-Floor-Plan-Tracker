import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  
  // Look for the exact parameters Procore passes
  const procoreProjectId = searchParams.get('project_id');
  const procoreCompanyId = searchParams.get('company_id');

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  const baseUrl = `${proto}://${host}`;

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  if (procoreProjectId) {
    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('procore_project_id', procoreProjectId)
      .maybeSingle(); // Prevents a hard 500 error if no rows or duplicate rows are found

    if (project) {
      return NextResponse.redirect(`${baseUrl}/project/${project.id}`);
    } else {
      return NextResponse.redirect(`${baseUrl}/dashboard?link_procore_project=${procoreProjectId}&link_procore_company=${procoreCompanyId}`);
    }
  }

  return NextResponse.redirect(`${baseUrl}/dashboard`);
}
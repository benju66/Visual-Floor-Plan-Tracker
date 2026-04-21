import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  
  // Look for both the custom parameters AND the default Procore parameters
  const procoreProjectId = searchParams.get('procore_project_id') || searchParams.get('project_id');
  const procoreCompanyId = searchParams.get('procore_company_id') || searchParams.get('company_id');

  // MAGIC FIX: Dynamically grab the ngrok URL from the request headers
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
      .single();

    if (project) {
      return NextResponse.redirect(`${baseUrl}/project/${project.id}`);
    } else {
      return NextResponse.redirect(`${baseUrl}/dashboard?link_procore_project=${procoreProjectId}&link_procore_company=${procoreCompanyId}`);
    }
  }

  return NextResponse.redirect(`${baseUrl}/dashboard`);
}
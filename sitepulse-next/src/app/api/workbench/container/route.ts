import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Bootstrap (find-or-create) the SINGLE hidden Location Labeling Workbench
// container — a `projects` row flagged `kind='workbench'`. Mirrors
// `src/app/api/projects/route.js`: it runs with the service-role key SERVER-SIDE
// ONLY (so we never widen client RLS) and assigns the creating user the
// `'admin'` role (a plain `.insert`, NOT the `create_new_project` RPC — same as
// api/projects). That admin membership satisfies the privileged-write RLS on
// workbench_sheets / sheets / units the later phases rely on.
//
// Lazy-create on first privileged visit (the plan's default): if a workbench
// container already exists we return it untouched and add no membership — v1
// keeps one shared container with manual membership (plan § Out of scope).

const WORKBENCH_CONTAINER_NAME = 'Drawing Library';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { user_id } = body as { user_id?: string };

    if (!user_id) {
      return NextResponse.json({ error: 'Missing user_id' }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    );

    // 1. Look for the existing container. Ordered + limited so that, even if a
    //    race ever produced two, we deterministically return the earliest one.
    const { data: existing, error: findError } = await supabaseAdmin
      .from('projects')
      .select('*')
      .eq('kind', 'workbench')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (findError) throw findError;

    if (existing) {
      return NextResponse.json(existing);
    }

    // 2. None exists — create it.
    const { data: container, error: createError } = await supabaseAdmin
      .from('projects')
      .insert([{ name: WORKBENCH_CONTAINER_NAME, kind: 'workbench' }])
      .select()
      .single();

    if (createError) throw createError;

    // 3. Make the creating user an admin (mirrors api/projects).
    const { error: memberError } = await supabaseAdmin
      .from('project_members')
      .insert([{ project_id: container.id, user_id, role: 'admin' }]);

    if (memberError) throw memberError;

    return NextResponse.json(container);
  } catch (error) {
    console.error('Workbench Container Bootstrap Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
